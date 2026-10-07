import { strict as assert } from "node:assert";
import { test, beforeEach } from "node:test";
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { timingSafeEqual } from "node:crypto";
import worker from "../src/index";
import { invalidateSettingsCache } from "../src/gateway/config";
import { countKeptDiarySources } from "../src/db/v2";

// read_diary 带 memory_id：看一条记忆从哪来。原文还在给原文；原文过了保留期，退到那天的日记，再退到那一周的周记。
(crypto.subtle as any).timingSafeEqual = (a: Uint8Array, b: Uint8Array) => timingSafeEqual(a, b);
let sqlite: DatabaseSync;
let env: any;
let db: any;

beforeEach(() => {
  sqlite?.close(); sqlite = new DatabaseSync(":memory:");
  for (const file of readdirSync("migrations").filter((f: string) => f.endsWith(".sql")).sort()) {
    try { sqlite.exec(readFileSync(`migrations/${file}`, "utf8")); }
    catch (error) {
      if (!String(error).includes("fts5")) throw error;
    }
  }
  db = { prepare(sql: string) {
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
  env = { DB: db, CHATBOX_API_KEY: "owner-key", DREAM_TIMEZONE: "Asia/Shanghai",
    AI: { async run() { return { data: [[0.1, 0.2, 0.3]] }; } },
    VECTORIZE: { async upsert() { return {}; }, async deleteByIds() { return {}; }, async query() { return { matches: [] }; } } };
  globalThis.fetch = async (url: any) => { throw new Error(`unexpected upstream call: ${url}`); };
});

function memory(id: string, content: string, sources: string[], createdAt = "2026-09-20T12:00:00.000Z") {
  sqlite.prepare(`INSERT INTO memories (id, namespace, type, content, importance, confidence, status, pinned, tags, source,
    source_message_ids, vector_id, created_at, updated_at, version_status)
    VALUES (?, 'default', 'fact', ?, 0.7, 0.9, 'active', 0, '[]', 'review', ?, ?, ?, ?, 'current')`)
    .run(id, content, JSON.stringify(sources), `mem_${id}`, createdAt, createdAt);
}
function message(id: string, content: string, role = "user", createdAt = "2026-10-06T10:00:00.000Z") {
  sqlite.prepare(`INSERT INTO messages (id, conversation_id, namespace, role, content, source, created_at)
    VALUES (?, 'default:default', 'default', ?, ?, 'test', ?)`).run(id, role, content, createdAt);
}
function diary(date: string, summary: string, sources: string[] = []) {
  sqlite.prepare(`INSERT INTO daily_log (namespace, date, title, summary, source_message_ids, updated_at)
    VALUES ('default', ?, ?, ?, ?, '2026-10-01T00:00:00.000Z')`).run(date, `${date} 的日记`, summary, JSON.stringify(sources));
}
function candidate(id: string, memoryId: string, createdAt: string) {
  sqlite.prepare(`INSERT INTO memory_candidates (id, namespace, type, content, source_message_ids, source, status,
    target_memory_id, created_at, updated_at)
    VALUES (?, 'default', 'fact', '候选', '[]', 'dream_extract', 'approved', ?, ?, ?)`).run(id, memoryId, createdAt, createdAt);
}
function dreamRun(dateLabel: string, startedAt: string, finishedAt: string) {
  sqlite.prepare(`INSERT INTO dream_runs (id, namespace, date_label, started_at, finished_at, status, trigger)
    VALUES (?, 'default', ?, ?, ?, 'ok', 'cron')`).run(`run_${dateLabel}`, dateLabel, startedAt, finishedAt);
}

async function readSource(memoryId: string) {
  const response = await worker.fetch(new Request("https://aelios.test/mcp", { method: "POST",
    headers: { authorization: "Bearer owner-key", "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call",
      params: { name: "read_diary", arguments: { memory_id: memoryId } } }) }), env, { waitUntil() {} } as any);
  return (await response.json() as any).result;
}

test("while the original messages are kept, the memory opens into them, whole", async () => {
  const long = `开头。${"中间的话。".repeat(100)}最后那句才是重点：我不想再搬家了。`;
  message("msg_a", long);
  message("msg_b", "嗯，我记住了。", "assistant", "2026-10-06T10:01:00.000Z");
  memory("m1", "她不想再搬家了。", ["msg_a", "msg_b", "msg_gone"]);

  const { data } = (await readSource("m1")).structuredContent;
  assert.equal(data.memory, "她不想再搬家了。");
  assert.equal(data.source.kind, "messages");
  assert.deepEqual(data.source.messages.map((m: any) => m.id), ["msg_a", "msg_b"]);
  assert.equal(data.source.messages[0].content, long);
  assert.equal(data.source.missing, 1);
});

test("a very long original is cut in the middle with a marker, keeping head and tail", async () => {
  message("msg_long", `开头${"字".repeat(9000)}结尾`);
  memory("m1", "一条长消息里的事。", ["msg_long"]);
  const content = (await readSource("m1")).structuredContent.data.source.messages[0].content;
  assert.match(content, /^开头/);
  assert.match(content, /结尾$/);
  assert.match(content, /中间省略 \d+ 字/);
  assert.ok(content.length < 4100);
});

test("once the originals are gone, the diary that cited them is the source", async () => {
  diary("2026-09-18", "那天她说起搬家的事。", ["msg_x", "msg_y"]);
  diary("2026-09-19", "别的一天。", ["msg_z"]);
  memory("m1", "她不想再搬家了。", ["msg_y"]);

  const { source } = (await readSource("m1")).structuredContent.data;
  assert.equal(source.kind, "diary");
  assert.equal(source.date, "2026-09-18");
  assert.equal(source.matched_by, "diary_sources");
  assert.equal(source.summary, "那天她说起搬家的事。");
  assert.ok(source.disclaimer);
});

test("without a citing diary, the night that produced the memory names the day", async () => {
  // 9-21 晚上整理的是 9-19 的聊天，记忆的创建日期和候选日期都不是那一天。
  dreamRun("2026-09-19", "2026-09-21T20:10:15.000Z", "2026-09-21T20:12:26.000Z");
  dreamRun("2026-09-21", "2026-09-22T20:10:00.000Z", "2026-09-22T20:12:00.000Z");
  candidate("c1", "m1", "2026-09-21T20:12:12.000Z");
  diary("2026-09-19", "她那天很累，但还是把题刷完了。", ["msg_other"]);
  diary("2026-09-21", "不是这天。");
  memory("m1", "她累了也会把当天的题刷完。", ["msg_gone"], "2026-09-23T03:00:00.000Z");

  const { source } = (await readSource("m1")).structuredContent.data;
  assert.equal(source.kind, "diary");
  assert.equal(source.date, "2026-09-19");
  assert.equal(source.matched_by, "dream_night");
});

test("a day already rolled into its week falls back to the weekly entry", async () => {
  dreamRun("2026-09-16", "2026-09-16T20:11:00.000Z", "2026-09-16T20:14:00.000Z");
  candidate("c1", "m1", "2026-09-16T20:13:55.000Z");
  sqlite.prepare(`INSERT INTO weekly_log (namespace, week, start_date, end_date, title, summary, source_days, updated_at)
    VALUES ('default', '2026-W38', '2026-09-14', '2026-09-20', '搬家那周', '这周一直在收拾新家。', 5, '2026-09-21T00:00:00.000Z')`).run();
  memory("m1", "她九月中在收拾新家。", ["msg_gone"]);

  const { source } = (await readSource("m1")).structuredContent.data;
  assert.equal(source.kind, "week");
  assert.equal(source.week, "2026-W38");
  assert.equal(source.date, "2026-09-16");
  assert.equal(source.summary, "这周一直在收拾新家。");
});

test("memories with no sources, or none left anywhere, say so instead of guessing", async () => {
  memory("m-none", "直接记下的一句话。", []);
  memory("m-gone", "原文和日记都没了。", ["msg_gone"]);
  assert.deepEqual((await readSource("m-none")).structuredContent.data.source, { kind: "none", reason: "no_sources" });
  assert.deepEqual((await readSource("m-gone")).structuredContent.data.source, { kind: "none", reason: "sources_gone" });

  const missing = await readSource("m-nope");
  assert.equal(missing.isError, true);
  assert.match(missing.content[0].text, /Memory not found/);
});

test("a diary with malformed source ids does not break the lookup", async () => {
  sqlite.prepare(`INSERT INTO daily_log (namespace, date, title, summary, source_message_ids, updated_at)
    VALUES ('default', '2026-09-10', '坏数据', '……', 'not json', '2026-09-10T00:00:00.000Z')`).run();
  diary("2026-09-11", "对得上的那天。", ["msg_y"]);
  memory("m1", "对得上的事。", ["msg_y"]);
  assert.equal((await readSource("m1")).structuredContent.data.source.date, "2026-09-11");
});

test("read_diary still reads a day when no memory_id is given", async () => {
  diary("2026-09-18", "那天的日记。");
  const response = await worker.fetch(new Request("https://aelios.test/mcp", { method: "POST",
    headers: { authorization: "Bearer owner-key", "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call",
      params: { name: "read_diary", arguments: { date: "2026-09-18" } } }) }), env, { waitUntil() {} } as any);
  assert.equal((await response.json() as any).result.structuredContent.data.summary, "那天的日记。");
});

test("the admin diary list says how many cited originals are still kept", async () => {
  message("msg_kept", "还在的原文。");
  diary("2026-10-06", "最近的日记。", ["msg_kept", "msg_gone"]);
  diary("2026-09-01", "老日记。", ["msg_old"]);
  diary("2026-09-02", "坏数据。");
  sqlite.prepare("UPDATE daily_log SET source_message_ids = 'oops' WHERE date = '2026-09-02'").run();

  const kept = await countKeptDiarySources(db, { namespace: "default", startDate: "2026-09-01", endDate: "2026-10-06" });
  assert.equal(kept.get("2026-10-06"), 1);
  assert.equal(kept.get("2026-09-01"), undefined);

  const response = await worker.fetch(new Request("https://aelios.test/admin/diary?limit=30", {
    headers: { authorization: "Bearer owner-key" } }), env, { waitUntil() {} } as any);
  const { dailies } = (await response.json() as any).data;
  assert.deepEqual(dailies.map((d: any) => [d.date, d.sources_kept]),
    [["2026-10-06", 1], ["2026-09-02", 0], ["2026-09-01", 0]]);
});
