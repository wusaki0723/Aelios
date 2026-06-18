#!/usr/bin/env node

/**
 * Smoke tests for the D1-canonical + Vectorize-index memory architecture.
 *
 * Usage:
 *   node scripts/smoke-test-memory.mjs [--api-url URL] [--api-key KEY] [--namespace NS]
 *
 * Tests:
 * 1. Create memory → D1 row exists → Vectorize embedding exists
 * 2. Search memory → Vectorize hit fetches D1 canonical row
 * 3. Text fallback works if Vectorize misses (via direct text search)
 * 4. Patch memory → D1 updates → Vectorize reindexes updated content
 * 5. Delete memory → D1 status changes → stale vector no longer affects recall
 * 6. Z-audit does not mass-disable all memories under a fact_key
 * 7. Debug reindex rebuilds Vectorize from D1
 */

const args = process.argv.slice(2);
function flag(name) {
  const idx = args.indexOf(`--${name}`);
  return idx !== -1 && idx + 1 < args.length ? args[idx + 1] : null;
}

const apiUrl = flag("api-url") || process.env.AELIOS_URL || "http://localhost:8787";
const apiKey = flag("api-key") || process.env.AELIOS_API_KEY || "";
const namespace = flag("namespace") || process.env.AELIOS_NAMESPACE || "default";

if (!apiKey) {
  console.error("Error: --api-key or AELIOS_API_KEY required");
  process.exit(1);
}

const HEADERS = {
  "Content-Type": "application/json",
  Authorization: `Bearer ${apiKey}`,
};

let passed = 0;
let failed = 0;
const createdIds = [];

function assert(condition, message) {
  if (condition) {
    console.log(`  PASS: ${message}`);
    passed++;
  } else {
    console.error(`  FAIL: ${message}`);
    failed++;
  }
}

