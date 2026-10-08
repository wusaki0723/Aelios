import { object, type Identity, type Protocol } from "./config";
import { cleanMessageText } from "../utils/sanitize";

/**
 * Client request bodies are arbitrary JSON that this layer reads and rewrites field by field.
 * Narrowing to `unknown` costs 77 type errors across the gateway and buys no safety the runtime
 * guards here do not already provide.
 */
// biome-ignore lint/suspicious/noExplicitAny: see above
export type Body = Record<string, any>;
export function visibleText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.filter(p => object(p) && ["text", "input_text", "output_text"].includes(p.type) && typeof p.text === "string")
    .map(p => p.text).join("\n");
}
export function inputItems(body: Body, protocol: Protocol): Body[] {
  if (protocol === "responses") return typeof body.input === "string" ? [{ role: "user", content: body.input }] : body.input;
  return body.messages;
}
export function validateBody(body: unknown, protocol: Protocol): asserts body is Body {
  if (!object(body) || typeof body.model !== "string") throw new Error("A model name is required");
  const items = inputItems(body, protocol);
  if (!Array.isArray(items) || !items.every(object)) throw new Error(protocol === "responses" ? "input must be a string or item array" : "messages must be an array of objects");
}
export interface Turn { kind: "human" | "tool" | "auxiliary"; text: string; index: number }
export function recentHumanTexts(body: Body, protocol: Protocol, limit = 4): string[] {
  const items = inputItems(body, protocol) ?? [];
  const texts: string[] = [];
  for (let i = items.length - 1; i >= 0 && texts.length < limit; i--) {
    const item = items[i];
    if (!object(item) || item.role !== "user") continue;
    if (item.type && !["message", "input_message"].includes(item.type)) continue;
    const text = cleanMessageText(visibleText(item.content));
    if (!text) continue;
    texts.push(text);
  }
  return texts.reverse();
}

export function classifyTurn(body: Body, protocol: Protocol, auxiliary = false): Turn {
  const items = inputItems(body, protocol);
  const index = items.length - 1;
  const last = items[index];
  if (auxiliary || !last) return { kind: "auxiliary", text: "", index };
  if (last.role === "tool" || /_call_output$/.test(last.type || "")) return { kind: "tool", text: "", index };
  if (last.role !== "user" || last.type && !["message", "input_message"].includes(last.type)) return { kind: "auxiliary", text: "", index };
  const raw = visibleText(last.content);
  const text = cleanMessageText(raw);
  const blocks = Array.isArray(last.content) ? last.content : [];
  const tool = blocks.some(p => object(p) && p.type === "tool_result");
  if (tool && !text.trim()) return { kind: "tool", text: "", index };
  // Recap / system-reminder / empty envelopes: not a user utterance.
  if (!text.trim() && raw.trim()) return { kind: "auxiliary", text: "", index };
  return { kind: "human", text, index };
}
export function appendMemory(body: Body, protocol: Protocol, patch: string): Body {
  const copy = structuredClone(body);
  if (!patch) return copy;
  if (protocol === "responses" && typeof copy.input === "string") {
    copy.input += `\n\n${patch}`;
    return copy;
  }
  const items = inputItems(copy, protocol);
  const last = items[items.length - 1];
  // Preserve every original content block and client cache_control marker.
  if (typeof last.content === "string") last.content += `\n\n${patch}`;
  else last.content = [...(last.content || []), { type: protocol === "responses" ? "input_text" : "text", text: patch }];
  return copy;
}
// Top-level cache_control is official automatic caching, but some Vertex/proxy
// deployments reject it. Lower to an explicit final cacheable breakpoint, before
// adding ephemeral memory. Cache markers are excluded from thinking bindings.
const CACHEABLE = new Set(["text", "image", "document", "search_result", "tool_use", "server_tool_use",
  "tool_result", "container_upload", "web_search_tool_result", "web_fetch_tool_result", "code_execution_tool_result",
  "bash_code_execution_tool_result", "text_editor_code_execution_tool_result", "tool_search_tool_result", "mcp_tool_result"]);
