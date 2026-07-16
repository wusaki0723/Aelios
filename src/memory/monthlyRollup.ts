import {
  bindDeleteWeeklyLogsByWeeksStatement,
  bindUpsertMonthlyLogStatement,
  getMonthlyLog,
  listWeeklyLogsBeforeStartDate,
  type WeeklyLogRow
} from "../db/v2";
import { callOpenAICompat } from "../proxy/openaiAdapter";
import type { Env, OpenAIChatRequest, OpenAIChatResponse } from "../types";
import {
  addDaysToDateLabel,
  getDateLabelsLookback
} from "./dreamDates";
import { readDreamTimeZoneFromEnv } from "./dreamEnv";
import { getMondayOfIsoWeek } from "./weeklyRollup";

const DEFAULT_TIME_ZONE = "Asia/Shanghai";
const DEFAULT_DREAM_MODEL = "workers-ai/@cf/openai/gpt-oss-120b";
const MAX_MONTHS_PER_RUN = 2;
const ROLLUP_AGE_DAYS = 35;
const MODEL_RETRY_BACKOFF_MS = [2000, 8000];

export interface MonthlyRollupMonthDetail {
  month: string;
  status: "rolled_up" | "skipped" | "dry_run" | "error";
  source_weeks?: number;
  deleted_weeks?: number;
  title?: string;
  summary?: string;
  reason?: string;
}

export interface MonthlyRollupStats {
  enabled: boolean;
  dry_run: boolean;
  cutoff_date: string;
  months_eligible: number;
  months_processed: number;
  months_skipped: number;
  details: MonthlyRollupMonthDetail[];
}

export type MonthlyRollupOptions = {
  dryRun?: boolean;
};

type MonthlyRollupModelResult = {
  title: string;
  summary: string;
} | null;

interface MonthlyRollupModelCallResult {
  result: MonthlyRollupModelResult;
  reason?: "model_error" | "model_invalid_json";
  model?: string;
  status?: number;
  finishReason?: string | null;
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function isMonthlyRollupEnabled(env: Env): boolean {
  const flag = readString(env.ENABLE_MONTHLY_ROLLUP);
  if (flag) return flag !== "false";
  return true;
}

function readRollupModel(env: Env): string {
  const raw = readString(env.DIARY_MODEL) || readString(env.DREAM_MODEL);
  return raw || DEFAULT_DREAM_MODEL;
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
  return getDateLabelsLookback(todayLabel, ROLLUP_AGE_DAYS + 1, timeZone)[ROLLUP_AGE_DAYS] ?? todayLabel;
}

export function getMonthLabelForWeekStart(startDate: string, timeZone: string): string {
  const monday = getMondayOfIsoWeek(startDate, timeZone);
  const thursday = addDaysToDateLabel(monday, 3, timeZone);
  return thursday.slice(0, 7);
}

function extractJsonObject(text: string): unknown | null {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    // Some providers wrap JSON in prose; pull out the outermost object.
  }

  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;

  try {
    return JSON.parse(text.slice(start, end + 1)) as unknown;
  } catch {
    return null;
  }
}

