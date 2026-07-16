import type { Env, MemoryApiRecord, MemoryRecord } from "../types";
import { newId } from "../utils/ids";
import { nowIso } from "../utils/time";
import { createEmbedding } from "./embedding";
import { clampMemoryType } from "./canonicalTypes";

type MetadataMap = Record<string, unknown>;

export interface VectorMemoryInput {
  namespace: string;
  type?: string;
  content: string;
  summary?: string | null;
  importance?: number;
  confidence?: number;
  pinned?: boolean;
  tags?: string[];
  source?: string | null;
  sourceMessageIds?: string[];
  expiresAt?: string | null;
}

export interface VectorMemoryPatch {
  type?: string;
  content?: string;
  summary?: string | null;
  importance?: number;
  confidence?: number;
  status?: string;
  pinned?: boolean;
  tags?: string[];
  source?: string | null;
  sourceMessageIds?: string[];
  expiresAt?: string | null;
}

export interface VectorMemorySearchInput {
  namespace: string;
  query: string;
  topK: number;
  types?: string[];
}

export interface VectorMemoryListInput {
  namespace?: string;
  cursor?: string;
  count: number;
  type?: string;
  status?: string;
}

export interface VectorMemoryListPage {
  data: MemoryApiRecord[];
  ids: string[];
  cursor: string | null;
  hasMore: boolean;
  count: number;
  totalCount?: number;
}

function clampScore(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.min(Math.max(value, 0), 1) : fallback;
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readBoolean(value: unknown): boolean {
  return value === true || value === "true" || value === 1;
}

function parseStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean);
  if (typeof value !== "string" || !value.trim()) return [];

  try {
    const parsed = JSON.parse(value) as unknown;
    if (Array.isArray(parsed)) return parseStringArray(parsed);
  } catch {
    // Plain metadata strings are also valid single tags.
  }

  return [value.trim()];
}

function toMetadata(input: Required<VectorMemoryInput> & { id: string; vectorId: string; createdAt: string; updatedAt: string; status?: string }): Record<string, VectorizeVectorMetadata> {
  return {
    kind: "memory",
    namespace: input.namespace,
    ref_id: input.id,
    type: input.type,
    content: input.content,
    summary: input.summary || "",
    importance: input.importance,
    confidence: input.confidence,
    status: input.status || "active",
    pinned: input.pinned,
    tags: JSON.stringify(input.tags),
    source: input.source || "",
    source_message_ids: JSON.stringify(input.sourceMessageIds),
    created_at: input.createdAt,
    updated_at: input.updatedAt,
    expires_at: input.expiresAt || ""
  };
}

export function vectorMetadataToMemoryRecord(
  vector: Pick<VectorizeVector, "id" | "metadata">,
  score?: number,
  options?: { includeInactive?: boolean }
): MemoryApiRecord | null {
  const metadata = (vector.metadata || {}) as MetadataMap;
  const status = readString(metadata.status) || "active";
  if (!options?.includeInactive && status !== "active") return null;

  const content = readString(metadata.content) || readString(metadata.text) || readString(metadata.memory);
  if (!content) return null;

  const id = readString(metadata.ref_id) || (vector.id.startsWith("mem_") ? vector.id.slice("mem_".length) : vector.id);
  const now = new Date(0).toISOString();

  return {
    id,
    namespace: readString(metadata.namespace) || "default",
    type: readString(metadata.type) || "note",
    content,
    summary: readString(metadata.summary),
    importance: clampScore(metadata.importance, 0.5),
    confidence: clampScore(metadata.confidence, 0.8),
    status,
    pinned: readBoolean(metadata.pinned),
    tags: parseStringArray(metadata.tags),
    source: readString(metadata.source) || readString(metadata.source_id),
    source_message_ids: parseStringArray(metadata.source_message_ids),
    vector_id: vector.id,
    last_recalled_at: null,
    recall_count: 0,
    created_at: readString(metadata.created_at) || now,
    updated_at: readString(metadata.updated_at) || readString(metadata.created_at) || now,
    expires_at: readString(metadata.expires_at),
    ...(score === undefined ? {} : { score })
  };
}

function requireVectorize(env: Env): Vectorize | VectorizeIndex {
  if (!env.VECTORIZE) throw new Error("Missing VECTORIZE binding");
  return env.VECTORIZE;
}

function getIndexName(env: Env): string {
  return env.VECTORIZE_INDEX_NAME?.trim() || "memo-kb";
}

