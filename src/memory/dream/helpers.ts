import { finishDreamRun, insertDreamRun } from "../../db/dreamRuns";
import type { DreamRunTrigger } from "../../db/dreamRuns";
import { listMemoriesPage } from "../../db/memories";
import { readCursor } from "../../db/retention";
import { archiveMemory, fetchMemoryLifecycleRows } from "../../db/v2";
import type { Env, MemoryApiRecord, MessageRecord } from "../../types";
import { getDateRangeForLabel } from "../dreamDates";
import { DEFAULT_EMPTY_MEMORY_MIN_CHARS } from "../dreamEnv";
import {
  clampScore,
  readPositiveInt,
  readString,
  readStringArray,
  truncate
} from "../dreamUtils";
import type { ExtractedMemory } from "../extract";
import type { PerceptionPickStats } from "../perception";
import type { RelationBuildStats, ZAuditStats } from "../relations";
import { searchMemories, toMemoryApiRecord } from "../search";
import {
  deleteVectorMemory,
  getVectorMemory,
  listVectorMemories
} from "../vectorStore";
import { isV2Enabled } from "../v2/recall";

export interface DigestMemoryUpdate {
  target_id: string;
  content?: string;
  type?: string;
  importance?: number;
  confidence?: number;
  tags?: string[];
}

export interface DigestMemoryDelete {
  target_id: string;
  reason?: string;
}

export interface DailyDigestResult {
  date?: string;
  title?: string;
  summary?: string;
  sections?: Array<{ heading?: string; content?: string }>;
  memories_to_add?: ExtractedMemory[];
  memories_to_update?: DigestMemoryUpdate[];
  memories_to_delete?: DigestMemoryDelete[];
}

export interface DailyDigestStats {
  date: string;
  mode: "dream";
  processedMessages: number;
  addedMemories: number;
  updatedMemories: number;
  deletedMemories: number;
  queuedCandidates: number;
  cleanedEmptyMemories: number;
  cursorAdvanced: boolean;
  hasMore: boolean;
  errors?: Array<{ target_id: string; reason: string }>;
  // LMC-5 additive phases (only present when night pipeline ran them)
  relation_build?: RelationBuildStats;
  z_audit?: ZAuditStats;
  perception?: PerceptionPickStats;
}

export interface DreamRoutingItem {
  destination: "candidate" | "world_fact_direct";
  kind: "extract" | "add" | "update" | "delete";
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

export type DailyDigestSkipReason =
  | "dream_disabled"
  | "already_done"
  | "no_messages"
  | "missing_model"
  | "model_error"
  | "model_invalid_json"
  | "extract_model_error"
  | "v2_disabled";

export interface DailyDigestSkipped {
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

export type DailyDigestRunResult =
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

export interface DigestModelCallResult {
  digest: DailyDigestResult | null;
  reason?: Extract<DailyDigestSkipReason, "missing_model" | "model_error" | "model_invalid_json">;
  model?: string;
  status?: number;
  finishReason?: string | null;
}

export function normalizeExtractedMemory(value: unknown): ExtractedMemory | null {
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

export function normalizeDigestResult(value: unknown): DailyDigestResult {
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

export function formatTranscript(messages: MessageRecord[]): string {
  return messages
    .map((message) => {
      const role = message.role === "assistant" ? "我(助手)" : "用户";
      return `[${message.id}][${message.created_at}][${role}] ${truncate(message.content.trim(), 700)}`;
    })
    .join("\n\n");
}

export function formatExistingMemories(memories: MemoryApiRecord[]): string {
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

export async function retireMemoryRecord(
  env: Env,
  input: { namespace: string; id: string }
): Promise<boolean> {
  if (isV2Enabled(env)) {
    const archived = await archiveMemory(env, input);
    if (archived) return true;
  }
  return deleteVectorMemory(env, input.id);
}

export async function cleanEmptyMemories(
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

export function isWorldFactMemory(input: { type?: string | null; factKey?: string | null }): boolean {
  const type = input.type?.trim().toLowerCase();
  if (type === "world_fact") return true;
  const factKey = input.factKey?.trim().toLowerCase();
  return Boolean(factKey && (factKey.startsWith("world_fact:") || factKey.startsWith("world:")));
}

export async function resolveWorldFactTarget(
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

const DREAM_CONTEXT_QUERY_MAX_MESSAGES = 20;
const DREAM_CONTEXT_QUERY_MAX_CHARS = 4000;

export function buildDreamContextQuery(messages: MessageRecord[]): string {
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
export async function selectDreamMemoryContext(
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

export async function safeFinishDreamRun(
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

export async function safeInsertDreamRun(
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
