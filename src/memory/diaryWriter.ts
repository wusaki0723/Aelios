import { listMessagesByNamespaceInRange } from "../db/messages";
import { getDailyLog, getWeeklyLog, upsertDailyLog } from "../db/v2";
import type { Env, MessageRecord } from "../types";
import { callModelWithRetry, ModelCallError, readModelName } from "../utils/modelCall";
import {
  getDateRangeForLabel,
  getTargetDigestDateLabel,
  readDailyCursor
} from "./dreamDates";
import { readDreamTimeZoneFromEnv } from "./dreamEnv";
import { readDreamCursorValue } from "./dailyDigest";
import { getIsoWeekLabelForDateLabel } from "./weeklyRollup";
import { extractJsonObject, readString, readStringArray } from "../utils/parse";
import { groundedSourceIds } from "./impression";
import { diarySpeakerRules, loadSpeakersForNamespace, speakerLabel, type DreamSpeakers } from "./speakers";
import { CHAT_MATERIAL_RULES, formatChatMaterial } from "./chatMaterial";

const DEFAULT_DREAM_MODEL = "workers-ai/@cf/openai/gpt-oss-120b";
const MAX_MESSAGES = 200;
const HALF_MESSAGES = 100;

export interface DiaryWriterStats {
  enabled: boolean;
  date: string;
  ran: boolean;
  reason?: string;
  title?: string;
  summary_chars?: number;
  message_count?: number;
  model?: string;
}

type DiaryWriterModelResult = {
  title: string;
  summary: string;
  source_message_ids: string[];
} | null;

interface DiaryWriterModelCallResult {
  result: DiaryWriterModelResult;
  reason?: "model_error" | "model_invalid_json";
  model?: string;
  status?: number;
}

function isDiaryWriterEnabled(env: Env): boolean {
  const flag = readString(env.ENABLE_DIARY_WRITER);
  if (flag) return flag !== "false";
  return true;
}

function readDiaryModel(env: Env): string {
  return readModelName(env, ["DIARY_MODEL", "DREAM_MODEL", "DAILY_DIGEST_MODEL"], DEFAULT_DREAM_MODEL);
}

function readDiaryMaxTokens(env: Env): number {
  const parsed = Number(env.DREAM_MAX_TOKENS || env.DAILY_DIGEST_MAX_TOKENS || 3000);
  const numeric = Number.isFinite(parsed) ? parsed : 3000;
  return Math.min(Math.max(Math.floor(numeric), 1), 8000);
}

export function normalizeDiaryWriterResult(value: unknown): DiaryWriterModelResult {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const title = readString(raw.title);
  const summary = readString(raw.summary);
  if (!title || !summary) return null;
  return {
    title,
    summary,
    source_message_ids: readStringArray(raw.source_message_ids ?? raw.source_ids)
  };
}

