import { finishDreamRun, insertDreamRun } from "../db/dreamRuns";
import { listMessagesByNamespaceInRange } from "../db/messages";
import { listMemoriesPage } from "../db/memories";
import { readCursor, writeCursor } from "../db/retention";
import type { DreamRunTrigger } from "../db/dreamRuns";
import { callOpenAICompat } from "../proxy/openaiAdapter";
import type { Env, MemoryApiRecord, MessageRecord, OpenAIChatRequest, OpenAIChatResponse } from "../types";
import type { ExtractedMemory } from "./extract";
import {
  deleteVectorMemory,
  getVectorMemory,
  listVectorMemories
} from "./vectorStore";
import { isV2Enabled } from "./v2/recall";
import { searchMemories, toMemoryApiRecord } from "./search";
import {
  supersedeMemory,
  archiveMemory,
  createMemoryCandidate,
  upsertDailyLog,
  fetchMemoryLifecycleRows
} from "../db/v2";
import { extractDreamMemoriesFromMessages } from "./dreamExtract";
import { newId } from "../utils/ids";
import { nowIso } from "../utils/time";

interface DigestMemoryUpdate {
  target_id: string;
  content?: string;
  type?: string;
  importance?: number;
  confidence?: number;
  tags?: string[];
}

interface DigestMemoryDelete {
  target_id: string;
  reason?: string;
}

interface ImportantExcerpt {
  quote: string;
  reason?: string;
  tags?: string[];
  source_message_ids?: string[];
}

interface DailyDigestResult {
  date?: string;
  title?: string;
  summary?: string;
  sections?: Array<{ heading?: string; content?: string }>;
  important_excerpts?: ImportantExcerpt[];
  memories_to_add?: ExtractedMemory[];
  memories_to_update?: DigestMemoryUpdate[];
  memories_to_delete?: DigestMemoryDelete[];
}

interface DailyDigestStats {
  date: string;
  mode: "dream";
  processedMessages: number;
  addedMemories: number;
  updatedMemories: number;
  deletedMemories: number;
  queuedCandidates: number;
  savedExcerpts: number;
  cleanedEmptyMemories: number;
  cursorAdvanced: boolean;
  hasMore: boolean;
  errors?: Array<{ target_id: string; reason: string }>;
}

export interface DreamRoutingItem {
  destination: "candidate" | "world_fact_direct";
  kind: "extract" | "add" | "update" | "delete" | "excerpt";
  content?: string;
  type?: string;
  fact_key?: string | null;
  target_id?: string;
  reason?: string;
}

export interface DreamRoutingPlan {
  items: DreamRoutingItem[];
  summary: {
    to_candidates: number;
    world_fact_direct: number;
  };
}

type DailyDigestSkipReason =
  | "dream_disabled"
  | "already_done"
  | "no_messages"
  | "missing_model"
  | "model_error"
  | "model_invalid_json"
  | "extract_model_error"
  | "v2_disabled";

interface DailyDigestSkipped {
  ran: false;
  mode: "dream";
  date?: string;
  reason: DailyDigestSkipReason;
  startIso?: string;
  endIso?: string;
  cursor?: string | null;
  processedMessages?: number;
  model?: string;
  status?: number;
  finishReason?: string | null;
}

type DailyDigestRunResult =
  | {
      ran: true;
      stats: DailyDigestStats;
      proposal?: DailyDigestResult;
      routing_plan?: DreamRoutingPlan;
      extracted_memories?: ExtractedMemory[];
    }
  | (DailyDigestSkipped & { proposal?: DailyDigestResult; routing_plan?: DreamRoutingPlan });

export type DailyDigestRunOptions = {
  dateLabel?: string;
  force?: boolean;
  dryRun?: boolean;
  trigger?: DreamRunTrigger;
};

interface DigestModelCallResult {
  digest: DailyDigestResult | null;
  reason?: Extract<DailyDigestSkipReason, "missing_model" | "model_error" | "model_invalid_json">;
  model?: string;
  status?: number;
  finishReason?: string | null;
}

const DEFAULT_MAX_MESSAGES = 40;
const DEFAULT_MEMORY_CONTEXT_LIMIT = 40;
const DEFAULT_EXCERPT_LIMIT = 8;
const DEFAULT_EMPTY_MEMORY_MIN_CHARS = 4;
const DEFAULT_TIME_ZONE = "Asia/Singapore";
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

function isDreamEnabled(env: Env): boolean {
  const dreamFlag = readString(env.ENABLE_DREAM);
  if (dreamFlag) return dreamFlag !== "false";
  return env.ENABLE_DAILY_MEMORY_DIGEST !== "false";
}

function readDreamStrategy(env: Env): "upsert" | "review" {
  const raw = env.DREAM_STRATEGY;
  if (raw === "review") return "review";
  return "upsert";
}

function readFirstEnvValue(...values: unknown[]): unknown {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value;
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return undefined;
}

const DEFAULT_DREAM_MODEL = "workers-ai/@cf/openai/gpt-oss-120b";

function readDreamModel(env: Env): string | null {
  return (
    readString(readFirstEnvValue(env.DREAM_MODEL, env.DAILY_DIGEST_MODEL, env.SUMMARY_MODEL)) ||
    DEFAULT_DREAM_MODEL
  );
}

function readDreamTimeZone(env: Env): string {
  return readString(readFirstEnvValue(env.DREAM_TIME_ZONE, env.DAILY_DIGEST_TIME_ZONE)) || DEFAULT_TIME_ZONE;
}

function readDreamMaxMessages(env: Env): number {
  return readPositiveInt(
    readFirstEnvValue(env.DREAM_MAX_MESSAGES, env.DAILY_DIGEST_MAX_MESSAGES),
    DEFAULT_MAX_MESSAGES,
    1000
  );
}

function readDreamMaxTokens(env: Env): number {
  return readPositiveInt(readFirstEnvValue(env.DREAM_MAX_TOKENS, env.DAILY_DIGEST_MAX_TOKENS), 3000, 8000);
}

