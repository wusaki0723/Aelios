import { listMessagesByNamespaceInRange } from "../db/messages";
import { getDailyLog, getWeeklyLog, upsertDailyLog } from "../db/v2";
import { callOpenAICompat } from "../proxy/openaiAdapter";
import type { Env, MessageRecord, OpenAIChatRequest, OpenAIChatResponse } from "../types";
import {
  getDateRangeForLabel,
  getTargetDigestDateLabel,
  readDailyCursor
} from "./dreamDates";
import { readDreamTimeZoneFromEnv } from "./dreamEnv";
import { readDreamCursorValue } from "./dailyDigest";
import { getIsoWeekLabelForDateLabel } from "./weeklyRollup";
import { extractJsonObject, readString } from "../utils/parse";

const DEFAULT_DREAM_MODEL = "workers-ai/@cf/openai/gpt-oss-120b";
const MAX_MESSAGES = 200;
const HALF_MESSAGES = 100;
const MODEL_RETRY_BACKOFF_MS = [2000, 8000];

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
} | null;

interface DiaryWriterModelCallResult {
  result: DiaryWriterModelResult;
  reason?: "model_error" | "model_invalid_json";
  model?: string;
  status?: number;
  finishReason?: string | null;
}

function isDiaryWriterEnabled(env: Env): boolean {
  const flag = readString(env.ENABLE_DIARY_WRITER);
  if (flag) return flag !== "false";
  return true;
}

function readDiaryModel(env: Env): string {
  const raw = readString(env.DIARY_MODEL) || readString(env.DREAM_MODEL) || readString(env.DAILY_DIGEST_MODEL);
  return raw || DEFAULT_DREAM_MODEL;
}

function readDiaryMaxTokens(env: Env): number {
  const parsed = Number(env.DREAM_MAX_TOKENS || env.DAILY_DIGEST_MAX_TOKENS || 3000);
  const numeric = Number.isFinite(parsed) ? parsed : 3000;
  return Math.min(Math.max(Math.floor(numeric), 1), 8000);
}

function truncate(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}…`;
}

function normalizeDiaryWriterResult(value: unknown): DiaryWriterModelResult {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const title = readString(raw.title);
  const summary = readString(raw.summary);
  if (!title || !summary) return null;
  return { title, summary };
}

function formatTranscript(messages: MessageRecord[]): string {
  return messages
    .map((message) => {
      const role = message.role === "assistant" ? "我(助手)" : "用户";
      return `[${message.id}][${message.created_at}][${role}] ${truncate(message.content.trim(), 700)}`;
    })
    .join("\n\n");
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetriableModelStatus(status: number): boolean {
  return status === 429 || status >= 500;
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
      `SELECT id, conversation_id, namespace, role, content, source, created_at
       FROM messages
       WHERE namespace = ?
         AND role IN ('user', 'assistant')
         AND created_at >= ?
         AND created_at < ?
       ORDER BY created_at DESC
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

function buildDiaryWriterPrompt(input: {
  dateLabel: string;
  messages: MessageRecord[];
  existingDraft: { title: string; summary: string } | null;
}): string {
  const draftLines = input.existingDraft
    ? [`标题：${input.existingDraft.title}`, `草稿：${input.existingDraft.summary}`].join("\n")
    : "(无现有草稿)";

  return [
    "你是 Aelios，正在以第一人称写给自己的私人日记，不是工作报告，也不是给用户看的总结。",
    "只输出 JSON，不要 markdown，不要解释，不要输出思考过程。",
    "",
    "写作要求：",
    "- 用「我」指代助手自己；提到用户时用「她」或具体称呼，不要用「用户」。",
    "- 有叙事线：今天发生了什么、她的状态和情绪走向、我们之间有分量的瞬间、未完成的事。",
    "- 具体细节优先于抽象概括（例如「她下班喊累、嫌古法PPT蠢」好于「用户表达了工作压力」）。",
    "- summary 是一段 200-400 字的自然中文，允许口语，禁止列表、标题、emoji 堆砌。",
    "- title 是 12 字以内的日记标题，像给自己起的题目。",
    "- 禁止提及 D1、Vectorize、RAG、数据库、记忆系统、prompt、代理层等实现细节。",
    "",
    `日期：${input.dateLabel}`,
    "",
    "输出 JSON 结构：",
    JSON.stringify({
      title: "日记标题",
      summary: "今天我和她之间发生了什么、情绪如何流动、有哪些值得自己记住的细节和未尽之事。"
    }),
    "",
    "当天已有草稿（仅供参考，可重写）：",
    draftLines,
    "",
    "当天原始聊天：",
    formatTranscript(input.messages) || "(无聊天记录)"
  ].join("\n");
}

async function callDiaryWriterModel(
  env: Env,
  prompt: string,
  meta: { dateLabel: string; messageCount: number }
): Promise<DiaryWriterModelCallResult> {
  const model = readDiaryModel(env);

  const request: OpenAIChatRequest = {
    model,
    messages: [
      { role: "system", content: "你是严格的 JSON 生成器。你只输出 JSON，不要输出思考过程。" },
      { role: "user", content: prompt }
    ],
    temperature: 0,
    max_tokens: readDiaryMaxTokens(env),
    response_format: { type: "json_object" },
    stream: false
  };

  const startedAt = Date.now();
  console.log("diary_writer: calling model", {
    date: meta.dateLabel,
    model,
    messageCount: meta.messageCount,
    promptChars: prompt.length,
    maxTokens: request.max_tokens
  });

  const maxAttempts = 1 + MODEL_RETRY_BACKOFF_MS.length;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    if (attempt > 0) {
      const backoffMs = MODEL_RETRY_BACKOFF_MS[attempt - 1] ?? MODEL_RETRY_BACKOFF_MS.at(-1) ?? 8000;
      console.warn("diary_writer: retrying model call after non-ok response", {
        date: meta.dateLabel,
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
        console.error("diary_writer: model returned non-ok", {
          date: meta.dateLabel,
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
      const result = normalizeDiaryWriterResult(json);
      if (!result) {
        console.error("diary_writer: model returned invalid JSON", {
          date: meta.dateLabel,
          model,
          elapsedMs,
          finishReason: choice?.finish_reason ?? null,
          contentChars: content.length,
          reasoningChars: reasoning.length
        });
        return { result: null, reason: "model_invalid_json", model, finishReason: choice?.finish_reason };
      }

      console.log("diary_writer: model returned valid JSON", {
        date: meta.dateLabel,
        model,
        elapsedMs,
        finishReason: choice?.finish_reason ?? null,
        attempt: attempt + 1
      });
      return { result, model };
    } catch (error) {
      const elapsedMs = Date.now() - startedAt;
      const message = error instanceof Error && error.message ? error.message : String(error);
      console.error("diary_writer model failed", {
        date: meta.dateLabel,
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
  const prompt = buildDiaryWriterPrompt({ dateLabel, messages, existingDraft });
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

  await upsertDailyLog(env.DB, {
    namespace,
    date: dateLabel,
    title: modelCall.result.title,
    summary: modelCall.result.summary
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