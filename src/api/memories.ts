import { authenticate } from "../auth/apiKey";
import { requireScope } from "../auth/scopes";
import { getOrCreateConversation } from "../db/conversations";
import { createMemory, getMemoryById, listMemoriesPage, softDeleteMemory, updateMemory } from "../db/memories";
import { saveIngestMessages } from "../db/messages";
import { runDailyMemoryDigest } from "../memory/dailyDigest";
import { upsertMemoryEmbedding } from "../memory/embedding";
import { filterAndCompressMemoriesWithMeta } from "../memory/filter";
import { formatMemoryPatch } from "../memory/inject";
import {
  normalizeFactKey,
  normalizeResponsePosture,
  normalizeRiskLevel,
  normalizeTensionScore,
  normalizeThread,
  normalizeUrgencyLevel
} from "../memory/coordinates";
import { searchMemories, toMemoryApiRecord } from "../memory/search";
import { enqueueMemoryMaintenanceIfNeeded } from "../queue/producer";
import type { Env, KeyProfile } from "../types";
import { json, openAiError } from "../utils/json";
import {
  readBoolean,
  readJsonObject,
  readMessages,
  readNonNegativeInt,
  readNumber,
  readOptionalString,
  readPositiveInt,
  readString,
  readStringArray,
  resolveNamespace
} from "../utils/request";

async function handleCreateMemory(
  request: Request,
  env: Env,
  profile: KeyProfile
): Promise<Response> {
  const scopeError = requireScope(profile, "memory:write");
  if (scopeError) return scopeError;

  const body = await readJsonObject(request);
  if (!body) return openAiError("Request body must be a JSON object", 400);

  const content = readString(body.content);
  const type = readString(body.type) || "note";

  if (!content) {
    return openAiError("content is required", 400);
  }

  let memory;
  try {
    const created = await createMemory(env.DB, {
      namespace: resolveNamespace(profile, body.namespace),
      type,
      content,
      summary: readOptionalString(body.summary),
      importance: readNumber(body.importance, 0.5),
      confidence: readNumber(body.confidence, 0.8),
      pinned: readBoolean(body.pinned),
      tags: readStringArray(body.tags),
      source: readOptionalString(body.source) || profile.source,
      sourceMessageIds: readStringArray(body.source_message_ids),
      expiresAt: readOptionalString(body.expires_at),
      factKey: normalizeFactKey(body.fact_key),
      thread: normalizeThread(body.thread),
      riskLevel: normalizeRiskLevel(body.risk_level),
      urgencyLevel: normalizeUrgencyLevel(body.urgency_level),
      tensionScore: normalizeTensionScore(body.tension_score),
      responsePosture: normalizeResponsePosture(body.response_posture)
    });
    await upsertMemoryEmbedding(env, created);
    memory = toMemoryApiRecord(created);
  } catch (error) {
    const message = error instanceof Error ? error.message : "memory_create failed";
    return openAiError(message, 503, "memory_error");
  }

  return json({ data: memory }, { status: 201 });
}

async function handleListMemories(request: Request, env: Env, profile: KeyProfile): Promise<Response> {
  const scopeError = requireScope(profile, "memory:read");
  if (scopeError) return scopeError;

  const url = new URL(request.url);
  const namespace = resolveNamespace(profile, url.searchParams.get("namespace"));
  const limit = readPositiveInt(url.searchParams.get("limit"), 100, 1000);
  const offset = readNonNegativeInt(url.searchParams.get("cursor"), 0, 1_000_000);
  const page = await listMemoriesPage(env.DB, {
    namespace,
    status: readString(url.searchParams.get("status")) || "active",
    type: readString(url.searchParams.get("type")) || undefined,
    limit,
    offset
  });

  return json({
    data: page.records.map((record) => toMemoryApiRecord(record)),
    paging: {
      limit,
      cursor: page.nextOffset === null ? null : String(page.nextOffset),
      has_more: page.hasMore,
      count: page.records.length
    }
  });
}

