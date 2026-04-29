import { fetchMemoriesByIds, markMemoriesRecalled, searchMemoriesByText } from "../db/memories";
import type { Env, MemoryApiRecord, MemoryRecord } from "../types";
import { createEmbedding } from "./embedding";

type MetadataMap = Record<string, unknown>;

function parseJsonArray(value: string | null): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

export function toMemoryApiRecord(record: MemoryRecord, score?: number): MemoryApiRecord {
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
    ...(score === undefined ? {} : { score })
  };
}

function getTopK(env: Env, requested?: number): number {
  const fallback = Number(env.MEMORY_TOP_K || 8);
  const value = requested || fallback;
  return Math.min(Math.max(value, 1), 50);
}

function getMinScore(env: Env): number {
  const value = Number(env.MEMORY_MIN_SCORE || 0.35);
  return Number.isFinite(value) ? value : 0.35;
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
    tags: JSON.stringify(readMetadataStringArray(metadata, "tags")),
    source: readMetadataString(metadata, "source_id") || readMetadataString(metadata, "source") || "vectorize-legacy",
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

async function searchWithVectorize(
  env: Env,
  input: { namespace: string; query: string; types?: string[]; topK: number }
): Promise<Array<MemoryRecord & { score: number }> | null> {
  if (!env.VECTORIZE || !input.query.trim()) return null;

  const vector = await createEmbedding(env, input.query);
  if (!vector) return null;

  let result = await queryVectorize(env, vector, input, true);
  if (result.matches.length === 0) {
    result = await queryVectorize(env, vector, input, false);
  }

  const minScore = getMinScore(env);
  const scoredIds = new Map<string, number>();
  const legacyRecords: Array<MemoryRecord & { score: number }> = [];

  for (const match of result.matches) {
    if (match.score < minScore) continue;
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
  const d1Records = activeRecords.map((record) => ({ ...record, score: scoredIds.get(record.id) ?? 0 }));
  const legacyOnlyRecords = legacyRecords.filter((record) => !foundD1Ids.has(record.id));

  return [...d1Records, ...legacyOnlyRecords].sort(
    (a, b) => b.score + b.importance * 0.05 - (a.score + a.importance * 0.05)
  );
}

export async function searchMemories(
  env: Env,
  input: { namespace: string; query: string; types?: string[]; topK?: number }
): Promise<MemoryApiRecord[]> {
  const topK = getTopK(env, input.topK);
  let records = await searchWithVectorize(env, {
    namespace: input.namespace,
    query: input.query,
    types: input.types,
    topK
  });

  if (!records || records.length === 0) {
    records = await searchMemoriesByText(env.DB, {
      namespace: input.namespace,
      query: input.query,
      types: input.types,
      limit: topK
    });
  }

  await markMemoriesRecalled(env.DB, {
    namespace: input.namespace,
    ids: records.map((record) => record.id)
  });

  return records.map((record) => toMemoryApiRecord(record, record.score));
}
