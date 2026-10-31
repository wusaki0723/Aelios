import { authenticate } from "../auth/apiKey";
import type { Env } from "../types";
import { newId } from "../utils/ids";
import { codingAgent, stripCodeBlocks } from "./coding";
import { allowedIdentities, findIdentity, isMainModel, loadConfig, object, PROTOCOLS, type GatewayConfig, type Identity, type Protocol } from "./config";
import { recordExchange, rememberAndRecall, settleOutput } from "./handler";
import { classifyTurn, hasServerState, validateBody, type Body, type Turn } from "./protocol";
import { OutputCollector, prepareExchange, type GatewayExchange } from "./record";

/**
 * POST /v1/hook/recall and POST /v1/hook/record: the gateway's memory, for a caller that sends the
 * model request itself (the magpie plugin). Nothing is forwarded upstream. Both are stateless: the
 * exchange ids are content hashes, so the same slimmed request sent to both yields the same ids and
 * the person's words are stored once.
 */
export const HOOK_BODY_LIMIT = 2 * 1024 * 1024;

interface HookInput {
  protocol: Protocol;
  model: string;
  agent: string | null;
  session: string | null;
  identity: string | null;
  body: Body;
  raw: Body;
}

interface HookContext {
  input: HookInput;
  identity: Identity;
  source: string;
  main: boolean;
  coding: string | null;
  turn: Turn;
  stateful: boolean;
}

function hookError(message: string, status: number): Response {
  const type = status === 401 ? "authentication_error" : status >= 500 ? "api_error" : "invalid_request_error";
  return Response.json({ error: { type, message } }, { status, headers: { "cache-control": "no-store" } });
}

function hookJson(data: unknown): Response {
  return Response.json(data, { headers: { "cache-control": "no-store" } });
}

const optionalText = (value: unknown): string | null => typeof value === "string" && value.trim() ? value.trim() : null;

/** Auth, body, identity and turn: everything both endpoints decide the same way. */
async function openHook(request: Request, env: Env): Promise<HookContext | Response> {
  const auth = await authenticate(request, env);
  if (!auth.ok) return hookError("Unauthorized", 401);
  const declared = Number(request.headers.get("content-length") || 0);
  if (declared > HOOK_BODY_LIMIT) return hookError("Request body is larger than 2 MB", 413);
  let raw: Body;
  try {
    const bytes = await request.arrayBuffer();
    if (bytes.byteLength > HOOK_BODY_LIMIT) return hookError("Request body is larger than 2 MB", 413);
    raw = JSON.parse(new TextDecoder().decode(bytes));
  } catch { return hookError("Invalid JSON", 400); }
  if (!object(raw)) return hookError("Request body must be a JSON object", 400);
  // magpie calls the Messages protocol "anthropic"; accept both names.
  const protocol = raw.protocol === "anthropic" ? "messages" : raw.protocol;
  if (!PROTOCOLS.includes(protocol)) return hookError("protocol must be chat, messages or responses", 400);
  if (typeof raw.model !== "string" || !raw.model.trim()) return hookError("A model name is required", 400);
  if (!object(raw.body)) return hookError("body must be the request body object", 400);
  try { validateBody({ ...raw.body, model: raw.model }, protocol); }
  catch (error) { return hookError(error instanceof Error ? error.message : "Invalid body", 400); }
  const input: HookInput = { protocol, model: raw.model, agent: optionalText(raw.agent), session: optionalText(raw.session),
    identity: optionalText(raw.identity), body: raw.body, raw };
  let config: GatewayConfig;
  try { config = await loadConfig(env); }
  catch { return hookError("Gateway configuration unavailable. Apply migrations and check /admin.", 503); }
  // Explicit routing wins; only hooks choose a default by model, within this key's permissions.
  const identities = allowedIdentities(config, auth);
  const identity = input.identity ? findIdentity(config, auth, input.identity)
    : identities.find(candidate => isMainModel(candidate, input.model)) ?? identities[0];
  if (!identity) {
    return hookError(input.identity
      ? `No identity "${input.identity}" available for this key. Configure /admin, then use https://<host>/<identity>/v1.`
      : "This key has no identity. Configure one at /admin.", 403);
  }
  const main = isMainModel(identity, input.model);
  const coding = main && identity.codingFilter !== false ? codingAgent(input.agent, input.body) : null;
  const classified = classifyTurn(input.body, protocol);
  const turn = coding && classified.text ? { ...classified, text: stripCodeBlocks(classified.text) } : classified;
  return { input, identity, source: auth.profile.source, main, coding, turn,
    stateful: protocol === "responses" && hasServerState(input.body, protocol) };
}

function exchangeFor(request: Request, hook: HookContext): Promise<GatewayExchange> {
  return prepareExchange(request, { ...hook.input.body, model: hook.input.model }, hook.identity, hook.input.protocol, hook.turn, hook.source,
    hook.input.session);
}

export async function handleHookRecall(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const hook = await openHook(request, env);
  if (hook instanceof Response) return hook;
  const quiet = (memory: string) => hookJson({ memory, patch: "", recall_id: null, remember: "none" });
  if (!hook.main) return quiet("off");
  if (hook.turn.kind !== "human") return quiet("skipped");
  // The gateway refuses this request outright; a hook may not fail the agent's request, so it only steps aside.
  if (hook.stateful) return quiet("stateful");
  const recallId = newId("rcl");
  const exchange = await exchangeFor(request, hook);
  const outcome = await rememberAndRecall(env, ctx, hook.identity, hook.input.protocol, hook.input.body, hook.turn,
    exchange, hook.coding, recallId, hook.input.raw.record === true);
  return hookJson({ memory: outcome.memory, patch: outcome.patch, recall_id: recallId, remember: outcome.remember,
    ...(hook.coding ? { coding: hook.coding } : {}) });
}

export async function handleHookRecord(request: Request, env: Env): Promise<Response> {
  const hook = await openHook(request, env);
  if (hook instanceof Response) return hook;
  if (!hook.main) return hookJson({ recorded: false, reason: "off" });
  if (hook.stateful) return hookJson({ recorded: false, reason: "stateful" });
  const { raw } = hook.input;
  const reply = object(raw.reply) ? raw.reply : null;
  const ok = raw.success !== false && reply !== null;
  const exchange = await exchangeFor(request, hook);
  exchange.httpStatus = Number.isInteger(raw.http_status) ? raw.http_status : ok ? 200 : 502;
  exchange.model = optionalText(raw.upstream_model) || hook.input.model;
  const out = new OutputCollector(hook.input.protocol, Boolean(hook.coding));
  try {
    if (reply) out.json(reply);
    out.finish();
  } catch { out.failed = true; }
  settleOutput(exchange, out, Boolean(hook.coding), ok, false);
  try { await recordExchange(env, exchange, Boolean(hook.coding)); }
  catch {
    console.error("hook exchange recording failed", { identity: hook.identity.slug, id: exchange.id });
    return Response.json({ recorded: false, reason: "unavailable" }, { status: 503, headers: { "cache-control": "no-store" } });
  }
  return hookJson({ recorded: true, exchange_id: exchange.id, completion: exchange.completion });
}
