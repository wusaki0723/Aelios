#!/usr/bin/env node
/**
 * Contract test for src/memory/vectorStore.ts D1/Vectorize consistency.
 *
 * Vector memory writes must update D1 first, create the lifecycle sidecar row
 * when v2 is enabled, and only then mirror the record into Vectorize. This
 * prevents Vectorize-only orphan memories and stale D1 rows from reappearing.
 *
 * Run:  node scripts/verify-vector-memory-write.mjs
 * Exit 0 = all checks passed, exit 1 = failure.
 */

import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = readFileSync(resolve(root, "src/memory/vectorStore.ts"), "utf8");

function indexOfOrThrow(haystack, needle) {
  const index = haystack.indexOf(needle);
  assert.notEqual(index, -1, `Expected source to contain: ${needle}`);
  return index;
}

const createStart = indexOfOrThrow(source, "export async function createVectorMemory");
const getStart = indexOfOrThrow(source, "export async function getVectorMemory");
const deleteStart = indexOfOrThrow(source, "export async function deleteVectorMemory");
const updateStart = indexOfOrThrow(source, "export async function updateVectorMemory");
const searchStart = indexOfOrThrow(source, "export async function searchVectorMemories");
const createBody = source.slice(createStart, getStart);
const getBody = source.slice(getStart, deleteStart);
const deleteBody = source.slice(deleteStart, updateStart);
const updateBody = source.slice(updateStart, searchStart);

assert.match(source, /function\s+isLifecycleEnabled\(env: Env\): boolean \{\s*return env\.MEMORY_LIFECYCLE_ENABLED !== "false";\s*\}/s);
assert.match(source, /INSERT INTO memories \(/);
assert.match(source, /INSERT OR IGNORE INTO memory_lifecycle \(/);
assert.match(source, /await env\.DB\.batch\(\[memoryInsert, lifecycleInsert\]\);/);
assert.match(source, /UPDATE memories SET\s+type = \?, content = \?, summary = \?, importance = \?, confidence = \?, status = \?,/s);
assert.match(source, /UPDATE memories SET status = 'deleted', updated_at = \? WHERE namespace = \? AND id = \?/);

const d1Insert = indexOfOrThrow(createBody, "await insertMemoryRecord(env, record);");
const vectorUpsert = indexOfOrThrow(createBody, "await requireVectorize(env).upsert");
assert.ok(d1Insert < vectorUpsert, "createVectorMemory must write D1 before Vectorize");

assert.match(createBody, /catch \(error\) \{\s*console\.error\("memory vector upsert failed after D1 insert", \{ id, error \}\);\s*\}/s);
assert.match(createBody, /return memoryRecordToApiRecord\(record\);/);
assert.match(getBody, /const d1Record = await getMemoryRecordById\(env, id\);\s*return d1Record \? memoryRecordToApiRecord\(d1Record\) : null;/s);

const d1Delete = indexOfOrThrow(deleteBody, "await markMemoryRecordDeleted(env,");
const vectorDelete = indexOfOrThrow(deleteBody, "await requireVectorize(env).deleteByIds");
assert.ok(d1Delete < vectorDelete, "deleteVectorMemory must mark D1 deleted before Vectorize delete");
assert.match(deleteBody, /console\.error\("memory vector delete failed after D1 delete", \{ id, error \}\);/);

const d1Update = indexOfOrThrow(updateBody, "const updatedRecord = await updateMemoryRecord(env, nextRecord);");
const updateVectorUpsert = indexOfOrThrow(updateBody, "await requireVectorize(env).upsert");
assert.ok(d1Update < updateVectorUpsert, "updateVectorMemory must update D1 before Vectorize upsert");
assert.match(updateBody, /console\.error\("memory vector upsert failed after D1 update", \{ id: next\.id, error \}\);/);
assert.match(updateBody, /return memoryRecordToApiRecord\(updatedRecord\);/);

console.log("verify-vector-memory-write: all checks passed");
