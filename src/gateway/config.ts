import type { AuthResult, Env } from "../types";
import { validateSettings } from "./settings";

export const PROTOCOLS = ["chat", "messages", "responses"] as const;
export type Protocol = typeof PROTOCOLS[number];
export const PATHS: Record<Protocol, string> = {
  chat: "chat/completions", messages: "messages", responses: "responses"
};

/** One upstream for the whole gateway. The CF token lives in Worker secrets, never in this config. */
export interface Upstream {
  /** CF account ID (32 hex chars) or a full base URL ending before the protocol path. */
  address: string;
}
export interface Identity {
  slug: string;
  /** Write space; defaults to the slug. Existing v3 configs keep their meaning. */
  namespace?: string;
  /** Explicit recall spaces. Omitted: write space; []: record without recall. */
  readNamespaces?: string[];
  keys: AuthResult["keyName"][];
  /** Main models: recalled and recorded. Every other model passes through quietly. */
  models: string[];
  /** Omitted means auto: drop_block on the native Anthropic line, passthrough elsewhere. */
  anthropicThinking?: "auto" | "passthrough" | "drop_block";
  maxMemoryChars?: number;
  /** 用户显示名。Dream / 日记 / 周月卷 / 审核写事实时用这个名字，不要写 user/用户。 */
  userName?: string;
  /** 助手显示名。Dream / 日记 / 周月卷 / 审核写事实时用这个名字，不要写 assistant/助手。空则回退到 slug。 */
  assistantName?: string;
}
export interface GatewayConfig {
  version: 3;
  upstream?: Upstream;
  identities: Identity[];
  settings?: Record<string, string>;
}
/** The guard that opens untrusted JSON up for every caller; see the note on `Body` in protocol.ts. */
// biome-ignore lint/suspicious/noExplicitAny: see above
export function object(value: unknown): value is Record<string, any> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
const text = (v: unknown): v is string => typeof v === "string" && !!v.trim();
const KEY_NAMES = ["CHATBOX_API_KEY", "IM_API_KEY", "DEBUG_API_KEY", "GUIDE_DOG_API_KEY"];
// Slugs are the first path segment, so they cannot shadow existing entry points.
const RESERVED_SLUGS = ["v1", "api", "admin", "health", "mcp", "memory-mcp", "memory-admin", "guide-dog"];

export function validateConfig(value: unknown): GatewayConfig {
  check(object(value) && value.version === 3, "Gateway config requires version: 3");
  if (value.upstream !== undefined) {
    const upstream = value.upstream;
    check(object(upstream) && text(upstream.address), "upstream.address is required");
    if (!/^[a-f0-9]{32}$/i.test(upstream.address)) {
      const url = new URL(upstream.address);
      check(url.protocol === "https:" && !url.username && !url.password && !url.search && !url.hash,
        "upstream.address must be a CF account ID or an HTTPS URL without credentials, query or fragment");
    }
  }
  value.settings = validateSettings(value.settings);
  check(Array.isArray(value.identities), "identities must be an array");
  const slugs = new Set<string>();
  for (const identity of value.identities) {
    check(object(identity) && text(identity.slug) && /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/.test(identity.slug),
      "Identity requires an ASCII slug used as the base URL path segment (max 64 characters)");
    const where = identity.slug;
    check(!RESERVED_SLUGS.includes(identity.slug.toLowerCase()), `${where}: reserved slug`);
    check(!slugs.has(identity.slug), `Duplicate identity slug: ${where}`);
    slugs.add(identity.slug);
    check(identity.namespace === undefined || text(identity.namespace) && identity.namespace.length <= 128,
      `${where}: namespace must be text (max 128 characters)`);
    check(identity.readNamespaces === undefined || Array.isArray(identity.readNamespaces) &&
      identity.readNamespaces.length <= 8 && identity.readNamespaces.every((ns: unknown) =>
        text(ns) && ns === ns.trim() && ns.length <= 128) &&
      new Set(identity.readNamespaces).size === identity.readNamespaces.length,
      `${where}: readNamespaces must contain at most 8 unique, nonblank spaces (max 128 characters each)`);
    check(Array.isArray(identity.keys) && identity.keys.length && identity.keys.every((k: unknown) => KEY_NAMES.includes(String(k))), `${where}: invalid keys`);
    check(Array.isArray(identity.models) && identity.models.length <= 64 &&
      identity.models.every((m: unknown) => text(m) && (m as string).length <= 200),
      `${where}: models must be an array of at most 64 model names`);
    check(identity.anthropicThinking === undefined || ["auto", "passthrough", "drop_block"].includes(identity.anthropicThinking), `${where}: invalid anthropicThinking`);
    check(identity.maxMemoryChars === undefined || Number.isInteger(identity.maxMemoryChars) && identity.maxMemoryChars >= 256 && identity.maxMemoryChars <= 24000, `${where}: maxMemoryChars must be 256–24000`);
    check(identity.userName === undefined || text(identity.userName) && identity.userName.trim().length <= 32 && !/[\r\n]/.test(identity.userName),
      `${where}: userName must be text (max 32 characters)`);
    check(identity.assistantName === undefined || text(identity.assistantName) && identity.assistantName.trim().length <= 32 && !/[\r\n]/.test(identity.assistantName),
      `${where}: assistantName must be text (max 32 characters)`);
    // 主模型自己审候选这条路拆了 (只剩 clef 和 MCP)，旧配置里的这两项下次保存时顺手清掉。
    delete identity.judgeModel;
    delete identity.judgeWithMainModel;
  }
  return value as unknown as GatewayConfig;
}

