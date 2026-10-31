import { strict as assert } from "node:assert";
import { test, beforeEach } from "node:test";
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { timingSafeEqual } from "node:crypto";
import worker from "../src/index";
import { invalidateSettingsCache } from "../src/gateway/config";
import { codingAgent } from "../src/gateway/coding";
import { persistExchange } from "../src/gateway/record";
import { lexicalOverlapScore, shapeRecallQuery } from "../src/memory/queryShape";

// POST /v1/hook/recall and /v1/hook/record against the real SQL schema; nothing may go upstream.
(crypto.subtle as any).timingSafeEqual = (a: Uint8Array, b: Uint8Array) => timingSafeEqual(a, b);
let sqlite: DatabaseSync;
let env: any;
let ctx: any;
let pending: Promise<unknown>[];
let upstream: string[];
let queue: any[];
const identity = (extra: any = {}) => ({ slug: "partner", namespace: "partner-a", keys: ["CHATBOX_API_KEY"],
  models: ["partner", "*opus*"], ...extra });
function setConfig(identities: any[] = [identity()]) {
  env.GATEWAY_CONFIG = JSON.stringify({ version: 3, upstream: { address: "https://upstream.test/ai/v1" }, identities });
  invalidateSettingsCache();
}
beforeEach(() => {
  sqlite?.close(); sqlite = new DatabaseSync(":memory:");
  for (const file of readdirSync("migrations").filter((f: string) => f.endsWith(".sql")).sort()) {
    try { sqlite.exec(readFileSync(`migrations/${file}`, "utf8")); }
    catch (error) { if (!String(error).includes("fts5")) throw error; }
  }
  const db = { prepare(sql: string) {
    const statement = sqlite.prepare(sql); let args: any[] = [];
    const api = { bind(...values: any[]) { args = values; return api; },
      async first() { return statement.get(...args) || null; },
      async all() { return { results: statement.all(...args) }; },
      async run() { const r = statement.run(...args); return { meta: { changes: r.changes } }; }
    }; return api;
  }, async batch(statements: any[]) {
    sqlite.exec("BEGIN");
    try { const results = []; for (const statement of statements) results.push(await statement.run()); sqlite.exec("COMMIT"); return results; }
    catch (e) { sqlite.exec("ROLLBACK"); throw e; }
  } };
  upstream = []; queue = []; pending = [];
  ctx = { waitUntil(p: Promise<unknown>) { pending.push(p); } };
  env = { DB: db, CHATBOX_API_KEY: "owner-key", IM_API_KEY: "im-key", CLOUDFLARE_API_TOKEN: "cf-token",
    AI: { async run(model: string, data: any) {
      if (!model.includes("reranker")) throw new Error("embedding unavailable in test");
      return { response: data.contexts.map((c: any, id: number) => ({ id,
        score: lexicalOverlapScore(c.text, shapeRecallQuery({ query: data.query }).lexicalTokens) > 0 ? 0.9 : 0.01 })) };
    } },
    MEMORY_QUEUE: { async send(e: any) { queue.push(e); } } };
  globalThis.fetch = async (url: any) => { upstream.push(String(url)); throw new Error("hook endpoints must not call out"); };
  setConfig();
});
async function hook(path: string, payload: unknown, headers: Record<string, string> = {}) {
  const response = await worker.fetch(new Request(`https://aelios.test${path}`, { method: "POST",
    headers: { authorization: "Bearer owner-key", "content-type": "application/json", ...headers },
    body: typeof payload === "string" ? payload : JSON.stringify(payload) }), env, ctx);
  const text = await response.text(); await Promise.all(pending);
  return { status: response.status, json: text ? JSON.parse(text) : null };
}
function count(sql: string, ...args: any[]) { return (sqlite.prepare(`SELECT count(*) AS n FROM ${sql}`).get(...args) as any).n; }
function precious(namespace: string, content: string) {
  sqlite.prepare("INSERT INTO precious (id, namespace, content, created_at) VALUES (?, ?, ?, ?)")
    .run(`${namespace}-${content.slice(0, 24)}`, namespace, content, "2026-09-06");
}
const humanBody = (text = "我们喜欢什么？") => ({ messages: [{ role: "user", content: [{ type: "text", text }] }] });
const toolBody = () => ({ messages: [
  { role: "user", content: [{ type: "text", text: "帮我查一下" }] },
  { role: "assistant", content: [{ type: "tool_use", id: "t1", name: "lookup", input: {} }] },
  { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: "" }] }] });
const claudeReply = (text: string) => ({ model: "claude-real", content: [{ type: "text", text }], stop_reason: "end_turn" });