function readDreamMemoryContextLimit(env: Env): number {
  return readPositiveInt(
    readFirstEnvValue(env.DREAM_MEMORY_CONTEXT_LIMIT, env.DAILY_DIGEST_MEMORY_CONTEXT_LIMIT),
    DEFAULT_MEMORY_CONTEXT_LIMIT,
    1000
  );
}

function readDreamExcerptLimit(env: Env): number {
  return readPositiveInt(readFirstEnvValue(env.DREAM_EXCERPT_LIMIT, env.DAILY_DIGEST_EXCERPT_LIMIT), DEFAULT_EXCERPT_LIMIT, 20);
}

function readPositiveInt(value: unknown, fallback: number, max: number): number {
  const parsed = typeof value === "string" ? Number(value) : typeof value === "number" ? value : fallback;
  const numeric = Number.isFinite(parsed) ? parsed : fallback;
  return Math.min(Math.max(Math.floor(numeric), 1), max);
}

function clampScore(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.min(Math.max(value, 0), 1) : fallback;
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean);
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function truncate(text: string, maxChars: number): string {
  return text.length <= maxChars ? text : `${text.slice(0, maxChars - 3)}...`;
}

function formatDate(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(date);
}

export function getTargetDigestDateLabel(timeZone: string, now = new Date()): string {
  return formatDate(new Date(now.getTime() - ONE_DAY_MS), timeZone);
}

export function readDreamTimeZoneFromEnv(env: Env): string {
  return readDreamTimeZone(env);
}

export function getDateLabelsLookback(dateLabel: string, count: number, timeZone: string): string[] {
  const labels: string[] = [];
  for (let i = 0; i < count; i += 1) {
    labels.push(addDaysToDateLabel(dateLabel, -i, timeZone));
  }
  return labels;
}

function parseDateLabel(dateLabel: string): { year: number; month: number; day: number } {
  const [year, month, day] = dateLabel.split("-").map((value) => Number(value));
  if (!year || !month || !day) {
    throw new Error(`Invalid date label: ${dateLabel}`);
  }
  return { year, month, day };
}

function getTimeZoneOffsetMs(date: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  }).formatToParts(date);

  const values = new Map(parts.map((part) => [part.type, part.value]));
  const year = Number(values.get("year"));
  const month = Number(values.get("month"));
  const day = Number(values.get("day"));
  const hour = Number(values.get("hour")) % 24;
  const minute = Number(values.get("minute"));
  const second = Number(values.get("second"));
  const zonedAsUtc = Date.UTC(year, month - 1, day, hour, minute, second);

  return zonedAsUtc - date.getTime();
}

function zonedWallTimeToUtc(input: {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  timeZone: string;
}): Date {
  const wallClockUtc = Date.UTC(input.year, input.month - 1, input.day, input.hour, input.minute, input.second);
  let utc = wallClockUtc;

  for (let i = 0; i < 3; i += 1) {
    const offset = getTimeZoneOffsetMs(new Date(utc), input.timeZone);
    const next = wallClockUtc - offset;
    if (Math.abs(next - utc) < 1000) break;
    utc = next;
  }

  return new Date(utc);
}

function addDaysToDateLabel(dateLabel: string, days: number, timeZone: string): string {
  const { year, month, day } = parseDateLabel(dateLabel);
  const localNoonUtc = zonedWallTimeToUtc({
    year,
    month,
    day,
    hour: 12,
    minute: 0,
    second: 0,
    timeZone
  });
  return formatDate(new Date(localNoonUtc.getTime() + days * ONE_DAY_MS), timeZone);
}

export function getDateRangeForLabel(dateLabel: string, timeZone: string): { startIso: string; endIso: string } {
  const start = parseDateLabel(dateLabel);
  const end = parseDateLabel(addDaysToDateLabel(dateLabel, 1, timeZone));

  return {
    startIso: zonedWallTimeToUtc({ ...start, hour: 0, minute: 0, second: 0, timeZone }).toISOString(),
    endIso: zonedWallTimeToUtc({ ...end, hour: 0, minute: 0, second: 0, timeZone }).toISOString()
  };
}

export function readDailyCursor(value: string | null, startIso: string, endIso: string): { done: boolean; after: string | null } {
  if (!value) return { done: false, after: null };
  if (value.startsWith("done:")) return { done: true, after: null };
  if (value >= startIso && value < endIso) return { done: false, after: value };
  return { done: false, after: null };
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

function normalizeExtractedMemory(value: unknown): ExtractedMemory | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const content = readString(raw.content);
  if (!content) return null;

  return {
    type: readString(raw.type) || "note",
    content,
    importance: clampScore(raw.importance, 0.7),
    confidence: clampScore(raw.confidence, 0.82),
    tags: readStringArray(raw.tags),
    source_message_ids: readStringArray(raw.source_message_ids),
    fact_key: typeof raw.fact_key === "string" && raw.fact_key.trim() ? raw.fact_key.trim() : undefined
  };
}