let settingsCache: { value: Record<string, string>; expires: number } | null = null;
export function invalidateSettingsCache(): void { settingsCache = null; }
/** Read on every entry point, so keep it cheap; saved edits land within ten seconds. */
export async function loadSettings(env: Env): Promise<Record<string, string>> {
  if (settingsCache && settingsCache.expires > Date.now()) return settingsCache.value;
  let value: Record<string, string> = {};
  try {
    const row = await env.DB.prepare("SELECT config_json FROM gateway_config WHERE id = 1").first<{ config_json: string }>();
    const raw = row?.config_json || env.GATEWAY_CONFIG;
    if (raw) value = validateSettings(JSON.parse(raw).settings);
  } catch { value = {}; }
  settingsCache = { value, expires: Date.now() + 10_000 };
  return value;
}
export async function loadConfig(env: Env): Promise<GatewayConfig> {
  const row = await env.DB.prepare("SELECT config_json FROM gateway_config WHERE id = 1").first<{ config_json: string }>();
  if (row) return validateConfig(JSON.parse(row.config_json));
  if (env.GATEWAY_CONFIG) return validateConfig(JSON.parse(env.GATEWAY_CONFIG));
  return { version: 3, identities: [], settings: {} };
}
export function allowedIdentities(config: GatewayConfig, auth: AuthResult): Identity[] {
  if (!auth.profile.scopes.includes("chat:proxy")) return [];
  return config.identities.filter(i => i.keys.includes(auth.keyName));
}
/** Without a path slug the key falls back to its first identity. */
export function findIdentity(config: GatewayConfig, auth: AuthResult, slug: string | null): Identity | undefined {
  const list = allowedIdentities(config, auth);
  return slug ? list.find(i => i.slug === slug) : list[0];
}
export function identityNamespace(identity: Identity): string {
  return identity.namespace || identity.slug;
}
export function identityReadNamespaces(identity: Identity): string[] {
  return identity.readNamespaces ?? [identityNamespace(identity)];
}

export type DreamSpeakers = {
  userName: string;
  assistantName: string;
};

/** 写记忆/日记用的说话人名字。没填用户名则返回 null，回退到旧的「你/我」。 */
export function identitySpeakers(identity: Identity | undefined): DreamSpeakers | null {
  if (!identity) return null;
  const userName = identity.userName?.trim();
  if (!userName) return null;
  return {
    userName,
    assistantName: identity.assistantName?.trim() || identity.slug
  };
}

export function speakersForNamespace(config: GatewayConfig, namespace: string): DreamSpeakers | null {
  const named = config.identities.find((identity) =>
    identityNamespace(identity) === namespace && Boolean(identity.userName?.trim()));
  return identitySpeakers(named);
}
export function matchGlob(pattern: string, value: string): boolean {
  const source = pattern.split("*").map(part => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(".*");
  return new RegExp(`^${source}$`, "i").test(value);
}
/** A main-model pattern matches the requested name in full or its basename after the last slash. */
export function isMainModel(identity: Identity, requested: string): boolean {
  const base = requested.slice(requested.lastIndexOf("/") + 1);
  return identity.models.some(pattern => matchGlob(pattern, requested) || matchGlob(pattern, base));
}
