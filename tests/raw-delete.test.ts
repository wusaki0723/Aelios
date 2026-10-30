import { strict as assert } from "node:assert";
import { test, beforeEach } from "node:test";
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { timingSafeEqual } from "node:crypto";
import { runInNewContext } from "node:vm";
import worker from "../src/index";
import { invalidateSettingsCache } from "../src/gateway/config";
import { ADMIN_HTML } from "../src/api/admin/ui";

// 删一句原话：报错、乱码、突然拒答这种，在后台首页「今天的对话」里删掉，整理、日记和召回都读不到。
(crypto.subtle as any).timingSafeEqual = (a: Uint8Array, b: Uint8Array) => timingSafeEqual(a, b);
let sqlite: DatabaseSync;
let env: any;

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
  env = { DB: db, CHATBOX_API_KEY: "owner-key", MEMORY_MCP_API_KEY: "mcp-key" };
  globalThis.fetch = async (url: any) => { throw new Error(`unexpected upstream call: ${url}`); };
  const now = new Date().toISOString();
  const insert = sqlite.prepare(`INSERT INTO messages (id, conversation_id, namespace, role, content, source, created_at, seq)
    VALUES (?, 'gw_c', ?, ?, ?, 'gateway:resident', ?, ?)`);
  const index = sqlite.prepare("INSERT INTO message_fts (fts_body, namespace, message_id) VALUES (?, ?, ?)");
  for (const [id, namespace, role, content, seq] of [
    ["gw_user_1", "default", "user", "帮我看看这段", 0],
    ["gw_req_1:assistant", "default", "assistant", "我不能完成这个任务。", 1],
    ["gw_req_2:assistant", "other", "assistant", "我不能完成这个任务。", 1]
  ] as const) {
    insert.run(id, namespace, role, content, now, seq);
    index.run(content, namespace, id);
  }
});

async function del(id: string, namespace = "default", key = "owner-key") {
  const response = await worker.fetch(new Request(`https://aelios.test/v1/raw/${encodeURIComponent(id)}?namespace=${namespace}`, {
    method: "DELETE", headers: { authorization: `Bearer ${key}` }
  }), env, { waitUntil() {} } as any);
  return { status: response.status, body: await response.json() as any };
}
const rows = () => sqlite.prepare("SELECT id FROM messages ORDER BY id").all().map((row: any) => row.id);
const indexed = () => sqlite.prepare("SELECT message_id FROM message_fts ORDER BY message_id").all().map((row: any) => row.message_id);

test("a line is deleted with its search index, in its own space only", async () => {
  assert.deepEqual(await del("gw_req_1:assistant"), { status: 200, body: { data: { id: "gw_req_1:assistant", deleted: true } } });
  assert.deepEqual(rows(), ["gw_req_2:assistant", "gw_user_1"]);
  assert.deepEqual(indexed(), ["gw_req_2:assistant", "gw_user_1"]);
  assert.equal((await del("gw_req_1:assistant")).status, 404, "gone already");
  assert.equal((await del("gw_req_2:assistant", "default")).status, 404, "another space's line is not this one's");
  assert.deepEqual(rows(), ["gw_req_2:assistant", "gw_user_1"]);
});

test("only DELETE, only with a key that may write", async () => {
  assert.equal((await del("gw_user_1", "default", "wrong")).status, 401);
  const get = await worker.fetch(new Request("https://aelios.test/v1/raw/gw_user_1", { headers: { authorization: "Bearer owner-key" } }),
    env, { waitUntil() {} } as any);
  assert.equal(get.status, 404);
  assert.equal(rows().length, 3);
});

test("the home page's chats have a delete button that asks first, then drops the line from the list", async () => {
  assert.match(ADMIN_HTML, /@click="deleteRaw\(message\)"/);
  const script = (ADMIN_HTML.match(/<script>\s*(function memoryAdmin\(\)[\s\S]*?)<\/script>/) as RegExpMatchArray)[1];
  let answer = false;
  const app = runInNewContext(`${script}\nmemoryAdmin()`, {
    localStorage: { getItem: () => null, setItem() {} },
    location: { origin: "https://aelios.test" },
    document: { documentElement: { dataset: {} } },
    window: { setTimeout() {}, confirm: () => answer }
  });
  const calls: string[] = [];
  app.request = async (path: string, options: any = {}) => { calls.push(`${options.method || "GET"} ${path}`); return { data: { deleted: true } }; };
  app.notify = () => {};
  app.todayMessages = [{ id: "gw_user_1", role: "user", content: "帮我看看这段" }, { id: "gw_req_1:assistant", role: "assistant", content: "我不能完成这个任务。" }];
  app.stats = { today_raw_count: 2 };
  await app.deleteRaw(app.todayMessages[1]);
  assert.deepEqual(calls, [], "a no deletes nothing");
  answer = true;
  await app.deleteRaw(app.todayMessages[1]);
  assert.deepEqual(calls, ["DELETE /v1/raw/gw_req_1%3Aassistant?namespace=default"]);
  assert.deepEqual(app.todayMessages.map((message: any) => message.id), ["gw_user_1"]);
  assert.equal(app.stats.today_raw_count, 1);
});