function normalizeDigestResult(value: unknown): DailyDigestResult {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const raw = value as Record<string, unknown>;

  const sections = Array.isArray(raw.sections)
    ? raw.sections.flatMap((item): Array<{ heading?: string; content?: string }> => {
        if (!item || typeof item !== "object" || Array.isArray(item)) return [];
        const record = item as Record<string, unknown>;
        const heading = readString(record.heading) ?? undefined;
        const content = readString(record.content) ?? undefined;
        return heading || content ? [{ heading, content }] : [];
      })
    : undefined;

  const important_excerpts = Array.isArray(raw.important_excerpts)
    ? raw.important_excerpts.flatMap((item): ImportantExcerpt[] => {
        if (!item || typeof item !== "object" || Array.isArray(item)) return [];
        const record = item as Record<string, unknown>;
        const quote = readString(record.quote);
        if (!quote) return [];
        return [
          {
            quote,
            reason: readString(record.reason) ?? undefined,
            tags: readStringArray(record.tags),
            source_message_ids: readStringArray(record.source_message_ids)
          }
        ];
      })
    : undefined;

  const memories_to_update = Array.isArray(raw.memories_to_update)
    ? raw.memories_to_update.flatMap((item): DigestMemoryUpdate[] => {
        if (!item || typeof item !== "object" || Array.isArray(item)) return [];
        const record = item as Record<string, unknown>;
        const targetId = readString(record.target_id);
        if (!targetId) return [];
        return [
          {
            target_id: targetId,
            content: readString(record.content) ?? undefined,
            type: readString(record.type) ?? undefined,
            importance: typeof record.importance === "number" ? clampScore(record.importance, 0.7) : undefined,
            confidence: typeof record.confidence === "number" ? clampScore(record.confidence, 0.82) : undefined,
            tags: Array.isArray(record.tags) ? readStringArray(record.tags) : undefined
          }
        ];
      })
    : undefined;

  const memories_to_delete = Array.isArray(raw.memories_to_delete)
    ? raw.memories_to_delete.flatMap((item): DigestMemoryDelete[] => {
        if (!item || typeof item !== "object" || Array.isArray(item)) return [];
        const record = item as Record<string, unknown>;
        const targetId = readString(record.target_id);
        return targetId ? [{ target_id: targetId, reason: readString(record.reason) ?? undefined }] : [];
      })
    : undefined;

  return {
    date: readString(raw.date) ?? undefined,
    title: readString(raw.title) ?? undefined,
    summary: readString(raw.summary) ?? undefined,
    sections,
    important_excerpts,
    memories_to_add: Array.isArray(raw.memories_to_add)
      ? raw.memories_to_add.flatMap((item): ExtractedMemory[] => {
          const memory = normalizeExtractedMemory(item);
          return memory ? [memory] : [];
        })
      : undefined,
    memories_to_update,
    memories_to_delete
  };
}

function formatTranscript(messages: MessageRecord[]): string {
  return messages
    .map((message) => {
      const role = message.role === "assistant" ? "我(助手)" : "用户";
      return `[${message.id}][${message.created_at}][${role}] ${truncate(message.content.trim(), 700)}`;
    })
    .join("\n\n");
}

function formatExistingMemories(memories: MemoryApiRecord[]): string {
  if (memories.length === 0) return "[]";
  return JSON.stringify(
    memories.map((memory) => ({
      id: memory.id,
      type: memory.type,
      content: truncate(memory.content, 260),
      importance: memory.importance,
      confidence: memory.confidence,
      pinned: memory.pinned,
      tags: memory.tags
    })),
    null,
    2
  );
}

function buildDigestPrompt(input: {
  dateLabel: string;
  startIso: string;
  endIso: string;
  messages: MessageRecord[];
  existingMemories: MemoryApiRecord[];
  excerptLimit: number;
  hasMore: boolean;
}): string {
  return [
    "你是 Aelios 的 nightly dream 记忆整理器。你的任务不是简单总结，而是在用户休息时整理长期记忆。",
    "你会读取旧长期记忆和当天聊天 transcript，产出一份更干净、更一致、更有用的 memory store 整理计划。",
    "只输出 JSON，不要 markdown，不要解释，不要输出思考过程。",
    "",
    "Dream 目标：",
    "- 合并重复记忆，避免同一事实以多个版本长期存在。",
    "- 发现过时、被新信息否定、互相矛盾的旧记忆，并提出更新或删除建议（全部进入审核队列）。",
    "- 检查当天夜间抽取候选和旧记忆之间是否重复、过时或冲突。",
    "- 只在极少数必要场景提出关键原文摘录。",
    "- 形成简洁的昨日日志，而不是保存流水账。",
    "",
    "窗口：",
    `- 你只能处理 ${input.dateLabel} 这一天窗口内的聊天。窗口是 ${input.startIso} 到 ${input.endIso}。`,
    input.hasMore ? "- 这是当天的一批聊天，不是完整一天；只整理这一批里明确出现的信息。" : "- 这是当天最后一批或完整批次。",
    "",
    "总原则：",
    "- 原始聊天不要逐条变成记忆，只保留未来真的会用到的事实、偏好、边界、项目进展、承诺。",
    "- 宁可少记，也不要把临时语气、寒暄、重复话、空内容、调试内容写进长期记忆。",
    "- 当旧记忆和新信息冲突时，优先更新或删除旧记忆，不要并排留下互相打架的版本。",
    "- 当新信息只是旧记忆的更准确版本，优先 memories_to_update，不要 memories_to_add。",
    "- 稳定事实的首次抽取由 dream 夜间管线负责，产物全部进审核队列；memories_to_add 默认给空数组。",
    "- 当多条旧记忆重复，保留更完整的一条并删除重复项；必要时先 update 保留项。",
    "- pinned=true 的旧记忆不能删除，只能在 memories_to_update 中提出更保守的补充。",
    "- 旧记忆里的临时计划/意图（例如“打算下个月充值X”）如果已经过期、已经发生、或被当天新信息取代，优先更新成持久事实或直接删除，不要让过期的打算一直躺在库里。",
    "- 站在“我=助手”的视角写。关于用户，用“你……”；关于助手承诺，用“我需要……”。",
    "- 不要提到 D1、Vectorize、RAG、数据库、记忆系统、代理层等实现细节。",
    "",
    "Dream 输出格式：",
    "- title 是 12 字以内标题。",
    "- summary 写成一段简短自然中文，描述这次 dream 整理出了什么。",
    "- sections 最多 3 段，每段有 heading 和 content；没有必要可以给空数组。",
    `- important_excerpts 最多 ${input.excerptLimit} 条，quote 必须是值得人工审核的原文片段；不要把普通聊天流水、调试口令、临时玩笑放进来。`,
    "- v2 下 important_excerpts 只会进入人工审核候选，不会自动写入长期记忆。",
    "- memories_to_add 保留兼容字段，v2 下默认输出空数组。",
    "- memories_to_update 只针对给出的旧记忆 id。",
    "- memories_to_update 里的 type 只能从这 8 个里选：fact、event、preference、relationship、boundary、habit、decision、note；项目进展归 fact，承诺/决定归 decision。绝不输出 project、world_fact 等其他值。",
    "- memories_to_delete 只删除空、重复、明显过期或被新信息否定的旧记忆。",
    "- 控制总输出长度，宁可少写也不要输出超长 JSON。",
    "",
    "输出 JSON 结构：",
    JSON.stringify({
      date: input.dateLabel,
      title: "夜间整理",
      summary: "这次 dream 合并了重复记忆，更新了项目状态，并保留了关键原文。",
      sections: [{ heading: "整理结果", content: "……" }],
      important_excerpts: [
        {
          quote: "用户或助手说过的关键原文",
          reason: "为什么值得保留",
          tags: ["project"],
          source_message_ids: ["msg_x"]
        }
      ],
      memories_to_add: [],
      memories_to_update: [
        {
          target_id: "mem_x",
          content: "更新后的旧记忆正文",
          type: "fact",
          importance: 0.88,
          confidence: 0.9,
          tags: ["project"]
        }
      ],
      memories_to_delete: [{ target_id: "mem_y", reason: "空内容或重复" }]
    }),
    "",
    "旧长期记忆候选：",
    formatExistingMemories(input.existingMemories),
    "",
    "今日原始聊天：",
    formatTranscript(input.messages)
  ].join("\n");
}

