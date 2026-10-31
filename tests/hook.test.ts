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

test("recall requires explicit boolean recording consent before storing speech or remember-now", async () => {
  precious("partner-a", "喜欢 Cloudflare");
  for (const record of [undefined, false, "true", 1]) {
    const { status, json } = await hook("/v1/hook/recall", { protocol: "messages", model: "partner", record,
      body: humanBody("请记住，我喜欢 Cloudflare") });
    assert.equal(status, 200);
    assert.equal(json.memory, "injected");
    assert.match(json.patch, /喜欢 Cloudflare/);
    assert.equal(json.remember, "none");
  }
  assert.equal(count("conversations"), 0);
  assert.equal(count("messages"), 0);
  assert.equal(count("memories"), 0);
  assert.equal(count("gateway_exchanges"), 0);
  assert.equal(queue.length, 0);
});
test("recall without recording does not store a synthetic credential", async () => {
  const text = "帮我配置 password=review-fixture-only";
  const { json } = await hook("/v1/hook/recall", { protocol: "messages", model: "partner", body: humanBody(text) });
  assert.equal(json.remember, "none");
  assert.equal(count("messages"), 0);
  assert.equal(count("memories"), 0);
});
test("recall with recording enabled stores speech and explicit remember-now", async () => {
  const text = "请记住，我喜欢蓝色";
  const { json } = await hook("/v1/hook/recall", { protocol: "messages", model: "partner", record: true, body: humanBody(text) });
  assert.ok(["saved", "indexed"].includes(json.remember));
  assert.equal(count("messages WHERE role = 'user' AND content = ?", text), 1);
  assert.equal(count("memories"), 1);
});

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
    agent: "claude-desktop", session: "s1", record: true, body: humanBody() });
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

test("hooks choose the first authorized main-model match for recall and record namespaces", async () => {
  setConfig([
    identity({ slug: "private", namespace: "private-ns", keys: ["IM_API_KEY"], models: ["*"] }),
    identity({ slug: "claude", namespace: "claude-ns", models: ["claude-*"] }),
    identity({ slug: "gpt", namespace: "gpt-ns", models: ["gpt-*"] })
  ]);
  precious("private-ns", "喜欢 Cloudflare，私密内容");
  precious("claude-ns", "喜欢 Cloudflare，Claude 分区");
  precious("gpt-ns", "喜欢 Cloudflare，GPT 分区");
  for (const [model, slug, namespace, marker, other] of [
    ["anthropic/claude-sonnet-4", "claude", "claude-ns", "Claude 分区", "GPT 分区"],
    ["openai/gpt-5", "gpt", "gpt-ns", "GPT 分区", "Claude 分区"]
  ]) {
    const turn = { protocol: "messages", model, session: "same-session", record: true, body: humanBody("喜欢 Cloudflare") };
    const recall = await hook("/v1/hook/recall", turn);
    assert.equal(recall.status, 200);
    assert.equal(recall.json.memory, "injected");
    assert.match(recall.json.patch, new RegExp(marker));
    assert.doesNotMatch(recall.json.patch, new RegExp(`${other}|私密内容`));
    assert.equal(count("messages WHERE namespace = ? AND role = 'user'", namespace), 1);
    assert.equal(count("memory_events WHERE namespace = ? AND id = ?", namespace, recall.json.recall_id), 1);
    const recorded = await hook("/v1/hook/record", { ...turn, reply: claudeReply(`${marker}回答`), success: true });
    assert.equal(recorded.status, 200);
    assert.equal(recorded.json.recorded, true);
    const exchange = queue.at(-1);
    assert.equal(exchange.namespace, namespace);
    assert.equal(exchange.profile, slug);
    await persistExchange(env, exchange);
    assert.equal(count("messages WHERE namespace = ? AND role = 'user'", namespace), 1);
    assert.equal(count("messages WHERE namespace = ? AND role = 'assistant' AND content = ?", namespace, `${marker}回答`), 1);
    assert.equal(count("gateway_exchanges WHERE namespace = ? AND id = ?", namespace, recorded.json.exchange_id), 1);
  }
  for (const path of ["/v1/hook/recall", "/v1/hook/record"]) {
    assert.equal((await hook(path, { protocol: "messages", model: "gpt-5", identity: "private", body: humanBody(),
      reply: claudeReply("不能存") })).status, 403);
  }
  assert.equal(count("messages WHERE namespace = 'private-ns'"), 0);
  assert.deepEqual(upstream, []);
});

test("explicit hook identity wins over model routing, including a non-main model", async () => {
  delete env.MEMORY_QUEUE;
  setConfig([identity({ models: ["*"] }), identity({ slug: "second", namespace: "second-ns", models: ["gpt-*"] })]);
  precious("partner-a", "喜欢 Cloudflare，默认分区");
  precious("second-ns", "喜欢 Cloudflare，显式分区");
  const turn = { protocol: "messages", model: "gpt-5", identity: "second", record: true, body: humanBody("喜欢 Cloudflare") };
  const recall = await hook("/v1/hook/recall", turn);
  assert.match(recall.json.patch, /显式分区/);
  assert.doesNotMatch(recall.json.patch, /默认分区/);
  const record = await hook("/v1/hook/record", { ...turn, reply: claudeReply("显式回答") });
  assert.equal(record.json.recorded, true);
  assert.equal(count("messages WHERE namespace = 'second-ns'"), 2);
  for (const model of ["claude-sonnet-4", "unknown-model"]) {
    const off = { ...turn, model };
    assert.equal((await hook("/v1/hook/recall", off)).json.memory, "off");
    assert.deepEqual((await hook("/v1/hook/record", { ...off, reply: claudeReply("忽略") })).json, { recorded: false, reason: "off" });
  }
  assert.equal(count("messages"), 2);
});

