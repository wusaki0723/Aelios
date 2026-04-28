import { fetchMemoriesByIds, markMemoriesRecalled, searchMemoriesByText } from "../db/memories";
import type { Env, MemoryApiRecord, MemoryRecord } from "../types";
import { createEmbedding } from "./embedding";

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
  const metadata = match.metadata || {};
  const refId = metadata.ref_id;
  if (typeof refId === "string") return refId;
  if (match.id.startsWith("mem_")) return match.id.slice("mem_".length);
  return null;
}

async function searchWithVectorize(
  env: Env,
  input: { namespace: string; query: string; types?: string[]; topK: number }
): Promise<Array<MemoryRecord & { score: number }> | null> {
  if (!env.VECTORIZE || !input.query.trim()) return null;

  const vector = await createEmbedding(env, input.query);
  if (!vector) return null;

  const filter: VectorizeVectorMetadataFilter = {
    namespace: input.namespace,
    status: "active"
  };

  if (input.types && input.types.length > 0) {
    filter.type = { $in: input.types };
  }

  const result = await env.VECTORIZE.query(vector, {
    topK: input.topK,
    namespace: input.namespace,
    returnMetadata: true,
    filter
  });

  const minScore = getMinScore(env);
  const scoredIds = new Map<string, number>();

  for (const match of result.matches) {
    if (match.score < minScore) continue;
    const id = getRefId(match);
    if (id) scoredIds.set(id, match.score);
  }

  const records = await fetchMemoriesByIds(env.DB, {
    namespace: input.namespace,
    ids: [...scoredIds.keys()]
  });

  return records
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

  records ??= await searchMemoriesByText(env.DB, {
    namespace: input.namespace,
    query: input.query,
    types: input.types,
    limit: topK
  });

  await markMemoriesRecalled(env.DB, {
    namespace: input.namespace,
    ids: records.map((record) => record.id)
  });

  return records.map((record) => toMemoryApiRecord(record, record.score));
}
