import { authenticate } from "../auth/apiKey";
import { requireScope } from "../auth/scopes";
import { getOrCreateConversation } from "../db/conversations";
import { createMemory, getMemoryById, listMemoriesPage, softDeleteMemory, updateMemory } from "../db/memories";
import { listMessagesByNamespaceInRange, saveIngestMessages } from "../db/messages";
import { runDailyMemoryDigest } from "../memory/dailyDigest";
import { deleteMemoryEmbedding, upsertMemoryEmbedding } from "../memory/embedding";
import { exportMemories } from "../memory/export";
import { filterAndCompressMemoriesWithMeta } from "../memory/filter";
import { formatMemoryPatch } from "../memory/inject";
import { findSimilarActiveMemory } from "../memory/dedupGate";
import { searchMemories, toMemoryApiRecord } from "../memory/search";
import { deleteVectorMemory } from "../memory/vectorStore";
import { clampMemoryType } from "../memory/canonicalTypes";
import {
  archiveMemory,
  countActiveMemoriesByType,
  countMemoryCandidates,
  createPrecious,
  deleteGlossary,
  deleteLongtail,
  deletePrecious,
  fetchMemoryLifecycleRows,
  getDailyLog,
  getMemoryCandidateById,
  listGlossary,
  listMemoryCandidates,
  listPrecious,
  type MemoryCandidateRow,
  supersedeMemory,
  updateGlossary,
  updateMemoryCandidateStatus,
  upsertGlossary,
  upsertMemoryByFactKey
} from "../db/v2";
import { isV2Enabled, runRecall } from "../memory/v2/recall";

import type { Env, KeyProfile, MemoryApiRecord } from "../types";
import { json, openAiError } from "../utils/json";
import {
  readBoolean,
  readJsonObject,
  readMessages,
  readNumber,
  readNonNegativeInt,
  readOptionalString,
  readPositiveInt,
  readString,
  readStringArray,
  resolveNamespace
} from "../utils/request";

async function syncMemoryEmbeddingBestEffort(env: Env, memory: Awaited<ReturnType<typeof createMemory>>): Promise<void> {
  try {
    await upsertMemoryEmbedding(env, memory);
  } catch (error) {
    console.error("memory api vector upsert failed", { id: memory.id, error });
  }
}

