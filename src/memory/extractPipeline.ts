import { listMessagesByNamespaceInRange } from "../db/messages";
import { readCursor, writeCursor } from "../db/retention";
import {
  createMemoryCandidate,
  getActiveMemoryByFactKey,
  markMemorySeen,
  supersedeMemory,
  upsertMemoryByFactKey
} from "../db/v2";
import { callOpenAICompat } from "../proxy/openaiAdapter";
import type { Env, MessageRecord, OpenAIChatRequest, OpenAIChatResponse } from "../types";
import { createEmbedding } from "./embedding";
import { type ExtractedMemory } from "./extract";
import { createVectorMemory } from "./vectorStore";
import { clampMemoryType } from "./canonicalTypes";
import { isV2Enabled } from "./v2/recall";

const DEFAULT_EXTRACT_MODEL = "deepseek/deepseek-v4-flash";
const DEFAULT_MAX_MESSAGES = 40;
const DEFAULT_MAX_RUNS = 4;
const DEFAULT_MAX_TOKENS = 1200;
const DEFAULT_DEDUP_COSINE = 0.9;
const DEFAULT_REVIEW_CONFIDENCE = 0.76;
const FOUR_HOURS_MS = 4 * 60 * 60 * 1000;

interface ExtractModelResult {
  memories: ExtractedMemory[];
  model?: string;
  reason?: "missing_model" | "model_error" | "model_invalid_json";
  status?: number;
}

interface PersistStats {
  created: number;
  superseded: number;
  duplicate: number;
  queued: number;
  failed: number;
}

interface ExtractionStats extends PersistStats {
  windowEndIso: string;
  processedMessages: number;
  extractedCandidates: number;
  cursorAdvanced: boolean;
  hasMore: boolean;
}

export type MemoryExtractionRunResult =
  | { ran: true; mode: "extract"; stats: ExtractionStats }
  | {
      ran: false;
      mode: "extract";
      reason: "extract_disabled" | "already_done" | "no_messages" | "missing_model" | "model_error" | "model_invalid_json";
      windowEndIso?: string;
      cursor?: string | null;
      processedMessages?: number;
      model?: string;
      status?: number;
    };

function readPositiveInt(value: unknown, fallback: number, max: number): number {
  const parsed = typeof value === "string" ? Number(value) : typeof value === "number" ? value : fallback;
  const numeric = Number.isFinite(parsed) ? parsed : fallback;
  return Math.min(Math.max(Math.floor(numeric), 1), max);
}

function readDedupCosine(env: Env): number {
  const parsed = Number(env.DEDUP_COSINE ?? DEFAULT_DEDUP_COSINE);
  if (!Number.isFinite(parsed)) return DEFAULT_DEDUP_COSINE;
  return Math.min(Math.max(parsed, 0), 1);
}

function readReviewConfidence(env: Env): number {
  const parsed = Number(env.EXTRACT_REVIEW_CONFIDENCE ?? DEFAULT_REVIEW_CONFIDENCE);
  if (!Number.isFinite(parsed)) return DEFAULT_REVIEW_CONFIDENCE;
  return Math.min(Math.max(parsed, 0), 1);
}

function readExtractModel(env: Env): string | null {
  const model = env.EXTRACT_MODEL?.trim() || DEFAULT_EXTRACT_MODEL;
  return model || null;
}

function floorToFourHourWindow(date: Date): Date {
  const windowEnd = new Date(date);
  windowEnd.setUTCMinutes(0, 0, 0);
  windowEnd.setUTCHours(Math.floor(windowEnd.getUTCHours() / 4) * 4);
  return windowEnd;
}

function windowEndIso(scheduledTime?: number): string {
  const base = typeof scheduledTime === "number" && Number.isFinite(scheduledTime)
    ? new Date(scheduledTime)
    : new Date();
  return floorToFourHourWindow(base).toISOString();
}

function previousWindowStartIso(endIso: string): string {
  return new Date(new Date(endIso).getTime() - FOUR_HOURS_MS).toISOString();
}

