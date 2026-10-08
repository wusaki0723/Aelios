import type { Env } from "../types";
import { isMainModel, PATHS, type GatewayConfig, type Identity, type Protocol } from "./config";
import { applyThinkingPolicy, PROTECTED_TOOL_FIELDS, rejectedFieldNames, sanitizeCacheControl, STRIPPABLE_TOOL_FIELDS, stripToolField, type Body } from "./protocol";
import { normalizeRequest, validateRequest } from "./request";

const ACCOUNT_RE = /^[a-f0-9]{32}$/i;
/** Second path segment that is a protocol leftover, not a Gateway ID. */
const NOT_GATEWAY = /^(compat|v1|models|chat|messages|responses)$/i;
const GATEWAY_HOST_RE =
  /^https:\/\/gateway\.ai\.cloudflare\.com\/v1\/([a-f0-9]{32})(?:\/([^/]+))?(?:\/(.*))?$/i;
const REST_HOST_RE =
  /^https:\/\/api\.cloudflare\.com\/client\/v4\/accounts\/([a-f0-9]{32})(?:\/.*)?$/i;

export interface ResolvedUpstream {
  accountId: string | null;
  gatewayId: string;
  /** CF: the gateway root. Custom OpenAI bases stay as typed. */
  base: string;
}

function configuredAddress(env: Env, config: GatewayConfig): string {
  return config.upstream?.address?.trim() || env.AI_GATEWAY_BASE_URL || env.CLOUDFLARE_ACCOUNT_ID || "";
}

/** The only CF catalog that actually lists models. Do not change this shape. */
export function compatBase(accountId: string, gatewayId: string): string {
  return `https://gateway.ai.cloudflare.com/v1/${accountId.toLowerCase()}/${gatewayId}/compat`;
}

/** Root of every BYOK-capable surface: compat, provider endpoints, catalog. */
export function gatewayBase(accountId: string, gatewayId: string): string {
  return `https://gateway.ai.cloudflare.com/v1/${accountId.toLowerCase()}/${gatewayId}`;
}

export function resolveGatewayId(env: Env, address = ""): string {
  const fromUrl = stripAddress(address).match(GATEWAY_HOST_RE);
  if (fromUrl?.[2] && !NOT_GATEWAY.test(fromUrl[2])) return fromUrl[2];
  return env.AI_GATEWAY_ID?.trim() || "default";
}

function stripAddress(address: string): string {
  return address.trim().replace(/\/+$/, "");
}

function parseGatewayHost(address: string): { accountId: string } | null {
  const match = stripAddress(address).match(GATEWAY_HOST_RE);
  return match ? { accountId: match[1] } : null;
}

export function resolveUpstream(env: Env, config: GatewayConfig): ResolvedUpstream {
  const address = configuredAddress(env, config);
  if (!address) throw new Error("Upstream not configured. Set the CF account in /admin.");
  const trimmed = stripAddress(address);
  const gatewayId = resolveGatewayId(env, trimmed);

  if (ACCOUNT_RE.test(trimmed)) {
    return { accountId: trimmed.toLowerCase(), gatewayId, base: gatewayBase(trimmed, gatewayId) };
  }

  const rest = trimmed.match(REST_HOST_RE);
  if (rest) {
    return { accountId: rest[1].toLowerCase(), gatewayId, base: gatewayBase(rest[1], gatewayId) };
  }

  const gw = parseGatewayHost(trimmed);
  if (gw) {
    return { accountId: gw.accountId.toLowerCase(), gatewayId, base: gatewayBase(gw.accountId, gatewayId) };
  }

  return { accountId: null, gatewayId, base: trimmed };
}

/** Do not change this shape: GET {compat}/models is the catalog CF actually serves. */
export function catalogUrl(env: Env, config: GatewayConfig): string {
  const resolved = resolveUpstream(env, config);
  if (resolved.accountId) return `${compatBase(resolved.accountId, resolved.gatewayId)}/models`;
  return `${resolved.base}/models`;
}