test("overlapping hook main models use the first authorized identity", async () => {
  delete env.MEMORY_QUEUE;
  setConfig([identity({ models: ["*"] }), identity({ slug: "second", namespace: "second-ns", models: ["*"] })]);
  precious("partner-a", "喜欢 Cloudflare，首个分区");
  precious("second-ns", "喜欢 Cloudflare，后续分区");
  const turn = { protocol: "messages", model: "gpt-5", record: true, body: humanBody("喜欢 Cloudflare") };
  const recall = await hook("/v1/hook/recall", turn);
  assert.match(recall.json.patch, /首个分区/);
  assert.doesNotMatch(recall.json.patch, /后续分区/);
  assert.equal((await hook("/v1/hook/record", { ...turn, reply: claudeReply("第一位回答") })).json.recorded, true);
  assert.equal(count("messages WHERE namespace = 'partner-a'"), 2);
  assert.equal(count("messages WHERE namespace = 'second-ns'"), 0);
});

test("unmatched hook models retain the first-identity fallback and keys with no identity get 403", async () => {
  setConfig([identity({ models: ["claude-*"] }), identity({ slug: "second", models: ["gpt-*"] })]);
  const turn = { protocol: "messages", model: "unknown-model", record: true, body: humanBody(), reply: claudeReply("忽略") };
  assert.deepEqual((await hook("/v1/hook/recall", turn)).json, { memory: "off", patch: "", recall_id: null, remember: "none" });
  assert.deepEqual((await hook("/v1/hook/record", turn)).json, { recorded: false, reason: "off" });
  for (const path of ["/v1/hook/recall", "/v1/hook/record"]) {
    assert.equal((await hook(path, turn, { authorization: "Bearer im-key" })).status, 403);
  }
  assert.equal(count("messages"), 0);
  assert.equal(count("memory_events"), 0);
  assert.equal(queue.length, 0);
});

test("gateway identity selection still uses the path or first identity regardless of model", async () => {
  setConfig([identity({ models: ["claude-*"] }), identity({ slug: "second", namespace: "second-ns", models: ["gpt-*"] })]);
  globalThis.fetch = async () => Response.json({ choices: [{ index: 0, message: { content: "好" }, finish_reason: "stop" }] });
  for (const [path, slug, memory] of [["/v1/chat/completions", "partner", "off"],
    ["/partner/v1/chat/completions", "partner", "off"], ["/second/v1/chat/completions", "second", "empty"]]) {
    const response = await worker.fetch(new Request(`https://aelios.test${path}`, { method: "POST",
      headers: { authorization: "Bearer owner-key", "content-type": "application/json" },
      body: JSON.stringify({ model: "gpt-5", messages: [{ role: "user", content: "你好" }] }) }), env, ctx);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("x-aelios-identity"), slug);
    assert.equal(response.headers.get("x-aelios-memory"), memory);
    await response.text(); await Promise.all(pending);
  }
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
  const turn = { protocol: "messages", model: "partner", agent: "claude-desktop", session: "s1", record: true, body: humanBody("今晚想吃火锅") };
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

test("different main models keep both replies while sharing the same user utterance", async () => {
  delete env.MEMORY_QUEUE;
  const turn = { protocol: "messages", session: "same-session", record: true,
    body: { ...humanBody("今晚吃什么"), model: "ignored-inner-model" } };
  const ids: string[] = [];
  for (const [model, text] of [["partner", "吃火锅"], ["claude-opus-5-5", "吃面"]]) {
    await hook("/v1/hook/recall", { ...turn, model });
    const { json } = await hook("/v1/hook/record", { ...turn, model, reply: claudeReply(text), success: true });
    assert.equal(json.recorded, true);
    assert.equal(json.completion, "complete");
    ids.push(json.exchange_id);
    // Retrying each model stays idempotent.
    const retry = await hook("/v1/hook/record", { ...turn, model, reply: claudeReply(text), success: true });
    assert.equal(retry.json.exchange_id, json.exchange_id);
  }
  assert.notEqual(ids[0], ids[1]);
  assert.equal(count("messages WHERE role = 'user'"), 1);
  assert.equal(count("messages WHERE role = 'assistant'"), 2);
  assert.equal(count("messages WHERE role = 'assistant' AND content = ?", "吃火锅"), 1);
  assert.equal(count("messages WHERE role = 'assistant' AND content = ?", "吃面"), 1);
  assert.equal(count("gateway_exchanges"), 2);
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
  const turn = { protocol: "messages", model: "partner", agent: "claude", record: true, body: humanBody(said) };
  const recall = await hook("/v1/hook/recall", turn);
  assert.equal(recall.json.coding, "agent:claude");
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
  assert.equal(codingAgent("claude", {}), "agent:claude");
  for (const agent of ["claude-desktop", "my-claude", "claude-proxy", "qwen", "kimi"]) {
    assert.equal(codingAgent(agent, {}), null, agent);
  }
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
  await hook("/v1/hook/recall", { ...ok, identity: "second", record: true });
  assert.equal(count("messages WHERE namespace = 'second-ns'"), 1);
  assert.deepEqual(upstream, []);
});
