import { authenticate } from "../auth/apiKey";
import { requireScope } from "../auth/scopes";
import { createEmbedding } from "../memory/embedding";
import {
  createVectorMemory,
  deleteVectorMemory,
  getVectorMemory,
  listVectorMemories,
  searchVectorMemories,
  updateVectorMemory,
  vectorMetadataToMemoryRecord
} from "../memory/vectorStore";
import { json, openAiError } from "../utils/json";
import type { Env, KeyProfile, MemoryApiRecord } from "../types";
import { readBoolean, readJsonObject, readPositiveInt, readString } from "../utils/request";

interface CacheHealthRow {
  created_at: string;
  model: string | null;
  cache_read_tokens: number | null;
  cache_creation_tokens: number | null;
  input_tokens: number | null;
  client_system_hash: string | null;
  cache_anchor_block: string | null;
}

interface ModelAgg {
  model: string;
  requests: number;
  cache_creation_tokens: number;
  cache_read_tokens: number;
  input_tokens: number;
}

interface HashAgg {
  client_system_hash: string;
  requests: number;
  cache_read_tokens: number;
}

interface CacheHealthSummary {
  total_requests: number;
  cache_creation_total_tokens: number;
  cache_read_total_tokens: number;
  input_total_tokens: number;
  cache_read_ratio: number;
  by_model: ModelAgg[];
  by_client_system_hash: HashAgg[];
  recent: CacheHealthRow[];
}

// All queries filter to Anthropic/Claude traffic only.
const ANTHROPIC_FILTER = "(provider = 'anthropic' OR lower(model) LIKE 'anthropic/%' OR lower(model) LIKE '%claude%')";

function canReadDebug(profile: KeyProfile): boolean {
  return profile.scopes.includes("debug:read") || profile.scopes.includes("memory:write");
}

function embeddingNorm(vector: number[]): number {
  return Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
}

function readEmbeddingModel(env: Env): string {
  return env.EMBEDDING_MODEL?.trim() || "workers-ai/@cf/google/embeddinggemma-300m";
}

function readEmbeddingProvider(model: string): string {
  if (model.startsWith("workers-ai/") || model.startsWith("worker/") || model.startsWith("@cf/")) return "workers-ai";
  return "openai-compatible";
}