/** A route the caller can fix by changing protocol or model; not an upstream outage. */
export class UpstreamRouteError extends Error {
  readonly status = 400;
}

export interface UpstreamRoute {
  url: string;
  /** Provider endpoints take the native name; compat keeps the author-prefixed one. */
  model: string;
  /** Provider endpoints carry the CF token as cf-aig-authorization (BYOK); bearer elsewhere. */
  auth: "bearer" | "cf-aig";
}

/**
 * BYOK lives on the gateway surface; CF REST spends Unified credits only.
 * chat → compat (every provider). messages / responses → the provider's native
 * endpoint with its own path shape (`/v1/messages`; custom providers mount without
 * the v1, and openai's responses drops it per CF docs).
 */
export function routeFor(resolved: ResolvedUpstream, protocol: Protocol, model: string): UpstreamRoute {
  if (!resolved.accountId) return { url: `${resolved.base}/${PATHS[protocol]}`, model, auth: "bearer" };
  const gw = gatewayBase(resolved.accountId, resolved.gatewayId);
  if (protocol === "chat") return { url: `${gw}/compat/chat/completions`, model, auth: "bearer" };
  const slash = model.indexOf("/");
  const provider = slash > 0 ? model.slice(0, slash).toLowerCase() : "";
  const native = slash > 0 ? model.slice(slash + 1) : model;
  if (!provider) throw new UpstreamRouteError(
    `"${model}" has no provider prefix; use the author/model form so the BYOK endpoint is known.`);
  const custom = provider.startsWith("custom-");
  const path = protocol === "messages" ? (custom ? "/messages" : "/v1/messages")
    : provider === "openai" || custom ? "/responses" : "/v1/responses";
  return { url: `${gw}/${provider}${path}`, model: native, auth: "cf-aig" };
}

/** Anthropic's own endpoint behind CF; it enforces thinking prefix bindings by default (seen 2026-10-08). */
export function nativeAnthropic(route: UpstreamRoute): boolean {
  return route.auth === "cf-aig" && /\/anthropic\/v1\/messages$/.test(route.url);
}

// One call, one upstream. Model names pass through as written (minus the provider
// prefix on native endpoints); retries and fallback are AI Gateway's own job.
export interface PreparedRequest { route: UpstreamRoute; headers: Headers; body: Body; removed: string[];
  /** Set when auto guessed adaptive thinking; holds the client's own anthropic-beta for the fallback. */
  guessedThinking?: { beta: string | null };
}
export function prepareGatewayRequest(env: Env, config: GatewayConfig, identity: Identity,
  protocol: Protocol, original: Request, body: Body): PreparedRequest {
  const token = env.CLOUDFLARE_API_TOKEN;
  if (!token) throw new Error("Missing Worker secret CLOUDFLARE_API_TOKEN");
  const route = routeFor(resolveUpstream(env, config), protocol, body.model);
  const headers = new Headers({
    "content-type": "application/json",
    accept: body.stream ? "text/event-stream" : "application/json"
  });
  if (route.auth === "cf-aig") headers.set("cf-aig-authorization", `Bearer ${token}`);
  else headers.set("authorization", `Bearer ${token}`);
  for (const name of ["anthropic-version", "anthropic-beta", "openai-beta", "x-stainless-helper-method"]) {
    const value = original.headers.get(name);
    if (value) headers.set(name, value);
  }
  if (protocol === "messages" && !headers.has("anthropic-version")) headers.set("anthropic-version", "2023-06-01");
  const normalized = normalizeRequest(body, protocol);
  const out = normalized.body;
  out.model = route.model;
  const clientBeta = headers.get("anthropic-beta");
  const guessed = isMainModel(identity, body.model) &&
    applyThinkingPolicy(out, identity, protocol, headers, nativeAnthropic(route));
  validateRequest(out, protocol, headers);
  sanitizeCacheControl(out, protocol);
  validateRequest(out, protocol, headers);
  return { route, headers, body: out, removed: normalized.removed,
    ...(guessed ? { guessedThinking: { beta: clientBeta } } : {}) };
}
// Isolate-scope learned capability: Vertex-backed and relay lines answer 400
// "unrecognizedProperty=<field>" to tool-definition fields they do not know
// (cache_control, eager_input_streaming). Once per isolate per route, the refused
// fields are learned and stripped before every later send.
export const rejectedToolFields = new Map<string, Set<string>>();

