import {
  bindDeleteDailyLogsInRangeStatement,
  bindUpsertWeeklyLogStatement,
  deleteDailyLogsInRange,
  getWeeklyLog,
  listDailyLogDatesBefore,
  listDailyLogsInRange
} from "../db/v2";
import type { Env } from "../types";
import { callModelWithRetry, ModelCallError, readModelName } from "../utils/modelCall";
import {
  addDaysToDateLabel,
  getDateLabelsLookback,
  getDateRangeForLabel
} from "./dreamDates";
import { readDreamTimeZoneFromEnv } from "./dreamEnv";
import { extractJsonObject, readString } from "../utils/parse";

const DEFAULT_TIME_ZONE = "Asia/Singapore";
const DEFAULT_DREAM_MODEL = "workers-ai/@cf/openai/gpt-oss-120b";
const MAX_WEEKS_PER_RUN = 2;

export interface WeeklyRollupWeekDetail {
  week: string;
  start_date: string;
  end_date: string;
  status: "rolled_up" | "skipped" | "dry_run" | "error";
  source_days?: number;
  deleted_days?: number;
  title?: string;
  summary?: string;
  reason?: string;
}

export interface WeeklyRollupStats {
  enabled: boolean;
  dry_run: boolean;
  cutoff_date: string;
  weeks_eligible: number;
  weeks_processed: number;
  weeks_skipped: number;
  details: WeeklyRollupWeekDetail[];
}

export type WeeklyRollupOptions = {
  dryRun?: boolean;
};

type WeeklyRollupModelResult = {
  title: string;
  summary: string;
} | null;

interface WeeklyRollupModelCallResult {
  result: WeeklyRollupModelResult;
  reason?: "model_error" | "model_invalid_json";
  model?: string;
  status?: number;
  finishReason?: string | null;
}

interface IsoWeekRange {
  week: string;
  monday: string;
  sunday: string;
}

function isWeeklyRollupEnabled(env: Env): boolean {
  const flag = readString(env.ENABLE_WEEKLY_ROLLUP);
  if (flag) return flag !== "false";
  return true;
}

function readRollupModel(env: Env): string {
  return readModelName(env, ["DREAM_MODEL", "DAILY_DIGEST_MODEL", "SUMMARY_MODEL"], DEFAULT_DREAM_MODEL);
}

function readRollupMaxTokens(env: Env): number {
  const parsed = Number(env.DREAM_MAX_TOKENS || env.DAILY_DIGEST_MAX_TOKENS || 3000);
  const numeric = Number.isFinite(parsed) ? parsed : 3000;
  return Math.min(Math.max(Math.floor(numeric), 1), 8000);
}

function formatTodayDateLabel(timeZone: string, now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(now);
}

function getCutoffDateLabel(todayLabel: string, timeZone: string): string {
  return getDateLabelsLookback(todayLabel, 8, timeZone)[7] ?? todayLabel;
}

function getDayOfWeekMonday0(dateLabel: string, timeZone: string): number {
  const { startIso } = getDateRangeForLabel(dateLabel, timeZone);
  const weekday = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short" }).format(new Date(startIso));
  const map: Record<string, number> = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };
  return map[weekday] ?? 0;
}

export function getMondayOfIsoWeek(dateLabel: string, timeZone: string): string {
  const dayIndex = getDayOfWeekMonday0(dateLabel, timeZone);
  return getDateLabelsLookback(dateLabel, dayIndex + 1, timeZone)[dayIndex] ?? dateLabel;
}

export function getSundayOfIsoWeek(mondayLabel: string, timeZone: string): string {
  return addDaysToDateLabel(mondayLabel, 6, timeZone);
}

