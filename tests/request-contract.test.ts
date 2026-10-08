import { strict as assert } from "node:assert";
import { test } from "node:test";
import { normalizeRequest, validateRequest, RequestContractError } from "../src/gateway/request";
import { appendMemory, applyThinkingPolicy, sanitizeCacheControl } from "../src/gateway/protocol";

const base = () => ({ model: "claude-test", max_tokens: 2048, messages: [{ role: "user", content: "hello" }] });
const assistant = { role: "assistant", content: [
  { type: "thinking", thinking: "", signature: "opaque-signature" },
  { type: "redacted_thinking", data: "opaque-data" },
  { type: "tool_use", id: "t1", name: "lookup", input: { display: "domain data", output_config: { x: true } } }
] };
const result = { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: "done" }] };

test("normalization strips envelope extras, preserves legal output config and opaque schemas, is immutable/idempotent", () => {
  const schema = { type: "object", properties: { display: { type: "string" }, output_config: { type: "object", additionalProperties: true } } };
  const raw = { ...base(), display: "client-ui", output_config: { effort: "high", display: "ui", format: { type: "json_schema", schema } },
    thinking: { type: "adaptive", display: "omitted", ui: true }, metadata: { user_id: "u", session_id: "local-only" },
    tools: [{ name: "lookup", input_schema: schema, display: "ui" }],
    messages: [...base().messages, assistant, result] };
  const before = structuredClone(raw);
  const normalized = normalizeRequest(raw, "messages");
  assert.deepEqual(raw, before);
  assert.equal(normalized.body.display, undefined);
  assert.equal(normalized.body.output_config.display, undefined);
  assert.equal(normalized.body.thinking.display, "omitted");
  assert.equal(normalized.body.metadata.session_id, undefined);
  assert.deepEqual(normalized.body.output_config.format.schema, schema);
  assert.deepEqual(normalized.body.tools[0].input_schema, schema);
  assert.deepEqual(normalized.body.messages.slice(1), [assistant, result]);
  assert.deepEqual(normalizeRequest(normalized.body, "messages"), { body: normalized.body, removed: [] });
  assert.doesNotThrow(() => validateRequest(normalized.body, "messages"));
});

test("protocol envelopes stay separate, Responses reasoning and tool payloads stay opaque", () => {
  const chat = normalizeRequest({ ...base(), display: true, output_config: {}, reasoning_effort: "high", response_format: { type: "json_object" } }, "chat");
  assert.equal(chat.body.output_config, undefined);
  assert.equal(chat.body.reasoning_effort, "high");
  const input = [{ type: "reasoning", encrypted_content: "opaque", summary: [] }, { type: "function_call_output", call_id: "t", output: "raw" }];
  const response = normalizeRequest({ model: "gpt-test", input, max_tokens: 200, max_output_tokens: 200, display: true, reasoning: { effort: "high" } }, "responses");
  assert.equal(response.body.max_tokens, undefined);
  assert.deepEqual(response.body.input, input);
  assert.deepEqual(response.body.reasoning, { effort: "high" });
});

test("never silently drop unknown block types or rewrite signed blocks", () => {
  for (const block of [{ type: "future_block", content: "important" }, { type: "constructor" },
    { type: "thinking", thinking: "", signature: "sig", display: "ui" }]) {
    assert.throws(() => normalizeRequest({ ...base(), messages: [{ role: "assistant", content: [block] }] }, "messages"), RequestContractError);
  }
});

