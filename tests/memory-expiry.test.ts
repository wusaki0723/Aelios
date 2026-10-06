import { strict as assert } from "node:assert";
import { test, beforeEach } from "node:test";
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { expireOldMemories } from "../src/db/retention";

// The 180-day expiry: a memory that keeps being recalled is still in use, even if
// nobody has rewritten it.
let sqlite: DatabaseSync;
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
});

const OLD = "2026-01-01T00:00:00.000Z";
const CUTOFF = "2026-04-01T00:00:00.000Z";
const RECENT = "2026-09-30T00:00:00.000Z";

function memory(id: string, extra: { updated?: string; pinned?: number; type?: string; namespace?: string } = {}) {
  sqlite.prepare(`INSERT INTO memories (id, namespace, type, content, importance, confidence, status, pinned, tags, source,
    source_message_ids, vector_id, created_at, updated_at)
    VALUES (?, ?, ?, ?, 0.6, 0.8, 'active', ?, '[]', 'dream', '[]', ?, ?, ?)`)
    .run(id, extra.namespace ?? "default", extra.type ?? "fact", `content of ${id}`, extra.pinned ?? 0, `vec_${id}`,
      OLD, extra.updated ?? OLD);
}
function lifecycle(id: string, fields: { injected?: string | null; seen?: string | null }) {
  sqlite.prepare(`INSERT INTO memory_lifecycle (memory_id, namespace, seen_count, last_seen_at, last_injected_at)
    VALUES (?, 'default', 0, ?, ?)`).run(id, fields.seen ?? null, fields.injected ?? null);
}
const status = (id: string) => (sqlite.prepare("SELECT status FROM memories WHERE id = ?").get(id) as any).status;

test("a memory recalled after the cutoff stays active even if never rewritten", async () => {
  memory("recalled");
  lifecycle("recalled", { injected: RECENT });
  memory("forgotten");
  lifecycle("forgotten", { injected: OLD });

  const result = await expireOldMemories(db, "default", CUTOFF);

  assert.deepEqual(result.expired.map((m) => m.id), ["forgotten"]);
  assert.equal(result.count, 1);
  assert.equal(status("recalled"), "active");
  assert.equal(status("forgotten"), "expired");
});

test("seen again after the cutoff also keeps a memory", async () => {
  memory("seen");
  lifecycle("seen", { seen: RECENT });

  const result = await expireOldMemories(db, "default", CUTOFF);

  assert.equal(result.count, 0);
  assert.equal(status("seen"), "active");
});

test("memories without a lifecycle row still expire on updated_at alone", async () => {
  memory("v1-old");
  memory("v1-fresh", { updated: RECENT });

  const result = await expireOldMemories(db, "default", CUTOFF);

  assert.deepEqual(result.expired.map((m) => [m.id, m.vector_id]), [["v1-old", "vec_v1-old"]]);
  assert.equal(status("v1-fresh"), "active");
});

test("pinned, identity and persona memories and other namespaces are left alone", async () => {
  memory("pinned", { pinned: 1 });
  memory("identity", { type: "identity" });
  memory("persona", { type: "persona" });
  memory("elsewhere", { namespace: "other" });

  const result = await expireOldMemories(db, "default", CUTOFF);

  assert.equal(result.count, 0);
  for (const id of ["pinned", "identity", "persona", "elsewhere"]) assert.equal(status(id), "active");
});

test("expiring more memories than one SQL batch marks every one of them", async () => {
  for (let i = 0; i < 200; i++) memory(`bulk-${i}`);

  const result = await expireOldMemories(db, "default", CUTOFF);

  assert.equal(result.count, 200);
  const left = sqlite.prepare("SELECT COUNT(*) AS n FROM memories WHERE status = 'active'").get() as any;
  assert.equal(left.n, 0);
});
