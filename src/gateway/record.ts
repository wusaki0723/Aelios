import type { Env } from "../types";
import { insertMessageFts } from "../memory/fts";
import { captureRememberNow } from "../memory/rememberNow";
import { sha256Hex } from "../utils/hash";
import { getSseData, splitSseEvents } from "../utils/sseParser";
import { cleanMessageText } from "../utils/sanitize";
import { CodeFilter, isSpeechTool, replaceCodeIn } from "./coding";
import { identityNamespace, object, type Identity, type Protocol } from "./config";
import { canonical, inputItems, visibleText, type Body, type Turn } from "./protocol";

// Two JSON-escaped text fields plus metadata fit within a Queue message.
const TEXT_LIMIT = 8000;
/** A streamed tool call's arguments are held up to this much (8,000 characters even when \u-escaped). */
const TOOL_ARGS_LIMIT = 64000;
export interface GatewayExchange {
  type: "gateway_exchange";
  id: string;
  userId: string;
  namespace: string;
  profile: string;
  conversationId: string;
  protocol: Protocol;
  kind: Turn["kind"];
  userText: string;
  assistantText: string;
  model: string;
  provider: string;
  httpStatus: number;
  completion: "complete" | "incomplete" | "failed" | "truncated";
  createdAt: string;
  stream: boolean;
}
/** `session` stands in for the x-aelios-session-id header when the caller has it some other way (the hook endpoints). */
export async function prepareExchange(request: Request, body: Body, identity: Identity,
  protocol: Protocol, turn: Turn, source: string, session: string | null = null): Promise<GatewayExchange> {
  const scopeSession = session || request.headers.get("x-aelios-session-id") || request.headers.get("session_id") ||
    request.headers.get("x-session-id") || body.metadata?.session_id || "unscoped";
  const namespace = identityNamespace(identity);
  const scope = canonical([namespace, identity.slug, source, scopeSession]);
  const conversationId = `gw_${await sha256Hex(scope)}`;
  const prefix = inputItems(body, protocol).slice(0, turn.index + 1);
  const userId = `gw_user_${await sha256Hex(canonical([scope, protocol, prefix]))}`;
  const id = `gw_req_${await sha256Hex(canonical([scope, protocol, turn.kind, body,
    request.headers.get("x-aelios-request-id") || ""]))}`;
  return { type: "gateway_exchange", id, userId, namespace, profile: identity.slug,
    conversationId, protocol, kind: turn.kind, userText: turn.text.slice(0, TEXT_LIMIT), assistantText: "",
    model: "", provider: "", httpStatus: 0, completion: turn.text.length > TEXT_LIMIT ? "truncated" : "incomplete",
    createdAt: new Date().toISOString(), stream: body.stream === true };
}