export function getIsoWeekLabelForDateLabel(dateLabel: string, timeZone: string): string {
  const monday = getMondayOfIsoWeek(dateLabel, timeZone);
  const thursday = addDaysToDateLabel(monday, 3, timeZone);
  const [year, month, day] = thursday.split("-").map((value) => Number(value));
  const date = new Date(Date.UTC(year, month - 1, day));
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((date.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`;
}

export function getIsoWeekRangeForDateLabel(dateLabel: string, timeZone: string): IsoWeekRange {
  const monday = getMondayOfIsoWeek(dateLabel, timeZone);
  const sunday = getSundayOfIsoWeek(monday, timeZone);
  return {
    week: getIsoWeekLabelForDateLabel(dateLabel, timeZone),
    monday,
    sunday
  };
}

function normalizeWeeklyRollupResult(value: unknown): WeeklyRollupModelResult {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const title = readString(raw.title);
  const summary = readString(raw.summary);
  if (!title || !summary) return null;
  return { title, summary };
}

function buildWeeklyRollupPrompt(input: {
  week: string;
  startDate: string;
  endDate: string;
  dailyLogs: Array<{ date: string; title: string; summary: string }>;
}): string {
  const diaryLines = input.dailyLogs
    .map((row) => `- ${row.date} | ${row.title}\n  ${row.summary}`)
    .join("\n\n");

  return [
    "你是 Aelios 的周报整理器。你会读取一周内已写好的每日日记，把它们浓缩成一条自然中文周记。",
    "只输出 JSON，不要 markdown，不要解释，不要输出思考过程。",
    "",
    "目标：",
    "- 保留具体事件、情绪线索和关系转折，不要写成空泛总结。",
    "- summary 是一段自然中文周记，300 字以内。",
    "- title 是 12 字以内的周标题。",
    "- 站在「我=助手」视角；关于用户用「你」，关于助手承诺用「我需要」。",
    "- 不要提到 D1、Vectorize、RAG、数据库、记忆系统、代理层等实现细节。",
    "",
    `周次：${input.week}`,
    `日期范围：${input.startDate} 至 ${input.endDate}`,
    "",
    "输出 JSON 结构：",
    JSON.stringify({
      title: "一周标题",
      summary: "这一周发生了什么、情绪如何流动、有哪些值得继续记住的线索。"
    }),
    "",
    "本周每日日记：",
    diaryLines || "(无日记内容)"
  ].join("\n");
}

async function callWeeklyRollupModel(
  env: Env,
  prompt: string,
  meta: { week: string; dayCount: number }
): Promise<WeeklyRollupModelCallResult> {
  const model = readRollupModel(env);
  const maxTokens = readRollupMaxTokens(env);

  const startedAt = Date.now();
  console.log("weekly_rollup: calling model", {
    week: meta.week,
    model,
    dayCount: meta.dayCount,
    promptChars: prompt.length,
    maxTokens
  });

  let text: string;
  try {
    text = await callModelWithRetry(env, {
      model,
      prompt,
      maxTokens,
      logPrefix: "weekly_rollup",
      logMeta: { week: meta.week }
    });
  } catch (error) {
    return {
      result: null,
      reason: "model_error",
      model,
      status: error instanceof ModelCallError ? error.status : undefined
    };
  }

  const elapsedMs = Date.now() - startedAt;
  const json = extractJsonObject(text);
  const result = normalizeWeeklyRollupResult(json);
  if (!result) {
    console.error("weekly_rollup: model returned invalid JSON", {
      week: meta.week,
      model,
      elapsedMs,
      contentChars: text.length
    });
    return { result: null, reason: "model_invalid_json", model };
  }

  console.log("weekly_rollup: model returned valid JSON", {
    week: meta.week,
    model,
    elapsedMs
  });
  return { result, model };
}

function collectEligibleWeeks(input: {
  dates: string[];
  cutoffDate: string;
  timeZone: string;
}): IsoWeekRange[] {
  const byWeek = new Map<string, IsoWeekRange>();

  for (const date of input.dates) {
    const range = getIsoWeekRangeForDateLabel(date, input.timeZone);
    if (range.sunday >= input.cutoffDate) continue;
    const existing = byWeek.get(range.week);
    if (!existing || existing.monday > range.monday) {
      byWeek.set(range.week, range);
    }
  }

  return [...byWeek.values()].sort((a, b) => a.monday.localeCompare(b.monday));
}

async function processWeek(
  env: Env,
  input: {
    namespace: string;
    weekRange: IsoWeekRange;
    dryRun: boolean;
  }
): Promise<WeeklyRollupWeekDetail> {
  const { namespace, weekRange, dryRun } = input;
  const baseDetail: WeeklyRollupWeekDetail = {
    week: weekRange.week,
    start_date: weekRange.monday,
    end_date: weekRange.sunday,
    status: "skipped"
  };

  const existingWeekly = await getWeeklyLog(env.DB, { namespace, week: weekRange.week });
  if (existingWeekly) {
    const leftoverDailyLogs = await listDailyLogsInRange(env.DB, {
      namespace,
      startDate: weekRange.monday,
      endDate: weekRange.sunday
    });
    let deletedDays = 0;
    if (!dryRun) {
      deletedDays = await deleteDailyLogsInRange(env.DB, {
        namespace,
        startDate: weekRange.monday,
        endDate: weekRange.sunday
      });
    }
    return {
      ...baseDetail,
      status: "skipped",
      reason: "already_rolled_up",
      source_days: leftoverDailyLogs.length,
      deleted_days: deletedDays
    };
  }

  const dailyLogs = await listDailyLogsInRange(env.DB, {
    namespace,
    startDate: weekRange.monday,
    endDate: weekRange.sunday
  });
  if (dailyLogs.length === 0) {
    return { ...baseDetail, status: "skipped", reason: "no_daily_logs" };
  }

  const prompt = buildWeeklyRollupPrompt({
    week: weekRange.week,
    startDate: weekRange.monday,
    endDate: weekRange.sunday,
    dailyLogs: dailyLogs.map((row) => ({ date: row.date, title: row.title, summary: row.summary }))
  });
  const modelResult = await callWeeklyRollupModel(env, prompt, {
    week: weekRange.week,
    dayCount: dailyLogs.length
  });

  if (!modelResult.result) {
    return {
      ...baseDetail,
      status: "error",
      source_days: dailyLogs.length,
      reason: modelResult.reason ?? "model_error"
    };
  }

  if (dryRun) {
    return {
      ...baseDetail,
      status: "dry_run",
      source_days: dailyLogs.length,
      title: modelResult.result.title,
      summary: modelResult.result.summary
    };
  }

  try {
    const upsertStmt = bindUpsertWeeklyLogStatement(env.DB, {
      namespace,
      week: weekRange.week,
      startDate: weekRange.monday,
      endDate: weekRange.sunday,
      title: modelResult.result.title,
      summary: modelResult.result.summary,
      sourceDays: dailyLogs.length
    });
    const deleteStmt = bindDeleteDailyLogsInRangeStatement(env.DB, {
      namespace,
      startDate: weekRange.monday,
      endDate: weekRange.sunday
    });
    const [, deleteResult] = await env.DB.batch([upsertStmt, deleteStmt]);

    const saved = await getWeeklyLog(env.DB, { namespace, week: weekRange.week });
    if (!saved) {
      return {
        ...baseDetail,
        status: "error",
        source_days: dailyLogs.length,
        reason: "weekly_log_write_unconfirmed"
      };
    }

    const deletedDays = deleteResult.meta?.changes ?? 0;

    return {
      ...baseDetail,
      status: "rolled_up",
      source_days: dailyLogs.length,
      deleted_days: deletedDays,
      title: saved.title,
      summary: saved.summary
    };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    console.error("weekly_rollup: failed to persist week", {
      namespace,
      week: weekRange.week,
      error: reason
    });
    return {
      ...baseDetail,
      status: "error",
      source_days: dailyLogs.length,
      reason
    };
  }
}

export async function runWeeklyRollup(
  env: Env,
  namespace: string,
  options: WeeklyRollupOptions = {}
): Promise<WeeklyRollupStats> {
  const dryRun = options.dryRun === true;
  const enabled = isWeeklyRollupEnabled(env);
  const timeZone = readDreamTimeZoneFromEnv(env) || DEFAULT_TIME_ZONE;
  const todayLabel = formatTodayDateLabel(timeZone);
  const cutoffDate = getCutoffDateLabel(todayLabel, timeZone);

  if (!enabled) {
    return {
      enabled: false,
      dry_run: dryRun,
      cutoff_date: cutoffDate,
      weeks_eligible: 0,
      weeks_processed: 0,
      weeks_skipped: 0,
      details: []
    };
  }

  const dates = await listDailyLogDatesBefore(env.DB, { namespace, beforeDate: cutoffDate });
  const eligibleWeeks = collectEligibleWeeks({ dates, cutoffDate, timeZone });
  const weeksToProcess = eligibleWeeks.slice(0, MAX_WEEKS_PER_RUN);
  const details: WeeklyRollupWeekDetail[] = [];

  for (const weekRange of weeksToProcess) {
    try {
      const detail = await processWeek(env, { namespace, weekRange, dryRun });
      details.push(detail);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      console.error("weekly_rollup: week processing failed", {
        namespace,
        week: weekRange.week,
        error: reason
      });
      details.push({
        week: weekRange.week,
        start_date: weekRange.monday,
        end_date: weekRange.sunday,
        status: "error",
        reason
      });
    }
  }

  const weeksProcessed = details.filter((item) => item.status === "rolled_up" || item.status === "dry_run").length;
  const weeksSkipped = details.filter((item) => item.status === "skipped").length;

  return {
    enabled: true,
    dry_run: dryRun,
    cutoff_date: cutoffDate,
    weeks_eligible: eligibleWeeks.length,
    weeks_processed: weeksProcessed,
    weeks_skipped: weeksSkipped,
    details
  };
}