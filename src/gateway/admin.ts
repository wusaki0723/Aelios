import { authenticate } from "../auth/apiKey";
import type { Env } from "../types";
import { identityNamespace, invalidateSettingsCache, loadConfig, object, validateConfig, type GatewayConfig } from "./config";
import { describeSettings } from "./settings";

async function ownerOnly(request: Request, env: Env): Promise<boolean> {
  const auth = await authenticate(request, env);
  return auth.ok && ["CHATBOX_API_KEY", "DEBUG_API_KEY"].includes(auth.keyName);
}
/** Reports the values this Worker was deployed with, so the page can show them as placeholders. */
export async function handleGatewayEnv(request: Request, env: Env): Promise<Response> {
  if (!await ownerOnly(request, env)) return Response.json({ error: "Owner key required" }, { status: 401 });
  let settings = {};
  try { settings = (await loadConfig(env)).settings || {}; } catch { settings = {}; }
  return Response.json(describeSettings(env, settings), { headers: { "cache-control": "no-store" } });
}
/**
 * PATCH 只改带来的部分，设置页每改一项就存一项，不用整份配置来回传：
 * settings 按项合并 (值为 "" 就删掉这项、回到部署值)，identities 和 upstream 带了就整块替换，upstream: null 删掉。
 */
function mergeConfig(current: GatewayConfig, patch: unknown): unknown {
  if (!object(patch)) throw new Error("Patch must be an object");
  const next: Record<string, unknown> = { ...current };
  if (patch.settings !== undefined) next.settings = object(patch.settings) ? { ...current.settings, ...patch.settings } : patch.settings;
  if (patch.identities !== undefined) next.identities = patch.identities;
  if (patch.upstream === null) delete next.upstream;
  else if (patch.upstream !== undefined) next.upstream = patch.upstream;
  return next;
}
export async function handleGatewayAdmin(request: Request, env: Env): Promise<Response> {
  if (!await ownerOnly(request, env)) return Response.json({ error: "Owner key required" }, { status: 401 });
  try {
    if (request.method === "GET") return Response.json(await loadConfig(env), { headers: { "cache-control": "no-store" } });
    if (request.method !== "PUT" && request.method !== "PATCH") {
      return Response.json({ error: "Use GET, PUT or PATCH" }, { status: 405, headers: { allow: "GET, PUT, PATCH" } });
    }
    const current = request.method === "PATCH" ? await loadConfig(env) : null;
    let config: GatewayConfig;
    try {
      const body = await request.json();
      config = validateConfig(current ? mergeConfig(current, body) : body);
    } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Invalid config" }, { status: 400 }); }
    await env.DB.prepare(`INSERT INTO gateway_config (id, config_json, updated_at) VALUES (1, ?, ?)
      ON CONFLICT(id) DO UPDATE SET config_json = excluded.config_json, updated_at = excluded.updated_at`)
      .bind(JSON.stringify(config), new Date().toISOString()).run();
    invalidateSettingsCache();
    if (request.method === "PATCH") return Response.json({ ok: true, settings: config.settings || {} });
    return Response.json({ ok: true, identities: config.identities.length, settings: Object.keys(config.settings || {}).length });
  } catch { return Response.json({ error: "Configuration store unavailable. Apply D1 migrations first." }, { status: 503 }); }
}
/**
 * 每个空间有多少条在用的记忆。设置页拿它提醒：新助手的写入空间还是空的，记忆其实在 default 等别的空间里。
 */
export async function handleGatewaySpaces(request: Request, env: Env): Promise<Response> {
  if (!await ownerOnly(request, env)) return Response.json({ error: "Owner key required" }, { status: 401 });
  const rows = await env.DB.prepare(`SELECT namespace, COUNT(*) AS memories FROM memories
    WHERE status = 'active' GROUP BY namespace ORDER BY memories DESC, namespace LIMIT 200`)
    .all<{ namespace: string; memories: number }>();
  return Response.json({ spaces: (rows.results || []).map(row => ({ namespace: row.namespace, memories: Number(row.memories) })) },
    { headers: { "cache-control": "no-store" } });
}
/** Read-only recall explanations for one configured identity, including empty/error decisions. */
export async function handleRecallHistory(request: Request, env: Env): Promise<Response> {
  if (!await ownerOnly(request, env)) return Response.json({ error: "Owner key required" }, { status: 401 });
  const slug = new URL(request.url).searchParams.get("identity");
  const config = await loadConfig(env);
  const identity = config.identities.find(i => i.slug === slug);
  if (!identity) return Response.json({ error: "Unknown identity" }, { status: 400 });
  const rows = await env.DB.prepare(`SELECT id, created_at, payload_json FROM memory_events
    WHERE namespace = ? AND event_type = 'recall_explain' AND json_extract(payload_json, '$.identity') = ?
    ORDER BY created_at DESC, id DESC LIMIT 20`).bind(identityNamespace(identity), identity.slug)
    .all<{ id: string; created_at: string; payload_json: string }>();
  return Response.json({ items: (rows.results || []).map(row => ({
    id: row.id, created_at: row.created_at, ...JSON.parse(row.payload_json)
  })) }, { headers: { "cache-control": "no-store" } });
}