function normalizeMonthlyRollupResult(value: unknown): MonthlyRollupModelResult {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const title = readString(raw.title);
  const summary = readString(raw.summary);
  if (!title || !summary) return null;
  return { title, summary };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetriableModelStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

function buildMonthlyRollupPrompt(input: {
  month: string;
  weeklyLogs: Array<{ week: string; title: string; summary: string }>;
  existingMonthly?: { title: string; summary: string } | null;
}): string {
  const weekLines = input.weeklyLogs
    .map((row) => `- ${row.week} | ${row.title}\n  ${row.summary}`)
    .join("\n\n");

  const sections = [
    "你是 Aelios 的月度印象整理器。你会读取多周周记，写成 2-3 句宽泛的月度印象。",
    "只输出 JSON，不要 markdown，不要解释，不要输出思考过程。",
    "",
    "目标：",
    "- 只保留宽泛主题和关系氛围，不要精确数字、引语、工具名或私密细节。",
    "- summary 是 2-3 句自然中文月度印象。",
    "- title 是 12 字以内的月标题。",
    "- 站在「我=助手」视角；关于用户用「你」，关于助手承诺用「我需要」。",
    "- 不要提到 D1、Vectorize、RAG、数据库、记忆系统、代理层等实现细节。",
    "",
    `月份：${input.month}`,
    "",
    "输出 JSON 结构：",
    JSON.stringify({
      title: "一月印象",
      summary: "这个月整体氛围如何、关系主题是什么、有哪些值得继续感受的线索。"
    })
  ];

  if (input.existingMonthly) {
    sections.push(
      "",
      "已有月记（需与新周记合并刷新）：",
      `- ${input.existingMonthly.title}\n  ${input.existingMonthly.summary}`,
      "",
      "新增周记：",
      weekLines || "(无周记内容)"
    );
  } else {
    sections.push("", "本月周记：", weekLines || "(无周记内容)");
  }

  return sections.join("\n");
}

async function callMonthlyRollupModel(
  env: Env,
  prompt: string,
  meta: { month: string; weekCount: number }
): Promise<MonthlyRollupModelCallResult> {
  const model = readRollupModel(env);

  const request: OpenAIChatRequest = {
    model,
    messages: [
      { role: "system", content: "你是严格的 JSON 生成器。你只输出 JSON，不要输出思考过程。" },
      { role: "user", content: prompt }
    ],
    temperature: 0,
    max_tokens: readRollupMaxTokens(env),
    response_format: { type: "json_object" },
    stream: false
  };

  const startedAt = Date.now();
  console.log("monthly_rollup: calling model", {
    month: meta.month,
    model,
    weekCount: meta.weekCount,
    promptChars: prompt.length,
    maxTokens: request.max_tokens
  });

  const maxAttempts = 1 + MODEL_RETRY_BACKOFF_MS.length;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    if (attempt > 0) {
      const backoffMs = MODEL_RETRY_BACKOFF_MS[attempt - 1] ?? MODEL_RETRY_BACKOFF_MS.at(-1) ?? 8000;
      console.warn("monthly_rollup: retrying model call after non-ok response", {
        month: meta.month,
        model,
        attempt: attempt + 1,
        maxAttempts,
        backoffMs
      });
      await delay(backoffMs);
    }

    try {
      const response = await callOpenAICompat(env, request);
      const elapsedMs = Date.now() - startedAt;
      if (!response.ok) {
        const retriable = isRetriableModelStatus(response.status);
        console.error("monthly_rollup: model returned non-ok", {
          month: meta.month,
          model,
          status: response.status,
          statusText: response.statusText,
          elapsedMs,
          attempt: attempt + 1,
          retriable
        });
        if (retriable && attempt < maxAttempts - 1) continue;
        return { result: null, reason: "model_error", model, status: response.status };
      }

      const parsed = (await response.json()) as OpenAIChatResponse;
      const choice = parsed.choices?.[0];
      const message = choice?.message as ({ content?: unknown; reasoning_content?: unknown }) | undefined;
      const content = typeof message?.content === "string" ? message.content.trim() : "";
      const reasoning = typeof message?.reasoning_content === "string" ? message.reasoning_content.trim() : "";
      const json = extractJsonObject(content || reasoning);
      const result = normalizeMonthlyRollupResult(json);
      if (!result) {
        console.error("monthly_rollup: model returned invalid JSON", {
          month: meta.month,
          model,
          elapsedMs,
          finishReason: choice?.finish_reason ?? null,
          contentChars: content.length,
          reasoningChars: reasoning.length
        });
        return { result: null, reason: "model_invalid_json", model, finishReason: choice?.finish_reason };
      }

      console.log("monthly_rollup: model returned valid JSON", {
        month: meta.month,
        model,
        elapsedMs,
        finishReason: choice?.finish_reason ?? null,
        attempt: attempt + 1
      });
      return { result, model };
    } catch (error) {
      const elapsedMs = Date.now() - startedAt;
      const message = error instanceof Error && error.message ? error.message : String(error);
      console.error("monthly_rollup model failed", {
        month: meta.month,
        model,
        elapsedMs,
        attempt: attempt + 1,
        error: message
      });
      if (attempt < maxAttempts - 1) continue;
      return { result: null, reason: "model_error", model };
    }
  }

  return { result: null, reason: "model_error", model };
}

function collectEligibleMonths(input: {
  weeklyLogs: WeeklyLogRow[];
  timeZone: string;
}): Map<string, WeeklyLogRow[]> {
  const byMonth = new Map<string, WeeklyLogRow[]>();
  for (const row of input.weeklyLogs) {
    const month = getMonthLabelForWeekStart(row.start_date, input.timeZone);
    const existing = byMonth.get(month) ?? [];
    existing.push(row);
    byMonth.set(month, existing);
  }
  return byMonth;
}

