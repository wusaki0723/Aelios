import { strict as assert } from "node:assert";
import { test, beforeEach } from "node:test";
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { timingSafeEqual } from "node:crypto";
import worker from "../src/index";
import { invalidateSettingsCache } from "../src/gateway/config";

// MCP tool list as the Claude app sees it: nine everyday tools named after the moment they are for,
// usage guidance both in initialize and in wake_up (the Claude app ignores instructions), old names still callable.
(crypto.subtle as any).timingSafeEqual = (a: Uint8Array, b: Uint8Array) => timingSafeEqual(a, b);
let sqlite: DatabaseSync;
let env: any;

const CORE = ["wake_up", "recall", "remember", "keep_moment", "forget", "learn_word", "read_diary", "log_conversation", "list_memories"];

beforeEach(() => {
  sqlite?.close(); sqlite = new DatabaseSync(":memory:");
  for (const file of readdirSync("migrations").filter((f: string) => f.endsWith(".sql")).sort()) {
    try { sqlite.exec(readFileSync(`migrations/${file}`, "utf8")); }
    catch (error) {
      if (!String(error).includes("fts5")) throw error;
    }
  }
  const db = { prepare(sql: string) {
    const statement = sqlite.prepare(sql); let args: any[] = [];
    const api = { bind(...values: any[]) { args = values; return api; },
      async first() { return statement.get(...args) || null; },
      async all() { return { results: statement.all(...args) }; },
      async run() { const r = statement.run(...args); return { meta: { changes: r.changes } }; }
    }; return api;
  }, async batch(statements: any[]) {
    const results = []; for (const statement of statements) results.push(await statement.run()); return results;
  } };
  invalidateSettingsCache();
  env = { DB: db, CHATBOX_API_KEY: "owner-key",
    AI: { async run() { return { data: [[0.1, 0.2, 0.3]] }; } },
    VECTORIZE: { async upsert() { return {}; }, async deleteByIds() { return {}; }, async query() { return { matches: [] }; } } };
  globalThis.fetch = async (url: any) => { throw new Error(`unexpected upstream call: ${url}`); };
});

function memory(id: string, content: string, extra: { pinned?: number; importance?: number; factKey?: string } = {}) {
  const at = "2026-09-01T00:00:00.000Z";
  sqlite.prepare(`INSERT INTO memories (id, namespace, type, content, importance, confidence, status, pinned, tags, source,
    source_message_ids, vector_id, created_at, updated_at, fact_key, version_status)
    VALUES (?, 'default', 'fact', ?, ?, 0.8, 'active', ?, '[]', 'dream', '[]', ?, ?, ?, ?, 'current')`)
    .run(id, content, extra.importance ?? 0.6, extra.pinned ?? 0, `mem_${id}`, at, at, extra.factKey ?? null);
  sqlite.prepare("INSERT INTO memory_lifecycle (memory_id, namespace, fact_key, seen_count) VALUES (?, 'default', ?, 0)")
    .run(id, extra.factKey ?? null);
}
const row = (table: string, id: string) => sqlite.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id) as any;