function normalizeContent(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

function cosineSimilarity(a: number[], b: number[]): number {
  const length = Math.min(a.length, b.length);
  if (length === 0) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < length; i += 1) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

async function isSameFactByEmbedding(
  env: Env,
  input: { existingContent: string; nextContent: string; threshold: number }
): Promise<boolean> {
  if (normalizeContent(input.existingContent) === normalizeContent(input.nextContent)) return true;
  const [existingVector, nextVector] = await Promise.all([
    createEmbedding(env, input.existingContent),
    createEmbedding(env, input.nextContent)
  ]);
  if (!existingVector || !nextVector) return false;
  return cosineSimilarity(existingVector, nextVector) >= input.threshold;
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

function normalizeCandidate(item: unknown): ExtractedMemory | null {
  if (!item || typeof item !== "object" || Array.isArray(item)) return null;
  const raw = item as Record<string, unknown>;
  const content = readString(raw.content);
  if (!content || content.length > 1000) return null;
  return {
    type: clampMemoryType(readString(raw.type)),
    content,
    importance: clampScore(raw.importance, 0.65),
    confidence: clampScore(raw.confidence, 0.82),
    tags: readStringArray(raw.tags),
    source_message_ids: readStringArray(raw.source_message_ids),
    fact_key: readString(raw.fact_key) ?? undefined
  };
}

function parseExtractModelOutput(text: string): ExtractedMemory[] | null {
  const parsed = extractJsonObject(text);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const raw = parsed as Record<string, unknown>;
  const memories = Array.isArray(raw.memories) ? raw.memories : Array.isArray(raw.candidates) ? raw.candidates : [];
  return memories.flatMap((item): ExtractedMemory[] => {
    const candidate = normalizeCandidate(item);
    return candidate ? [candidate] : [];
  });
}

function formatTranscript(messages: MessageRecord[]): string {
  return messages
    .map((message) => {
      const role = message.role === "assistant" ? "我(助手)" : "用户";
      return `[${message.id}][${message.created_at}][${role}] ${message.content.trim().slice(0, 900)}`;
    })
    .join("\n\n");
}

function buildExtractPrompt(messages: MessageRecord[]): string {
  return [
    "你是 Aelios 的小批量长期记忆抽取器。只做一个判断：这段对话有没有值得长期保留的稳定事实，并提炼成一句未来可直接使用的记忆。",
    "只输出 JSON，不要 markdown，不要解释，不要输出思考过程。",
    "",
    "边界：",
    "- 不做判重、不做合并、不决定是否 supersede；这些由代码按 embedding 和 fact_key 处理。",
    "- 不保存普通寒暄、临时任务、调试口令、纯情绪噪音、后端实现流水账。",
    "- 只有用户明确说出、确认、长期表现出的事实，才能写成关于用户的记忆。",
    "- 关于用户的记忆，优先写成“你……”。关于我应遵守的长期方式，写成“我需要……”。",
    "- 每条 content 必须是一句自然短句。",
    "- type 只能从这 8 个里选：fact、event、preference、relationship、boundary、habit、decision、note。绝不输出 project、world_fact、commitment 等其他值；项目进展归 fact，承诺/决定归 decision，习惯归 habit。",
    "- 稳定事实必须尽量给 fact_key，格式为小写 ASCII，例如 project:aelios-memory-v2、preference:answer-style、boundary:no-system-records。fact_key 是分组键，跟 type 无关，可以带 project: preference: 等前缀。",
    "",
    "输出格式：",
    JSON.stringify({
      memories: [
        {
          content: "你正在把 Aelios v2 记忆写入拆成即时捕获、小批抽取和夜间整理三档。",
          type: "fact",
          fact_key: "project:aelios-memory-v2-write-pipeline",
          importance: 0.86,
          confidence: 0.92,
          tags: ["project", "aelios"],
          source_message_ids: ["msg_x"]
        }
      ]
    }),
    "",
    "如果没有值得长期保留的稳定事实，输出：",
    JSON.stringify({ memories: [] }),
    "",
    "对话：",
    formatTranscript(messages)
  ].join("\n");
}

async function callExtractModel(env: Env, messages: MessageRecord[]): Promise<ExtractModelResult> {
  const model = readExtractModel(env);
  if (!model) return { memories: [], reason: "missing_model" };

  const request: OpenAIChatRequest = {
    model,
    messages: [
      { role: "system", content: "你是严格的 JSON 生成器。你只输出 JSON。" },
      { role: "user", content: buildExtractPrompt(messages) }
    ],
    temperature: 0,
    max_tokens: readPositiveInt(env.EXTRACT_MAX_TOKENS, DEFAULT_MAX_TOKENS, 4000),
    response_format: { type: "json_object" },
    stream: false
  };

  try {
    const response = await callOpenAICompat(env, request);
    if (!response.ok) return { memories: [], model, reason: "model_error", status: response.status };
    const parsed = (await response.json()) as OpenAIChatResponse;
    const message = parsed.choices?.[0]?.message as ({ content?: unknown; reasoning_content?: unknown }) | undefined;
    const content = typeof message?.content === "string" ? message.content.trim() : "";
    const reasoning = typeof message?.reasoning_content === "string" ? message.reasoning_content.trim() : "";
    const memories = parseExtractModelOutput(content || reasoning);
    if (!memories) return { memories: [], model, reason: "model_invalid_json" };
    return { memories, model };
  } catch (error) {
    console.error("extract: model failed", { model, error });
    return { memories: [], model, reason: "model_error" };
  }
}

async function findEmbeddingDuplicate(
  env: Env,
  input: { namespace: string; type: string; content: string; threshold: number }
): Promise<{ id: string; score: number } | null> {
  if (!env.VECTORIZE) return null;
  const vector = await createEmbedding(env, input.content);
  if (!vector) return null;

  const result = await env.VECTORIZE.query(vector, {
    topK: 5,
    returnMetadata: "all",
    filter: {
      namespace: input.namespace,
      kind: "memory",
      type: input.type,
      status: "active"
    } as VectorizeVectorMetadataFilter
  } as unknown as Parameters<typeof env.VECTORIZE.query>[1]);
  const matches = (result.matches ?? []) as VectorizeMatch[];
  for (const match of matches) {
    if ((match.score ?? 0) < input.threshold) continue;
    const metadata = (match.metadata ?? {}) as Record<string, unknown>;
    const id = typeof metadata.ref_id === "string" ? metadata.ref_id : null;
    if (id) return { id, score: match.score ?? 0 };
  }
  return null;
}

async function persistCandidate(
  env: Env,
  input: { namespace: string; memory: ExtractedMemory; fallbackMessageIds: string[]; dedupCosine: number }
): Promise<"created" | "superseded" | "duplicate" | "queued"> {
  const sourceMessageIds = input.memory.source_message_ids.length > 0
    ? input.memory.source_message_ids
    : input.fallbackMessageIds;
  const factKey = input.memory.fact_key?.trim();

  if (input.memory.confidence < readReviewConfidence(env)) {
    await createMemoryCandidate(env.DB, {
      namespace: input.namespace,
      type: input.memory.type,
      content: input.memory.content,
      factKey: factKey || null,
      confidence: input.memory.confidence,
      importance: input.memory.importance,
      tags: input.memory.tags,
      sourceMessageIds,
      source: "extract"
    });
    return "queued";
  }

  if (factKey) {
    const existing = await getActiveMemoryByFactKey(env.DB, { namespace: input.namespace, factKey });
    if (existing) {
      if (await isSameFactByEmbedding(env, {
        existingContent: existing.content,
        nextContent: input.memory.content,
        threshold: input.dedupCosine
      })) {
        await markMemorySeen(env.DB, { namespace: input.namespace, id: existing.id });
        return "duplicate";
      }
      await supersedeMemory(env, {
        namespace: input.namespace,
        oldId: existing.id,
        newContent: input.memory.content,
        newType: input.memory.type,
        newFactKey: factKey,
        importance: input.memory.importance,
        confidence: input.memory.confidence,
        tags: input.memory.tags,
        source: "extract",
        sourceMessageIds,
        reason: "extract_fact_key"
      });
      return "superseded";
    }

    await upsertMemoryByFactKey(env, {
      namespace: input.namespace,
      factKey,
      content: input.memory.content,
      type: input.memory.type,
      importance: input.memory.importance,
      confidence: input.memory.confidence,
      tags: input.memory.tags,
      source: "extract",
      sourceMessageIds
    });
    return "created";
  }

  const duplicate = await findEmbeddingDuplicate(env, {
    namespace: input.namespace,
    type: input.memory.type,
    content: input.memory.content,
    threshold: input.dedupCosine
  });
  if (duplicate) {
    await markMemorySeen(env.DB, { namespace: input.namespace, id: duplicate.id });
    return "duplicate";
  }

  await createVectorMemory(env, {
    namespace: input.namespace,
    type: input.memory.type,
    content: input.memory.content,
    importance: input.memory.importance,
    confidence: input.memory.confidence,
    tags: input.memory.tags,
    source: "extract",
    sourceMessageIds
  });
  return "created";
}

async function persistCandidates(
  env: Env,
  input: { namespace: string; memories: ExtractedMemory[]; fallbackMessageIds: string[] }
): Promise<PersistStats> {
  const stats: PersistStats = { created: 0, superseded: 0, duplicate: 0, queued: 0, failed: 0 };
  const dedupCosine = readDedupCosine(env);

  for (const memory of input.memories) {
    try {
      const result = await persistCandidate(env, {
        namespace: input.namespace,
        memory,
        fallbackMessageIds: input.fallbackMessageIds,
        dedupCosine
      });
      stats[result] += 1;
    } catch (error) {
      stats.failed += 1;
      console.error("extract: failed to persist candidate", { namespace: input.namespace, error });
    }
  }

  return stats;
}

export async function runMemoryExtractionWindow(
  env: Env,
  namespace: string,
  options: { scheduledTime?: number; force?: boolean } = {}
): Promise<MemoryExtractionRunResult> {
  if (!isV2Enabled(env)) return { ran: false, mode: "extract", reason: "extract_disabled" };

  const endIso = windowEndIso(options.scheduledTime);
  const cursorName = `extract:${namespace}`;
  const doneName = `extract:${namespace}:${endIso}`;
  const cursor = await readCursor(env.DB, cursorName);
  const done = await readCursor(env.DB, doneName);
  if (!options.force && done?.startsWith("done:")) {
    return { ran: false, mode: "extract", reason: "already_done", windowEndIso: endIso, cursor };
  }

  const maxMessages = readPositiveInt(env.EXTRACT_MAX_MESSAGES, DEFAULT_MAX_MESSAGES, 200);
  const startIso = cursor ?? previousWindowStartIso(endIso);
  const rows = await listMessagesByNamespaceInRange(env.DB, {
    namespace,
    startCreatedAt: startIso,
    endCreatedAt: endIso,
    afterCreatedAt: cursor,
    limit: maxMessages + 1
  });
  const hasMore = rows.length > maxMessages;
  const messages = rows.slice(0, maxMessages);
  if (messages.length === 0) {
    await writeCursor(env.DB, doneName, `done:${cursor ?? endIso}`);
    return { ran: false, mode: "extract", reason: "no_messages", windowEndIso: endIso, cursor };
  }

  const modelResult = await callExtractModel(env, messages);
  if (modelResult.reason) {
    return {
      ran: false,
      mode: "extract",
      reason: modelResult.reason,
      windowEndIso: endIso,
      cursor,
      processedMessages: messages.length,
      model: modelResult.model,
      status: modelResult.status
    };
  }

  const messageIds = messages.map((message) => message.id);
  const persisted = await persistCandidates(env, {
    namespace,
    memories: modelResult.memories,
    fallbackMessageIds: messageIds
  });
  const lastMessage = messages[messages.length - 1];
  await writeCursor(env.DB, cursorName, lastMessage.created_at);
  if (!hasMore) await writeCursor(env.DB, doneName, `done:${lastMessage.created_at}`);

  return {
    ran: true,
    mode: "extract",
    stats: {
      windowEndIso: endIso,
      processedMessages: messages.length,
      extractedCandidates: modelResult.memories.length,
      created: persisted.created,
      superseded: persisted.superseded,
      duplicate: persisted.duplicate,
      queued: persisted.queued,
      failed: persisted.failed,
      cursorAdvanced: true,
      hasMore
    }
  };
}

export async function runMemoryExtractionBatches(
  env: Env,
  namespace: string,
  options: { scheduledTime?: number; force?: boolean } = {}
): Promise<MemoryExtractionRunResult[]> {
  const maxRuns = readPositiveInt(env.EXTRACT_MAX_RUNS, DEFAULT_MAX_RUNS, 10);
  const results: MemoryExtractionRunResult[] = [];
  for (let i = 0; i < maxRuns; i += 1) {
    const result = await runMemoryExtractionWindow(env, namespace, options);
    results.push(result);
    if (!result.ran || !result.stats.hasMore) break;
  }
  return results;
}
