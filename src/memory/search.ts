import { fetchMemoriesByIds, markMemoriesRecalled, searchMemoriesByText } from "../db/memories";
import { fetchMemoryLifecycleRows } from "../db/v2";
import type { Env, MemoryApiRecord, MemoryLifecycleRow, MemoryRecord } from "../types";
import { createEmbedding } from "./embedding";

type MetadataMap = Record<string, unknown>;

// provenance (additive)：MemoryApiRecord 之外挂一个 backed 位，
// 标记这条命中是否有有效 D1 记录背书。不改 types.ts 里的 MemoryApiRecord，
// 只在本文件扩展一层，调用方按 MemoryApiRecord 用照样成立 (结构类型, 多出的字段不碍事)。
export interface MemoryApiRecordWithProvenance extends MemoryApiRecord {
  backed: boolean;
}

export interface SearchMemoriesResult {
  records: MemoryApiRecordWithProvenance[];
  // 本次响应里没有 D1 背书的命中数 (RECALL_REQUIRE_D1_BACKING=true 时应恒为 0，因为已被丢弃)
  unbacked_count: number;
  // RECALL_REQUIRE_D1_BACKING=true 时，因严格过滤被丢弃的孤儿向量命中数
  unbacked_dropped: number;
}

function parseJsonArray(value: string | null): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

// v2 字段从 memory_lifecycle 侧车表合并 (可选)。lc 传 undefined 时 v2 字段全 null。
export function toMemoryApiRecord(
  record: MemoryRecord,
  score?: number,
  lc?: MemoryLifecycleRow | null
): MemoryApiRecord {
  return {
    id: record.id,
    namespace: record.namespace,
    type: record.type,
    content: record.content,
    summary: record.summary,
    importance: record.importance,
    confidence: record.confidence,
    status: record.status,
    pinned: Boolean(record.pinned),
    tags: parseJsonArray(record.tags),
    source: record.source,
    source_message_ids: parseJsonArray(record.source_message_ids),
    vector_id: record.vector_id,
    last_recalled_at: record.last_recalled_at,
    recall_count: record.recall_count,
    created_at: record.created_at,
    updated_at: record.updated_at,
    expires_at: record.expires_at,
    // v2 字段 (侧车表)，闸三降权靠 last_injected_at，supersede 链靠 supersedes_*。
    fact_key: lc?.fact_key ?? null,
    supersedes_id: lc?.supersedes_id ?? null,
    superseded_by_id: lc?.superseded_by_id ?? null,
    review_reason: lc?.review_reason ?? null,
    valid_as_of: lc?.valid_as_of ?? null,
    last_seen_at: lc?.last_seen_at ?? null,
    seen_count: lc?.seen_count ?? 0,
    last_injected_at: lc?.last_injected_at ?? null,
    ...(score === undefined ? {} : { score })
  };
}

function getTopK(env: Env, requested?: number): number {
  const fallback = Number(env.MEMORY_TOP_K || 50);
  const value = requested || fallback;
  return Math.min(Math.max(value, 1), 200);
}

// Recall floor on the raw embedding score, applied BEFORE the reranker.
// Kept low on purpose: embeddinggemma under-scores on-topic-but-reworded hits
// (~0.15–0.20), so a high floor silently drops relevant memories. Precision is
// owned downstream by the reranker + LLM compressor, not by this gate.
function getMinScore(env: Env): number {
  const value = Number(env.MEMORY_MIN_SCORE || 0.1);
  return Number.isFinite(value) ? Math.min(Math.max(value, 0), 1) : 0.1;
}

function getLegacyFallbackLimit(env: Env, topK: number): number {
  const value = Number(env.MEMORY_LEGACY_VECTOR_FALLBACK_LIMIT || 3);
  const limit = Number.isFinite(value) ? Math.max(Math.floor(value), 0) : 3;
  return Math.min(limit, topK);
}

function getLegacyFallbackScoreFactor(env: Env): number {
  const value = Number(env.MEMORY_LEGACY_VECTOR_FALLBACK_SCORE_FACTOR || 0.45);
  return Number.isFinite(value) ? Math.min(Math.max(value, 0), 1) : 0.45;
}

// 严格 D1 背书过滤开关。默认 off = 现状 (legacy 孤儿向量走 legacyOnlyRecords 兜底透传)。
function isRequireD1Backing(env: Env): boolean {
  return env.RECALL_REQUIRE_D1_BACKING === "true";
}

function getRefId(match: VectorizeMatch): string | null {
  const metadata = (match.metadata || {}) as MetadataMap;
  const refId = metadata.ref_id;
  if (typeof refId === "string") return refId;
  if (match.id.startsWith("mem_")) return match.id.slice("mem_".length);
  return null;
}