/** Setting values already reported, so a bad one warns once per isolate, not once per request. */
const reportedStripSettings = new Set<string>();

/** Operator escape hatch: strip these before the first send and never eat the 400. */
function preStrippedToolFields(env: Env): string[] {
  const raw = env.UPSTREAM_STRIP_TOOL_FIELDS?.trim();
  if (!raw) return [];
  const named = raw.split(",").map(field => field.trim()).filter(field => /^[A-Za-z_][A-Za-z0-9_]*$/.test(field));
  const usable = named.filter(field => !PROTECTED_TOOL_FIELDS.has(field));
  // The setting is free text, and validateRequest already ran, so a typo naming a tool's
  // identity would ship a broken tool. Refuse those, and say so rather than silently
  // honouring a shorter list than the operator wrote.
  if (usable.length !== named.length && !reportedStripSettings.has(raw)) {
    reportedStripSettings.add(raw);
    console.warn("UPSTREAM_STRIP_TOOL_FIELDS skipped tool identity fields", {
      skipped: named.filter(field => PROTECTED_TOOL_FIELDS.has(field))
    });
  }
  return usable;
}

export async function callGatewayUpstream(env: Env, protocol: Protocol, original: Request,
  prepared: PreparedRequest, body: Body): Promise<Response> {
  const { route, headers } = prepared;
  // Check the actual wire payload, including the gateway's own modifications.
  validateRequest(body, protocol, headers);
  const learned = rejectedToolFields.get(route.url);
  if (learned) for (const field of learned) stripToolField(body, field);
  for (const field of preStrippedToolFields(env)) stripToolField(body, field);
  const send = () => fetch(route.url, {
    method: "POST", headers, body: JSON.stringify(body), signal: original.signal, redirect: "manual"
  });
  let response = await send();
  // A relay names one unknown field per 400, and a client can send several at once
  // (eager_input_streaming on every tool, cache_control on the last one). Learn in a
  // bounded loop so first contact costs at most one round per strippable field.
  for (let round = 0; response.status === 400 && round < STRIPPABLE_TOOL_FIELDS.size; round++) {
    const detail = await response.clone().text().catch(() => "");
    // Only a field we actually removed justifies a retry; anything else is the caller's 400.
    const refused: string[] = [];
    for (const field of rejectedFieldNames(detail)) {
      if (STRIPPABLE_TOOL_FIELDS.has(field) && stripToolField(body, field)) refused.push(field);
    }
    if (!refused.length) break;
    const known = rejectedToolFields.get(route.url) ?? new Set<string>();
    for (const field of refused) known.add(field);
    rejectedToolFields.set(route.url, known);
    console.log("gateway learned upstream rejects tool fields", { url: route.url, fields: refused });
    response = await send();
  }
  // Signed history made auto guess the model thinks by default. A model that refuses the guess
  // (haiku-4-5 has no adaptive, e.g. after switching models mid-chat) gets what the client sent.
  if (response.status === 400 && prepared.guessedThinking) {
    const detail = await response.clone().text().catch(() => "");
    if (/thinking/i.test(detail)) {
      delete body.thinking;
      const { beta } = prepared.guessedThinking;
      if (beta) headers.set("anthropic-beta", beta);
      else headers.delete("anthropic-beta");
      console.log("gateway upstream refused guessed thinking; resending as the client sent it", { url: route.url });
      response = await send();
    }
  }
  return response;
}