const invalid: [string, any, RegExp][] = [
  ["missing token limit", { ...base(), max_tokens: undefined }, /max_tokens/],
  ["string token limit", { ...base(), max_tokens: "2048" }, /max_tokens/],
  ["boolean stream", { ...base(), stream: "true" }, /stream/],
  ["invalid role", { ...base(), messages: [{ role: "tool", content: "done" }] }, /role/],
  ["empty content array", { ...base(), messages: [{ role: "user", content: [] }] }, /content/],
  ["missing signature", { ...base(), messages: [{ role: "assistant", content: [{ type: "thinking", thinking: "x" }] }] }, /signature/],
  ["orphan result", { ...base(), messages: [result] }, /tool_use_id/],
  ["missing result", { ...base(), messages: [...base().messages, assistant] }, /tool_result/],
  ["text before result", { ...base(), messages: [assistant, { role: "user", content: [{ type: "text", text: "hi" }, ...result.content] }] }, /before text/],
  ["duplicate result", { ...base(), messages: [assistant, { role: "user", content: [...result.content, ...result.content] }] }, /tool_use_id/],
  ["short thinking budget", { ...base(), thinking: { type: "enabled", budget_tokens: 100 } }, /budget_tokens/],
  ["budget exceeds output", { ...base(), thinking: { type: "enabled", budget_tokens: 3000 } }, /budget_tokens/],
  ["adaptive budget", { ...base(), thinking: { type: "adaptive", budget_tokens: 1200 } }, /budget_tokens/],
  ["forced thinking tool", { ...base(), thinking: { type: "adaptive" }, tool_choice: { type: "any" } }, /tool_choice/],
  ["binding without beta", { ...base(), thinking: { type: "adaptive", block_binding: { prefix_mismatch_behavior: "drop_block" } } }, /anthropic-beta/],
  ["invalid schema", { ...base(), tools: [{ name: "x", input_schema: "not an object" }] }, /input_schema/],
  ["invalid cache ttl", { ...base(), cache_control: { type: "ephemeral", ttl: "1d" } }, /cache_control/],
  ["invalid output format", { ...base(), output_config: { format: { type: "json_schema" } } }, /output_config.format/]
];
for (const [name, body, message] of invalid) test(`contract rejects ${name} with a useful path`, () => {
  assert.throws(() => validateRequest(body, "messages"), message);
});

test("parallel calls and consecutive same-role fragments preserve the logical tool turn", () => {
  const body = { ...base(), messages: [assistant,
    { role: "assistant", content: [{ type: "tool_use", id: "t2", name: "lookup", input: {} }] },
    result, { role: "user", content: [{ type: "tool_result", tool_use_id: "t2", content: [] }, { type: "text", text: "Now explain" }] }] };
  assert.doesNotThrow(() => validateRequest(body, "messages"));
  const patched = appendMemory(body, "messages", "reference");
  assert.deepEqual(patched.messages.slice(0, -1), body.messages.slice(0, -1));
  assert.doesNotThrow(() => validateRequest(patched, "messages"));
});

test("legitimate empty thinking, cache warming, server tool replay and beta system controls survive", () => {
  assert.doesNotThrow(() => validateRequest({ ...base(), max_tokens: 0 }, "messages"));
  const messages = [base().messages[0], { role: "assistant", content: [
    assistant.content[0], { type: "server_tool_use", id: "s", name: "web_search", input: { query: "test" } },
    { type: "web_search_tool_result", tool_use_id: "s", content: [{ type: "web_search_result", encrypted_content: "opaque" }] },
    { type: "text", text: "answer" }] },
    { role: "system", content: [], output_config: { effort: "low" } },
    { role: "system", content: "hint", clear_at: "next_user_message" },
    { role: "system", content: [{ type: "tool_removal", tool: { type: "tool_reference", name: "x" } }] },
    { role: "user", content: "next" }];
  const normalized = normalizeRequest({ ...base(), messages }, "messages");
  assert.deepEqual(normalized.body.messages, messages);
  const headers = new Headers({ "anthropic-beta": "mid-conversation-output-config-2026-07-01,mid-conversation-system-clear-at-2026-08-21,mid-conversation-tool-changes-2026-07-01" });
  assert.doesNotThrow(() => validateRequest(normalized.body, "messages", headers));
});

test("the binding policy is present through tool continuations and later signed histories without editing them", () => {
  const identity: any = { anthropicThinking: "drop_block" };
  for (const messages of [base().messages, [base().messages[0], assistant, result],
    [base().messages[0], assistant, result, { role: "assistant", content: [assistant.content[0], { type: "text", text: "answer" }] }, { role: "user", content: "next" }]]) {
    const body: any = { ...base(), messages, thinking: { type: "enabled", budget_tokens: 1024, display: "omitted" } };
    const before = structuredClone(messages);
    const headers = new Headers({ "anthropic-beta": "other-beta" });
    applyThinkingPolicy(body, identity, "messages", headers);
    applyThinkingPolicy(body, identity, "messages", headers);
    assert.equal(body.thinking.type, "enabled");
    assert.equal(body.thinking.budget_tokens, 1024);
    assert.equal(body.thinking.block_binding.prefix_mismatch_behavior, "drop_block");
    assert.equal(headers.get("anthropic-beta")!.split(",").length, 2);
    assert.deepEqual(messages, before);
    assert.doesNotThrow(() => validateRequest(body, "messages", headers));
  }
  const disabled: any = { ...base(), thinking: { type: "disabled" }, messages: [base().messages[0], assistant, result] };
  const before = structuredClone(disabled);
  const headers = new Headers();
  applyThinkingPolicy(disabled, identity, "messages", headers);
  assert.deepEqual(disabled, before);
  assert.equal(headers.has("anthropic-beta"), false);
});