function readMetadataText(metadata: MetadataMap): string | null {
  const fields = ["content", "text", "memory", "summary", "document", "chunk", "value", "title"];

  for (const field of fields) {
    const value = metadata[field];
    if (typeof value === "string" && value.trim()) return value.trim();
  }

  return null;
}

function readMetadataString(metadata: MetadataMap, field: string): string | null {
  const value = metadata[field];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readMetadataNumber(metadata: MetadataMap, field: string, fallback: number): number {
  const value = metadata[field];
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function readMetadataBoolean(metadata: MetadataMap, field: string): boolean {
  const value = metadata[field];
  return value === true || value === "true";
}

function readMetadataStringArray(metadata: MetadataMap, field: string): string[] {
  const value = metadata[field];
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === "string");
  }
  if (typeof value === "string" && value.trim()) return [value.trim()];
  return [];
}

function toLegacyMemoryRecord(
  match: VectorizeMatch,
  input: { namespace: string }
): (MemoryRecord & { score: number }) | null {
  const metadata = (match.metadata || {}) as MetadataMap;
  const status = readMetadataString(metadata, "status");
  if (status && status !== "active") return null;

  const content = readMetadataText(metadata);
  if (!content) return null;

  const now = new Date(0).toISOString();
  const id = getRefId(match) || match.id;

  let tags = "[]";
  const rawTags = metadata.tags;
  if (typeof rawTags === "string") {
    tags = rawTags;
  } else if (Array.isArray(rawTags)) {
    tags = JSON.stringify(rawTags);
  }

  return {
    id,
    namespace: readMetadataString(metadata, "namespace") || input.namespace,
    type: readMetadataString(metadata, "type") || "note",
    content,
    summary: readMetadataString(metadata, "summary"),
    importance: readMetadataNumber(metadata, "importance", 0.5),
    confidence: readMetadataNumber(metadata, "confidence", 0.8),
    status: "active",
    pinned: readMetadataBoolean(metadata, "pinned") ? 1 : 0,
    tags,
    source: readMetadataString(metadata, "source_id") || readMetadataString(metadata, "source") || "vectorize",
    source_message_ids: JSON.stringify([]),
    vector_id: match.id,
    last_recalled_at: null,
    recall_count: 0,
    created_at: readMetadataString(metadata, "created_at") || now,
    updated_at: readMetadataString(metadata, "updated_at") || now,
    expires_at: null,
    score: match.score
  };
}

async function queryVectorize(
  env: Env,
  vector: number[],
  input: { namespace: string; types?: string[]; topK: number },
  useFilter: boolean
): Promise<VectorizeMatches> {
  if (!useFilter) {
    return env.VECTORIZE!.query(vector, {
      topK: input.topK,
      returnMetadata: true
    });
  }

  const filter: VectorizeVectorMetadataFilter = {
    namespace: input.namespace,
    status: "active"
  };

  if (input.types && input.types.length > 0) {
    filter.type = { $in: input.types };
  }

  return env.VECTORIZE!.query(vector, {
    topK: input.topK,
    namespace: input.namespace,
    returnMetadata: true,
    filter
  });
}

interface VectorizeSearchOutcome {
  records: Array<MemoryRecord & { score: number; backed: boolean }>;
  // 严格模式下因没有 D1 背书被整批丢弃的孤儿向量命中数 (未开严格模式恒为 0)
  unbackedDropped: number;
}

