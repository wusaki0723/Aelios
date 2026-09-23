import { strict as assert } from "node:assert";
import { test, beforeEach } from "node:test";
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { timingSafeEqual } from "node:crypto";
import worker from "../src/index";
import { upsertMemoryEmbedding } from "../src/memory/embedding";
import { runVectorBackfill } from "../src/memory/vectorBackfill";
import type { MemoryRecord } from "../src/types";

// Real migrations in node:sqlite, an in-memory Vectorize double, and a Workers AI
// embedding double — same approach as gateway.test.ts.
(crypto.subtle as any).timingSafeEqual = (a: Uint8Array, b: Uint8Array) => timingSafeEqual(a, b);
let sqlite: DatabaseSync;
let env: any;
let vectors: Map<string, { id: string; values: number[]; metadata: Record<string, unknown> }>;
let getByIdsCalls: string[][];
let embedCalls: number;
let failGetByIds: (ids: string[]) => boolean;

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
  } };
  vectors = new Map(); getByIdsCalls = []; embedCalls = 0; failGetByIds = () => false;
  env = {
    DB: db, CHATBOX_API_KEY: "owner-key",
    AI: { async run(_model: string, data: any) { embedCalls += 1; return { data: [[0.1, 0.2, data.text[0].length]] }; } },
    VECTORIZE: {
      async getByIds(ids: string[]) {
        getByIdsCalls.push(ids);
        if (ids.length > 20) throw new Error("getByIds batch over platform cap");
        if (failGetByIds(ids)) throw new Error("vectorize unavailable");
        return ids.flatMap((id) => vectors.has(id) ? [vectors.get(id)] : []);
      },
      async upsert(items: any[]) { for (const item of items) vectors.set(item.id, item); return { mutationId: "m" }; }
    }
  };
});