const DREAM_MODEL_RETRY_BACKOFF_MS = [2000, 8000];

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetriableModelStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

async function callDigestModel(
  env: Env,
  prompt: string,
  meta: { dateLabel: string; messageCount: number; memoryCount: number; hasMore: boolean }
): Promise<DigestModelCallResult> {
  const model = readDreamModel(env);
  if (!model) {
    console.error("dream: missing model");
    return { digest: null, reason: "missing_model" };
  }

  const request: OpenAIChatRequest = {
    model,
    messages: [
      { role: "system", content: "你是严格的 JSON 生成器。你只输出 JSON，不要输出思考过程。" },
      { role: "user", content: prompt }
    ],
    temperature: 0,
    max_tokens: readDreamMaxTokens(env),
    response_format: {
      type: "json_object"
    },
    stream: false
  };

  const startedAt = Date.now();
  console.log("dream: calling model", {
    date: meta.dateLabel,
    model,
    messageCount: meta.messageCount,
    memoryCount: meta.memoryCount,
    hasMore: meta.hasMore,
    promptChars: prompt.length,
    maxTokens: request.max_tokens
  });

  const maxAttempts = 1 + DREAM_MODEL_RETRY_BACKOFF_MS.length;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    if (attempt > 0) {
      const backoffMs = DREAM_MODEL_RETRY_BACKOFF_MS[attempt - 1] ?? DREAM_MODEL_RETRY_BACKOFF_MS.at(-1) ?? 8000;
      console.warn("dream: retrying model call after non-ok response", {
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
        console.error("dream: model returned non-ok", {
          date: meta.dateLabel,
          model,
          status: response.status,
          statusText: response.statusText,
          elapsedMs,
          attempt: attempt + 1,
          retriable
        });
        if (retriable && attempt < maxAttempts - 1) continue;
        return { digest: null, reason: "model_error", model, status: response.status };
      }
      const parsed = (await response.json()) as OpenAIChatResponse;
      const choice = parsed.choices?.[0];
      const message = choice?.message as ({ content?: unknown; reasoning_content?: unknown }) | undefined;
      const content = typeof message?.content === "string" ? message.content.trim() : "";
      const reasoning = typeof message?.reasoning_content === "string" ? message.reasoning_content.trim() : "";
      const json = extractJsonObject(content || reasoning);
      if (!json) {
        console.error("dream: model returned invalid JSON", {
          date: meta.dateLabel,
          model,
          elapsedMs,
          finishReason: choice?.finish_reason ?? null,
          contentChars: content.length,
          reasoningChars: reasoning.length
        });
        return { digest: null, reason: "model_invalid_json", model, finishReason: choice?.finish_reason };
      }
      console.log("dream: model returned valid JSON", {
        date: meta.dateLabel,
        model,
        elapsedMs,
        finishReason: choice?.finish_reason ?? null,
        contentChars: content.length,
        reasoningChars: reasoning.length,
        attempt: attempt + 1
      });
      return { digest: normalizeDigestResult(json), model };
    } catch (error) {
      const elapsedMs = Date.now() - startedAt;
      const message = error instanceof Error && error.message ? error.message : String(error);
      console.error("dream model failed", {
        date: meta.dateLabel,
        model,
        elapsedMs,
        attempt: attempt + 1,
        error: message
      });
      // Thrown fetch errors are almost always network-level and worth retrying.
      if (attempt < maxAttempts - 1) continue;
      return { digest: null, reason: "model_error", model };
    }
  }

  return { digest: null, reason: "model_error", model };
}

async function retireMemoryRecord(
  env: Env,
  input: { namespace: string; id: string }
): Promise<boolean> {
  if (isV2Enabled(env)) {
    const archived = await archiveMemory(env, input);
    if (archived) return true;
  }
  return deleteVectorMemory(env, input.id);
}

async function cleanEmptyMemories(
  env: Env,
  namespace: string
): Promise<number> {
  const minChars = readPositiveInt(env.EMPTY_MEMORY_MIN_CHARS, DEFAULT_EMPTY_MEMORY_MIN_CHARS, 20);
  let page: Awaited<ReturnType<typeof listVectorMemories>>;
  try {
    page = await listVectorMemories(env, { namespace, count: 1000 });
  } catch (error) {
    console.error("dream: failed to list memories for cleanup", error);
    return 0;
  }
  const records = page.data.filter((record) => !record.pinned && record.content.trim().length < minChars);

  for (const record of records) {
    await retireMemoryRecord(env, { namespace, id: record.id });
  }

  return records.length;
}

