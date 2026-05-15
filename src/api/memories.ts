import { authenticate } from "../auth/apiKey";
import { requireScope } from "../auth/scopes";
import { getOrCreateConversation } from "../db/conversations";
import {
  createMemory,
  getMemoryById,
  listMemories,
  listMemoriesPage,
  softDeleteMemory,
  updateMemory
} from "../db/memories";
import { saveIngestMessages } from "../db/messages";
import { deleteMemoryEmbedding, upsertMemoryEmbedding } from "../memory/embedding";
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
  ctx: ExecutionContext,
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

  const memory = await createMemory(env.DB, {
    namespace: resolveNamespace(profile, body.namespace),
    type,
    content,
    summary: readOptionalString(body.summary),
    importance: readNumber(body.importance, 0.5),
    confidence: readNumber(body.confidence, 0.8),
    status: readString(body.status) || "active",
    pinned: readBoolean(body.pinned),
    tags: readStringArray(body.tags),
    source: readOptionalString(body.source) || profile.source,
    sourceMessageIds: readStringArray(body.source_message_ids),
    expiresAt: readOptionalString(body.expires_at)
  });

  ctx.waitUntil(
    upsertMemoryEmbedding(env, memory).catch((error) => {
      console.error("failed to upsert memory embedding", error);
    })
  );

  return json({ data: toMemoryApiRecord(memory) }, { status: 201 });
}

async function handleListMemories(request: Request, env: Env, profile: KeyProfile): Promise<Response> {
  const scopeError = requireScope(profile, "memory:read");
  if (scopeError) return scopeError;

  const url = new URL(request.url);
  const namespace = resolveNamespace(profile, url.searchParams.get("namespace"));
  const limit = readPositiveInt(url.searchParams.get("limit"), 100, 1000);
  const offset = readNonNegativeInt(url.searchParams.get("offset"), 0, 100_000);
  const page = await listMemoriesPage(env.DB, {
    namespace,
    type: url.searchParams.get("type") || undefined,
    status: url.searchParams.get("status") || "active",
    limit,
    offset
  });

  return json({
    data: page.records.map((record) => toMemoryApiRecord(record)),
    paging: {
      limit,
      offset,
      has_more: page.hasMore,
      next_offset: page.nextOffset
    }
  });
}

async function handleSearchMemories(request: Request, env: Env, profile: KeyProfile): Promise<Response> {
  const scopeError = requireScope(profile, "memory:read");
  if (scopeError) return scopeError;

  const body = await readJsonObject(request);
  if (!body) return openAiError("Request body must be a JSON object", 400);

  const query = readString(body.query) || "";
  const topK = readNumber(body.top_k, Number(env.MEMORY_TOP_K || 8));
  const data = await searchMemories(env, {
    namespace: resolveNamespace(profile, body.namespace),
    query,
    topK,
    types: readStringArray(body.types)
  });

  return json({ data });
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

export async function handleIngestMessagesApi(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const auth = await authenticate(request, env);
  if (!auth.ok) return openAiError("Unauthorized", 401, "authentication_error");

  return handleIngestMemories(request, env, ctx, auth.profile);
}

async function handlePatchMemory(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  profile: KeyProfile,
  id: string
): Promise<Response> {
  const scopeError = requireScope(profile, "memory:write");
  if (scopeError) return scopeError;

  const body = await readJsonObject(request);
  if (!body) return openAiError("Request body must be a JSON object", 400);

  const namespace = resolveNamespace(profile, body.namespace);
  const patch = {
    type: readString(body.type),
    content: readString(body.content),
    summary: readOptionalString(body.summary),
    importance: typeof body.importance === "number" ? readNumber(body.importance, 0.5) : undefined,
    confidence: typeof body.confidence === "number" ? readNumber(body.confidence, 0.8) : undefined,
    status: readString(body.status),
    pinned: typeof body.pinned === "boolean" ? readBoolean(body.pinned) : undefined,
    tags: Array.isArray(body.tags) ? readStringArray(body.tags) : undefined,
    expiresAt: body.expires_at === undefined ? undefined : readOptionalString(body.expires_at)
  };

  const updated = await updateMemory(env.DB, {
    namespace,
    id,
    patch
  });

  if (!updated) return openAiError("Memory not found", 404);

  ctx.waitUntil(
    (updated.status === "active" ? upsertMemoryEmbedding(env, updated) : deleteMemoryEmbedding(env, updated)).catch((error) => {
      console.error("failed to sync memory embedding", error);
    })
  );

  return json({ data: toMemoryApiRecord(updated) });
}

async function handleDeleteMemory(
  env: Env,
  ctx: ExecutionContext,
  profile: KeyProfile,
  id: string
): Promise<Response> {
  const scopeError = requireScope(profile, "memory:write");
  if (scopeError) return scopeError;

  const deleted = await softDeleteMemory(env.DB, {
    namespace: profile.namespace,
    id
  });

  if (!deleted) return openAiError("Memory not found", 404);

  ctx.waitUntil(
    deleteMemoryEmbedding(env, deleted).catch((error) => {
      console.error("failed to delete memory embedding", error);
    })
  );

  return json({ data: toMemoryApiRecord(deleted) });
}

async function handleGetMemory(env: Env, profile: KeyProfile, id: string): Promise<Response> {
  const scopeError = requireScope(profile, "memory:read");
  if (scopeError) return scopeError;

  const memory = await getMemoryById(env.DB, {
    namespace: profile.namespace,
    id
  });

  if (!memory) return openAiError("Memory not found", 404);
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
    return handleCreateMemory(request, env, ctx, auth.profile);
  }

  if (tail.length === 1 && tail[0] === "search" && request.method === "POST") {
    return handleSearchMemories(request, env, auth.profile);
  }

  if (tail.length === 1 && tail[0] === "ingest" && request.method === "POST") {
    return handleIngestMemories(request, env, ctx, auth.profile);
  }

  if (tail.length === 1) {
    const id = tail[0];
    if (request.method === "GET") return handleGetMemory(env, auth.profile, id);
    if (request.method === "PATCH") return handlePatchMemory(request, env, ctx, auth.profile, id);
    if (request.method === "DELETE") return handleDeleteMemory(env, ctx, auth.profile, id);
  }

  return openAiError("Not found", 404);
}