let seq = 0;
function insertMemory(overrides: Partial<MemoryRecord> = {}): MemoryRecord {
  seq += 1;
  const id = overrides.id ?? `mem_${String(seq).padStart(32, "0")}`;
  const row = {
    id, namespace: "default", type: "note", content: `记忆 ${seq}`, summary: null, importance: 0.5,
    confidence: 0.8, status: "active", pinned: 0, tags: "[]", source: "review", source_message_ids: "[]",
    vector_id: `mem_${id}`, created_at: `2026-09-22T00:00:${String(seq % 60).padStart(2, "0")}Z`,
    updated_at: "2026-09-22T00:00:00Z", expires_at: null, ...overrides
  };
  sqlite.prepare(
    `INSERT INTO memories (id, namespace, type, content, summary, importance, confidence, status, pinned,
       tags, source, source_message_ids, vector_id, created_at, updated_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(row.id, row.namespace, row.type, row.content, row.summary, row.importance, row.confidence, row.status,
    row.pinned, row.tags, row.source, row.source_message_ids, row.vector_id, row.created_at, row.updated_at,
    row.expires_at);
  return sqlite.prepare("SELECT * FROM memories WHERE id = ?").get(row.id) as unknown as MemoryRecord;
}

async function embedNormally(memory: MemoryRecord) {
  assert.equal(await upsertMemoryEmbedding(env, memory), true);
}

test("dry run finds active memories whose vector is missing and touches nothing", async () => {
  const synced = insertMemory();
  await embedNormally(synced);
  const sqlOnly = insertMemory({ content: "直接写进 D1 的记忆" });
  insertMemory({ status: "archived" });
  insertMemory({ namespace: "other" });
  embedCalls = 0;

  const report = await runVectorBackfill(env, { namespace: "default" });

  assert.equal(report.dry_run, true);
  assert.equal(report.active_memories, 2);
  assert.deepEqual(report.counts, { ok: 1, missing: 1, stale: 0, no_vector_id: 0 });
  assert.deepEqual(report.samples.missing.map((s) => s.id), [sqlOnly.id]);
  assert.equal(report.repair, undefined);
  assert.equal(embedCalls, 0);
  assert.equal(vectors.has(sqlOnly.vector_id as string), false);
});

test("repair writes the missing vector with the same id and metadata as the normal write path", async () => {
  const memory = insertMemory({ content: "代批的记忆", tags: "[\"review\"]" });

  const report = await runVectorBackfill(env, { namespace: "default", dryRun: false });

  assert.deepEqual(report.repair, { attempted: 1, repaired: 1, failed_count: 0, failed: [], remaining: 0 });
  const written = vectors.get(`mem_${memory.id}`);
  assert.ok(written, "vector id follows the mem_ + memory id convention");
  assert.equal(written.metadata.ref_id, memory.id);
  assert.equal(written.metadata.content, "代批的记忆");
  assert.equal(written.metadata.namespace, "default");

  const again = await runVectorBackfill(env, { namespace: "default" });
  assert.deepEqual(again.counts, { ok: 1, missing: 0, stale: 0, no_vector_id: 0 });
});

test("stale vectors whose content drifted from D1 are found and refreshed after missing ones", async () => {
  const edited = insertMemory({ content: "旧内容" });
  await embedNormally(edited);
  sqlite.prepare("UPDATE memories SET content = '新内容' WHERE id = ?").run(edited.id);
  const missing = insertMemory();

  const dry = await runVectorBackfill(env, { namespace: "default" });
  assert.deepEqual(dry.counts, { ok: 0, missing: 1, stale: 1, no_vector_id: 0 });
  assert.equal(dry.samples.stale[0].reason, "content");

  const report = await runVectorBackfill(env, { namespace: "default", dryRun: false, limit: 1 });
  assert.deepEqual(report.repair, { attempted: 1, repaired: 1, failed_count: 0, failed: [], remaining: 1 });
  assert.ok(vectors.has(`mem_${missing.id}`), "missing vectors are repaired before stale ones");
  assert.equal(vectors.get(`mem_${edited.id}`)?.metadata.content, "旧内容");

  await runVectorBackfill(env, { namespace: "default", dryRun: false });
  assert.equal(vectors.get(`mem_${edited.id}`)?.metadata.content, "新内容");
});

test("checks Vectorize in batches of at most 20 and never counts a failed batch as missing", async () => {
  for (let i = 0; i < 45; i += 1) insertMemory();
  let calls = 0;
  failGetByIds = () => { calls += 1; return calls === 2; };

  const report = await runVectorBackfill(env, { namespace: "default", dryRun: false, limit: 200 });

  assert.deepEqual(getByIdsCalls.map((ids) => ids.length), [20, 20, 5]);
  assert.equal(report.unchecked, 20);
  assert.equal(report.counts.missing, 25);
  assert.equal(report.repair?.attempted, 25);
  assert.match(report.errors[0], /getbyids_failed/);
});

test("embedding failures are reported and stay in remaining", async () => {
  insertMemory();
  env.AI = { async run() { throw new Error("workers ai down"); } };

  const report = await runVectorBackfill(env, { namespace: "default", dryRun: false });

  assert.equal(report.repair?.repaired, 0);
  assert.equal(report.repair?.failed[0].error, "embedding_failed");
  assert.equal(report.repair?.remaining, 1);
});

test("memories without a vector_id are reported but D1 is never written", async () => {
  const memory = insertMemory({ vector_id: null });

  const report = await runVectorBackfill(env, { namespace: "default", dryRun: false });

  assert.deepEqual(report.samples.no_vector_id.map((s) => s.id), [memory.id]);
  assert.equal(report.repair?.attempted, 0);
  const row = sqlite.prepare("SELECT vector_id FROM memories WHERE id = ?").get(memory.id) as { vector_id: string | null };
  assert.equal(row.vector_id, null);
});

test("POST /v1/vector-backfill defaults to dry run and repairs only when dry_run is false", async () => {
  const memory = insertMemory();
  const call = (body: unknown) => worker.fetch(new Request("https://aelios.test/v1/vector-backfill", {
    method: "POST",
    headers: { authorization: "Bearer owner-key", "content-type": "application/json" },
    body: JSON.stringify(body)
  }), env, { waitUntil() {} } as any);

  const unauthorized = await worker.fetch(new Request("https://aelios.test/v1/vector-backfill", {
    method: "POST", headers: { authorization: "Bearer nope" }, body: "{}"
  }), env, { waitUntil() {} } as any);
  assert.equal(unauthorized.status, 401);

  const dry = await (await call({ namespace: "default" })).json() as any;
  assert.equal(dry.data.dry_run, true);
  assert.equal(dry.data.counts.missing, 1);
  assert.equal(vectors.size, 0);

  const fixed = await (await call({ namespace: "default", dry_run: false })).json() as any;
  assert.equal(fixed.ok, true);
  assert.equal(fixed.data.repair.repaired, 1);
  assert.ok(vectors.has(`mem_${memory.id}`));
});

test("metadata written by older paths is not flagged stale for formatting differences", async () => {
  const memory = insertMemory({ tags: "[\"a\", \"b\"]" });
  vectors.set(`mem_${memory.id}`, {
    id: `mem_${memory.id}`, values: [0.1],
    metadata: { ref_id: memory.id, content: memory.content, type: memory.type, tags: "[\"a\",\"b\"]" }
  });

  const report = await runVectorBackfill(env, { namespace: "default" });

  assert.deepEqual(report.counts, { ok: 1, missing: 0, stale: 0, no_vector_id: 0 });
});