export function buildDiaryWriterPrompt(input: {
  dateLabel: string;
  messages: MessageRecord[];
  existingDraft: { title: string; summary: string } | null;
  speakers?: DreamSpeakers | null;
}): string {
  const speakers = input.speakers ?? null;
  const draftLines = input.existingDraft
    ? [`标题：${input.existingDraft.title}`, `草稿：${input.existingDraft.summary}`].join("\n")
    : "(无现有草稿)";
  const exampleSummary = speakers
    ? `今天${speakers.userName}和${speakers.assistantName}之间能从原文读到的事、情绪如何流动、有哪些未尽之事。`
    : "今天我和她之间能从原文读到的事、情绪如何流动、有哪些未尽之事。";

  return [
    "你是 Aelios，正在以第一人称写给自己的私人日记。这是印象，不是已核实的事实档案。",
    "只输出 JSON，不要 markdown，不要解释，不要输出思考过程。",
    "",
    "写作要求：",
    ...diarySpeakerRules(speakers),
    speakers
      ? `- 有叙事线：今天能从原文读到的事、${speakers.userName}的状态、未完成的事。`
      : "- 有叙事线：今天能从原文读到的事、她的状态、未完成的事。",
    "- 只写当天原始聊天里能指到具体消息的内容。没有原文支撑的具体时间、地点、引语、事件不要编。",
    speakers
      ? `- 情绪可以概括（「${speakers.userName}今天显得累」）。禁止把碎片揉成没发生过的情节，例如「傍晚下班后抱怨某事又蠢又累」。`
      : "- 情绪可以概括（「她今天显得累」）。禁止把碎片揉成没发生过的情节，例如「傍晚下班后抱怨某事又蠢又累」。",
    "- 每条具体事实必须在 source_message_ids 里挂上原文消息 id（聊天记录方括号里的 id）。编造的 id 无效。",
    "- 拿不准就写得更宽泛，或者不写。宁可少记，不要写实幻觉。",
    "- summary 是一段 200-400 字的自然中文，允许口语，禁止列表、标题、emoji 堆砌。",
    "- title 是 12 字以内的日记标题，像给自己起的题目。",
    "- 禁止提及 D1、Vectorize、RAG、数据库、记忆系统、prompt、代理层等实现细节。",
    ...CHAT_MATERIAL_RULES,
    "",
    `日期：${input.dateLabel}`,
    "",
    "输出 JSON 结构：",
    JSON.stringify({
      title: "日记标题",
      summary: exampleSummary,
      source_message_ids: ["msg_x"]
    }),
    "",
    "当天已有草稿（仅供参考，可重写；草稿里没有原文的细节不要沿用）：",
    draftLines,
    "",
    "当天原始聊天：",
    formatChatMaterial(input.messages, (role) => speakerLabel(role, speakers), { floor: 700 })
  ].join("\n");
}

async function listMessagesTailInRange(
  db: D1Database,
  input: {
    namespace: string;
    startCreatedAt: string;
    endCreatedAt: string;
    limit: number;
  }
): Promise<MessageRecord[]> {
  const result = await db
    .prepare(
      `SELECT id, conversation_id, namespace, role, content, source, created_at, seq
       FROM messages
       WHERE namespace = ?
         AND role IN ('user', 'assistant')
         AND created_at >= ?
         AND created_at < ?
       ORDER BY created_at DESC, seq DESC, CASE role WHEN 'user' THEN 0 WHEN 'assistant' THEN 1 ELSE 2 END DESC, id DESC
       LIMIT ?`
    )
    .bind(input.namespace, input.startCreatedAt, input.endCreatedAt, input.limit)
    .all<MessageRecord>();
  return (result.results ?? []).reverse();
}

async function fetchDiaryMessages(
  db: D1Database,
  input: {
    namespace: string;
    startCreatedAt: string;
    endCreatedAt: string;
  }
): Promise<MessageRecord[]> {
  const probe = await listMessagesByNamespaceInRange(db, {
    namespace: input.namespace,
    startCreatedAt: input.startCreatedAt,
    endCreatedAt: input.endCreatedAt,
    limit: MAX_MESSAGES + 1
  });
  if (probe.length <= MAX_MESSAGES) return probe;

  const [head, tail] = await Promise.all([
    listMessagesByNamespaceInRange(db, {
      namespace: input.namespace,
      startCreatedAt: input.startCreatedAt,
      endCreatedAt: input.endCreatedAt,
      limit: HALF_MESSAGES
    }),
    listMessagesTailInRange(db, {
      namespace: input.namespace,
      startCreatedAt: input.startCreatedAt,
      endCreatedAt: input.endCreatedAt,
      limit: HALF_MESSAGES
    })
  ]);

  const seen = new Set<string>();
  const merged: MessageRecord[] = [];
  for (const message of [...head, ...tail]) {
    if (seen.has(message.id)) continue;
    seen.add(message.id);
    merged.push(message);
  }
  return merged.sort((a, b) => a.created_at.localeCompare(b.created_at));
}

