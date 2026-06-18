import { listRelationExpandedMemories } from "../db/memoryRelations";
import {
  fetchMemoriesByIds,
  listExperienceSimilarMemories,
  markMemoriesRecalled,
  searchMemoriesByText
} from "../db/memories";
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
    fact_key: record.fact_key,
    thread: record.thread,
    risk_level: record.risk_level,
    urgency_level: record.urgency_level,
    tension_score: record.tension_score,
    response_posture: record.response_posture,
    audit_state: record.audit_state,
    vector_sync_status: record.vector_sync_status,
    ...(score === undefined ? {} : { score })
  };
}

function getTopK(env: Env, requested?: number): number {
  const fallback = Number(env.MEMORY_TOP_K || 50);
  const value = requested || fallback;
  return Math.min(Math.max(value, 1), 50);
}

function getMinScore(env: Env): number {
  const value = Number(env.MEMORY_MIN_SCORE || 0.35);
  return Number.isFinite(value) ? Math.min(Math.max(value, 0), 1) : 0.35;
}

function getRefId(match: VectorizeMatch): string | null {
  const metadata = (match.metadata || {}) as MetadataMap;
  const refId = metadata.ref_id;
  if (typeof refId === "string") return refId;
  if (match.id.startsWith("mem_")) return match.id.slice("mem_".length);
  return null;
}

function mergeScoredRecords(records: Array<MemoryRecord & { score: number }>, limit: number): Array<MemoryRecord & { score: number }> {
  const byId = new Map<string, MemoryRecord & { score: number }>();
  for (const record of records) {
    const existing = byId.get(record.id);
    if (!existing || record.score > existing.score) {
      byId.set(record.id, record);
    }
  }
  return [...byId.values()]
    .sort((a, b) => b.score + b.importance * 0.05 - (a.score + a.importance * 0.05))
    .slice(0, limit);
}

function averageTension(records: Array<MemoryRecord & { score: number }>): number | null {
  const values = records.flatMap((record): number[] =>
    typeof record.tension_score === "number" && Number.isFinite(record.tension_score) ? [record.tension_score] : []
  );
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function dominantValue(records: Array<MemoryRecord & { score: number }>, field: "risk_level" | "urgency_level"): string | null {
  const counts = new Map<string, number>();
  for (const record of records) {
    const value = record[field];
    if (!value) continue;
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
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

  for (const match of result.matches) {
    if (match.score < minScore) continue;
    const id = getRefId(match);
    if (id) scoredIds.set(id, match.score);
  }

  const allRecords = await fetchMemoriesByIds(env.DB, {
    namespace: input.namespace,
    ids: [...scoredIds.keys()]
  });

  return allRecords
    .filter((record) => record.status === "active")
    .map((record) => ({ ...record, score: scoredIds.get(record.id) ?? 0 }))
    .sort((a, b) => b.score + b.importance * 0.05 - (a.score + a.importance * 0.05));
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
      limit: Math.max(topK, 50)
    });
  }

  if (records.length > 0) {
    const relationRecords = await listRelationExpandedMemories(env.DB, {
      namespace: input.namespace,
      baseIds: records.map((record) => record.id),
      limit: topK
    });
    const experienceRecords = await listExperienceSimilarMemories(env.DB, {
      namespace: input.namespace,
      riskLevel: dominantValue(records, "risk_level"),
      urgencyLevel: dominantValue(records, "urgency_level"),
      tensionScore: averageTension(records),
      excludeIds: records.map((record) => record.id),
      limit: Math.max(5, Math.ceil(topK / 3))
    });
    records = mergeScoredRecords([...records, ...relationRecords, ...experienceRecords], topK);
  }

  await markMemoriesRecalled(env.DB, {
    namespace: input.namespace,
    ids: records.map((record) => record.id)
  });

  return records.map((record) => toMemoryApiRecord(record, record.score));
}