test("a human turn recalls and returns the patch without calling upstream", async () => {
  precious("partner-a", "喜欢 Cloudflare");
  const { status, json } = await hook("/v1/hook/recall", { protocol: "messages", model: "claude-opus-5-5",
    agent: "claude-desktop", session: "s1", body: humanBody() });
  assert.equal(status, 200);
  assert.equal(json.memory, "injected");
  assert.match(json.patch, /喜欢 Cloudflare/);
  assert.match(json.recall_id, /^rcl_/);
  assert.equal(json.remember, "none");
  assert.equal(json.coding, undefined);
  assert.deepEqual(upstream, []);
  // The person's words are kept at once, as on the gateway path.
  assert.equal(count("messages WHERE role = 'user' AND content = ?", "我们喜欢什么？"), 1);
  assert.equal(count("memory_events WHERE event_type = 'recall_explain' AND id = ?", json.recall_id), 1);
});

test("nothing found is empty, not an error; magpie's protocol name anthropic is accepted", async () => {
  const { status, json } = await hook("/v1/hook/recall", { protocol: "anthropic", model: "partner", body: humanBody("随便聊聊") });
  assert.equal(status, 200);
  assert.deepEqual(json, { memory: "empty", patch: "", recall_id: json.recall_id, remember: "none" });
});

test("a tool step does not recall and stores nothing", async () => {
  precious("partner-a", "喜欢 Cloudflare");
  const { json } = await hook("/v1/hook/recall", { protocol: "messages", model: "partner", body: toolBody() });
  assert.deepEqual(json, { memory: "skipped", patch: "", recall_id: null, remember: "none" });
  assert.equal(count("messages"), 0);
});

test("a model outside the main list is off for both endpoints", async () => {
  const recall = await hook("/v1/hook/recall", { protocol: "chat", model: "gpt-mini", body: { messages: [{ role: "user", content: "hi" }] } });
  assert.deepEqual(recall.json, { memory: "off", patch: "", recall_id: null, remember: "none" });
  const record = await hook("/v1/hook/record", { protocol: "chat", model: "gpt-mini", body: { messages: [{ role: "user", content: "hi" }] },
    reply: { choices: [{ index: 0, message: { content: "hello" }, finish_reason: "stop" }] }, success: true });
  assert.deepEqual(record.json, { recorded: false, reason: "off" });
  assert.equal(count("messages"), 0); assert.equal(queue.length, 0);
});

test("stateful Responses input steps aside instead of failing", async () => {
  const body = { input: [{ type: "item_reference", id: "msg_1" }, { role: "user", content: [{ type: "input_text", text: "记得吗" }] }] };
  const recall = await hook("/v1/hook/recall", { protocol: "responses", model: "partner", body });
  assert.equal(recall.status, 200);
  assert.equal(recall.json.memory, "stateful");
  const withPrevious = await hook("/v1/hook/recall", { protocol: "responses", model: "partner",
    body: { previous_response_id: "resp_1", input: "记得吗" } });
  assert.equal(withPrevious.json.memory, "stateful");
  const record = await hook("/v1/hook/record", { protocol: "responses", model: "partner", body, reply: null, success: true });
  assert.deepEqual(record.json, { recorded: false, reason: "stateful" });
  assert.equal(count("messages"), 0);
});

test("record after recall keeps the person's words once and adds the reply", async () => {
  const turn = { protocol: "messages", model: "partner", agent: "claude-desktop", session: "s1", body: humanBody("今晚想吃火锅") };
  await hook("/v1/hook/recall", turn);
  assert.equal(count("messages WHERE role = 'user'"), 1);
  const { status, json } = await hook("/v1/hook/record", { ...turn, reply: claudeReply("好，去吃火锅。"), success: true, http_status: 200 });
  assert.equal(status, 200);
  assert.equal(json.recorded, true);
  assert.match(json.exchange_id, /^gw_req_/);
  assert.equal(json.completion, "complete");
  assert.equal(queue.length, 1);
  assert.equal(queue[0].id, json.exchange_id);
  assert.equal(queue[0].model, "claude-real");
  await persistExchange(env, queue[0]); await persistExchange(env, queue[0]);
  assert.equal(count("messages WHERE role = 'user'"), 1);
  assert.equal(count("messages WHERE role = 'assistant' AND content = ?", "好，去吃火锅。"), 1);
  assert.equal(count("messages WHERE source = 'gateway:partner'"), 2);
  assert.equal(count("gateway_exchanges"), 1);
  // A repeated record (no queue) writes directly and still adds nothing new.
  delete env.MEMORY_QUEUE;
  const again = await hook("/v1/hook/record", { ...turn, reply: claudeReply("好，去吃火锅。"), success: true });
  assert.equal(again.json.exchange_id, json.exchange_id);
  assert.equal(count("messages"), 2);
});

test("the session scopes the conversation; without one it falls back to unscoped", async () => {
  delete env.MEMORY_QUEUE;
  const reply = claudeReply("嗯");
  await hook("/v1/hook/record", { protocol: "messages", model: "partner", session: "a", body: humanBody("早上好"), reply, success: true });
  await hook("/v1/hook/record", { protocol: "messages", model: "partner", session: "b", body: humanBody("早上好"), reply, success: true });
  await hook("/v1/hook/record", { protocol: "messages", model: "partner", body: humanBody("早上好"), reply, success: true });
  assert.equal(count("conversations"), 3);
  assert.equal(count("messages WHERE role = 'user'"), 3);
});