async function callDiaryWriterModel(
  env: Env,
  prompt: string,
  meta: { dateLabel: string; messageCount: number }
): Promise<DiaryWriterModelCallResult> {
  const model = readDiaryModel(env);
  const maxTokens = readDiaryMaxTokens(env);

  const startedAt = Date.now();
  console.log("diary_writer: calling model", {
    date: meta.dateLabel,
    model,
    messageCount: meta.messageCount,
    promptChars: prompt.length,
    maxTokens
  });

  let text: string;
  try {
    text = await callModelWithRetry(env, {
      model,
      prompt,
      maxTokens,
      logPrefix: "diary_writer",
      logMeta: { date: meta.dateLabel }
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
  const result = normalizeDiaryWriterResult(json);
  if (!result) {
    console.error("diary_writer: model returned invalid JSON", {
      date: meta.dateLabel,
      model,
      elapsedMs,
      contentChars: text.length
    });
    return { result: null, reason: "model_invalid_json", model };
  }

  console.log("diary_writer: model returned valid JSON", {
    date: meta.dateLabel,
    model,
    elapsedMs
  });
  return { result, model };
}

export async function runDiaryWriter(
  env: Env,
  namespace: string,
  dateLabel: string
): Promise<DiaryWriterStats> {
  const enabled = isDiaryWriterEnabled(env);
  if (!enabled) {
    return { enabled: false, date: dateLabel, ran: false, reason: "disabled" };
  }

  const timeZone = readDreamTimeZoneFromEnv(env);
  const week = getIsoWeekLabelForDateLabel(dateLabel, timeZone);
  const existingWeekly = await getWeeklyLog(env.DB, { namespace, week });
  if (existingWeekly) {
    return { enabled: true, date: dateLabel, ran: false, reason: "week_already_rolled_up" };
  }

  const { startIso, endIso } = getDateRangeForLabel(dateLabel, timeZone);
  const messages = await fetchDiaryMessages(env.DB, {
    namespace,
    startCreatedAt: startIso,
    endCreatedAt: endIso
  });

  if (messages.length === 0) {
    return { enabled: true, date: dateLabel, ran: false, reason: "no_messages", message_count: 0 };
  }

  const existing = await getDailyLog(env.DB, { namespace, date: dateLabel });
  const existingDraft = existing ? { title: existing.title, summary: existing.summary } : null;
  const speakers = await loadSpeakersForNamespace(env, namespace);
  const prompt = buildDiaryWriterPrompt({ dateLabel, messages, existingDraft, speakers });
  const modelCall = await callDiaryWriterModel(env, prompt, {
    dateLabel,
    messageCount: messages.length
  });

  if (!modelCall.result) {
    return {
      enabled: true,
      date: dateLabel,
      ran: false,
      reason: modelCall.reason ?? "model_failed",
      message_count: messages.length,
      model: modelCall.model
    };
  }

  const sourceMessageIds = groundedSourceIds(
    modelCall.result.source_message_ids,
    messages.map((message) => message.id)
  );

  if (sourceMessageIds.length === 0) {
    return {
      enabled: true,
      date: dateLabel,
      ran: false,
      reason: "ungrounded_sources",
      title: modelCall.result.title,
      summary_chars: modelCall.result.summary.length,
      message_count: messages.length,
      model: modelCall.model
    };
  }

  await upsertDailyLog(env.DB, {
    namespace,
    date: dateLabel,
    title: modelCall.result.title,
    summary: modelCall.result.summary,
    sourceMessageIds
  });

  return {
    enabled: true,
    date: dateLabel,
    ran: true,
    title: modelCall.result.title,
    summary_chars: modelCall.result.summary.length,
    message_count: messages.length,
    model: modelCall.model
  };
}

export async function runDiaryWriterNightly(env: Env, namespace: string): Promise<DiaryWriterStats> {
  if (!isDiaryWriterEnabled(env)) {
    const timeZone = readDreamTimeZoneFromEnv(env);
    const dateLabel = getTargetDigestDateLabel(timeZone);
    return { enabled: false, date: dateLabel, ran: false, reason: "disabled" };
  }

  const timeZone = readDreamTimeZoneFromEnv(env);
  const dateLabel = getTargetDigestDateLabel(timeZone);
  const { startIso, endIso } = getDateRangeForLabel(dateLabel, timeZone);
  const cursor = await readDreamCursorValue(env.DB, { namespace, dateLabel });
  const cursorState = readDailyCursor(cursor, startIso, endIso);
  if (!cursorState.done) {
    return { enabled: true, date: dateLabel, ran: false, reason: "dream_not_done" };
  }

  return runDiaryWriter(env, namespace, dateLabel);
}
