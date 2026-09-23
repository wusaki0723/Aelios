import { strict as assert } from "node:assert";
import { test, beforeEach } from "node:test";
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { timingSafeEqual } from "node:crypto";
import worker from "../src/index";
import { KEY_PROFILES } from "../src/config/keyProfiles";
import { resolveNamespace } from "../src/utils/request";

// The admin panel switches assistants by sending ?namespace=; the owner key must honour it,
// narrower keys stay pinned to their profile namespace.
(crypto.subtle as any).timingSafeEqual = (a: Uint8Array, b: Uint8Array) => timingSafeEqual(a, b);
let sqlite: DatabaseSync;
let env: any;
let deletedVectors: string[];

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
  deletedVectors = [];
  env = {
    DB: db, CHATBOX_API_KEY: "owner-key", MEMORY_MCP_API_KEY: "mcp-key",
    VECTORIZE: {
      async deleteByIds(ids: string[]) { deletedVectors.push(...ids); return { mutationId: "m" }; },
      async upsert() { return { mutationId: "m" }; }
    }
  };
  insertMemory("mem_00000000000000000000000000000001", "default", "旦九的记忆");
  insertMemory("mem_00000000000000000000000000000002", "wangshu", "望舒的记忆");
  insertMemory("mem_00000000000000000000000000000003", "zhilai", "知来的记忆");
  sqlite.prepare(
    `INSERT INTO memory_candidates (id, namespace, content, status, created_at, updated_at)
     VALUES ('cand_wangshu', 'wangshu', '望舒的候选', 'pending', '2026-09-22T00:00:00Z', '2026-09-22T00:00:00Z')`
  ).run();
});

function insertMemory(id: string, namespace: string, content: string): void {
  sqlite.prepare(
    `INSERT INTO memories (id, namespace, type, content, status, tags, source_message_ids, vector_id, created_at, updated_at)
     VALUES (?, ?, 'note', ?, 'active', '[]', '[]', ?, '2026-09-22T00:00:00Z', '2026-09-22T00:00:00Z')`
  ).run(id, namespace, content, `mem_${id}`);
}

function call(path: string, key = "owner-key", init: RequestInit = {}) {
  return worker.fetch(new Request(`https://aelios.test${path}`, {
    ...init, headers: { authorization: `Bearer ${key}` }
  }), env, { waitUntil() {} } as any);
}

test("owner and debug keys may choose a namespace; narrower keys stay pinned", () => {
  assert.equal(resolveNamespace(KEY_PROFILES.chatbox, "wangshu"), "wangshu");
  assert.equal(resolveNamespace(KEY_PROFILES.debug, "wangshu"), "wangshu");
  assert.equal(resolveNamespace(KEY_PROFILES.chatbox, ""), "default");
  for (const profile of [KEY_PROFILES.im, KEY_PROFILES.mcp, KEY_PROFILES.guideDog]) {
    assert.equal(resolveNamespace(profile, "wangshu"), "default");
  }
});

test("owner key lists each assistant's memories and candidates by namespace", async () => {
  const wangshu = await (await call("/v1/memory?namespace=wangshu&status=active")).json() as any;
  assert.deepEqual(wangshu.data.map((m: any) => m.content), ["望舒的记忆"]);
  const zhilai = await (await call("/v1/memory?namespace=zhilai&status=active")).json() as any;
  assert.deepEqual(zhilai.data.map((m: any) => m.content), ["知来的记忆"]);
  const fallback = await (await call("/v1/memory?status=active")).json() as any;
  assert.deepEqual(fallback.data.map((m: any) => m.content), ["旦九的记忆"]);

  const candidates = await (await call("/v1/candidates?namespace=wangshu&status=pending")).json() as any;
  assert.deepEqual(candidates.data.map((c: any) => c.id), ["cand_wangshu"]);
});

test("owner key reads and deletes a memory inside the chosen namespace only", async () => {
  const id = "mem_00000000000000000000000000000002";
  assert.equal((await call(`/v1/memory/${id}`)).status, 404);
  const got = await (await call(`/v1/memory/${id}?namespace=wangshu`)).json() as any;
  assert.equal(got.data.content, "望舒的记忆");

  const deleted = await call(`/v1/memory/${id}?namespace=wangshu`, "owner-key", { method: "DELETE" });
  assert.equal(deleted.status, 200);
  const row = sqlite.prepare("SELECT status FROM memories WHERE id = ?").get(id) as { status: string };
  assert.equal(row.status, "deleted");
  assert.deepEqual(deletedVectors, [`mem_${id}`]);
});

test("the MCP key cannot reach another assistant's namespace", async () => {
  const pinned = await (await call("/v1/memory?namespace=wangshu&status=active", "mcp-key")).json() as any;
  assert.deepEqual(pinned.data.map((m: any) => m.content), ["旦九的记忆"]);
  assert.equal((await call("/v1/memory/mem_00000000000000000000000000000002?namespace=wangshu", "mcp-key")).status, 404);
});