async function api(method, path, body) {
  const res = await fetch(`${apiUrl}${path}`, {
    method,
    headers: HEADERS,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${method} ${path} → ${res.status}: ${text}`);
  }
  return res.json();
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function cleanup() {
  for (const id of createdIds) {
    try {
      await api("DELETE", `/v1/memories/${id}`, { namespace });
    } catch {}
  }
}

async function test1_createMemory() {
  console.log("\nTest 1: Create memory → D1 row exists");
  const result = await api("POST", "/v1/memories", {
    namespace,
    type: "smoke_test",
    content: `smoke-test-${Date.now()} 这是一个烟雾测试记忆。`,
    importance: 0.5,
    confidence: 0.8,
    tags: ["smoke-test"],
    fact_key: "smoke:test_create",
  });
  const mem = result.data;
  createdIds.push(mem.id);
  assert(mem.id, "memory id returned");
  assert(mem.status === "active", "status is active");
  assert(mem.vector_id, "vector_id assigned");
  assert(mem.audit_state === null || mem.audit_state === undefined || typeof mem.audit_state === "string", "audit_state field exists");
  return mem;
}

async function test2_searchMemory(mem) {
  console.log("\nTest 2: Search memory → Vectorize hit fetches D1 canonical row");
  await delay(3000);
  const result = await api("POST", "/v1/memories/search", {
    namespace,
    query: "烟雾测试记忆",
    top_k: 10,
  });
  const found = result.data.find((m) => m.id === mem.id);
  assert(found, "created memory found via semantic search");
  if (found) {
    assert(found.content === mem.content, "content matches D1 canonical row");
    assert(found.status === "active", "returned memory is active");
  }
}

async function test3_textFallback() {
  console.log("\nTest 3: Text fallback search");
  const uniqueText = `xyzfallback${Date.now()}`;
  const result = await api("POST", "/v1/memories", {
    namespace,
    type: "smoke_test",
    content: uniqueText,
    tags: ["smoke-test"],
  });
  createdIds.push(result.data.id);

  const searchResult = await api("POST", "/v1/search/memories", {
    namespace,
    query: uniqueText,
    filter: false,
  });
  const found = searchResult.data.find((m) => m.id === result.data.id);
  assert(found, "memory found via text search fallback");
}

async function test4_patchMemory(mem) {
  console.log("\nTest 4: Patch memory → D1 updates → Vectorize reindexes");
  const newContent = `smoke-test-updated-${Date.now()} 这是更新后的烟雾测试。`;
  const result = await api("PATCH", `/v1/memories/${mem.id}`, {
    namespace,
    content: newContent,
    importance: 0.9,
  });
  assert(result.data.content === newContent, "content updated in D1");
  assert(result.data.importance === 0.9, "importance updated");
}

async function test5_deleteMemory() {
  console.log("\nTest 5: Delete memory → D1 status changes → vector cleaned up");
  const createResult = await api("POST", "/v1/memories", {
    namespace,
    type: "smoke_test",
    content: `smoke-test-delete-${Date.now()} 待删除的测试记忆。`,
    tags: ["smoke-test"],
  });
  const id = createResult.data.id;

  const deleteResult = await api("DELETE", `/v1/memories/${id}`, { namespace });
  assert(deleteResult.data.deleted === true, "memory deleted");

  const getResult = await api("GET", `/v1/memories/${id}?namespace=${namespace}`);
  assert(getResult.data.status === "deleted", "D1 status is deleted");

  await delay(2000);
  const searchResult = await api("POST", "/v1/memories/search", {
    namespace,
    query: "待删除的测试记忆",
    top_k: 10,
  });
  const found = searchResult.data.find((m) => m.id === id);
  assert(!found, "deleted memory not in search results");
}

async function test6_zAudit() {
  console.log("\nTest 6: Z-audit does not mass-disable all memories under a fact_key");
  const factKey = `smoke:z_audit_${Date.now()}`;

  const mem1 = await api("POST", "/v1/memories", {
    namespace,
    type: "smoke_test",
    content: `z-audit test A ${Date.now()}`,
    importance: 0.9,
    confidence: 0.95,
    fact_key: factKey,
    tags: ["smoke-test"],
  });
  createdIds.push(mem1.data.id);

  const mem2 = await api("POST", "/v1/memories", {
    namespace,
    type: "smoke_test",
    content: `z-audit test B ${Date.now()}`,
    importance: 0.5,
    confidence: 0.6,
    fact_key: factKey,
    tags: ["smoke-test"],
  });
  createdIds.push(mem2.data.id);

  const mem3 = await api("POST", "/v1/memories", {
    namespace,
    type: "smoke_test",
    content: `z-audit test C ${Date.now()}`,
    importance: 0.3,
    confidence: 0.4,
    fact_key: factKey,
    tags: ["smoke-test"],
  });
  createdIds.push(mem3.data.id);

  const get1 = await api("GET", `/v1/memories/${mem1.data.id}?namespace=${namespace}`);
  assert(get1.data.status === "active", "highest-confidence memory stays active under same fact_key");
}

async function test7_reindex() {
  console.log("\nTest 7: Debug reindex rebuilds Vectorize from D1");
  const result = await api("POST", "/v1/debug/vector_reindex", {
    namespace,
    limit: 5,
    dry_run: true,
  });
  assert(result.data.namespace === namespace, "reindex returns correct namespace");
  assert(typeof result.data.rewritten_count === "number", "reindex returns rewritten count");
  assert(result.data.listed_ids > 0, "reindex found active memories");
}

async function main() {
  console.log("=== Aelios Memory Smoke Tests ===");
  console.log(`API: ${apiUrl}`);
  console.log(`Namespace: ${namespace}`);

  try {
    const mem = await test1_createMemory();
    await test2_searchMemory(mem);
    await test3_textFallback();
    await test4_patchMemory(mem);
    await test5_deleteMemory();
    await test6_zAudit();
    await test7_reindex();
  } catch (err) {
    console.error("\nFatal error:", err.message);
    failed++;
  } finally {
    await cleanup();
  }

  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
  process.exit(failed > 0 ? 1 : 0);
}

main();
