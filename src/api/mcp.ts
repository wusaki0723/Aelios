import { authenticate } from "../auth/apiKey";
import { getOrCreateConversation } from "../db/conversations";
import { createMemory, listMemories } from "../db/memories";
import { saveIngestMessages } from "../db/messages";
import { upsertMemoryEmbedding } from "../memory/embedding";
import { searchMemories, toMemoryApiRecord } from "../memory/search";
import { enqueueMemoryMaintenanceIfNeeded } from "../queue/producer";
import type { Env, KeyProfile, OpenAIChatMessage, Scope } from "../types";
import { json } from "../utils/json";

type JsonRpcId = string | number | null;

interface JsonRpcRequest {
  jsonrpc?: "2.0";
  id?: JsonRpcId;
  method?: string;
  params?: unknown;
}

interface ToolCallParams {
  name?: unknown;
  arguments?: unknown;
}

function withTokenQuery(request: Request): Request {
  const url = new URL(request.url);
  const token = url.searchParams.get("token");
  if (!token || request.headers.has("authorization")) return request;

  const headers = new Headers(request.headers);
  headers.set("authorization", `Bearer ${token}`);
  return new Request(request, { headers });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function readNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function readBoolean(value: unknown, fallback = false): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean);
}

function resolveNamespace(profile: KeyProfile, requested: unknown): string {
  return profile.debug && typeof requested === "string" && requested.trim() ? requested.trim() : profile.namespace;
}

function hasScope(profile: KeyProfile, scope: Scope): boolean {
  return profile.scopes.includes(scope);
}

function rpcResult(id: JsonRpcId | undefined, result: unknown): Record<string, unknown> {
  return { jsonrpc: "2.0", id: id ?? null, result };
}

function rpcError(id: JsonRpcId | undefined, code: number, message: string): Record<string, unknown> {
  return {
    jsonrpc: "2.0",
    id: id ?? null,
    error: { code, message }
  };
}

function textToolResult(data: unknown): Record<string, unknown> {
  return {
    content: [
      {
        type: "text",
        text: typeof data === "string" ? data : JSON.stringify(data, null, 2)
      }
    ],
    structuredContent: data
  };
}

function toolError(message: string): Record<string, unknown> {
  return {
    content: [{ type: "text", text: message }],
    isError: true
  };
}

function readMessages(value: unknown): OpenAIChatMessage[] {
  if (!Array.isArray(value)) return [];

  return value.flatMap((item): OpenAIChatMessage[] => {
    if (!isRecord(item)) return [];
    const role = item.role;
    if (role !== "system" && role !== "user" && role !== "assistant" && role !== "tool") return [];
    const content = item.content;
    if (typeof content !== "string" && content !== null && !Array.isArray(content)) return [];
    return [{ role, content }];
  });
}

function getTools(): Array<Record<string, unknown>> {
  return [
    {
      name: "memory_search",
      description: "Search the user's long-term memory library.",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string" },
          top_k: { type: "number", minimum: 1, maximum: 50 },
          types: { type: "array", items: { type: "string" } },
          namespace: { type: "string" }
        },
        required: ["query"]
      }
    },
    {
      name: "memory_create",
      description: "Create one long-term memory.",
      inputSchema: {
        type: "object",
        properties: {
          content: { type: "string" },
          type: { type: "string" },
          summary: { type: "string" },
          importance: { type: "number" },
          confidence: { type: "number" },
          pinned: { type: "boolean" },
          tags: { type: "array", items: { type: "string" } },
          namespace: { type: "string" }
        },
        required: ["content"]
      }
    },
    {
      name: "memory_list",
      description: "List memories from the user's memory library.",
      inputSchema: {
        type: "object",
        properties: {
          limit: { type: "number", minimum: 1, maximum: 100 },
          type: { type: "string" },
          status: { type: "string" },
          namespace: { type: "string" }
        }
      }
    },
    {
      name: "memory_ingest",
      description: "Save chat messages and optionally extract memories from them.",
      inputSchema: {
        type: "object",
        properties: {
          messages: {
            type: "array",
            items: {
              type: "object",
              properties: {
                role: { type: "string" },
                content: {}
              },
              required: ["role", "content"]
            }
          },
          conversation_id: { type: "string" },
          source: { type: "string" },
          auto_extract: { type: "boolean" },
          namespace: { type: "string" }
        },
        required: ["messages"]
      }
    }
  ];
}