function getCloudflareApiToken(env: Env): string | null {
  return env.CLOUDFLARE_API_TOKEN?.trim() || null;
}

function getAccountId(env: Env): string | null {
  return env.CLOUDFLARE_ACCOUNT_ID?.trim() || null;
}

// Recall floor on the raw embedding score from Vectorize, applied BEFORE the
// reranker. Kept low: embeddinggemma under-scores on-topic-but-reworded hits
// (~0.15–0.20), so a high floor silently drops relevant memories. The reranker
// (bge-reranker-base) and the LLM compressor downstream handle precision.
function getMinScore(env: Env): number {
  const value = Number(env.MEMORY_MIN_SCORE || 0.1);
  return Number.isFinite(value) ? Math.min(Math.max(value, 0), 1) : 0.1;
}

function isLifecycleEnabled(env: Env): boolean {
  return env.MEMORY_LIFECYCLE_ENABLED !== "false";
}

function memoryRecordToApiRecord(record: MemoryRecord): MemoryApiRecord {
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
    tags: parseStringArray(record.tags),
    source: record.source,
    source_message_ids: parseStringArray(record.source_message_ids),
    vector_id: record.vector_id,
    last_recalled_at: record.last_recalled_at,
    recall_count: record.recall_count,
    created_at: record.created_at,
    updated_at: record.updated_at,
    expires_at: record.expires_at
  };
}

function toMemoryRecord(input: Required<VectorMemoryInput> & { id: string; vectorId: string; createdAt: string; updatedAt: string }): MemoryRecord {
  return {
    id: input.id,
    namespace: input.namespace,
    type: input.type,
    content: input.content,
    summary: input.summary,
    importance: input.importance,
    confidence: input.confidence,
    status: "active",
    pinned: input.pinned ? 1 : 0,
    tags: JSON.stringify(input.tags),
    source: input.source,
    source_message_ids: JSON.stringify(input.sourceMessageIds),
    vector_id: input.vectorId,
    last_recalled_at: null,
    recall_count: 0,
    created_at: input.createdAt,
    updated_at: input.updatedAt,
    expires_at: input.expiresAt
  };
}