async function queueImportantExcerptsForReview(
  env: Env,
  input: { namespace: string; dateLabel: string; excerpts: ImportantExcerpt[]; fallbackMessageIds: string[] }
): Promise<number> {
  let queued = 0;
  const limit = readDreamExcerptLimit(env);

  for (const excerpt of input.excerpts.slice(0, limit)) {
    const quote = readString(excerpt.quote);
    if (!quote) continue;
    await createMemoryCandidate(env.DB, {
      namespace: input.namespace,
      type: "excerpt",
      content: quote,
      factKey: null,
      importance: 0.72,
      confidence: 0.72,
      tags: uniqueStrings(["important-excerpt", input.dateLabel, ...(excerpt.tags ?? [])]),
      sourceMessageIds: excerpt.source_message_ids?.length ? excerpt.source_message_ids : input.fallbackMessageIds,
      source: "dream_excerpt"
    });
    queued += 1;
  }

  return queued;
}

async function recordDreamReviewProposal(
  env: Env,
  input: { namespace: string; dateLabel: string; digest: DailyDigestResult; messageIds: string[] }
): Promise<void> {
  await env.DB
    .prepare(
      `INSERT INTO memory_events (id, namespace, event_type, memory_id, payload_json, created_at)
       VALUES (?, ?, ?, NULL, ?, ?)`
    )
    .bind(
      newId("evt"),
      input.namespace,
      "dream_review_proposal",
      JSON.stringify({
        date: input.dateLabel,
        message_ids: input.messageIds,
        title: input.digest.title ?? null,
        summary: input.digest.summary ?? null,
        memories_to_add: input.digest.memories_to_add ?? [],
        memories_to_update: input.digest.memories_to_update ?? [],
        memories_to_delete: input.digest.memories_to_delete ?? [],
        important_excerpts: input.digest.important_excerpts ?? []
      }),
      nowIso()
    )
    .run();
}

function sanitizeDreamDigestLists(
  updates: DigestMemoryUpdate[],
  deletes: DigestMemoryDelete[]
): { updates: DigestMemoryUpdate[]; deletes: DigestMemoryDelete[] } {
  const deleteIds = new Set((deletes ?? []).map((item) => item.target_id));
  const seenUpdateIds = new Set<string>();
  const cleanedUpdates: DigestMemoryUpdate[] = [];

  for (const item of updates ?? []) {
    if (!item.target_id) continue;
    if (deleteIds.has(item.target_id)) continue;
    if (seenUpdateIds.has(item.target_id)) continue;
    seenUpdateIds.add(item.target_id);
    cleanedUpdates.push(item);
  }

  return { updates: cleanedUpdates, deletes: deletes ?? [] };
}

function isWorldFactMemory(input: { type?: string | null; factKey?: string | null }): boolean {
  const type = input.type?.trim().toLowerCase();
  if (type === "world_fact") return true;
  const factKey = input.factKey?.trim().toLowerCase();
  return Boolean(factKey && (factKey.startsWith("world_fact:") || factKey.startsWith("world:")));
}

async function resolveWorldFactTarget(
  env: Env,
  input: { namespace: string; targetId: string }
): Promise<{ type: string; factKey: string | null } | null> {
  const existing = await getVectorMemory(env, input.targetId, { requireD1Backing: true });
  if (!existing || existing.namespace !== input.namespace || existing.status !== "active") return null;
  const lifecycleRows = await fetchMemoryLifecycleRows(env.DB, [existing.id]);
  const factKey = lifecycleRows[0]?.fact_key ?? null;
  if (!isWorldFactMemory({ type: existing.type, factKey })) return null;
  return { type: existing.type, factKey };
}