async function rpc(method: string, params: any = {}, query = "") {
  const response = await worker.fetch(new Request(`https://aelios.test/mcp${query}`, { method: "POST",
    headers: { authorization: "Bearer owner-key", "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) }), env, { waitUntil() {} } as any);
  return (await response.json() as any).result;
}
const call = async (name: string, args: any = {}) => rpc("tools/call", { name, arguments: args });
const listNames = async (query = "") => (await rpc("tools/list", {}, query)).tools.map((tool: any) => tool.name);

test("initialize carries the usage guidance for clients that read instructions", async () => {
  const result = await rpc("initialize");
  assert.match(result.instructions, /wake_up/);
  assert.match(result.instructions, /recall/);
  assert.match(result.instructions, /log_conversation/);
});

test("the default list is the nine everyday tools; review shows only with clef off, maintenance only with tools=all", async () => {
  assert.deepEqual(await listNames(), CORE);
  env.CLEF_AUTO_REVIEW = "off";
  assert.deepEqual(await listNames(), [...CORE, "memory_candidates", "memory_review"]);
  delete env.CLEF_AUTO_REVIEW;
  assert.deepEqual(await listNames("?tools=all"), [...CORE, "memory_candidates", "memory_review", "memory_get", "memory_export"]);

  const tools = (await rpc("tools/list")).tools;
  for (const name of ["wake_up", "recall", "read_diary", "list_memories"]) {
    assert.equal(tools.find((tool: any) => tool.name === name).annotations.readOnlyHint, true, name);
  }
  // The first sentence says when to call, which is all an on-demand tool catalog shows.
  assert.match(tools.find((tool: any) => tool.name === "wake_up").description, /^Call this first in every new conversation/);
});

test("wake_up hands over the guidance and the core memories, pinned first", async () => {
  memory("m-low", "她喜欢晴天。", { importance: 0.3 });
  memory("m-pin", "她叫咲咲，住在武汉。", { pinned: 1, importance: 0.5 });
  memory("m-high", "她的女儿叫可可。", { importance: 0.9 });
  sqlite.prepare("INSERT INTO precious (id, namespace, content, created_at) VALUES ('p1', 'default', '第一次叫我旦九。', '2026-09-02T00:00:00.000Z')").run();

  const { data } = (await call("wake_up")).structuredContent;
  assert.match(data.how_to_use, /wake_up/);
  assert.deepEqual(data.core.map((m: any) => m.id), ["m-pin", "m-high", "m-low"]);
  assert.equal(data.precious[0].content, "第一次叫我旦九。");
  assert.ok("impressions" in data && "glossary" in data);
});

test("remember saves without a fact_key and replaces with history, never in place", async () => {
  const created = (await call("remember", { content: "她最近在备考中级经济师。" })).structuredContent.data;
  assert.equal(created.created, true);
  const saved = row("memories", created.id);
  assert.equal(saved.content, "她最近在备考中级经济师。");
  assert.match(saved.fact_key, /^remember:[0-9a-f]{32}$/);
  assert.equal(saved.source, "mcp");

  memory("m-city", "她住在香港。");
  const moved = (await call("remember", { content: "她 9 月 28 日搬进了武汉的新家。", replaces: "m-city", reason: "搬家了" })).structuredContent.data;
  assert.equal(moved.replaced, "m-city");
  assert.equal(row("memories", "m-city").version_status, "superseded");
  assert.equal(row("memories", moved.id).status, "active");

  memory("m-coffee", "她早上喝拿铁。", { factKey: "user:coffee" });
  const keyed = (await call("remember", { content: "她改喝美式了。", fact_key: "user:coffee" })).structuredContent.data;
  assert.equal(keyed.replaced, "m-coffee");
  assert.equal(row("memories", "m-coffee").content, "她早上喝拿铁。");
  assert.equal(row("memories", "m-coffee").version_status, "superseded");
  assert.equal(row("memories", keyed.id).fact_key, "user:coffee");
});

test("forget archives by default and erases only when asked", async () => {
  memory("m-a", "一条要收起来的。");
  memory("m-b", "一条要删掉的。");
  assert.equal((await call("forget", { id: "m-a" })).structuredContent.data.archived, true);
  assert.equal(row("memories", "m-a").status, "archived");
  assert.equal((await call("forget", { id: "m-b", permanent: true })).structuredContent.data.deleted, true);
  assert.equal(row("memories", "m-b"), undefined);
  assert.equal((await call("forget", { id: "nope" })).isError, true);
});

test("log_conversation opens its own conversation and skips lines it already has", async () => {
  const first = (await call("log_conversation", { messages: [
    { role: "user", content: "今天考了一套题。" },
    { role: "assistant", content: "考得怎么样？" }
  ] })).structuredContent.data;
  assert.match(first.conversation_id, /^conv_/);
  assert.equal(first.saved, 2);

  const second = (await call("log_conversation", { conversation_id: first.conversation_id, messages: [
    { role: "user", content: "今天考了一套题。" },
    { role: "assistant", content: "考得怎么样？ " },
    { role: "user", content: "84 分，过了！" },
    { role: "user", content: "84 分，过了！" }
  ] })).structuredContent.data;
  assert.equal(second.saved, 1);
  assert.equal(second.skipped, 3);
  const stored = sqlite.prepare("SELECT role, content, source FROM messages WHERE conversation_id = ? ORDER BY created_at, seq")
    .all(first.conversation_id) as any[];
  assert.deepEqual(stored.map((m) => m.content), ["今天考了一套题。", "考得怎么样？", "84 分，过了！"]);
  assert.ok(stored.every((m) => m.source === "mcp"));
});

test("renamed tools reach the same handlers and old names keep working", async () => {
  memory("m-1", "她养了一只猫。");
  assert.equal((await call("list_memories")).structuredContent.data[0].id, "m-1");
  assert.equal((await call("memory_list")).structuredContent.data[0].id, "m-1");

  assert.equal((await call("learn_word", { term: "旦九", definition: "她给我起的名字" })).structuredContent.data.term, "旦九");
  assert.equal((await call("keep_moment", { content: "她说今天很开心。" })).structuredContent.data.content, "她说今天很开心。");
  assert.deepEqual((await call("read_diary", { date: "2026-10-01" })).structuredContent.data, null);

  const legacy = (await call("memory_upsert", { fact_key: "user:pet", content: "她养了两只猫。" })).structuredContent.data;
  assert.equal(row("memories", legacy.id).fact_key, "user:pet");
  assert.equal((await call("memory_archive", { id: legacy.id })).structuredContent.data.archived, true);
  // The boot package is cached per namespace for a minute, so only its shape is checked here.
  assert.ok(Array.isArray((await call("memory_boot")).structuredContent.data.glossary));
  assert.equal((await call("no_such_tool")).isError, true);
});