test("a tool step's reply is recorded; a failed or missing reply records no assistant line", async () => {
  delete env.MEMORY_QUEUE;
  const tool = await hook("/v1/hook/record", { protocol: "messages", model: "partner", body: toolBody(),
    reply: claudeReply("查到了，是周五。"), success: true });
  assert.equal(tool.json.completion, "complete");
  assert.equal(count("messages WHERE role = 'assistant' AND content = ?", "查到了，是周五。"), 1);
  assert.equal(count("messages WHERE role = 'user'"), 0);
  const failed = await hook("/v1/hook/record", { protocol: "messages", model: "partner", body: humanBody("还在吗"),
    reply: claudeReply("在"), success: false });
  assert.equal(failed.json.completion, "failed");
  const missing = await hook("/v1/hook/record", { protocol: "messages", model: "partner", body: humanBody("喂"), reply: null, success: true });
  assert.equal(missing.json.completion, "failed");
  assert.equal(count("messages WHERE role = 'assistant'"), 1);
  assert.equal((sqlite.prepare("SELECT http_status FROM gateway_exchanges WHERE completion_status = 'failed' LIMIT 1").get() as any).http_status, 502);
});

test("the agent id turns on the coding filter, unless the assistant switched it off", async () => {
  delete env.MEMORY_QUEUE;
  const said = "看看这个\n```js\nconst secret = 1;\n```";
  const turn = { protocol: "messages", model: "partner", agent: "claude-code", body: humanBody(said) };
  const recall = await hook("/v1/hook/recall", turn);
  assert.equal(recall.json.coding, "agent:claude-code");
  await hook("/v1/hook/record", { ...turn, reply: claudeReply("改好了：\n```js\nconst x = 2;\n```\n试试看。"), success: true });
  const stored = (sqlite.prepare("SELECT role, content FROM messages ORDER BY seq").all() as any[]).map(r => `${r.role}:${r.content}`);
  assert.equal(stored.length, 2);
  assert.ok(stored.every(line => !line.includes("const ")));
  assert.match(stored[0], /^user:看看这个\n\[code\]$/);
  assert.match(stored[1], /^assistant:改好了：/);
  assert.match(stored[1], /\[code\]/);

  setConfig([identity({ codingFilter: false })]);
  const off = await hook("/v1/hook/recall", { ...turn, session: "other", body: humanBody(`${said}\n再看`) });
  assert.equal(off.json.coding, undefined);
  assert.equal(count("messages WHERE content LIKE '%const secret%'"), 1);
});

test("codingAgent reads magpie agent ids and keeps the tool rule", () => {
  for (const agent of ["claude-code", "codex", "opencode", "cline", "aider", "kilo", "qwen-code"]) {
    assert.ok(codingAgent(agent, {}), agent);
  }
  assert.equal(codingAgent("claude-desktop", {}), null);
  assert.equal(codingAgent(null, {}), null);
  assert.equal(codingAgent("claude-desktop", { tools: [{ name: "Bash" }, { name: "Edit" }] }), "tools:bash+edit");
  assert.equal(codingAgent(undefined, { tools: [{ type: "function", function: { name: "shell" } }, { type: "function", function: { name: "apply_patch" } }] }),
    "tools:shell+applypatch");
});

test("auth, identity, validation and the 2 MB limit", async () => {
  const ok = { protocol: "messages", model: "partner", body: humanBody() };
  assert.equal((await hook("/v1/hook/recall", ok, { authorization: "Bearer wrong" })).status, 401);
  const unknown = await hook("/v1/hook/recall", { ...ok, identity: "nobody" });
  assert.equal(unknown.status, 403);
  assert.match(unknown.json.error.message, /No identity "nobody"/);
  assert.equal((await hook("/v1/hook/record", { ...ok, protocol: "gemini" })).status, 400);
  assert.equal((await hook("/v1/hook/recall", { ...ok, body: { messages: "x" } })).status, 400);
  assert.equal((await hook("/v1/hook/recall", "not json")).status, 400);
  const huge = { ...ok, body: humanBody("x".repeat(2 * 1024 * 1024)) };
  assert.equal((await hook("/v1/hook/recall", huge)).status, 413);
  assert.equal((await hook("/v1/hook/record", huge)).status, 413);
  assert.equal(count("messages"), 0);
  // A named identity this key can use is honored.
  setConfig([identity(), identity({ slug: "second", namespace: "second-ns" })]);
  await hook("/v1/hook/recall", { ...ok, identity: "second" });
  assert.equal(count("messages WHERE namespace = 'second-ns'"), 1);
  assert.deepEqual(upstream, []);
});