async function callTool(
  env: Env,
  ctx: ExecutionContext,
  profile: KeyProfile,
  params: ToolCallParams
): Promise<Record<string, unknown>> {
  const args = isRecord(params.arguments) ? params.arguments : {};

  if (params.name === "memory_search") {
    if (!hasScope(profile, "memory:read")) return toolError("Missing memory:read scope");
    const query = readString(args.query);
    if (!query) return toolError("query is required");
    const data = await searchMemories(env, {
      namespace: resolveNamespace(profile, args.namespace),
      query,
      topK: readNumber(args.top_k, Number(env.MEMORY_TOP_K || 8)),
      types: readStringArray(args.types)
    });
    return textToolResult({ data });
  }

  if (params.name === "memory_create") {
    if (!hasScope(profile, "memory:write")) return toolError("Missing memory:write scope");
    const content = readString(args.content);
    if (!content) return toolError("content is required");
    const memory = await createMemory(env.DB, {
      namespace: resolveNamespace(profile, args.namespace),
      type: readString(args.type) || "note",
      content,
      summary: readString(args.summary) || null,
      importance: readNumber(args.importance, 0.5),
      confidence: readNumber(args.confidence, 0.8),
      status: "active",
      pinned: readBoolean(args.pinned),
      tags: readStringArray(args.tags),
      source: "mcp",
      sourceMessageIds: [],
      expiresAt: null
    });
    ctx.waitUntil(upsertMemoryEmbedding(env, memory));
    return textToolResult({ data: toMemoryApiRecord(memory) });
  }

  if (params.name === "memory_list") {
    if (!hasScope(profile, "memory:read")) return toolError("Missing memory:read scope");
    const records = await listMemories(env.DB, {
      namespace: resolveNamespace(profile, args.namespace),
      type: readString(args.type),
      status: readString(args.status) || "active",
      limit: Math.min(Math.max(Math.floor(readNumber(args.limit, 50)), 1), 100)
    });
    return textToolResult({ data: records.map((record) => toMemoryApiRecord(record)) });
  }

  if (params.name === "memory_ingest") {
    if (!hasScope(profile, "memory:write")) return toolError("Missing memory:write scope");
    const messages = readMessages(args.messages);
    if (messages.length === 0) return toolError("messages must contain at least one message");
    const namespace = resolveNamespace(profile, args.namespace);
    const conversation = await getOrCreateConversation(env.DB, {
      namespace,
      id: readString(args.conversation_id)
    });
    const source = readString(args.source) || "mcp";
    const ids = await saveIngestMessages(env.DB, {
      conversationId: conversation.id,
      namespace,
      source,
      messages
    });

    if (args.auto_extract !== false && ids.length > 0) {
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

    return textToolResult({
      data: {
        conversation_id: conversation.id,
        message_ids: ids,
        auto_extract: args.auto_extract !== false
      }
    });
  }

  return toolError(`Unknown tool: ${String(params.name || "")}`);
}

async function handleRpc(
  request: JsonRpcRequest,
  env: Env,
  ctx: ExecutionContext,
  profile: KeyProfile
): Promise<Record<string, unknown> | null> {
  if (!request.id && request.method?.startsWith("notifications/")) return null;

  if (request.method === "initialize") {
    return rpcResult(request.id, {
      protocolVersion: "2025-06-18",
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: "companion-memory-mcp", version: "0.1.0" }
    });
  }

  if (request.method === "tools/list") {
    return rpcResult(request.id, { tools: getTools() });
  }

  if (request.method === "resources/list") {
    return rpcResult(request.id, { resources: [] });
  }

  if (request.method === "prompts/list") {
    return rpcResult(request.id, { prompts: [] });
  }

  if (request.method === "tools/call") {
    const params = isRecord(request.params) ? (request.params as ToolCallParams) : {};
    const result = await callTool(env, ctx, profile, params);
    return rpcResult(request.id, result);
  }

  if (request.method === "ping") {
    return rpcResult(request.id, {});
  }

  return rpcError(request.id, -32601, "Method not found");
}

export async function handleMcp(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204 });
  }

  if (request.method === "GET") {
    return json({
      name: "companion-memory-mcp",
      transport: "streamable-http",
      endpoint: new URL(request.url).pathname,
      tools: getTools().map((tool) => tool.name)
    });
  }

  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, { status: 405 });
  }

  const auth = await authenticate(withTokenQuery(request), env);
  if (!auth.ok) return rpcErrorResponse(null, -32001, "Unauthorized", 401);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return rpcErrorResponse(null, -32700, "Parse error", 400);
  }

  if (Array.isArray(body)) {
    const results = (
      await Promise.all(
        body
          .filter((item): item is JsonRpcRequest => isRecord(item))
          .map((item) => handleRpc(item, env, ctx, auth.profile))
      )
    ).filter((item): item is Record<string, unknown> => item !== null);
    return results.length > 0 ? json(results) : new Response(null, { status: 202 });
  }

  if (!isRecord(body)) return rpcErrorResponse(null, -32600, "Invalid Request", 400);

  const result = await handleRpc(body, env, ctx, auth.profile);
  return result ? json(result) : new Response(null, { status: 202 });
}

function rpcErrorResponse(id: JsonRpcId | undefined, code: number, message: string, status: number): Response {
  return json(rpcError(id, code, message), { status });
}