async function insertMemoryRecord(env: Env, record: MemoryRecord): Promise<void> {
  const memoryInsert = env.DB
    .prepare(
      `INSERT INTO memories (
        id, namespace, type, content, summary, importance, confidence, status,
        pinned, tags, source, source_message_ids, vector_id, created_at, updated_at, expires_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      record.id,
      record.namespace,
      record.type,
      record.content,
      record.summary,
      record.importance,
      record.confidence,
      record.status,
      record.pinned,
      record.tags,
      record.source,
      record.source_message_ids,
      record.vector_id,
      record.created_at,
      record.updated_at,
      record.expires_at
    );

  if (!isLifecycleEnabled(env)) {
    await memoryInsert.run();
    return;
  }

  const lifecycleInsert = env.DB
    .prepare(
      `INSERT OR IGNORE INTO memory_lifecycle (
        memory_id, namespace, fact_key, supersedes_id, superseded_by_id,
        review_reason, valid_as_of, last_seen_at, seen_count, last_injected_at
      ) VALUES (?, ?, NULL, NULL, NULL, NULL, NULL, ?, 0, NULL)`
    )
    .bind(record.id, record.namespace, record.created_at);

  await env.DB.batch([memoryInsert, lifecycleInsert]);
}

async function getVectorsByIdsBatched(
  vectorize: Vectorize | VectorizeIndex,
  ids: string[]
): Promise<VectorizeVector[]> {
  const vectors: VectorizeVector[] = [];

  for (let index = 0; index < ids.length; index += 20) {
    vectors.push(...(await vectorize.getByIds(ids.slice(index, index + 20))));
  }

  return vectors;
}

function candidateVectorIds(id: string): string[] {
  const trimmed = id.trim();
  if (!trimmed) return [];
  const candidates = trimmed.startsWith("mem_mem_")
    ? [trimmed]
    : trimmed.startsWith("mem_")
      ? [`mem_${trimmed}`, trimmed]
      : [`mem_${trimmed}`, trimmed];
  return [...new Set(candidates)];
}

function candidateMemoryIds(id: string): string[] {
  const trimmed = id.trim();
  if (!trimmed) return [];
  const candidates = [trimmed];
  if (trimmed.startsWith("mem_")) candidates.push(trimmed.slice("mem_".length));
  return [...new Set(candidates.filter(Boolean))];
}

async function getMemoryRecordById(env: Env, id: string): Promise<MemoryRecord | null> {
  for (const candidate of candidateMemoryIds(id)) {
    const record = await env.DB
      .prepare("SELECT * FROM memories WHERE id = ?")
      .bind(candidate)
      .first<MemoryRecord>();
    if (record) return record;
  }
  return null;
}

async function updateMemoryRecord(env: Env, record: MemoryRecord): Promise<MemoryRecord | null> {
  await env.DB
    .prepare(
      `UPDATE memories SET
        type = ?, content = ?, summary = ?, importance = ?, confidence = ?, status = ?,
        pinned = ?, tags = ?, source = ?, source_message_ids = ?, vector_id = ?,
        updated_at = ?, expires_at = ?
       WHERE namespace = ? AND id = ?`
    )
    .bind(
      record.type,
      record.content,
      record.summary,
      record.importance,
      record.confidence,
      record.status,
      record.pinned,
      record.tags,
      record.source,
      record.source_message_ids,
      record.vector_id,
      record.updated_at,
      record.expires_at,
      record.namespace,
      record.id
    )
    .run();

  return getMemoryRecordById(env, record.id);
}

async function markMemoryRecordDeleted(env: Env, input: { namespace: string; id: string; updatedAt: string }): Promise<void> {
  await env.DB
    .prepare("UPDATE memories SET status = 'deleted', updated_at = ? WHERE namespace = ? AND id = ?")
    .bind(input.updatedAt, input.namespace, input.id)
    .run();
}

export async function createVectorMemory(env: Env, input: VectorMemoryInput): Promise<MemoryApiRecord> {
  const content = input.content.trim();
  if (!content) throw new Error("content is required");

  const vector = await createEmbedding(env, content);
  if (!vector) throw new Error("Failed to create embedding");

  const id = newId("mem");
  const vectorId = `mem_${id}`;
  const now = nowIso();
  const normalized = {
    namespace: input.namespace,
    type: clampMemoryType(input.type, "note"),
    content,
    summary: input.summary ?? null,
    importance: clampScore(input.importance, 0.5),
    confidence: clampScore(input.confidence, 0.8),
    pinned: Boolean(input.pinned),
    tags: input.tags ?? [],
    source: input.source ?? null,
    sourceMessageIds: input.sourceMessageIds ?? [],
    expiresAt: input.expiresAt ?? null,
    id,
    vectorId,
    createdAt: now,
    updatedAt: now
  };

  const record = toMemoryRecord(normalized);
  await insertMemoryRecord(env, record);

  try {
    await requireVectorize(env).upsert([
      {
        id: vectorId,
        namespace: normalized.namespace,
        values: vector,
        metadata: toMetadata(normalized)
      }
    ]);
  } catch (error) {
    console.error("memory vector upsert failed after D1 insert", { id, error });
  }

  return memoryRecordToApiRecord(record);
}

export async function getVectorMemory(
  env: Env,
  id: string,
  options?: { requireD1Backing?: boolean }
): Promise<MemoryApiRecord | null> {
  if (options?.requireD1Backing) {
    const d1Record = await getMemoryRecordById(env, id);
    return d1Record ? memoryRecordToApiRecord(d1Record) : null;
  }

  const vectorIds = candidateVectorIds(id);
  const vectors = vectorIds.length > 0 ? await requireVectorize(env).getByIds(vectorIds) : [];

  for (const vector of vectors) {
    const record = vectorMetadataToMemoryRecord(vector);
    if (record) return record;
  }

  const d1Record = await getMemoryRecordById(env, id);
  return d1Record ? memoryRecordToApiRecord(d1Record) : null;
}

export async function deleteVectorMemory(env: Env, id: string): Promise<boolean> {
  const existing = await getVectorMemory(env, id);
  const vectorIds = existing?.vector_id ? [existing.vector_id] : candidateVectorIds(id);
  if (!existing && vectorIds.length === 0) return false;

  if (existing) {
    await markMemoryRecordDeleted(env, { namespace: existing.namespace, id: existing.id, updatedAt: nowIso() });
  }

  if (vectorIds.length > 0) {
    try {
      await requireVectorize(env).deleteByIds(vectorIds);
    } catch (error) {
      console.error("memory vector delete failed after D1 delete", { id, error });
    }
  }
  return true;
}

export async function updateVectorMemory(
  env: Env,
  id: string,
  patch: VectorMemoryPatch
): Promise<MemoryApiRecord | null> {
  const existing = await getVectorMemory(env, id);
  if (!existing) return null;

  const content = (patch.content ?? existing.content).trim();
  if (!content) return null;

  const vector = await createEmbedding(env, content);
  if (!vector) throw new Error("Failed to create embedding");

  const updatedAt = nowIso();
  const vectorId = existing.vector_id || (id.startsWith("mem_") ? id : `mem_${id}`);
  const next = {
    namespace: existing.namespace,
    type: patch.type ?? existing.type,
    content,
    summary: patch.summary === undefined ? existing.summary : patch.summary,
    importance: clampScore(patch.importance, existing.importance),
    confidence: clampScore(patch.confidence, existing.confidence),
    status: patch.status ?? existing.status,
    pinned: patch.pinned ?? existing.pinned,
    tags: patch.tags ?? existing.tags,
    source: patch.source === undefined ? existing.source : patch.source,
    sourceMessageIds: patch.sourceMessageIds ?? existing.source_message_ids,
    expiresAt: patch.expiresAt === undefined ? existing.expires_at : patch.expiresAt,
    id: existing.id,
    vectorId,
    createdAt: existing.created_at,
    updatedAt
  };

  const nextRecord: MemoryRecord = {
    id: next.id,
    namespace: next.namespace,
    type: next.type,
    content: next.content,
    summary: next.summary,
    importance: next.importance,
    confidence: next.confidence,
    status: next.status,
    pinned: next.pinned ? 1 : 0,
    tags: JSON.stringify(next.tags),
    source: next.source,
    source_message_ids: JSON.stringify(next.sourceMessageIds),
    vector_id: next.vectorId,
    last_recalled_at: existing.last_recalled_at,
    recall_count: existing.recall_count,
    created_at: next.createdAt,
    updated_at: next.updatedAt,
    expires_at: next.expiresAt
  };

  const updatedRecord = await updateMemoryRecord(env, nextRecord);
  if (!updatedRecord) return null;

  try {
    await requireVectorize(env).upsert([
      {
        id: vectorId,
        namespace: next.namespace,
        values: vector,
        metadata: toMetadata(next)
      }
    ]);
  } catch (error) {
    console.error("memory vector upsert failed after D1 update", { id: next.id, error });
  }

  return memoryRecordToApiRecord(updatedRecord);
}

export async function searchVectorMemories(
  env: Env,
  input: VectorMemorySearchInput
): Promise<MemoryApiRecord[]> {
  const query = input.query.trim();
  if (!query) return [];

  const vector = await createEmbedding(env, query);
  if (!vector) return [];

  const filter: VectorizeVectorMetadataFilter = {
    namespace: input.namespace,
    status: "active"
  };
  if (input.types && input.types.length > 0) {
    filter.type = { $in: input.types };
  }

  const topK = Math.min(Math.max(Math.floor(input.topK), 1), 50);
  const vectorize = requireVectorize(env);
  const namespacedResult = await vectorize.query(vector, {
    topK,
    namespace: input.namespace,
    returnMetadata: "all",
    filter
  });

  const legacyResult = await vectorize.query(vector, {
    topK,
    returnMetadata: "all"
  });

  const matchesByVectorId = new Map<string, VectorizeMatch>();
  for (const match of [...namespacedResult.matches, ...legacyResult.matches]) {
    const existing = matchesByVectorId.get(match.id);
    if (!existing || match.score > existing.score) {
      matchesByVectorId.set(match.id, match);
    }
  }

  return [...matchesByVectorId.values()]
    .flatMap((match): MemoryApiRecord[] => {
      if (match.score < getMinScore(env)) return [];
      // Legacy (unfiltered) query branch is only for migration-era vectors
      // that may lack a namespace. Require an explicit metadata namespace
      // matching input.namespace; do not let vectorMetadataToMemoryRecord's
      // "default" fallback pass through, or a named "default" namespace leaks.
      const md = (match.metadata || {}) as Record<string, unknown>;
      if (typeof md.namespace !== "string" || md.namespace !== input.namespace) return [];
      const record = vectorMetadataToMemoryRecord(match, match.score);
      if (!record || record.namespace !== input.namespace) return [];
      if (input.types && input.types.length > 0 && !input.types.includes(record.type)) return [];
      return [record];
    })
    .sort((a, b) => (b.score ?? 0) + b.importance * 0.05 - ((a.score ?? 0) + a.importance * 0.05))
    .slice(0, topK);
}

export async function listVectorIdsViaApi(
  env: Env,
  input: VectorMemoryListInput
): Promise<{ ids: string[]; cursor: string | null; hasMore: boolean; totalCount?: number }> {
  const accountId = getAccountId(env);
  const token = getCloudflareApiToken(env);
  if (!accountId || !token) {
    throw new Error("memory_list on Vectorize requires CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN");
  }

  const url = new URL(`https://api.cloudflare.com/client/v4/accounts/${accountId}/vectorize/v2/indexes/${getIndexName(env)}/list`);
  url.searchParams.set("count", String(Math.min(Math.max(Math.floor(input.count), 1), 1000)));
  if (input.cursor) url.searchParams.set("cursor", input.cursor);

  const response = await fetch(url, {
    headers: {
      authorization: `Bearer ${token}`
    }
  });
  if (!response.ok) {
    throw new Error(`Vectorize list failed: ${response.status}`);
  }

  const parsed = (await response.json()) as {
    result?: {
      vectors?: Array<string | { id?: string }>;
      ids?: string[];
      cursor?: string;
      next_cursor?: string;
      nextCursor?: string;
      isTruncated?: boolean;
      is_truncated?: boolean;
      totalCount?: number;
      total_count?: number;
    };
  };
  const result = parsed.result || {};
  const rawIds = result.ids || result.vectors || [];
  const ids = rawIds.flatMap((item): string[] => {
    if (typeof item === "string") return [item];
    if (item && typeof item.id === "string") return [item.id];
    return [];
  });

  return {
    ids,
    cursor: result.cursor || result.nextCursor || result.next_cursor || null,
    hasMore: Boolean(result.isTruncated ?? result.is_truncated ?? result.cursor ?? result.nextCursor ?? result.next_cursor),
    totalCount: result.totalCount ?? result.total_count
  };
}

export async function listVectorMemories(
  env: Env,
  input: VectorMemoryListInput
): Promise<VectorMemoryListPage> {
  const hasFilter = Boolean(input.type || input.status);
  const sortRecords = (records: MemoryApiRecord[]) =>
    records.sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.importance - a.importance || b.updated_at.localeCompare(a.updated_at));

  if (!hasFilter) {
    const listed = await listVectorIdsViaApi(env, input);
    const vectors = listed.ids.length > 0 ? await getVectorsByIdsBatched(requireVectorize(env), listed.ids) : [];
    const data = sortRecords(
      vectors.flatMap((vector): MemoryApiRecord[] => {
        const record = vectorMetadataToMemoryRecord(vector);
        if (!record) return [];
        if (input.namespace && record.namespace !== input.namespace) return [];
        return [record];
      })
    );

    return {
      data,
      ids: data.map((record) => record.id),
      cursor: listed.cursor,
      hasMore: listed.hasMore,
      count: data.length,
      totalCount: listed.totalCount
    };
  }

  const filtered: MemoryApiRecord[] = [];
  const includeInactive = Boolean(input.status && input.status !== "active");
  const vectorize = requireVectorize(env);
  let cursor: string | null | undefined = input.cursor;
  let hasMore = true;
  let lastCursor: string | null = null;
  let scannedPages = 0;
  const maxScanPages = 5;

  while (filtered.length < input.count && hasMore && scannedPages < maxScanPages) {
    const listed = await listVectorIdsViaApi(env, { ...input, cursor: cursor ?? undefined });
    const vectors = listed.ids.length > 0 ? await getVectorsByIdsBatched(vectorize, listed.ids) : [];

    for (const vector of vectors) {
      const record = vectorMetadataToMemoryRecord(vector, undefined, { includeInactive });
      if (!record) continue;
      if (input.namespace && record.namespace !== input.namespace) continue;
      if (input.type && record.type !== input.type) continue;
      if (input.status && record.status !== input.status) continue;
      filtered.push(record);
      if (filtered.length >= input.count) break;
    }

    cursor = listed.cursor;
    lastCursor = listed.cursor;
    hasMore = listed.hasMore;
    scannedPages += 1;
  }

  const data = sortRecords(filtered);
  return {
    data,
    ids: data.map((record) => record.id),
    cursor: lastCursor,
    hasMore,
    count: data.length
  };
}