async function handleSearchMemories(request: Request, env: Env, profile: KeyProfile): Promise<Response> {
  const scopeError = requireScope(profile, "memory:read");
  if (scopeError) return scopeError;

  const body = await readJsonObject(request);
  if (!body) return openAiError("Request body must be a JSON object", 400);

  const query = readString(body.query) || "";
  if (!query) return openAiError("query is required", 400);

  const namespace = resolveNamespace(profile, body.namespace);
  const topK = readPositiveInt(body.top_k, Number(env.MEMORY_TOP_K || 50), 50);
  const types = readStringArray(body.types);
  const raw = await searchMemories(env, { namespace, query, topK, types });
  const shouldFilter = readBoolean(body.filter, true);
  const filterResult = shouldFilter
    ? await filterAndCompressMemoriesWithMeta(env, { query, memories: raw })
    : null;
  const data = filterResult ? filterResult.data : raw;

  return json({
    data,
    meta: {
      namespace,
      backend: "d1",
      top_k: topK,
      raw_count: raw.length,
      count: data.length,
      filtered: shouldFilter,
      ...(readBoolean(body.include_filter_debug) && filterResult ? { memory_filter: filterResult.meta } : {})
    },
    ...(readBoolean(body.include_prompt) ? { prompt: formatMemoryPatch(data) } : {})
  });
}

async function handleIngestMemories(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  profile: KeyProfile
): Promise<Response> {
  const scopeError = requireScope(profile, "memory:write");
  if (scopeError) return scopeError;

  const body = await readJsonObject(request);
  if (!body) return openAiError("Request body must be a JSON object", 400);

  const messages = readMessages(body.messages);
  if (messages.length === 0) return openAiError("messages must contain at least one message", 400);

  const namespace = resolveNamespace(profile, body.namespace);
  const conversation = await getOrCreateConversation(env.DB, {
    namespace,
    id: readString(body.conversation_id)
  });
  const source = readString(body.source) || profile.source;
  const ids = await saveIngestMessages(env.DB, {
    conversationId: conversation.id,
    namespace,
    source,
    messages
  });

  if (body.auto_extract !== false && ids.length > 0) {
    ctx.waitUntil(
      enqueueMemoryMaintenanceIfNeeded(env, {
        namespace,
        conversationId: conversation.id,
        fromMessageId: ids[0],
        toMessageId: ids[ids.length - 1],
        source
      })
    );
  }

  return json({
    data: {
      conversation_id: conversation.id,
      message_ids: ids,
      auto_extract: body.auto_extract !== false
    }
  });
}

async function handleRunDigest(
  request: Request,
  env: Env,
  profile: KeyProfile
): Promise<Response> {
  const scopeError = requireScope(profile, "memory:write");
  if (scopeError) return scopeError;

  const body = await readJsonObject(request);
  if (!body) return openAiError("Request body must be a JSON object", 400);

  const namespace = resolveNamespace(profile, body.namespace);
  const date = readString(body.date);
  const dates = readStringArray(body.dates);
  const targets = dates.length > 0 ? dates : date ? [date] : [undefined];
  const maxRuns = readPositiveInt(body.max_runs, Number(env.DREAM_MAX_RUNS || env.DAILY_DIGEST_MAX_RUNS || 10), 10);
  const force = readBoolean(body.force, false);
  const results: Array<{ date?: string; runs: Array<Awaited<ReturnType<typeof runDailyMemoryDigest>>> }> = [];

  for (const target of targets) {
    const runs: Array<Awaited<ReturnType<typeof runDailyMemoryDigest>>> = [];
    for (let i = 0; i < maxRuns; i += 1) {
      const result = await runDailyMemoryDigest(env, namespace, {
        dateLabel: target,
        force: force && i === 0
      });
      runs.push(result);
      if (!result.ran || !result.stats?.hasMore) break;
    }
    results.push({ date: target, runs });
  }

  return json({
    data: {
      namespace,
      force,
      max_runs: maxRuns,
      results
    }
  });
}

export async function handleIngestMessagesApi(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const auth = await authenticate(request, env);
  if (!auth.ok) return openAiError("Unauthorized", 401, "authentication_error");

  return handleIngestMemories(request, env, ctx, auth.profile);
}

export async function handleSearchMemoriesApi(request: Request, env: Env): Promise<Response> {
  const auth = await authenticate(request, env);
  if (!auth.ok) return openAiError("Unauthorized", 401, "authentication_error");

  return handleSearchMemories(request, env, auth.profile);
}