async function searchWithVectorize(
  env: Env,
  input: { namespace: string; query: string; types?: string[]; topK: number }
): Promise<VectorizeSearchOutcome | null> {
  if (!env.VECTORIZE || !input.query.trim()) return null;

  const vector = await createEmbedding(env, input.query);
  if (!vector) return null;

  const legacyFallbackLimit = getLegacyFallbackLimit(env, input.topK);
  // Vectorize 带 returnMetadata:true 时单次 query 的 topK 硬上限是 50，超过会抛异常(worker 1101 → HTTP 500)。
  // 之前钳到 100，hook 传 top_k≥17 时 vectorTopK 就跨过 50 必崩。钳到 50 根治。
  const vectorTopK = Math.min(Math.max(input.topK * 3, input.topK + legacyFallbackLimit), 50);
  const vectorInput = { ...input, topK: vectorTopK };
  let result = await queryVectorize(env, vector, vectorInput, true);
  let usedUnfilteredFallback = false;
  if (result.matches.length === 0) {
    result = await queryVectorize(env, vector, vectorInput, false);
    usedUnfilteredFallback = true;
  }

  const minScore = getMinScore(env);
  const scoredIds = new Map<string, number>();
  const legacyRecords: Array<MemoryRecord & { score: number }> = [];

  for (const match of result.matches) {
    if (match.score < minScore) continue;

    // Unfiltered fallback can return vectors from any namespace. Force a
    // strict metadata filter here so foreign-namespace memories never leak in
    // via toLegacyMemoryRecord's input.namespace fallback. Vectors without an
    // explicit namespace field are dropped — we do NOT fall back to
    // input.namespace (that is the bug this guard prevents).
    if (usedUnfilteredFallback) {
      const md = (match.metadata || {}) as Record<string, unknown>;
      if (typeof md.namespace !== "string" || md.namespace !== input.namespace) continue;
      const status = md.status;
      if (status !== undefined && status !== "active") continue;
    }

    const id = getRefId(match);
    if (id) scoredIds.set(id, match.score);
    const legacy = toLegacyMemoryRecord(match, input);
    if (legacy) legacyRecords.push(legacy);
  }

  const allRecords = await fetchMemoriesByIds(env.DB, {
    namespace: input.namespace,
    ids: [...scoredIds.keys()]
  });

  // Only return active memories — expired/deleted/superseded must not be injected
  const activeRecords = allRecords.filter((record) => record.status === "active");

  // Use allRecords (not just active) so inactive D1 records block legacy fallback
  const foundD1Ids = new Set(allRecords.map((record) => record.id));
  const d1Records = activeRecords.map((record) => ({
    ...record,
    score: scoredIds.get(record.id) ?? 0,
    backed: true
  }));

  // legacyCandidates: Vectorize 命中里解不出有效 D1 记录的孤儿向量 (deleted/从未落 D1 的老数据)。
  const legacyCandidates = legacyRecords.filter((record) => !foundD1Ids.has(record.id));
  const requireD1Backing = isRequireD1Backing(env);
  // 严格模式: 不给 legacy 兜底留任何位置，孤儿向量整批丢弃而不是降权透传。
  const legacySlots = requireD1Backing
    ? 0
    : Math.max(0, Math.min(input.topK - d1Records.length, legacyFallbackLimit));
  const legacyOnlyRecords = legacySlots > 0
    ? legacyCandidates
      .sort((a, b) => b.score + b.importance * 0.05 - (a.score + a.importance * 0.05))
      .slice(0, legacySlots)
      .map((record) => ({
        ...record,
        score: record.score * getLegacyFallbackScoreFactor(env),
        source: record.source === "vectorize" ? "legacy_vectorize" : record.source || "legacy_vectorize",
        backed: false
      }))
    : [];
  const unbackedDropped = requireD1Backing ? legacyCandidates.length : 0;

  const records = [...d1Records, ...legacyOnlyRecords].sort(
    (a, b) => b.score + b.importance * 0.05 - (a.score + a.importance * 0.05)
  ).slice(0, input.topK);

  return { records, unbackedDropped };
}

// searchMemories 的完整版本: 额外带 provenance 计数 (unbacked_count / unbacked_dropped)，
// 供 v2 recall 管线在 meta 里透出，观察 legacy 孤儿向量的占比。
export async function searchMemoriesWithProvenance(
  env: Env,
  input: { namespace: string; query: string; types?: string[]; topK?: number }
): Promise<SearchMemoriesResult> {
  const topK = getTopK(env, input.topK);
  const vectorOutcome = await searchWithVectorize(env, {
    namespace: input.namespace,
    query: input.query,
    types: input.types,
    topK
  });

  let records: Array<MemoryRecord & { score: number; backed: boolean }>;
  let unbackedDropped = 0;

  if (vectorOutcome && vectorOutcome.records.length > 0) {
    records = vectorOutcome.records;
    unbackedDropped = vectorOutcome.unbackedDropped;
  } else {
    // D1 全文兜底: 结果本来就来自 memories 表, 天然全部有 D1 背书。
    const textRecords = await searchMemoriesByText(env.DB, {
      namespace: input.namespace,
      query: input.query,
      types: input.types,
      limit: Math.max(topK, 50)
    });
    records = textRecords.map((record) => ({ ...record, backed: true }));
  }

  await markMemoriesRecalled(env.DB, {
    namespace: input.namespace,
    ids: records.map((record) => record.id)
  });

  // v2: 批量查侧车行，合并 last_injected_at (闸三降权) 等 v2 字段。
  const lifecycleRows = await fetchMemoryLifecycleRows(env.DB, records.map((r) => r.id));
  const lifecycleByMemoryId = new Map(lifecycleRows.map((lc) => [lc.memory_id, lc]));

  const apiRecords: MemoryApiRecordWithProvenance[] = records.map((record) => ({
    ...toMemoryApiRecord(record, record.score, lifecycleByMemoryId.get(record.id) ?? null),
    backed: record.backed
  }));

  const unbackedCount = apiRecords.filter((record) => !record.backed).length;

  return { records: apiRecords, unbacked_count: unbackedCount, unbacked_dropped: unbackedDropped };
}

export async function searchMemories(
  env: Env,
  input: { namespace: string; query: string; types?: string[]; topK?: number }
): Promise<MemoryApiRecordWithProvenance[]> {
  const result = await searchMemoriesWithProvenance(env, input);
  return result.records;
}