export async function persistExchange(env: Env, e: GatewayExchange): Promise<void> {
  const spoken = cleanMessageText(e.assistantText);
  const statements = [env.DB.prepare(`INSERT INTO gateway_exchanges
    (id, namespace, profile, conversation_id, protocol, kind, user_text, assistant_text,
     upstream_model, upstream_provider, http_status, completion_status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET assistant_text = excluded.assistant_text,
      upstream_model = excluded.upstream_model, upstream_provider = excluded.upstream_provider,
      http_status = excluded.http_status, completion_status = excluded.completion_status
    WHERE gateway_exchanges.completion_status != 'complete'`)
    .bind(e.id, e.namespace, e.profile, e.conversationId, e.protocol, e.kind, e.userText, spoken,
      e.model, e.provider, e.httpStatus, e.completion, e.createdAt)];
  // Auxiliary tasks and incomplete outputs never become relationship memories.
  const added: Array<{ index: number; id: string; content: string }> = [];
  if (e.kind !== "auxiliary") {
    statements.push(env.DB.prepare("INSERT OR IGNORE INTO conversations (id, namespace, created_at, updated_at) VALUES (?, ?, ?, ?)")
      .bind(e.conversationId, e.namespace, e.createdAt, e.createdAt));
    const addMessage = (id: string, role: string, content: string, seq: number) => {
      added.push({ index: statements.length, id, content });
      statements.push(env.DB.prepare(`INSERT OR IGNORE INTO messages
      (id, conversation_id, namespace, role, content, source, client_message_hash, upstream_model,
       upstream_provider, request_model, stream, finish_reason, created_at, seq)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(id, e.conversationId, e.namespace, role, content, `gateway:${e.profile}`, id,
        e.model, e.provider, e.profile, e.stream ? 1 : 0, e.completion, e.createdAt, seq));
    };
    if (e.kind === "human" && e.userText && e.completion !== "truncated") addMessage(e.userId, "user", e.userText, 0);
    if (e.completion === "complete" && spoken) addMessage(`${e.id}:assistant`, "assistant", spoken, 1);
  }
  const results = await env.DB.batch(statements);
  // Index only rows this batch actually inserted. An ignored insert means the row (and its
  // FTS entry) already exists: the user line was usually captured on the request path by
  // persistHumanUtterance, and queue retries repeat the whole exchange.
  for (const message of added) {
    if ((results[message.index]?.meta?.changes ?? 0) === 0) continue;
    await insertMessageFts(env.DB, { namespace: e.namespace, messageId: message.id, content: message.content });
  }
  if (e.kind === "human" && e.userText && e.completion !== "truncated") {
    try {
      const remembered = await captureRememberNow(env, {
        namespace: e.namespace,
        userText: e.userText,
        messageId: e.userId
      });
      if (remembered.wrote) {
        console.log("remember-now wrote memory", {
          namespace: e.namespace,
          id: remembered.id,
          indexed: remembered.indexed === true
        });
      }
    } catch (error) {
      console.error("remember-now failed", { namespace: e.namespace, error });
    }
  }
}

/**
 * A finished step with nothing to keep adds no rows. If an earlier try of the same request failed or
 * was cut off, its row is marked done, as a full write would (a primary-key lookup, no write otherwise).
 */
export async function settleExchange(env: Env, e: GatewayExchange): Promise<void> {
  await env.DB.prepare(`UPDATE gateway_exchanges SET assistant_text = '', upstream_model = ?, upstream_provider = ?,
      http_status = ?, completion_status = 'complete'
    WHERE id = ? AND completion_status != 'complete'`)
    .bind(e.model, e.provider, e.httpStatus, e.id).run();
}

export async function persistHumanUtterance(
  env: Env,
  e: GatewayExchange
): Promise<{ saved: boolean; indexed: boolean; remember: { wrote: boolean; indexed?: boolean; id?: string } }> {
  if (e.kind !== "human" || !e.userText || e.completion === "truncated") {
    return { saved: false, indexed: false, remember: { wrote: false } };
  }
  const [, inserted] = await env.DB.batch([
    env.DB.prepare("INSERT OR IGNORE INTO conversations (id, namespace, created_at, updated_at) VALUES (?, ?, ?, ?)")
      .bind(e.conversationId, e.namespace, e.createdAt, e.createdAt),
    env.DB.prepare(`INSERT OR IGNORE INTO messages
      (id, conversation_id, namespace, role, content, source, client_message_hash, upstream_model,
       upstream_provider, request_model, stream, finish_reason, created_at, seq)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(e.userId, e.conversationId, e.namespace, "user", e.userText, `gateway:${e.profile}`, e.userId,
        e.model, e.provider, e.profile, e.stream ? 1 : 0, e.completion, e.createdAt, 0)
  ]);
  // A client retry of the same turn hits the existing row, which is already indexed.
  const indexed = (inserted?.meta?.changes ?? 0) > 0 && await insertMessageFts(env.DB, {
    namespace: e.namespace,
    messageId: e.userId,
    content: e.userText
  });
  let remember: { wrote: boolean; indexed?: boolean; id?: string } = { wrote: false };
  try {
    remember = await captureRememberNow(env, {
      namespace: e.namespace,
      userText: e.userText,
      messageId: e.userId
    });
  } catch (error) {
    console.error("remember-now failed", { namespace: e.namespace, error });
  }
  return { saved: true, indexed, remember };
}
export async function dispatchExchange(env: Env, exchange: GatewayExchange): Promise<void> {
  if (env.MEMORY_QUEUE) {
    try { await env.MEMORY_QUEUE.send(exchange); return; }
    catch { console.error("gateway queue send failed; writing exchange directly", { id: exchange.id }); }
  }
  await persistExchange(env, exchange);
}

/** Model-generated tool call as stored speech. Tool *results* never go through here. */
export function formatToolCall(name: string, input: unknown): string {
  const label = String(name || "tool").trim() || "tool";
  const value = coerceToolInput(input);
  if (value == null || value === "") return label;
  if (typeof value === "string") return `${label} ${value}`;
  try { return `${label} ${JSON.stringify(value)}`; }
  catch { return label; }
}

function coerceToolInput(input: unknown): unknown {
  if (typeof input !== "string") return input;
  const trimmed = input.trim();
  if (!trimmed) return "";
  try { return JSON.parse(trimmed); }
  catch { return trimmed; }
}

type ToolBuffer = { name: string; json: string; clipped: boolean };

function addArguments(buf: ToolBuffer, piece: string): void {
  if (!piece || buf.clipped) return;
  if (buf.json.length + piece.length > TOOL_ARGS_LIMIT) buf.clipped = true;
  buf.json = (buf.json + piece).slice(0, TOOL_ARGS_LIMIT);
}

export class OutputCollector {
  text = "";
  complete = false;
  failed = false;
  truncated = false;
  /** The output outgrew what the gateway buffers, so part of it was never seen. */
  overflow = false;
  /** Coding mode only: work tool calls (left out of `text`), and the speech tool calls on their own. */
  workCalls = 0;
  spoken = "";
  spokenTruncated = false;
  model = "";
  private rest = "";
  private decoder = new TextDecoder();
  private pending = new Map<number, ToolBuffer>();
  private chatTools = new Map<number, ToolBuffer>();
  private sealed = false;
  /** Coding mode only: code blocks become [code] as the text streams in, before the cap. */
  private filter: CodeFilter | null;
  constructor(readonly protocol: Protocol, readonly coding = false) {
    this.filter = coding ? new CodeFilter(text => this.keep(text)) : null;
  }
  private append(text: unknown): void {
    if (typeof text !== "string") return;
    if (this.filter) this.filter.push(text);
    else this.keep(text);
  }
  private keep(text: string): void {
    if (this.text.length + text.length > TEXT_LIMIT) this.truncated = true;
    this.text = (this.text + text).slice(0, TEXT_LIMIT);
  }
  private appendTool(name: string, input: unknown, clipped = false): void {
    // A coding agent's work tools carry code: count them, never keep their arguments.
    if (this.coding && !isSpeechTool(String(name || ""))) { this.workCalls += 1; return; }
    const line = formatToolCall(name, this.coding ? replaceCodeIn(coerceToolInput(input)) : input);
    if (!line) return;
    if (clipped) { this.truncated = true; if (this.coding) this.spokenTruncated = true; }
    if (this.coding) {
      const spoken = this.spoken ? `${this.spoken}\n${line}` : line;
      if (spoken.length > TEXT_LIMIT) this.spokenTruncated = true;
      this.spoken = spoken.slice(0, TEXT_LIMIT);
    }
    this.filter?.end();
    if (this.text && !this.text.endsWith("\n")) this.keep("\n");
    this.keep(`${line}\n`);
  }
  private notePending(index: number, name: string, json = ""): void {
    const existing = this.pending.get(index) || { name: "", json: "", clipped: false };
    if (name) existing.name = name;
    addArguments(existing, json);
    this.pending.set(index, existing);
  }
  private flushPending(): void {
    for (const [, tool] of [...this.pending.entries()].sort((a, b) => a[0] - b[0])) {
      this.appendTool(tool.name, tool.json, tool.clipped);
    }
    this.pending.clear();
    for (const [, tool] of [...this.chatTools.entries()].sort((a, b) => a[0] - b[0])) {
      this.appendTool(tool.name, tool.json, tool.clipped);
    }
    this.chatTools.clear();
  }
  json(data: unknown): void {
    if (!object(data)) return;
    if (typeof data.model === "string") this.model = data.model;
    if (this.protocol === "chat") {
      const first = data.choices?.find((c: Body) => c.index === 0) || data.choices?.[0];
      this.append(visibleText(first?.message?.content));
      for (const call of first?.message?.tool_calls || []) {
        this.appendTool(call.function?.name || call.name, call.function?.arguments ?? call.arguments);
      }
      this.complete = !!first?.finish_reason && !["length", "content_filter"].includes(first.finish_reason);
    } else if (this.protocol === "messages") {
      for (const block of Array.isArray(data.content) ? data.content : []) {
        if (!object(block)) continue;
        if (block.type === "text" && typeof block.text === "string") this.append(block.text);
        if (block.type === "tool_use") this.appendTool(block.name, block.input);
      }
      this.complete = !!data.stop_reason && !["max_tokens", "refusal"].includes(data.stop_reason);
    } else {
      for (const item of data.output || []) {
        if (!object(item)) continue;
        if (item.type === "message" && item.role === "assistant") this.append(visibleText(item.content));
        if (item.type === "function_call" || item.type === "custom_tool_call") {
          this.appendTool(item.name, item.arguments ?? item.input);
        }
      }
      this.complete = data.status === "completed";
    }
    this.failed = !!data.error || data.status === "failed";
  }
  chunk(bytes: Uint8Array): void {
    const parsed = splitSseEvents(this.rest + this.decoder.decode(bytes, { stream: true }));
    this.rest = parsed.rest;
    for (const event of parsed.events) this.event(event);
    if (this.rest.length > 128000) { this.rest = ""; this.truncated = true; this.overflow = true; }
  }
  private event(event: string): void {
    const raw = getSseData(event);
    if (!raw || raw === "[DONE]") return;
    let data: Body;
    try { data = JSON.parse(raw); } catch { return; }
    if (!object(data)) return;
    if (typeof data.model === "string") this.model = data.model;
    if (data.type === "error" || data.error) { this.failed = true; this.complete = false; }
    if (this.protocol === "chat") {
      const c = data.choices?.find((choice: Body) => choice.index === 0);
      this.append(c?.delta?.content);
      for (const call of c?.delta?.tool_calls || []) {
        const index = typeof call.index === "number" ? call.index : 0;
        const buf = this.chatTools.get(index) || { name: "", json: "", clipped: false };
        if (call.function?.name) buf.name += call.function.name;
        if (typeof call.function?.arguments === "string") addArguments(buf, call.function.arguments);
        if (typeof call.name === "string" && !call.function?.name) buf.name += call.name;
        this.chatTools.set(index, buf);
      }
      if (c?.finish_reason) this.complete = !["length", "content_filter"].includes(c.finish_reason);
    } else if (this.protocol === "messages") {
      if (data.type === "message_start" && data.message?.model) this.model = data.message.model;
      if (data.type === "content_block_start" && data.content_block?.type === "text") this.append(data.content_block.text);
      if (data.type === "content_block_delta" && data.delta?.type === "text_delta") this.append(data.delta.text);
      if (data.type === "content_block_start" && data.content_block?.type === "tool_use") {
        this.notePending(data.index, data.content_block.name || "tool");
      }
      if (data.type === "content_block_delta" && data.delta?.type === "input_json_delta") {
        this.notePending(data.index, "", data.delta.partial_json || "");
      }
      if (data.type === "content_block_stop" && this.pending.has(data.index)) {
        const tool = this.pending.get(data.index)!;
        this.pending.delete(data.index);
        this.appendTool(tool.name, tool.json, tool.clipped);
      }
      if (data.type === "message_delta" && ["max_tokens", "refusal"].includes(data.delta?.stop_reason)) this.failed = true;
      if (data.type === "message_stop") this.complete = !this.failed;
    } else {
      if (data.type === "response.output_text.delta") this.append(data.delta);
      if (data.type === "response.function_call_arguments.delta" && typeof data.delta === "string") {
        this.notePending(typeof data.output_index === "number" ? data.output_index : 0, "", data.delta);
      }
      if (data.type === "response.output_item.added" && object(data.item) &&
          (data.item.type === "function_call" || data.item.type === "custom_tool_call")) {
        this.notePending(typeof data.output_index === "number" ? data.output_index : 0, data.item.name || "tool",
          typeof data.item.arguments === "string" ? data.item.arguments : "");
      }
      if (["response.completed", "response.incomplete", "response.failed"].includes(data.type)) {
        this.filter?.end();
        const streamed = this.text;
        this.pending.clear();
        this.text = "";
        this.workCalls = 0;
        this.spoken = "";
        this.spokenTruncated = false;
        this.json(data.response);
        this.filter?.end();
        if (!this.text) this.text = streamed;
      }
    }
  }
  finish(): void {
    this.rest += this.decoder.decode();
    if (this.rest.trim()) this.event(this.rest);
    this.rest = "";
    this.flushPending();
    this.filter?.end();
    if (this.sealed) return;
    this.sealed = true;
    this.text = cleanMessageText(this.text);
    this.spoken = cleanMessageText(this.spoken);
  }
}

export function observeResponse(upstream: Response, protocol: Protocol, ctx: ExecutionContext,
  onFinish: (collector: OutputCollector, interrupted: boolean) => Promise<void>, coding = false): Response {
  if (!upstream.body) return upstream;
  const reader = upstream.body.getReader();
  const collector = new OutputCollector(protocol, coding);
  const sse = upstream.headers.get("content-type")?.includes("text/event-stream");
  const decoder = new TextDecoder();
  let json = "";
  let done = false;
  const finish = (interrupted: boolean) => {
    if (done) return;
    done = true;
    try {
      if (sse) collector.finish();
      else if (!collector.truncated) {
        collector.json(JSON.parse(json + decoder.decode()));
        collector.finish();
      }
    } catch { collector.failed = true; }
    ctx.waitUntil(onFinish(collector, interrupted).catch(() => console.error("gateway exchange recording failed")));
  };
  // Observe with client backpressure: no unbounded tee or wire re-serialization.
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const item = await reader.read();
        if (item.done) { finish(false); controller.close(); return; }
        try {
          if (sse) collector.chunk(item.value);
          else if (!collector.truncated) {
            json += decoder.decode(item.value, { stream: true });
            if (json.length > 256000) { collector.truncated = true; collector.overflow = true; json = ""; }
          }
        } catch { collector.failed = true; }
        controller.enqueue(item.value);
      } catch (error) { finish(true); controller.error(error); }
    },
    async cancel(reason) { finish(true); await reader.cancel(reason); }
  });
  return new Response(stream, { status: upstream.status, statusText: upstream.statusText, headers: upstream.headers });
}