test("auto binds thinking only on the native Anthropic line and never switches thinking on by itself", () => {
  const binding = (body: any) => body.thinking?.block_binding?.prefix_mismatch_behavior;
  const apply = (body: any, mode: any, native: boolean) => {
    const headers = new Headers();
    applyThinkingPolicy(body, mode === undefined ? {} as any : { anthropicThinking: mode } as any, "messages", headers, native);
    return headers.get("anthropic-beta");
  };
  const loop = () => [base().messages[0], assistant, result];
  // The default on Anthropic's own endpoint: tool continuations and later turns keep working.
  for (const mode of [undefined, "auto"]) {
    const adaptive: any = { ...base(), thinking: { type: "adaptive" }, messages: loop() };
    assert.equal(apply(adaptive, mode, true), "thinking-binding-controls-2026-08-01");
    assert.equal(binding(adaptive), "drop_block");
    assert.doesNotThrow(() => validateRequest(adaptive, "messages", new Headers({ "anthropic-beta": "thinking-binding-controls-2026-08-01" })));
    // Unset thinking with signed history: the model already thinks by default, so the block needs binding.
    const unsetWithHistory: any = { ...base(), messages: loop() };
    apply(unsetWithHistory, mode, true);
    assert.equal(unsetWithHistory.thinking.type, "adaptive");
    assert.equal(binding(unsetWithHistory), "drop_block");
  }
  // Unset thinking and nothing signed yet: leave the request exactly as the client sent it.
  const fresh: any = base();
  assert.equal(apply(fresh, undefined, true), null);
  assert.deepEqual(fresh, base());
  // Other lines (Vertex, custom relays) and explicit choices stay untouched.
  const elsewhere: any = { ...base(), thinking: { type: "adaptive" }, messages: loop() };
  assert.equal(apply(elsewhere, undefined, false), null);
  assert.deepEqual(elsewhere.thinking, { type: "adaptive" });
  const passthrough: any = { ...base(), thinking: { type: "adaptive" }, messages: loop() };
  assert.equal(apply(passthrough, "passthrough", true), null);
  assert.deepEqual(passthrough.thinking, { type: "adaptive" });
  const disabled: any = { ...base(), thinking: { type: "disabled" }, messages: loop() };
  assert.equal(apply(disabled, undefined, true), null);
  assert.deepEqual(disabled.thinking, { type: "disabled" });
});

test("cache validation shares the last cacheable point, rejects fifth points and TTL conflicts without touching thinking", () => {
  const cc = { type: "ephemeral", ttl: "5m" };
  const blocks = Array.from({ length: 4 }, (_, i) => ({ type: "text", text: `part-${i}`, cache_control: cc }));
  const body: any = { ...base(), cache_control: cc, messages: [{ role: "user", content: blocks }, { role: "assistant", content: [assistant.content[0]] }] };
  assert.doesNotThrow(() => validateRequest(body, "messages"));
  const out = structuredClone(body);
  sanitizeCacheControl(out, "messages");
  assert.deepEqual(out.messages, body.messages);
  assert.equal(out.cache_control, undefined);
  assert.doesNotThrow(() => validateRequest(out, "messages"));
  assert.throws(() => validateRequest({ ...body, cache_control: { type: "ephemeral", ttl: "1h" } }, "messages"), /TTLs/);
  assert.throws(() => validateRequest({ ...body, cache_control: { type: "invalid" } }, "messages"), /cache_control/);
  assert.throws(() => validateRequest({ ...body, messages: [...body.messages, { role: "user", content: "new cache point" }] }, "messages"), /four/);
});
