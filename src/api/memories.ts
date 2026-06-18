import { authenticate } from "../auth/apiKey";
import { requireScope } from "../auth/scopes";
import { getOrCreateConversation } from "../db/conversations";
import { fetchMemoriesByIds, getMemoryById, listMemoriesPage } from "../db/memories";
import { saveIngestMessages } from "../db/messages";
import { runDailyMemoryDigest } from "../memory/dailyDigest";
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
import {
  createSyncedMemory,
  patchSyncedMemory,
  deleteSyncedMemory,
  supersedeSyncedMemory,
} from "../memory/state";
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
    const created = await createSyncedMemory(env, {
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
    thread: readString(url.searchParams.get("thread")) || undefined,
    factKey: readString(url.searchParams.get("fact_key")) || undefined,
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

  const updated = await patchSyncedMemory(env, namespace, id, patch);

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

  await deleteSyncedMemory(env, profile.namespace, id);
  return json({ data: { id: existing.id, vector_id: existing.vector_id, deleted: true } });
}

async function handleGetMemory(env: Env, profile: KeyProfile, id: string): Promise<Response> {
  const scopeError = requireScope(profile, "memory:read");
  if (scopeError) return scopeError;

  const memory = await getMemoryById(env.DB, { namespace: profile.namespace, id });

  if (!memory || memory.namespace !== profile.namespace) return openAiError("Memory not found", 404);
  return json({ data: toMemoryApiRecord(memory) });
}

const REVIEW_EVENT_TYPES = ["z_audit", "z_conflict", "y_relation_review", "m_patrol"];

async function handleReviewQueue(env: Env, profile: KeyProfile): Promise<Response> {
  const scopeError = requireScope(profile, "memory:read");
  if (scopeError) return scopeError;

  const namespace = profile.namespace;
  const placeholders = REVIEW_EVENT_TYPES.map(() => "?").join(", ");
  const events = await env.DB
    .prepare(
      `SELECT * FROM memory_events
       WHERE namespace = ?
         AND event_type IN (${placeholders})
         AND resolved_at IS NULL
       ORDER BY created_at DESC
       LIMIT 100`
    )
    .bind(namespace, ...REVIEW_EVENT_TYPES)
    .all<{ id: string; event_type: string; memory_id: string | null; payload_json: string; created_at: string }>();

  const rows = events.results ?? [];
  const allMemoryIds = new Set<string>();
  for (const row of rows) {
    try {
      const payload = JSON.parse(row.payload_json);
      for (const id of payload.memory_ids ?? []) { if (typeof id === "string") allMemoryIds.add(id); }
      if (typeof payload.best_id === "string") allMemoryIds.add(payload.best_id);
      for (const id of payload.weaker_ids ?? []) { if (typeof id === "string") allMemoryIds.add(id); }
      if (typeof payload.old_memory_id === "string") allMemoryIds.add(payload.old_memory_id);
    } catch { /* skip malformed */ }
    if (row.memory_id) allMemoryIds.add(row.memory_id);
  }

  const memories = await fetchMemoriesByIds(env.DB, { namespace, ids: [...allMemoryIds] });
  const memoryMap = new Map(memories.map((m) => [m.id, toMemoryApiRecord(m)]));

  const grouped: Record<string, Array<Record<string, unknown>>> = {};
  for (const type of REVIEW_EVENT_TYPES) grouped[type] = [];

  for (const row of rows) {
    let payload: Record<string, unknown> = {};
    try { payload = JSON.parse(row.payload_json); } catch { /* skip */ }

    const memoryIds = [
      ...((payload.memory_ids as string[]) ?? []),
      payload.best_id,
      ...((payload.weaker_ids as string[]) ?? []),
      payload.old_memory_id,
      row.memory_id,
    ].filter((id): id is string => typeof id === "string");

    const relatedMemories = memoryIds
      .map((id) => memoryMap.get(id))
      .filter((m): m is NonNullable<typeof m> => m !== undefined);

    const item = {
      event_id: row.id,
      event_type: row.event_type,
      created_at: row.created_at,
      payload,
      memories: relatedMemories,
    };

    if (grouped[row.event_type]) grouped[row.event_type].push(item);
  }

  const counts: Record<string, number> = {};
  for (const type of REVIEW_EVENT_TYPES) counts[type] = grouped[type].length;

  return json({
    data: grouped,
    meta: { namespace, counts, total: rows.length }
  });
}

async function handleReviewResolve(
  request: Request,
  env: Env,
  profile: KeyProfile
): Promise<Response> {
  const scopeError = requireScope(profile, "memory:write");
  if (scopeError) return scopeError;

  const body = await readJsonObject(request);
  if (!body) return openAiError("Request body must be a JSON object", 400);

  const eventId = readString(body.event_id);
  const action = readString(body.action);
  const namespace = profile.namespace;

  if (!eventId) return openAiError("event_id is required", 400);
  if (!action || !["supersede", "keep_both", "edit"].includes(action)) {
    return openAiError("action must be supersede, keep_both, or edit", 400);
  }

  const event = await env.DB
    .prepare("SELECT * FROM memory_events WHERE namespace = ? AND id = ?")
    .bind(namespace, eventId)
    .first<{ id: string; event_type: string; payload_json: string; resolved_at: string | null }>();

  if (!event) return openAiError("Event not found", 404);
  if (event.resolved_at) return openAiError("Event already resolved", 409);

  const now = new Date().toISOString();
  let resultPayload: Record<string, unknown> = {};

  try {
    const payload = JSON.parse(event.payload_json);

    if (action === "supersede") {
      const keepId = readString(body.keep_id);
      const supersedeIds = readStringArray(body.supersede_ids);
      if (!keepId) return openAiError("keep_id is required for supersede action", 400);

      const keepMemory = await getMemoryById(env.DB, { namespace, id: keepId });
      if (!keepMemory) return openAiError("keep_id memory not found", 404);

      for (const oldId of supersedeIds) {
        if (oldId === keepId) continue;
        await supersedeSyncedMemory(env, namespace, oldId, {
          namespace,
          type: keepMemory.type,
          content: keepMemory.content,
          importance: keepMemory.importance,
          confidence: keepMemory.confidence,
          tags: JSON.parse(keepMemory.tags || "[]"),
          source: "review_resolve",
          sourceMessageIds: JSON.parse(keepMemory.source_message_ids || "[]"),
          factKey: keepMemory.fact_key,
          thread: keepMemory.thread,
          riskLevel: keepMemory.risk_level,
          urgencyLevel: keepMemory.urgency_level,
          tensionScore: keepMemory.tension_score,
          responsePosture: keepMemory.response_posture,
        }, {
          action: "review_supersede",
          event_id: eventId,
          old_memory_id: oldId,
          kept_id: keepId,
        });
      }
      resultPayload = { action: "supersede", keep_id: keepId, superseded_ids: supersedeIds };
    }

    if (action === "keep_both") {
      resultPayload = { action: "keep_both", note: readString(body.note) || null };
    }

    if (action === "edit") {
      const editId = readString(body.edit_id);
      if (!editId) return openAiError("edit_id is required for edit action", 400);

      const updated = await patchSyncedMemory(env, namespace, editId, {
        content: readString(body.content) || undefined,
        type: readString(body.type) || undefined,
        importance: typeof body.importance === "number" ? body.importance : undefined,
        confidence: typeof body.confidence === "number" ? body.confidence : undefined,
        factKey: body.fact_key !== undefined ? normalizeFactKey(body.fact_key) : undefined,
        thread: body.thread !== undefined ? normalizeThread(body.thread) : undefined,
        riskLevel: body.risk_level !== undefined ? normalizeRiskLevel(body.risk_level) : undefined,
        urgencyLevel: body.urgency_level !== undefined ? normalizeUrgencyLevel(body.urgency_level) : undefined,
        tensionScore: body.tension_score !== undefined ? normalizeTensionScore(body.tension_score) : undefined,
        responsePosture: body.response_posture !== undefined ? normalizeResponsePosture(body.response_posture) : undefined,
      });

      resultPayload = { action: "edit", edit_id: editId, updated: updated ? true : false };
    }
  } catch (error) {
    return openAiError(error instanceof Error ? error.message : "resolve failed", 500);
  }

  await env.DB
    .prepare("UPDATE memory_events SET resolved_at = ? WHERE id = ?")
    .bind(now, eventId)
    .run();

  return json({
    data: {
      event_id: eventId,
      resolved_at: now,
      result: resultPayload,
    }
  });
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

  if (tail.length === 1 && tail[0] === "review" && request.method === "GET") {
    return handleReviewQueue(env, auth.profile);
  }

  if (tail.length === 2 && tail[0] === "review" && tail[1] === "resolve" && request.method === "POST") {
    return handleReviewResolve(request, env, auth.profile);
  }

  if (tail.length === 1) {
    const id = tail[0];
    if (request.method === "GET") return handleGetMemory(env, auth.profile, id);
    if (request.method === "PATCH") return handlePatchMemory(request, env, auth.profile, id);
    if (request.method === "DELETE") return handleDeleteMemory(env, auth.profile, id);
  }

  return openAiError("Not found", 404);
}