export function lastCacheableBlock(body: Body, materialize = false): Body | undefined {
  for (let i = body.messages.length - 1; i >= 0; i--) {
    const message = body.messages[i];
    if (typeof message.content === "string" && message.content) {
      const block = { type: "text", text: message.content };
      if (materialize) message.content = [block];
      return block;
    }
    for (let j = (message.content?.length || 0) - 1; j >= 0; j--) {
      const block = message.content[j];
      if (object(block) && CACHEABLE.has(block.type)) return block;
    }
  }
  if (typeof body.system === "string" && body.system) {
    const block = { type: "text", text: body.system };
    if (materialize) body.system = [block];
    return block;
  }
  return (Array.isArray(body.system) ? body.system.at(-1) : undefined) || body.tools?.at(-1);
}
export function sanitizeCacheControl(body: Body, protocol: Protocol): void {
  if (protocol !== "messages" || body.cache_control === undefined) return;
  const cc = body.cache_control;
  delete body.cache_control;
  if (!object(cc)) return;
  const last = lastCacheableBlock(body, true);
  if (object(last) && !last.cache_control) last.cache_control = cc;
}
// Vertex-backed lines reject cache_control on tool definitions
// (INVALID_ARGUMENT unrecognizedProperty=cache_control); system/user markers are fine.
// Newer clients also stamp eager_input_streaming onto tool definitions; that field only
// tunes tool-argument streaming granularity, so dropping it costs a little latency and
// nothing else. Both are learned per upstream — see callGatewayUpstream.
export const STRIPPABLE_TOOL_FIELDS: ReadonlySet<string> = new Set(["cache_control", "eager_input_streaming"]);
/** A tool's identity, not a tuning knob: removing any of these ships a broken or useless tool. */
export const PROTECTED_TOOL_FIELDS: ReadonlySet<string> = new Set(["name", "description", "input_schema", "type"]);
/** Removing a field the tool never had reports false, so callers can tell a real retry from a no-op. */
export function stripToolField(body: Body, field: string): boolean {
  let stripped = false;
  for (const tool of body.tools ?? []) {
    if (object(tool) && tool[field] !== undefined) { delete tool[field]; stripped = true; }
  }
  return stripped;
}
/** Every `unrecognizedProperty=<name>` the upstream named, in its 400 detail. */
export function rejectedFieldNames(detail: string): string[] {
  const matches = detail.matchAll(/unrecognizedProperty=([A-Za-z_][A-Za-z0-9_]*)/g);
  return [...new Set([...matches].map(match => match[1]))];
}
// Encrypted reasoning stays allowed; only server-owned history breaks request-only memory.
export function hasServerState(body: Body, protocol: Protocol): boolean {
  return protocol === "responses" && !!(body.previous_response_id || body.conversation ||
    inputItems(body, protocol).some(item => item.type === "item_reference"));
}
function carriesThinking(body: Body): boolean {
  return (body.messages ?? []).some((message: Body) => Array.isArray(message?.content) &&
    message.content.some((block: unknown) => object(block) && ["thinking", "redacted_thinking"].includes(block.type)));
}
/**
 * The native Anthropic line binds every thinking block to the exact prefix it was produced after.
 * Recall rides only on the newest user message, so the next request (a tool continuation, or any later
 * turn) no longer carries it and the upstream answers 400 "The block is bound to a different conversation".
 * `auto` (the default) asks that line to drop mismatched blocks instead; other lines are left alone.
 */
export function applyThinkingPolicy(body: Body, identity: Identity, protocol: Protocol, headers: Headers,
  nativeAnthropic = false): void {
  const mode = identity.anthropicThinking ?? "auto";
  if (protocol !== "messages" || mode === "passthrough" || body.thinking?.type === "disabled") return;
  if (mode === "auto" && !nativeAnthropic) return;
  // Invalid client values must reach validation, not be coerced into adaptive.
  if (body.thinking !== undefined && (!object(body.thinking) || !["enabled", "adaptive"].includes(body.thinking.type))) return;
  // Whether to think is the client's call. Left unset, only signed history shows the model already
  // thinks by default, and only then is there a block to bind.
  if (mode === "auto" && body.thinking === undefined && !carriesThinking(body)) return;
  body.thinking = { type: "adaptive", ...body.thinking,
    block_binding: { ...body.thinking?.block_binding, prefix_mismatch_behavior: "drop_block" } };
  const betas = new Set((headers.get("anthropic-beta") || "").split(",").map(s => s.trim()).filter(Boolean));
  betas.add("thinking-binding-controls-2026-08-01");
  headers.set("anthropic-beta", [...betas].join(","));
}
// Fingerprints sort object keys without rewriting request payloads.
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (object(value)) return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonical(value[k])}`).join(",")}}`;
  return JSON.stringify(value) ?? "null";
}