async function handlePatchMemory(
  request: Request,
  env: Env,
  profile: KeyProfile,
  id: string
): Promise<Response> {
  const scopeError = requireScope(profile, "memory:write");
  if (scopeError) return scopeError;

  const body = await readJsonObject(request);
  if (!body) return openAiError("Request body must be a JSON object", 400);

  const namespace = resolveNamespace(profile, body.namespace);
  const existing = await getMemoryById(env.DB, { namespace, id });
  if (!existing || existing.namespace !== namespace) return openAiError("Memory not found", 404);

  const patch = {
    type: readString(body.type),
    content: readString(body.content),
    summary: readOptionalString(body.summary),
    importance: typeof body.importance === "number" ? readNumber(body.importance, 0.5) : undefined,
    confidence: typeof body.confidence === "number" ? readNumber(body.confidence, 0.8) : undefined,
    status: readString(body.status),
    pinned: typeof body.pinned === "boolean" ? readBoolean(body.pinned) : undefined,
    tags: Array.isArray(body.tags) ? readStringArray(body.tags) : undefined,
    sourceMessageIds: Array.isArray(body.source_message_ids) ? readStringArray(body.source_message_ids) : undefined,
    expiresAt: body.expires_at === undefined ? undefined : readOptionalString(body.expires_at),
    factKey: body.fact_key === undefined ? undefined : normalizeFactKey(body.fact_key),
    thread: body.thread === undefined ? undefined : normalizeThread(body.thread),
    riskLevel: body.risk_level === undefined ? undefined : normalizeRiskLevel(body.risk_level),
    urgencyLevel: body.urgency_level === undefined ? undefined : normalizeUrgencyLevel(body.urgency_level),
    tensionScore: body.tension_score === undefined ? undefined : normalizeTensionScore(body.tension_score),
    responsePosture: body.response_posture === undefined ? undefined : normalizeResponsePosture(body.response_posture)
  };

  const updated = await updateMemory(env.DB, { namespace, id, patch });
  if (updated) await upsertMemoryEmbedding(env, updated);

  if (!updated) return openAiError("Memory not found", 404);
  return json({ data: toMemoryApiRecord(updated) });
}

async function handleDeleteMemory(
  env: Env,
  profile: KeyProfile,
  id: string
): Promise<Response> {
  const scopeError = requireScope(profile, "memory:write");
  if (scopeError) return scopeError;

  const existing = await getMemoryById(env.DB, { namespace: profile.namespace, id });
  if (!existing || existing.namespace !== profile.namespace) return openAiError("Memory not found", 404);

  await softDeleteMemory(env.DB, { namespace: profile.namespace, id });
  return json({ data: { id: existing.id, vector_id: existing.vector_id, deleted: true } });
}

async function handleGetMemory(env: Env, profile: KeyProfile, id: string): Promise<Response> {
  const scopeError = requireScope(profile, "memory:read");
  if (scopeError) return scopeError;

  const memory = await getMemoryById(env.DB, { namespace: profile.namespace, id });

  if (!memory || memory.namespace !== profile.namespace) return openAiError("Memory not found", 404);
  return json({ data: toMemoryApiRecord(memory) });
}

export async function handleMemories(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const auth = await authenticate(request, env);
  if (!auth.ok) return openAiError("Unauthorized", 401, "authentication_error");

  const url = new URL(request.url);
  const parts = url.pathname.split("/").filter(Boolean);
  const tail = parts.slice(2);

  if (tail.length === 0 && request.method === "GET") {
    return handleListMemories(request, env, auth.profile);
  }

  if (tail.length === 0 && request.method === "POST") {
    return handleCreateMemory(request, env, auth.profile);
  }

  if (tail.length === 1 && tail[0] === "search" && request.method === "POST") {
    return handleSearchMemories(request, env, auth.profile);
  }

  if (tail.length === 1 && (tail[0] === "digest" || tail[0] === "dream") && request.method === "POST") {
    return handleRunDigest(request, env, auth.profile);
  }

  if (tail.length === 1 && tail[0] === "ingest" && request.method === "POST") {
    return handleIngestMemories(request, env, ctx, auth.profile);
  }

  if (tail.length === 1) {
    const id = tail[0];
    if (request.method === "GET") return handleGetMemory(env, auth.profile, id);
    if (request.method === "PATCH") return handlePatchMemory(request, env, auth.profile, id);
    if (request.method === "DELETE") return handleDeleteMemory(env, auth.profile, id);
  }

  return openAiError("Not found", 404);
}