async function queueDreamExtractedMemories(
  env: Env,
  input: { namespace: string; memories: ExtractedMemory[]; messageIds: string[] }
): Promise<number> {
  let queued = 0;
  for (const memory of input.memories) {
    try {
      await createMemoryCandidate(env.DB, {
        namespace: input.namespace,
        type: memory.type,
        content: memory.content,
        factKey: memory.fact_key ?? null,
        confidence: memory.confidence,
        importance: memory.importance,
        tags: memory.tags,
        sourceMessageIds: memory.source_message_ids.length ? memory.source_message_ids : input.messageIds,
        source: "dream_extract"
      });
      queued += 1;
    } catch (error) {
      console.warn("dream: failed to queue extracted memory", {
        namespace: input.namespace,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }
  return queued;
}

export function buildDreamRoutingPlan(input: {
  extracted: ExtractedMemory[];
  digest: DailyDigestResult;
  worldFactUpdateIds?: Set<string>;
}): DreamRoutingPlan {
  const items: DreamRoutingItem[] = [];
  const worldFactUpdateIds = input.worldFactUpdateIds ?? new Set<string>();

  for (const memory of input.extracted) {
    items.push({
      destination: "candidate",
      kind: "extract",
      content: memory.content,
      type: memory.type,
      fact_key: memory.fact_key ?? null
    });
  }

  for (const item of input.digest.memories_to_add ?? []) {
    items.push({
      destination: "candidate",
      kind: "add",
      content: item.content,
      type: item.type,
      fact_key: item.fact_key ?? null
    });
  }

  for (const item of input.digest.memories_to_update ?? []) {
    items.push({
      destination: worldFactUpdateIds.has(item.target_id) ? "world_fact_direct" : "candidate",
      kind: "update",
      content: item.content,
      type: item.type,
      target_id: item.target_id
    });
  }

  for (const item of input.digest.memories_to_delete ?? []) {
    items.push({
      destination: "candidate",
      kind: "delete",
      target_id: item.target_id,
      reason: item.reason
    });
  }

  for (const excerpt of input.digest.important_excerpts ?? []) {
    if (!readString(excerpt.quote)) continue;
    items.push({
      destination: "candidate",
      kind: "excerpt",
      content: excerpt.quote,
      reason: excerpt.reason
    });
  }

  const toCandidates = items.filter((item) => item.destination === "candidate").length;
  return {
    items,
    summary: {
      to_candidates: toCandidates,
      world_fact_direct: items.length - toCandidates
    }
  };
}

async function applyDreamV2(
  env: Env,
  input: {
    namespace: string;
    strategy: "upsert" | "review";
    dateLabel: string;
    messages: MessageRecord[];
    digest: DailyDigestResult;
    messageIds: string[];
    extracted: ExtractedMemory[];
  }
): Promise<{
  added: number;
  updated: number;
  deleted: number;
  queuedCandidates: number;
  excerpts: number;
  longtail: number;
  errors: Array<{ target_id: string; reason: string }>;
}> {
  const { namespace, strategy, dateLabel, digest, messageIds, extracted } = input;
  const isReview = strategy === "review";
  let updated = 0;
  let deleted = 0;
  let queuedCandidates = 0;
  const errors: Array<{ target_id: string; reason: string }> = [];

  if (isReview) {
    queuedCandidates += await queueDreamExtractedMemories(env, {
      namespace,
      memories: extracted,
      messageIds
    });
    await recordDreamReviewProposal(env, { namespace, dateLabel, digest, messageIds });
    return { added: 0, updated: 0, deleted: 0, queuedCandidates, excerpts: 0, longtail: 0, errors: [] };
  }

  queuedCandidates += await queueDreamExtractedMemories(env, {
    namespace,
    memories: extracted,
    messageIds
  });

  for (const item of digest.memories_to_add ?? []) {
    const content = readString(item.content);
    if (!content) continue;
    try {
      await createMemoryCandidate(env.DB, {
        namespace,
        type: item.type ?? "note",
        content,
        factKey: item.fact_key ?? null,
        confidence: item.confidence ?? 0.72,
        importance: item.importance ?? 0.72,
        tags: item.tags,
        sourceMessageIds: item.source_message_ids.length ? item.source_message_ids : messageIds,
        source: "dream_add"
      });
      queuedCandidates += 1;
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      console.warn("dream: add failed", { namespace, reason });
      errors.push({ target_id: content.slice(0, 40), reason });
    }
  }

  const { updates: memoriesToUpdate, deletes: memoriesToDelete } = sanitizeDreamDigestLists(
    digest.memories_to_update ?? [],
    digest.memories_to_delete ?? []
  );

  for (const item of memoriesToUpdate) {
    try {
      const worldFactTarget = await resolveWorldFactTarget(env, { namespace, targetId: item.target_id });
      if (worldFactTarget && item.content) {
        await supersedeMemory(env, {
          namespace,
          oldId: item.target_id,
          newContent: item.content,
          newType: item.type ?? worldFactTarget.type,
          newFactKey: worldFactTarget.factKey,
          importance: item.importance,
          confidence: item.confidence,
          tags: item.tags,
          source: "dream",
          sourceMessageIds: messageIds,
          reason: "dream_world_fact"
        });
        updated++;
        continue;
      }

      if (!item.content) continue;
      await createMemoryCandidate(env.DB, {
        namespace,
        type: item.type ?? "note",
        content: item.content,
        factKey: null,
        confidence: item.confidence ?? 0.72,
        importance: item.importance ?? 0.72,
        tags: item.tags,
        sourceMessageIds: messageIds,
        source: "dream_update",
        targetMemoryId: item.target_id
      });
      queuedCandidates += 1;
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      console.warn("dream: update failed", { namespace, target_id: item.target_id, reason });
      errors.push({ target_id: item.target_id, reason });
    }
  }

  for (const item of memoriesToDelete) {
    try {
      const existing = await getVectorMemory(env, item.target_id, { requireD1Backing: true });
      if (!existing || existing.status !== "active" || existing.pinned) continue;

      await createMemoryCandidate(env.DB, {
        namespace,
        type: existing.type,
        content: existing.content,
        factKey: null,
        confidence: 0.72,
        importance: existing.importance,
        tags: [],
        sourceMessageIds: messageIds,
        source: "dream_delete",
        targetMemoryId: item.target_id,
        decisionNote: item.reason ?? "dream_delete"
      });
      queuedCandidates += 1;
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      console.warn("dream: delete failed", { namespace, target_id: item.target_id, reason });
      errors.push({ target_id: item.target_id, reason });
    }
  }

  const excerpts = await queueImportantExcerptsForReview(env, {
    namespace,
    dateLabel,
    excerpts: digest.important_excerpts ?? [],
    fallbackMessageIds: messageIds
  });
  queuedCandidates += excerpts;

  await upsertDailyLog(env.DB, {
    namespace,
    date: dateLabel,
    title: digest.title ?? dateLabel,
    summary: digest.summary ?? ""
  });

  return { added: 0, updated, deleted, queuedCandidates, excerpts, longtail: 0, errors };
}

const DREAM_CONTEXT_QUERY_MAX_MESSAGES = 20;
const DREAM_CONTEXT_QUERY_MAX_CHARS = 4000;

function buildDreamContextQuery(messages: MessageRecord[]): string {
  const recent = messages.slice(-DREAM_CONTEXT_QUERY_MAX_MESSAGES);
  const text = recent
    .map((message) => message.content.trim())
    .filter(Boolean)
    .join("\n");
  return truncate(text, DREAM_CONTEXT_QUERY_MAX_CHARS);
}

// dream 的记忆上下文按“和当天聊天最相关”挑选，而不是固定翻旧记忆列表第一页——
// listMemoriesPage 按 pinned/importance/updated_at 排序，dream 每晚只会看到同一批高分记忆，
// 永远看不到中间层的重复项；改成用当天聊天做向量检索，才能命中真正该合并/纠正的旧记忆。
// 搜索失败或无结果时，回退到原先的分页列表，保证 dream 不因此空转。
async function selectDreamMemoryContext(
  env: Env,
  input: { namespace: string; messages: MessageRecord[]; limit: number }
): Promise<MemoryApiRecord[]> {
  const query = buildDreamContextQuery(input.messages);
  if (query) {
    try {
      const results = await searchMemories(env, {
        namespace: input.namespace,
        query,
        topK: input.limit
      });
      const active = results.filter((record) => record.status === "active");
      if (active.length > 0) return active;
    } catch (error) {
      console.error("dream: relevance-based memory context search failed, falling back to page listing", error);
    }
  }

  const page = await listMemoriesPage(env.DB, {
    namespace: input.namespace,
    status: "active",
    limit: input.limit,
    offset: 0
  });
  return page.records.map((record) => toMemoryApiRecord(record));
}

async function safeFinishDreamRun(
  db: D1Database,
  input: {
    id: string | null;
    status: "ok" | "skipped" | "error";
    reason?: string | null;
    model?: string | null;
    processedMessages?: number | null;
    error?: string | null;
  }
): Promise<void> {
  if (!input.id) return;
  try {
    await finishDreamRun(db, {
      id: input.id,
      status: input.status,
      reason: input.reason,
      model: input.model,
      processedMessages: input.processedMessages,
      error: input.error
    });
  } catch (error) {
    console.error("dream: failed to update dream_runs row", {
      id: input.id,
      status: input.status,
      error: error instanceof Error ? error.message : String(error)
    });
  }
}

async function safeInsertDreamRun(
  db: D1Database,
  input: { namespace: string; dateLabel: string; trigger: DreamRunTrigger }
): Promise<string | null> {
  try {
    return await insertDreamRun(db, input);
  } catch (error) {
    console.error("dream: failed to insert dream_runs row", {
      namespace: input.namespace,
      dateLabel: input.dateLabel,
      trigger: input.trigger,
      error: error instanceof Error ? error.message : String(error)
    });
    return null;
  }
}

export async function countRawMessagesForDateLabel(
  db: D1Database,
  input: { namespace: string; dateLabel: string; timeZone: string }
): Promise<number> {
  const { startIso, endIso } = getDateRangeForLabel(input.dateLabel, input.timeZone);
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS count
       FROM messages
       WHERE namespace = ?
         AND role IN ('user', 'assistant')
         AND created_at >= ?
         AND created_at < ?`
    )
    .bind(input.namespace, startIso, endIso)
    .first<{ count: number }>();
  return row?.count ?? 0;
}

export async function readDreamCursorValue(
  db: D1Database,
  input: { namespace: string; dateLabel: string }
): Promise<string | null> {
  const cursorName = `dream:${input.namespace}:${input.dateLabel}`;
  const legacyCursorName = `daily_digest:${input.namespace}:${input.dateLabel}`;
  return (await readCursor(db, cursorName)) ?? (await readCursor(db, legacyCursorName));
}

export async function runDreamBackfill(
  env: Env,
  namespace: string,
  options: { maxDates?: number; lookback?: number } = {}
): Promise<Array<{ dateLabel: string; result: DailyDigestRunResult }>> {
  const maxDates = options.maxDates ?? 2;
  const lookback = options.lookback ?? 3;
  const timeZone = readDreamTimeZone(env);
  const anchorDateLabel = getTargetDigestDateLabel(timeZone);
  const candidateLabels = getDateLabelsLookback(anchorDateLabel, lookback + 1, timeZone).slice(1);
  const results: Array<{ dateLabel: string; result: DailyDigestRunResult }> = [];
  let backfilled = 0;

  for (const dateLabel of candidateLabels) {
    if (backfilled >= maxDates) break;

    const { startIso, endIso } = getDateRangeForLabel(dateLabel, timeZone);
    const cursor = await readDreamCursorValue(env.DB, { namespace, dateLabel });
    const cursorState = readDailyCursor(cursor, startIso, endIso);
    if (cursorState.done) continue;

    const rawCount = await countRawMessagesForDateLabel(env.DB, { namespace, dateLabel, timeZone });
    if (rawCount === 0) continue;

    const result = await runDailyMemoryDigest(env, namespace, { dateLabel, trigger: "cron" });
    results.push({ dateLabel, result });
    if (result.ran) backfilled += 1;
  }

  return results;
}

export async function runDailyMemoryDigest(
  env: Env,
  namespace: string,
  options: DailyDigestRunOptions = {}
): Promise<DailyDigestRunResult> {
  if (!isDreamEnabled(env)) return { ran: false, mode: "dream", reason: "dream_disabled" };

  const dryRun = options.dryRun === true;
  const trigger = options.trigger ?? "cron";
  const timeZone = readDreamTimeZone(env);
  const dateLabel = readString(options.dateLabel) || getTargetDigestDateLabel(timeZone);
  const dreamRunId = await safeInsertDreamRun(env.DB, { namespace, dateLabel, trigger });
  const { startIso, endIso } = getDateRangeForLabel(dateLabel, timeZone);
  const cursorName = `dream:${namespace}:${dateLabel}`;
  const legacyCursorName = `daily_digest:${namespace}:${dateLabel}`;
  const cursor = (await readCursor(env.DB, cursorName)) ?? (await readCursor(env.DB, legacyCursorName));
  const cursorState = options.force ? { done: false, after: null } : readDailyCursor(cursor, startIso, endIso);
  if (cursorState.done) {
    await safeFinishDreamRun(env.DB, {
      id: dreamRunId,
      status: "skipped",
      reason: "already_done"
    });
    return { ran: false, mode: "dream", date: dateLabel, reason: "already_done", startIso, endIso, cursor };
  }

  const maxMessages = readDreamMaxMessages(env);
  const fetchedMessages = await listMessagesByNamespaceInRange(env.DB, {
    namespace,
    startCreatedAt: startIso,
    endCreatedAt: endIso,
    afterCreatedAt: cursorState.after,
    limit: maxMessages
  });
  if (fetchedMessages.length === 0) {
    if (!dryRun) {
      await writeCursor(env.DB, cursorName, `done:${cursorState.after ?? startIso}`);
    }
    await safeFinishDreamRun(env.DB, {
      id: dreamRunId,
      status: "skipped",
      reason: "no_messages"
    });
    return { ran: false, mode: "dream", date: dateLabel, reason: "no_messages", startIso, endIso, cursor };
  }

  const memoryContextLimit = readDreamMemoryContextLimit(env);
  const strategy = readDreamStrategy(env);
  const v2Enabled = isV2Enabled(env);
  let existingMemories: MemoryApiRecord[] = [];
  try {
    if (v2Enabled) {
      existingMemories = await selectDreamMemoryContext(env, {
        namespace,
        messages: fetchedMessages,
        limit: memoryContextLimit
      });
    } else {
      existingMemories = (await listVectorMemories(env, {
        namespace,
        count: memoryContextLimit
      })).data;
    }
  } catch (error) {
    console.error("dream: failed to list existing memories", error);
  }
  const cleanedEmptyMemories =
    dryRun || (v2Enabled && strategy === "review") ? 0 : await cleanEmptyMemories(env, namespace);
  const excerptLimit = readDreamExcerptLimit(env);
  const fetchedHasMore = fetchedMessages.length >= maxMessages;

  let messages = fetchedMessages;
  let hasMore = fetchedHasMore;
  let modelResult: DigestModelCallResult;
  for (;;) {
    const prompt = buildDigestPrompt({
      dateLabel,
      startIso,
      endIso,
      messages,
      existingMemories,
      excerptLimit,
      hasMore
    });
    modelResult = await callDigestModel(env, prompt, {
      dateLabel,
      messageCount: messages.length,
      memoryCount: existingMemories.length,
      hasMore
    });
    if (modelResult.digest) break;
    if (modelResult.reason !== "model_invalid_json" || modelResult.finishReason !== "length" || messages.length <= 1) break;

    const nextSize = Math.max(1, Math.floor(messages.length / 2));
    if (nextSize >= messages.length) break;
    console.warn("dream: retrying with smaller batch after length-truncated JSON", {
      date: dateLabel,
      previousMessageCount: messages.length,
      nextMessageCount: nextSize,
      model: modelResult.model
    });
    messages = messages.slice(0, nextSize);
    hasMore = true;
  }

  const digest = modelResult.digest;

  if (!digest) {
    console.error("dream: model did not return valid JSON; cursor not advanced", {
      reason: modelResult.reason,
      model: modelResult.model,
      status: modelResult.status
    });
    await safeFinishDreamRun(env.DB, {
      id: dreamRunId,
      status: "error",
      reason: modelResult.reason ?? "model_error",
      model: modelResult.model,
      processedMessages: messages.length,
      error: modelResult.finishReason
        ? `finish_reason=${modelResult.finishReason}`
        : modelResult.status
          ? `status=${modelResult.status}`
          : null
    });
    return {
      ran: false,
      mode: "dream",
      date: dateLabel,
      reason: modelResult.reason ?? "model_error",
      startIso,
      endIso,
      cursor,
      processedMessages: messages.length,
      model: modelResult.model,
      status: modelResult.status,
      finishReason: modelResult.finishReason
    };
  }

  const extractResult = await extractDreamMemoriesFromMessages(env, {
    namespace,
    messages
  });
  const extractedMemories = extractResult.memories;

  if (extractResult.reason === "model_error") {
    console.error("dream: extract model failed; cursor not advanced", {
      date: dateLabel,
      reason: extractResult.reason,
      model: extractResult.model,
      status: extractResult.status
    });
    await safeFinishDreamRun(env.DB, {
      id: dreamRunId,
      status: "error",
      reason: "extract_model_error",
      model: extractResult.model ?? modelResult.model,
      processedMessages: messages.length,
      error: extractResult.status
        ? `status=${extractResult.status}`
        : "model_error"
    });
    return {
      ran: false,
      mode: "dream",
      date: dateLabel,
      reason: "extract_model_error",
      startIso,
      endIso,
      cursor,
      processedMessages: messages.length,
      model: extractResult.model ?? modelResult.model,
      status: extractResult.status
    };
  }

  if (dryRun) {
    const worldFactUpdateIds = new Set<string>();
    for (const item of digest.memories_to_update ?? []) {
      const target = await resolveWorldFactTarget(env, { namespace, targetId: item.target_id });
      if (target) worldFactUpdateIds.add(item.target_id);
    }
    const routingPlan = buildDreamRoutingPlan({
      extracted: extractedMemories,
      digest,
      worldFactUpdateIds
    });
    await safeFinishDreamRun(env.DB, {
      id: dreamRunId,
      status: "skipped",
      reason: "dry_run",
      model: modelResult.model,
      processedMessages: messages.length
    });
    return {
      ran: true,
      stats: {
        date: dateLabel,
        mode: "dream",
        processedMessages: messages.length,
        addedMemories: 0,
        updatedMemories: 0,
        deletedMemories: 0,
        queuedCandidates: routingPlan.summary.to_candidates,
        savedExcerpts: 0,
        cleanedEmptyMemories,
        cursorAdvanced: false,
        hasMore
      },
      proposal: digest,
      routing_plan: routingPlan,
      extracted_memories: extractedMemories
    };
  }

  const lastMessage = messages[messages.length - 1];
  const messageIds = messages.map((message) => message.id);

  if (!v2Enabled) {
    console.error("dream: v2 lifecycle disabled; cursor not advanced", { namespace, date: dateLabel });
    await safeFinishDreamRun(env.DB, {
      id: dreamRunId,
      status: "error",
      reason: "v2_disabled",
      model: modelResult.model,
      processedMessages: messages.length
    });
    return {
      ran: false,
      mode: "dream",
      date: dateLabel,
      reason: "v2_disabled",
      startIso,
      endIso,
      cursor,
      processedMessages: messages.length,
      model: modelResult.model
    };
  }

  const v2Result = await applyDreamV2(env, {
    namespace,
    strategy,
    dateLabel,
    messages,
    digest,
    messageIds,
    extracted: extractedMemories
  });

  await writeCursor(env.DB, cursorName, hasMore ? lastMessage.created_at : `done:${lastMessage.created_at}`);

  await safeFinishDreamRun(env.DB, {
    id: dreamRunId,
    status: "ok",
    model: modelResult.model,
    processedMessages: messages.length,
    error: v2Result.errors.length > 0 ? JSON.stringify(v2Result.errors) : null
  });

  return {
    ran: true,
    stats: {
      date: dateLabel,
      mode: "dream",
      processedMessages: messages.length,
      addedMemories: v2Result.added,
      updatedMemories: v2Result.updated,
      deletedMemories: v2Result.deleted,
      queuedCandidates: v2Result.queuedCandidates,
      savedExcerpts: v2Result.excerpts,
      cleanedEmptyMemories,
      cursorAdvanced: true,
      hasMore,
      errors: v2Result.errors
    }
  };
}
