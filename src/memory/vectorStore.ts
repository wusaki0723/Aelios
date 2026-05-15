import type { Env, MemoryApiRecord } from "../types";
import { newId } from "../utils/ids";
import { nowIso } from "../utils/time";
import { createEmbedding } from "./embedding";

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

function toMetadata(input: Required<VectorMemoryInput> & { id: string; vectorId: string; createdAt: string; updatedAt: string }): Record<string, VectorizeVectorMetadata> {
  return {
    kind: "memory",
    namespace: input.namespace,
    ref_id: input.id,
    type: input.type,
    content: input.content,
    summary: input.summary || "",
    importance: input.importance,
    confidence: input.confidence,
    status: "active",
    pinned: input.pinned,
    tags: input.tags,
    source: input.source || "",
    source_message_ids: input.sourceMessageIds,
    created_at: input.createdAt,
    updated_at: input.updatedAt,
    expires_at: input.expiresAt || ""
  };
}

export function vectorMetadataToMemoryRecord(
  vector: Pick<VectorizeVector, "id" | "metadata">,
  score?: number
): MemoryApiRecord | null {
  const metadata = (vector.metadata || {}) as MetadataMap;
  const status = readString(metadata.status) || "active";
  if (status !== "active") return null;

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
    type: input.type || "note",
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

  await requireVectorize(env).upsert([
    {
      id: vectorId,
      values: vector,
      namespace: normalized.namespace,
      metadata: toMetadata(normalized)
    }
  ]);

  return {
    id,
    namespace: normalized.namespace,
    type: normalized.type,
    content,
    summary: normalized.summary,
    importance: normalized.importance,
    confidence: normalized.confidence,
    status: "active",
    pinned: normalized.pinned,
    tags: normalized.tags,
    source: normalized.source,
    source_message_ids: normalized.sourceMessageIds,
    vector_id: vectorId,
    last_recalled_at: null,
    recall_count: 0,
    created_at: now,
    updated_at: now,
    expires_at: normalized.expiresAt
  };
}

export async function getVectorMemory(env: Env, id: string): Promise<MemoryApiRecord | null> {
  const vectorId = id.startsWith("mem_") ? id : `mem_${id}`;
  const vectors = await requireVectorize(env).getByIds([vectorId]);
  return vectorMetadataToMemoryRecord(vectors[0] || { id: vectorId, metadata: {} });
}

export async function deleteVectorMemory(env: Env, id: string): Promise<boolean> {
  const vectorId = id.startsWith("mem_") ? id : `mem_${id}`;
  await requireVectorize(env).deleteByIds([vectorId]);
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

  await requireVectorize(env).upsert([
    {
      id: vectorId,
      values: vector,
      namespace: next.namespace,
      metadata: toMetadata(next)
    }
  ]);

  return {
    ...existing,
    type: next.type,
    content: next.content,
    summary: next.summary,
    importance: next.importance,
    confidence: next.confidence,
    pinned: next.pinned,
    tags: next.tags,
    source: next.source,
    source_message_ids: next.sourceMessageIds,
    expires_at: next.expiresAt,
    updated_at: updatedAt,
    vector_id: vectorId
  };
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
  let result = await requireVectorize(env).query(vector, {
    topK,
    namespace: input.namespace,
    returnMetadata: "all",
    filter
  });

  if (result.matches.length === 0) {
    result = await requireVectorize(env).query(vector, {
      topK,
      returnMetadata: "all"
    });
  }

  return result.matches.flatMap((match): MemoryApiRecord[] => {
    const record = vectorMetadataToMemoryRecord(match, match.score);
    return record ? [record] : [];
  });
}

async function listVectorIdsViaApi(
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
  const listed = await listVectorIdsViaApi(env, input);
  const vectors = listed.ids.length > 0 ? await getVectorsByIdsBatched(requireVectorize(env), listed.ids) : [];
  const data = vectors
    .flatMap((vector): MemoryApiRecord[] => {
      const record = vectorMetadataToMemoryRecord(vector);
      if (!record) return [];
      if (input.namespace && record.namespace !== input.namespace) return [];
      return [record];
    })
    .sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.importance - a.importance || b.updated_at.localeCompare(a.updated_at));

  return {
    data,
    ids: listed.ids,
    cursor: listed.cursor,
    hasMore: listed.hasMore,
    count: listed.ids.length,
    totalCount: listed.totalCount
  };
}
