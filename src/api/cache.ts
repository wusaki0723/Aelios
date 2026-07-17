import { authenticate } from "../auth/apiKey";
import { requireScope } from "../auth/scopes";
import { deleteCacheEntry, getCacheEntry, parseCacheEntryValue, putCacheEntry } from "../db/cacheEntries";
import type { Env, KeyProfile } from "../types";
import { json, openAiError } from "../utils/json";
import { readStringArray } from "../utils/parse";

function decodePathPart(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

async function readBody(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const body = (await request.json()) as unknown;
    return body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function parseTtl(body: Record<string, unknown>, env: Env): number | null | undefined {
  if (body.ttl_seconds === null) return null;
  if (typeof body.ttl_seconds === "number" && Number.isFinite(body.ttl_seconds)) {
    return Math.max(Math.floor(body.ttl_seconds), 0);
  }

  const fallback = Number(env.CACHE_DEFAULT_TTL_SECONDS || 86400);
  return Number.isFinite(fallback) ? fallback : 86400;
}

function getMaxBytes(env: Env): number {
  const value = Number(env.CACHE_MAX_VALUE_BYTES || 262144);
  return Number.isFinite(value) ? value : 262144;
}

function serializedSize(value: unknown): number {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return new TextEncoder().encode(text).byteLength;
}

function parseTags(value: string | null): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function serializeEntry(record: NonNullable<Awaited<ReturnType<typeof getCacheEntry>>>) {
  return {
    namespace: record.namespace,
    key: record.key,
    value: parseCacheEntryValue(record),
    content_type: record.content_type,
    tags: parseTags(record.tags),
    size_bytes: record.size_bytes,
    expires_at: record.expires_at,
    created_at: record.created_at,
    updated_at: record.updated_at
  };
}

function canAccessNamespace(profile: KeyProfile, namespace: string): boolean {
  return profile.debug || namespace === profile.namespace || profile.scopes.includes("cache:read");
}

function getCachePath(request: Request): { namespace: string; key: string } | Response {
  const url = new URL(request.url);
  const prefix = "/v1/cache/";
  if (!url.pathname.startsWith(prefix)) return openAiError("Not found", 404);

  const rest = url.pathname.slice(prefix.length);
  const slash = rest.indexOf("/");
  if (slash <= 0 || slash === rest.length - 1) {
    return openAiError("Cache path must be /v1/cache/:namespace/:key", 400);
  }

  const namespace = decodePathPart(rest.slice(0, slash));
  const key = decodePathPart(rest.slice(slash + 1));

  if (!namespace || !key) {
    return openAiError("Invalid cache namespace or key", 400);
  }

  return { namespace, key };
}

export async function handleCache(request: Request, env: Env): Promise<Response> {
  if (env.ENABLE_CACHE_API === "false") {
    return openAiError("Cache API is disabled", 404);
  }

  const auth = await authenticate(request, env);
  if (!auth.ok) return openAiError("Unauthorized", 401, "authentication_error");

  const path = getCachePath(request);
  if (path instanceof Response) return path;

  if (!canAccessNamespace(auth.profile, path.namespace)) {
    return openAiError("Forbidden namespace", 403);
  }

  if (request.method === "GET") {
    const scopeError = requireScope(auth.profile, "cache:read");
    if (scopeError) return scopeError;

    const entry = await getCacheEntry(env.DB, path);
    if (!entry) return openAiError("Cache entry not found", 404);

    return json(serializeEntry(entry));
  }

  if (request.method === "PUT") {
    const scopeError = requireScope(auth.profile, "cache:write");
    if (scopeError) return scopeError;

    const body = await readBody(request);
    if (!body) return openAiError("Request body must be a JSON object", 400);
    if (!("value" in body)) return openAiError("value is required", 400);

    const valueSize = serializedSize(body.value);
    if (valueSize > getMaxBytes(env)) {
      return openAiError("Cache value is too large", 413);
    }

    const entry = await putCacheEntry(env.DB, {
      namespace: path.namespace,
      key: path.key,
      value: body.value,
      contentType: typeof body.content_type === "string" ? body.content_type : null,
      tags: readStringArray(body.tags),
      ttlSeconds: parseTtl(body, env)
    });

    return json(serializeEntry(entry));
  }

  if (request.method === "DELETE") {
    const scopeError = requireScope(auth.profile, "cache:write");
    if (scopeError) return scopeError;

    await deleteCacheEntry(env.DB, path);
    return json({ deleted: true });
  }

  return openAiError("Method not allowed", 405);
}