async function deleteMemoryEmbeddingBestEffort(env: Env, memory: Awaited<ReturnType<typeof createMemory>>): Promise<void> {
  try {
    await deleteMemoryEmbedding(env, memory);
  } catch (error) {
    console.error("memory api vector delete failed", { id: memory.id, error });
  }
}

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
  const type = clampMemoryType(readString(body.type), "note");

  if (!content) {
    return openAiError("content is required", 400);
  }

  if (isV2Enabled(env)) {
    const namespace = resolveNamespace(profile, body.namespace);
    const factKey = readString(body.fact_key);
    if (!factKey) return openAiError("fact_key is required in v2; use memory_pin for precious append-only notes", 400);
    try {
      const result = await upsertMemoryByFactKey(env, {
        namespace,
        factKey,
        type,
        content,
        importance: readNumber(body.importance, 0.6),
        confidence: readNumber(body.confidence, 0.8),
        tags: readStringArray(body.tags),
        source: readOptionalString(body.source) || profile.source,
        sourceMessageIds: readStringArray(body.source_message_ids),
        validAsOf: readOptionalString(body.valid_as_of)
      });
      const record = await getMemoryById(env.DB, { namespace, id: result.id });
      const lifecycleRows = record ? await fetchMemoryLifecycleRows(env.DB, [record.id]) : [];
      return json({
        data: record ? toMemoryApiRecord(record, undefined, lifecycleRows[0] ?? null) : result
      }, { status: result.created ? 201 : 200 });
    } catch (error) {
      const message = error instanceof Error ? error.message : "memory_upsert failed";
      return openAiError(message, 503, "memory_error");
    }
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
      expiresAt: readOptionalString(body.expires_at)
    });
    await syncMemoryEmbeddingBestEffort(env, created);
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
  const offset = readNonNegativeInt(url.searchParams.get("offset") ?? url.searchParams.get("cursor"), 0, 1000000);
  const page = await listMemoriesPage(env.DB, {
    namespace,
    status: readString(url.searchParams.get("status")) || "active",
    type: readString(url.searchParams.get("type")),
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

async function handleExportMemories(request: Request, env: Env, profile: KeyProfile): Promise<Response> {
  let scopeError = requireScope(profile, "memory:read");
  if (scopeError) return scopeError;
  scopeError = requireScope(profile, "export:read");
  if (scopeError) return scopeError;

  const url = new URL(request.url);
  try {
    const result = await exportMemories(env, {
      namespace: resolveNamespace(profile, url.searchParams.get("namespace")),
      type: readString(url.searchParams.get("type")),
      format: readString(url.searchParams.get("format")) || "json"
    });
    return json(result);
  } catch (error) {
    return openAiError(error instanceof Error ? error.message : "memory_export failed", 400, "memory_export_error");
  }
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

function readRecallK(body: Record<string, unknown>, env: Env): number {
  const raw = body.k !== undefined ? body.k : body.top_k;
  const fallback = Number(env.MEMORY_TOP_K || 50);
  if (typeof raw === "number" && Number.isFinite(raw)) {
    return Math.floor(raw);
  }
  if (typeof raw === "string" && raw.trim()) {
    const parsed = Number(raw);
    if (Number.isFinite(parsed)) return Math.floor(parsed);
  }
  return Number.isFinite(fallback) ? Math.floor(fallback) : 50;
}

async function handleRecallMemories(request: Request, env: Env, profile: KeyProfile): Promise<Response> {
  const scopeError = requireScope(profile, "memory:read");
  if (scopeError) return scopeError;

  if (!isV2Enabled(env)) {
    return handleSearchMemories(request, env, profile);
  }

  const body = await readJsonObject(request);
  if (!body) return openAiError("Request body must be a JSON object", 400);

  const query = readString(body.query) || "";
  if (!query) return openAiError("query is required", 400);

  const namespace = resolveNamespace(profile, body.namespace);
  const k = readRecallK(body, env);
  const minScore = typeof body.min_score === "number" && Number.isFinite(body.min_score)
    ? body.min_score
    : undefined;
  const types = readStringArray(body.types);
  const includePrompt = readBoolean(body.include_prompt);
  // LMC-5 additive: explicit history opt-in (superseded rows). Default false.
  const includeHistory = readBoolean(body.include_history, false);

  const result = await runRecall(env, {
    namespace,
    query,
    k,
    min_score: minScore,
    types,
    include_history: includeHistory
  });
  const data = result.hits.map((h) => ({
    id: h.id,
    content: h.content,
    type: h.type,
    score: h.score,
    importance: 0.5,
    source: h.source,
    source_layer: h.source_layer
  }));

  let prompt: string | undefined;
  if (includePrompt && data.length > 0) {
    const promptRecords: MemoryApiRecord[] = data.map((d) => ({
      id: d.id,
      namespace,
      type: d.type,
      content: d.content,
      summary: null,
      importance: d.importance,
      confidence: 0.8,
      status: "active",
      pinned: false,
      tags: [],
      source: d.source,
      source_message_ids: [],
      vector_id: null,
      last_recalled_at: null,
      recall_count: 0,
      created_at: "",
      updated_at: "",
      expires_at: null,
      score: d.score
    }));
    const patch = formatMemoryPatch(promptRecords);
    if (result.glossary_hits.length > 0) {
      const glossaryLines = result.glossary_hits.map(
        (g) => `- [glossary] ${g.term}: ${g.definition}`
      );
      prompt = patch ? `${patch}\n${glossaryLines.join("\n")}` : glossaryLines.join("\n");
    } else {
      prompt = patch || undefined;
    }
  }

  return json({
    data,
    meta: {
      namespace,
      backend: "v2-recall",
      top_k: k,
      count: data.length,
      glossary_hits: result.glossary_hits.length,
      ...result.meta
    },
    ...(prompt ? { prompt } : {})
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
        force: force && i === 0,
        trigger: "manual"
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

function parseJsonArray(value: string | null): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function toCandidateApiRecord(row: MemoryCandidateRow) {
  return {
    id: row.id,
    namespace: row.namespace,
    type: row.type,
    content: row.content,
    fact_key: row.fact_key,
    confidence: row.confidence,
    importance: row.importance,
    tags: parseJsonArray(row.tags),
    source_message_ids: parseJsonArray(row.source_message_ids),
    source: row.source,
    status: row.status,
    target_memory_id: row.target_memory_id,
    decision_note: row.decision_note,
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}

function yesterdayDateLabel(now = new Date()): string {
  const date = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  return date.toISOString().slice(0, 10);
}

async function countMessagesInRange(
  db: D1Database,
  input: { namespace: string; startCreatedAt: string; endCreatedAt: string }
): Promise<number> {
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS count
       FROM messages
       WHERE namespace = ?
         AND role IN ('user', 'assistant')
         AND created_at >= ?
         AND created_at < ?`
    )
    .bind(input.namespace, input.startCreatedAt, input.endCreatedAt)
    .first<{ count: number }>();
  return row?.count ?? 0;
}

export async function handleMemoryBoot(request: Request, env: Env): Promise<Response> {
  const auth = await authenticate(request, env);
  if (!auth.ok) return openAiError("Unauthorized", 401, "authentication_error");

  if (request.method !== "GET") return openAiError("Not found", 404);

  const url = new URL(request.url);
  const namespace = resolveNamespace(auth.profile, url.searchParams.get("namespace"));
  const scopeError = requireScope(auth.profile, "memory:read");
  if (scopeError) return scopeError;

  const start = readString(url.searchParams.get("start")) || new Date().toISOString().slice(0, 10) + "T00:00:00.000Z";
  const end = readString(url.searchParams.get("end")) || new Date().toISOString();
  const dailyDate = readString(url.searchParams.get("daily_date")) || yesterdayDateLabel();
  const [dailyLog, precious, glossary, todayMessages, todayRawCount, pendingCount, typeCounts] = await Promise.all([
    getDailyLog(env.DB, { namespace, date: dailyDate }),
    listPrecious(env.DB, { namespace, limit: 100 }),
    listGlossary(env.DB, { namespace }),
    listMessagesByNamespaceInRange(env.DB, {
      namespace,
      startCreatedAt: start,
      endCreatedAt: end,
      limit: 160
    }),
    countMessagesInRange(env.DB, { namespace, startCreatedAt: start, endCreatedAt: end }),
    countMemoryCandidates(env.DB, { namespace, status: "pending" }),
    countActiveMemoriesByType(env.DB, namespace)
  ]);

  return json({
    data: {
      namespace,
      daily_log: dailyLog,
      precious,
      glossary,
      today_messages: todayMessages,
      stats: {
        today_raw_count: todayRawCount,
        pending_candidates: pendingCount,
        memory_type_counts: typeCounts
      }
    }
  });
}

function formatDateLabel(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(date);
}

function readDiaryTimeZone(env: Env): string {
  return env.DREAM_TIME_ZONE?.trim() || env.DAILY_DIGEST_TIME_ZONE?.trim() || "Asia/Singapore";
}

export async function handleDiaryApi(request: Request, env: Env): Promise<Response> {
  const auth = await authenticate(request, env);
  if (!auth.ok) return openAiError("Unauthorized", 401, "authentication_error");
  if (request.method !== "GET") return openAiError("Not found", 404);

  const scopeError = requireScope(auth.profile, "memory:read");
  if (scopeError) return scopeError;

  const url = new URL(request.url);
  const namespace = resolveNamespace(auth.profile, url.searchParams.get("namespace"));
  const timeZone = readDiaryTimeZone(env);

  if (url.pathname === "/v1/diary/recent") {
    const today = formatDateLabel(new Date(), timeZone);
    const yesterday = formatDateLabel(new Date(Date.now() - 24 * 60 * 60 * 1000), timeZone);
    const rows = await Promise.all([
      getDailyLog(env.DB, { namespace, date: today }),
      getDailyLog(env.DB, { namespace, date: yesterday })
    ]);
    const data = rows.filter((row): row is NonNullable<typeof row> => Boolean(row));
    return json({ data });
  }

  const date = readString(url.searchParams.get("date"));
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return openAiError("date query parameter is required (YYYY-MM-DD)", 400);
  }

  const row = await getDailyLog(env.DB, { namespace, date });
  if (!row) {
    return json({ data: null }, { status: 404 });
  }
  return json({ data: row });
}

export async function handlePrecious(request: Request, env: Env): Promise<Response> {
  const auth = await authenticate(request, env);
  if (!auth.ok) return openAiError("Unauthorized", 401, "authentication_error");

  const url = new URL(request.url);
  const namespace = resolveNamespace(auth.profile, url.searchParams.get("namespace"));
  const parts = url.pathname.split("/").filter(Boolean);
  const id = parts[2];

  if (request.method === "GET" && !id) {
    const scopeError = requireScope(auth.profile, "memory:read");
    if (scopeError) return scopeError;
    const rows = await listPrecious(env.DB, { namespace, limit: readPositiveInt(url.searchParams.get("limit"), 100, 200) });
    return json({ data: rows });
  }

  const scopeError = requireScope(auth.profile, "memory:write");
  if (scopeError) return scopeError;

  if (request.method === "POST" && !id) {
    const body = await readJsonObject(request);
    if (!body) return openAiError("Request body must be a JSON object", 400);
    const content = readString(body.content);
    if (!content) return openAiError("content is required", 400);
    const row = await createPrecious(env.DB, {
      namespace: resolveNamespace(auth.profile, body.namespace),
      content,
      contextMessageIds: readStringArray(body.context_message_ids),
      source: readString(body.source) || "human"
    });
    return json({ data: row }, { status: 201 });
  }

  if (request.method === "DELETE" && id) {
    const deleted = await deletePrecious(env.DB, { namespace, id });
    if (!deleted) return openAiError("Precious memory not found", 404);
    return json({ data: { id, deleted: true } });
  }

  return openAiError("Not found", 404);
}

export async function handleGlossaryApi(request: Request, env: Env): Promise<Response> {
  const auth = await authenticate(request, env);
  if (!auth.ok) return openAiError("Unauthorized", 401, "authentication_error");

  const url = new URL(request.url);
  const namespace = resolveNamespace(auth.profile, url.searchParams.get("namespace"));
  const parts = url.pathname.split("/").filter(Boolean);
  const id = parts[2];

  if (request.method === "GET" && !id) {
    const scopeError = requireScope(auth.profile, "memory:read");
    if (scopeError) return scopeError;
    const rows = await listGlossary(env.DB, {
      namespace,
      status: readString(url.searchParams.get("status")) || "active"
    });
    return json({ data: rows });
  }

  const scopeError = requireScope(auth.profile, "memory:write");
  if (scopeError) return scopeError;

  if (request.method === "POST" && !id) {
    const body = await readJsonObject(request);
    if (!body) return openAiError("Request body must be a JSON object", 400);
    const term = readString(body.term);
    const definition = readString(body.definition);
    if (!term || !definition) return openAiError("term and definition are required", 400);
    const row = await upsertGlossary(env.DB, {
      namespace: resolveNamespace(auth.profile, body.namespace),
      term,
      aliases: readStringArray(body.aliases),
      definition,
      examples: readStringArray(body.examples)
    });
    return json({ data: row });
  }

  if (request.method === "PATCH" && id) {
    const body = await readJsonObject(request);
    if (!body) return openAiError("Request body must be a JSON object", 400);
    const row = await updateGlossary(env.DB, {
      namespace: resolveNamespace(auth.profile, body.namespace),
      id,
      term: readString(body.term),
      aliases: Array.isArray(body.aliases) ? readStringArray(body.aliases) : undefined,
      definition: readString(body.definition),
      examples: Array.isArray(body.examples) ? readStringArray(body.examples) : undefined,
      status: readString(body.status)
    });
    if (!row) return openAiError("Glossary term not found", 404);
    return json({ data: row });
  }

  if (request.method === "DELETE" && id) {
    const deleted = await deleteGlossary(env.DB, { namespace, id });
    if (!deleted) return openAiError("Glossary term not found", 404);
    return json({ data: { id, deleted: true } });
  }

  return openAiError("Not found", 404);
}

export async function handleLongtailApi(request: Request, env: Env): Promise<Response> {
  const auth = await authenticate(request, env);
  if (!auth.ok) return openAiError("Unauthorized", 401, "authentication_error");

  const scopeError = requireScope(auth.profile, "memory:write");
  if (scopeError) return scopeError;

  const url = new URL(request.url);
  const namespace = resolveNamespace(auth.profile, url.searchParams.get("namespace"));
  const parts = url.pathname.split("/").filter(Boolean);
  const id = parts[2];

  if (request.method !== "DELETE" || !id) return openAiError("Not found", 404);

  const result = await deleteLongtail(env, { namespace, id });
  if (result === "not_found") return openAiError("Longtail entry not found", 404);
  if (result === "vector_error") {
    return openAiError("Longtail vector delete failed", 503, "memory_error");
  }
  return json({ data: { id, deleted: true } });
}

export type ApprovedMemoryResult = {
  id: string;
  action: "upserted" | "superseded" | "created";
  supersededId?: string;
};

async function createApprovedMemoryFromCandidate(
  env: Env,
  input: {
    namespace: string;
    type: string;
    content: string;
    factKey?: string | null;
    confidence: number;
    importance: number;
    tags: string[];
    sourceMessageIds: string[];
    source: string;
    excludeIds?: string[];
  }
): Promise<ApprovedMemoryResult> {
  if (input.factKey) {
    const result = await upsertMemoryByFactKey(env, {
      namespace: input.namespace,
      factKey: input.factKey,
      type: input.type,
      content: input.content,
      confidence: input.confidence,
      importance: input.importance,
      tags: input.tags,
      source: input.source,
      sourceMessageIds: input.sourceMessageIds
    });
    return { id: result.id, action: "upserted" };
  }

  const hit = await findSimilarActiveMemory(env, {
    namespace: input.namespace,
    content: input.content,
    excludeIds: input.excludeIds
  });
  if (hit) {
    const result = await supersedeMemory(env, {
      namespace: input.namespace,
      oldId: hit.memory.id,
      newContent: input.content,
      newType: input.type,
      newFactKey: null,
      importance: input.importance,
      confidence: input.confidence,
      tags: input.tags,
      source: input.source,
      sourceMessageIds: input.sourceMessageIds,
      reason: "dedup_gate_supersede"
    });
    return { id: result.newId, action: "superseded", supersededId: hit.memory.id };
  }

  const created = await createMemory(env.DB, {
    namespace: input.namespace,
    type: input.type,
    content: input.content,
    confidence: input.confidence,
    importance: input.importance,
    tags: input.tags,
    source: input.source,
    sourceMessageIds: input.sourceMessageIds
  });
  await syncMemoryEmbeddingBestEffort(env, created);
  return { id: created.id, action: "created" };
}

export async function handleMemoryCandidates(request: Request, env: Env): Promise<Response> {
  const auth = await authenticate(request, env);
  if (!auth.ok) return openAiError("Unauthorized", 401, "authentication_error");

  const url = new URL(request.url);
  const namespace = resolveNamespace(auth.profile, url.searchParams.get("namespace"));
  const parts = url.pathname.split("/").filter(Boolean);
  const id = parts[2];
  const action = parts[3];

  if (request.method === "GET" && !id) {
    const scopeError = requireScope(auth.profile, "memory:read");
    if (scopeError) return scopeError;
    const rows = await listMemoryCandidates(env.DB, {
      namespace,
      status: readString(url.searchParams.get("status")) || "pending",
      limit: readPositiveInt(url.searchParams.get("limit"), 100, 200)
    });
    return json({ data: rows.map(toCandidateApiRecord) });
  }

  const scopeError = requireScope(auth.profile, "memory:write");
  if (scopeError) return scopeError;
  if (!id || request.method !== "POST") return openAiError("Not found", 404);

  const candidate = await getMemoryCandidateById(env.DB, { namespace, id });
  if (!candidate) return openAiError("Candidate not found", 404);
  const body = (await readJsonObject(request)) ?? {};
  const content = readString(body.content) || candidate.content;
  const type = clampMemoryType(readString(body.type) || candidate.type, "note");
  const factKey = body.fact_key === null ? null : readString(body.fact_key) ?? candidate.fact_key;
  const confidence = readNumber(body.confidence, candidate.confidence);
  const importance = readNumber(body.importance, candidate.importance);
  const tags = Array.isArray(body.tags) ? readStringArray(body.tags) : parseJsonArray(candidate.tags);
  const sourceMessageIds = Array.isArray(body.source_message_ids)
    ? readStringArray(body.source_message_ids)
    : parseJsonArray(candidate.source_message_ids);

  if (action === "approve") {
    if (candidate.source === "dream_delete" && candidate.target_memory_id) {
      const archived = await archiveMemory(env, { namespace, id: candidate.target_memory_id });
      if (!archived) return openAiError("Target memory not found", 404);
      const updated = await updateMemoryCandidateStatus(env.DB, {
        namespace,
        id,
        status: "approved",
        targetMemoryId: candidate.target_memory_id,
        decisionNote: readString(body.decision_note) || "dream_delete approved"
      });
      return json({
        data: {
          candidate: updated ? toCandidateApiRecord(updated) : null,
          memory_id: candidate.target_memory_id
        }
      });
    }

    if (candidate.target_memory_id) {
      const target = await getMemoryById(env.DB, { namespace, id: candidate.target_memory_id });
      const targetActive =
        target &&
        target.status === "active" &&
        target.version_status !== "superseded";
      if (targetActive) {
        const result = await supersedeMemory(env, {
          namespace,
          oldId: candidate.target_memory_id,
          newContent: content,
          newType: type,
          newFactKey: factKey,
          confidence,
          importance,
          tags,
          source: "review",
          sourceMessageIds,
          reason: "approve_update"
        });
        const updated = await updateMemoryCandidateStatus(env.DB, {
          namespace,
          id,
          status: "approved",
          targetMemoryId: result.newId,
          decisionNote: readString(body.decision_note) || "approve_update"
        });
        return json({
          data: {
            candidate: updated ? toCandidateApiRecord(updated) : null,
            memory_id: result.newId,
            action: "superseded",
            superseded_id: candidate.target_memory_id
          }
        });
      }
    }

    const fallbackNote = candidate.target_memory_id
      ? `${readString(body.decision_note) || "approved"}; target_gone_fallback`
      : readString(body.decision_note) || "approved";
    const approval = await createApprovedMemoryFromCandidate(env, {
      namespace,
      type,
      content,
      factKey,
      confidence,
      importance,
      tags,
      sourceMessageIds,
      source: "review",
      excludeIds: candidate.target_memory_id ? [candidate.target_memory_id] : undefined
    });
    const updated = await updateMemoryCandidateStatus(env.DB, {
      namespace,
      id,
      status: "approved",
      targetMemoryId: approval.id,
      decisionNote: fallbackNote
    });
    return json({
      data: {
        candidate: updated ? toCandidateApiRecord(updated) : null,
        memory_id: approval.id,
        action: approval.action,
        ...(approval.supersededId ? { superseded_id: approval.supersededId } : {})
      }
    });
  }

  if (action === "discard") {
    const updated = await updateMemoryCandidateStatus(env.DB, {
      namespace,
      id,
      status: "discarded",
      decisionNote: readString(body.decision_note) || "discarded"
    });
    return json({ data: updated ? toCandidateApiRecord(updated) : null });
  }

  if (action === "merge") {
    const targetId = readString(body.target_id);
    if (!targetId) return openAiError("target_id is required", 400);
    const target = await getMemoryById(env.DB, { namespace, id: targetId });
    if (!target) return openAiError("Target memory not found", 404);
    const mergedContent = content || target.content;
    const updatedTarget = await updateMemory(env.DB, {
      namespace,
      id: targetId,
      patch: {
        type,
        content: mergedContent,
        confidence: Math.max(confidence, target.confidence),
        importance: Math.max(importance, target.importance),
        tags,
        sourceMessageIds
      }
    });
    if (updatedTarget) await syncMemoryEmbeddingBestEffort(env, updatedTarget);
    const updated = await updateMemoryCandidateStatus(env.DB, {
      namespace,
      id,
      status: "merged",
      targetMemoryId: targetId,
      decisionNote: readString(body.decision_note) || "merged"
    });
    return json({ data: { candidate: updated ? toCandidateApiRecord(updated) : null, memory: updatedTarget ? toMemoryApiRecord(updatedTarget) : null } });
  }

  if (action === "supersede") {
    const oldId = readString(body.target_id);
    if (!oldId) return openAiError("target_id is required", 400);
    const result = await supersedeMemory(env, {
      namespace,
      oldId,
      newContent: content,
      newType: type,
      newFactKey: factKey,
      confidence,
      importance,
      tags,
      source: "review",
      sourceMessageIds,
      reason: readString(body.decision_note) || "candidate_supersede"
    });
    const updated = await updateMemoryCandidateStatus(env.DB, {
      namespace,
      id,
      status: "merged",
      targetMemoryId: result.newId,
      decisionNote: readString(body.decision_note) || "superseded"
    });
    return json({ data: { candidate: updated ? toCandidateApiRecord(updated) : null, memory_id: result.newId } });
  }

  return openAiError("Not found", 404);
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
    source: body.source === undefined ? undefined : readOptionalString(body.source),
    sourceMessageIds: Array.isArray(body.source_message_ids) ? readStringArray(body.source_message_ids) : undefined,
    expiresAt: body.expires_at === undefined ? undefined : readOptionalString(body.expires_at)
  };

  const updated = await updateMemory(env.DB, { namespace, id, patch });
  if (updated) {
    if (updated.status === "active") {
      await syncMemoryEmbeddingBestEffort(env, updated);
    } else {
      await deleteMemoryEmbeddingBestEffort(env, updated);
    }
  }

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
  if (!existing || existing.namespace !== profile.namespace) {
    const deletedLegacyVector = await deleteVectorMemory(env, id);
    if (deletedLegacyVector) return json({ data: { id, deleted: true, source: "legacy_vectorize" } });
    return openAiError("Memory not found", 404);
  }

  const deleted = await softDeleteMemory(env.DB, { namespace: profile.namespace, id });
  if (deleted) await deleteMemoryEmbeddingBestEffort(env, deleted);
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

  if (tail.length === 1 && tail[0] === "recall" && request.method === "POST") {
    return handleRecallMemories(request, env, auth.profile);
  }

  if (tail.length === 1 && (tail[0] === "digest" || tail[0] === "dream") && request.method === "POST") {
    return handleRunDigest(request, env, auth.profile);
  }

  if (tail.length === 1 && tail[0] === "ingest" && request.method === "POST") {
    return handleIngestMemories(request, env, ctx, auth.profile);
  }

  if (tail.length === 1 && tail[0] === "export" && request.method === "GET") {
    return handleExportMemories(request, env, auth.profile);
  }

  if (tail.length === 1) {
    const id = tail[0];
    if (request.method === "GET") return handleGetMemory(env, auth.profile, id);
    if (request.method === "PATCH") return handlePatchMemory(request, env, auth.profile, id);
    if (request.method === "DELETE") return handleDeleteMemory(env, auth.profile, id);
  }

  return openAiError("Not found", 404);
}