async function processMonth(
  env: Env,
  input: {
    namespace: string;
    month: string;
    weeklyLogs: WeeklyLogRow[];
    dryRun: boolean;
  }
): Promise<MonthlyRollupMonthDetail> {
  const { namespace, month, weeklyLogs, dryRun } = input;
  const baseDetail: MonthlyRollupMonthDetail = {
    month,
    status: "skipped"
  };

  const existingMonthly = await getMonthlyLog(env.DB, { namespace, month });

  if (!existingMonthly && weeklyLogs.length < 2) {
    return { ...baseDetail, status: "skipped", reason: "orphan_weeks", source_weeks: weeklyLogs.length };
  }

  const prompt = buildMonthlyRollupPrompt({
    month,
    weeklyLogs: weeklyLogs.map((row) => ({ week: row.week, title: row.title, summary: row.summary })),
    existingMonthly: existingMonthly
      ? { title: existingMonthly.title, summary: existingMonthly.summary }
      : null
  });
  const modelResult = await callMonthlyRollupModel(env, prompt, {
    month,
    weekCount: weeklyLogs.length
  });

  if (!modelResult.result) {
    return {
      ...baseDetail,
      status: "error",
      source_weeks: weeklyLogs.length,
      reason: modelResult.reason ?? "model_error"
    };
  }

  if (dryRun) {
    return {
      ...baseDetail,
      status: "dry_run",
      source_weeks: weeklyLogs.length,
      title: modelResult.result.title,
      summary: modelResult.result.summary
    };
  }

  try {
    const upsertStmt = bindUpsertMonthlyLogStatement(env.DB, {
      namespace,
      month,
      title: modelResult.result.title,
      summary: modelResult.result.summary,
      sourceWeekCount: weeklyLogs.length
    });
    const deleteStmts = bindDeleteWeeklyLogsByWeeksStatement(env.DB, {
      namespace,
      weeks: weeklyLogs.map((row) => row.week)
    });
    const results = await env.DB.batch([upsertStmt, ...deleteStmts]);

    const saved = await getMonthlyLog(env.DB, { namespace, month });
    if (!saved) {
      return {
        ...baseDetail,
        status: "error",
        source_weeks: weeklyLogs.length,
        reason: "monthly_log_write_unconfirmed"
      };
    }

    const deletedWeeks = deleteStmts.length > 0 ? (results[1]?.meta?.changes ?? 0) : 0;

    return {
      ...baseDetail,
      status: "rolled_up",
      source_weeks: weeklyLogs.length,
      deleted_weeks: deletedWeeks,
      title: saved.title,
      summary: saved.summary
    };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    console.error("monthly_rollup: failed to persist month", {
      namespace,
      month,
      error: reason
    });
    return {
      ...baseDetail,
      status: "error",
      source_weeks: weeklyLogs.length,
      reason
    };
  }
}

export async function runMonthlyRollup(
  env: Env,
  namespace: string,
  options: MonthlyRollupOptions = {}
): Promise<MonthlyRollupStats> {
  const dryRun = options.dryRun === true;
  const enabled = isMonthlyRollupEnabled(env);
  const timeZone = readDreamTimeZoneFromEnv(env) || DEFAULT_TIME_ZONE;
  const todayLabel = formatTodayDateLabel(timeZone);
  const cutoffDate = getCutoffDateLabel(todayLabel, timeZone);

  if (!enabled) {
    return {
      enabled: false,
      dry_run: dryRun,
      cutoff_date: cutoffDate,
      months_eligible: 0,
      months_processed: 0,
      months_skipped: 0,
      details: []
    };
  }

  const weeklyLogs = await listWeeklyLogsBeforeStartDate(env.DB, {
    namespace,
    beforeStartDate: cutoffDate
  });
  const byMonth = collectEligibleMonths({ weeklyLogs, timeZone });
  const sortedMonths = [...byMonth.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  const eligibleMonths = sortedMonths.filter(([, rows]) => rows.length >= 2);
  const orphanMonths = sortedMonths.filter(([, rows]) => rows.length < 2);
  const monthsToProcess = eligibleMonths.slice(0, MAX_MONTHS_PER_RUN);
  const details: MonthlyRollupMonthDetail[] = [];

  for (const [month, rows] of orphanMonths) {
    try {
      const detail = await processMonth(env, { namespace, month, weeklyLogs: rows, dryRun });
      details.push(detail);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      details.push({ month, status: "error", reason });
    }
  }

  for (const [month, rows] of monthsToProcess) {
    try {
      const detail = await processMonth(env, { namespace, month, weeklyLogs: rows, dryRun });
      details.push(detail);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      console.error("monthly_rollup: month processing failed", {
        namespace,
        month,
        error: reason
      });
      details.push({
        month,
        status: "error",
        reason
      });
    }
  }

  const monthsProcessed = details.filter((item) => item.status === "rolled_up" || item.status === "dry_run").length;
  const monthsSkipped = details.filter((item) => item.status === "skipped").length;

  return {
    enabled: true,
    dry_run: dryRun,
    cutoff_date: cutoffDate,
    months_eligible: byMonth.size,
    months_processed: monthsProcessed,
    months_skipped: monthsSkipped,
    details
  };
}