function compactMatch(match: VectorizeMatch): Record<string, unknown> {
  const record = vectorMetadataToMemoryRecord(match, match.score);
  return {
    id: match.id,
    vector_namespace: match.namespace,
    score: match.score,
    namespace: record?.namespace,
    ref_id: record?.id,
    type: record?.type,
    content_preview: record?.content.slice(0, 120)
  };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function queryVectorize(
  env: Env,
  vector: number[],
  namespace: string
): Promise<{ namespaced: Record<string, unknown>[]; legacy: Record<string, unknown>[] }> {
  if (!env.VECTORIZE) return { namespaced: [], legacy: [] };

  const namespaced = await env.VECTORIZE.query(vector, {
    topK: 10,
    namespace,
    returnMetadata: "all"
  });
  const legacy = await env.VECTORIZE.query(vector, {
    topK: 10,
    returnMetadata: "all"
  });

  return {
    namespaced: namespaced.matches.map(compactMatch),
    legacy: legacy.matches.map(compactMatch)
  };
}

async function waitForVectorMemory(
  env: Env,
  memory: MemoryApiRecord,
  vector: number[],
  namespace: string
): Promise<{
  visible: boolean;
  attempts: number;
  getByPublicId: MemoryApiRecord | null;
  getByVectorId: MemoryApiRecord | null;
  directQuery: { namespaced: Record<string, unknown>[]; legacy: Record<string, unknown>[] };
  apiSearch: MemoryApiRecord[];
}> {
  let getByPublicId: MemoryApiRecord | null = null;
  let getByVectorId: MemoryApiRecord | null = null;
  let directQuery: { namespaced: Record<string, unknown>[]; legacy: Record<string, unknown>[] } = {
    namespaced: [],
    legacy: []
  };
  let apiSearch: MemoryApiRecord[] = [];

  for (let attempt = 1; attempt <= 8; attempt += 1) {
    getByPublicId = await getVectorMemory(env, memory.id);
    getByVectorId = memory.vector_id ? await getVectorMemory(env, memory.vector_id) : null;
    directQuery = await queryVectorize(env, vector, namespace);
    apiSearch = await searchVectorMemories(env, {
      namespace,
      query: memory.content,
      topK: 10
    });

    const visible =
      Boolean(getByPublicId || getByVectorId) ||
      directQuery.namespaced.some((match) => match.id === memory.vector_id || match.ref_id === memory.id) ||
      directQuery.legacy.some((match) => match.id === memory.vector_id || match.ref_id === memory.id) ||
      apiSearch.some((item) => item.id === memory.id || item.vector_id === memory.vector_id);

    if (visible || attempt === 8) {
      return { visible, attempts: attempt, getByPublicId, getByVectorId, directQuery, apiSearch };
    }

    await delay(2500);
  }

  return { visible: false, attempts: 8, getByPublicId, getByVectorId, directQuery, apiSearch };
}

export async function handleVectorHealth(request: Request, env: Env): Promise<Response> {
  const auth = await authenticate(request, env);
  if (!auth.ok) return openAiError("Unauthorized", 401, "authentication_error");
  if (!canReadDebug(auth.profile)) return openAiError("Missing required scope: debug:read", 403);

  const url = new URL(request.url);
  const namespace = url.searchParams.get("namespace")?.trim() || auth.profile.namespace;
  const phrase =
    url.searchParams.get("phrase")?.trim() ||
    `vector-health-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const model = readEmbeddingModel(env);
  const result: Record<string, unknown> = {
    ok: false,
    namespace,
    phrase,
    config: {
      embedding_model: model,
      embedding_provider: readEmbeddingProvider(model),
      embedding_dimensions_config: env.EMBEDDING_DIMENSIONS || null,
      vectorize_index_name: env.VECTORIZE_INDEX_NAME || "memo-kb",
      has_ai_binding: Boolean(env.AI),
      has_vectorize_binding: Boolean(env.VECTORIZE),
      has_cloudflare_api_config: Boolean(env.CLOUDFLARE_ACCOUNT_ID && env.CLOUDFLARE_API_TOKEN)
    },
    checks: {}
  };

  let created: MemoryApiRecord | null = null;

  try {
    const vector = await createEmbedding(env, phrase);
    if (!vector) {
      result.checks = { embedding: { ok: false, error: "embedding_returned_null" } };
      return json(result, { status: 503 });
    }

    const checks: Record<string, unknown> = {
      embedding: {
        ok: true,
        dimensions: vector.length,
        norm: Number(embeddingNorm(vector).toFixed(6)),
        sample: vector.slice(0, 6)
      }
    };

    if (!env.VECTORIZE) {
      result.checks = { ...checks, vectorize: { ok: false, error: "missing_vectorize_binding" } };
      return json(result, { status: 503 });
    }

    const beforeQuery = await queryVectorize(env, vector, namespace);
    checks.before_query = beforeQuery;

    created = await createVectorMemory(env, {
      namespace,
      type: "debug",
      content: phrase,
      importance: 0.1,
      confidence: 1,
      tags: ["vector-health"],
      source: "debug"
    });
    checks.create = {
      ok: true,
      id: created.id,
      vector_id: created.vector_id
    };

    const visibility = await waitForVectorMemory(env, created, vector, namespace);
    checks.get = {
      attempts: visibility.attempts,
      by_id: Boolean(visibility.getByPublicId),
      by_vector_id: Boolean(visibility.getByVectorId),
      by_id_vector_id: visibility.getByPublicId?.vector_id || null,
      by_vector_id_vector_id: visibility.getByVectorId?.vector_id || null
    };

    checks.after_query = visibility.directQuery;
    checks.api_search = {
      count: visibility.apiSearch.length,
      hits: visibility.apiSearch.map((memory) => ({
        id: memory.id,
        vector_id: memory.vector_id,
        score: memory.score,
        type: memory.type,
        content_preview: memory.content.slice(0, 120)
      }))
    };

    checks.result = {
      ok: visibility.visible,
      reason: visibility.visible ? "canary_visible_after_write" : "canary_not_visible_after_write"
    };

    result.ok = visibility.visible;
    result.checks = checks;
    return json(result, { status: visibility.visible ? 200 : 500 });
  } catch (error) {
    result.checks = {
      ...(typeof result.checks === "object" && result.checks ? result.checks : {}),
      error: error instanceof Error ? error.message : String(error)
    };
    return json(result, { status: 500 });
  } finally {
    if (created?.id) {
      try {
        await deleteVectorMemory(env, created.id);
      } catch (error) {
        console.error("vector_health cleanup failed", error);
      }
    }
  }
}

export async function handleVectorReindex(request: Request, env: Env): Promise<Response> {
  const auth = await authenticate(request, env);
  if (!auth.ok) return openAiError("Unauthorized", 401, "authentication_error");
  if (!auth.profile.scopes.includes("memory:write")) {
    return openAiError("Missing required scope: memory:write", 403);
  }

  const body = await readJsonObject(request);
  if (!body) return openAiError("Request body must be a JSON object", 400);

  const namespace = readString(body.namespace) || auth.profile.namespace;
  const limit = readPositiveInt(body.limit, 50, 100);
  const cursor = readString(body.cursor);
  const dryRun = readBoolean(body.dry_run, true);
  const model = readEmbeddingModel(env);

  try {
    const page = await listVectorMemories(env, {
      namespace,
      count: limit,
      cursor
    });
    const rewritten: Array<{ id: string; vector_id: string | null; ok: boolean; error?: string }> = [];

    for (const memory of page.data) {
      if (dryRun) {
        rewritten.push({ id: memory.id, vector_id: memory.vector_id, ok: true });
        continue;
      }

      try {
        const updated = await updateVectorMemory(env, memory.id, {
          type: memory.type,
          content: memory.content,
          summary: memory.summary,
          importance: memory.importance,
          confidence: memory.confidence,
          pinned: memory.pinned,
          tags: memory.tags,
          source: memory.source,
          sourceMessageIds: memory.source_message_ids,
          expiresAt: memory.expires_at
        });
        rewritten.push({
          id: memory.id,
          vector_id: updated?.vector_id || memory.vector_id,
          ok: Boolean(updated)
        });
      } catch (error) {
        rewritten.push({
          id: memory.id,
          vector_id: memory.vector_id,
          ok: false,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }

    const failed = rewritten.filter((item) => !item.ok);
    return json({
      ok: failed.length === 0,
      data: {
        namespace,
        embedding_model: model,
        dry_run: dryRun,
        requested_limit: limit,
        listed_ids: page.count,
        matched_memories: page.data.length,
        rewritten_count: rewritten.length - failed.length,
        failed_count: failed.length,
        cursor: page.cursor,
        has_more: page.hasMore,
        total_count: page.totalCount,
        rewritten,
        failed
      }
    }, { status: failed.length === 0 ? 200 : 500 });
  } catch (error) {
    return json({
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    }, { status: 500 });
  }
}

export async function handleCacheHealth(request: Request, env: Env): Promise<Response> {
  const auth = await authenticate(request, env);
  if (!auth.ok) return openAiError("Unauthorized", 401, "authentication_error");

  const scopeError = requireScope(auth.profile, "debug:read");
  if (scopeError) return scopeError;

  try {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    const summary = await env.DB.prepare(
      `SELECT
         COUNT(*) as total_requests,
         COALESCE(SUM(cache_creation_tokens), 0) as cache_creation_total_tokens,
         COALESCE(SUM(cache_read_tokens), 0) as cache_read_total_tokens,
         COALESCE(SUM(input_tokens), 0) as input_total_tokens
       FROM usage_logs
       WHERE created_at >= ? AND ${ANTHROPIC_FILTER}`
    ).bind(since).first<{
      total_requests: number;
      cache_creation_total_tokens: number;
      cache_read_total_tokens: number;
      input_total_tokens: number;
    }>();

    const totalRequests = summary?.total_requests ?? 0;
    const cacheCreationTotal = summary?.cache_creation_total_tokens ?? 0;
    const cacheReadTotal = summary?.cache_read_total_tokens ?? 0;
    const inputTotal = summary?.input_total_tokens ?? 0;

    const byModel = await env.DB.prepare(
      `SELECT
         model,
         COUNT(*) as requests,
         COALESCE(SUM(cache_creation_tokens), 0) as cache_creation_tokens,
         COALESCE(SUM(cache_read_tokens), 0) as cache_read_tokens,
         COALESCE(SUM(input_tokens), 0) as input_tokens
       FROM usage_logs
       WHERE created_at >= ? AND ${ANTHROPIC_FILTER}
       GROUP BY model
       ORDER BY requests DESC`
    ).bind(since).all<ModelAgg>();

    const byHash = await env.DB.prepare(
      `SELECT
         client_system_hash,
         COUNT(*) as requests,
         COALESCE(SUM(cache_read_tokens), 0) as cache_read_tokens
       FROM usage_logs
       WHERE created_at >= ? AND client_system_hash IS NOT NULL AND ${ANTHROPIC_FILTER}
       GROUP BY client_system_hash
       ORDER BY requests DESC`
    ).bind(since).all<HashAgg>();

    const recent = await env.DB.prepare(
      `SELECT
         created_at, model, cache_read_tokens, cache_creation_tokens,
         input_tokens, client_system_hash, cache_anchor_block
       FROM usage_logs
       WHERE created_at >= ? AND ${ANTHROPIC_FILTER}
       ORDER BY created_at DESC
       LIMIT 10`
    ).bind(since).all<CacheHealthRow>();

    const result: CacheHealthSummary = {
      total_requests: totalRequests,
      cache_creation_total_tokens: cacheCreationTotal,
      cache_read_total_tokens: cacheReadTotal,
      input_total_tokens: inputTotal,
      cache_read_ratio: inputTotal > 0 ? cacheReadTotal / inputTotal : 0,
      by_model: byModel.results ?? [],
      by_client_system_hash: byHash.results ?? [],
      recent: recent.results ?? []
    };

    return json(result);
  } catch (error) {
    console.error("cache_health query failed", error);
    return json({ error: "cache_health_query_failed" }, { status: 500 });
  }
}
