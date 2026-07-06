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
const searchSource = readFileSync(resolve(root, "src/memory/search.ts"), "utf8");
const digestSource = readFileSync(resolve(root, "src/memory/dailyDigest.ts"), "utf8");
const recallSource = readFileSync(resolve(root, "src/memory/v2/recall.ts"), "utf8");
const mcpSource = readFileSync(resolve(root, "src/api/mcp.ts"), "utf8");
const dreamExtractSource = readFileSync(resolve(root, "src/memory/dreamExtract.ts"), "utf8");
const indexSource = readFileSync(resolve(root, "src/index.ts"), "utf8");
const wranglerSource = readFileSync(resolve(root, "wrangler.toml"), "utf8");
const queueProducerSource = readFileSync(resolve(root, "src/queue/producer.ts"), "utf8");
const dbV2Source = readFileSync(resolve(root, "src/db/v2.ts"), "utf8");
const memoriesApiSource = readFileSync(resolve(root, "src/api/memories.ts"), "utf8");
const adminSource = readFileSync(resolve(root, "src/api/admin.ts"), "utf8");
const candidateJudgeSource = readFileSync(resolve(root, "src/memory/candidateJudge.ts"), "utf8");

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

assert.match(source, /type\?: string;\s+status\?: string;/);
assert.match(source, /options\?: \{ includeInactive\?: boolean \}/);
assert.match(source, /const hasFilter = Boolean\(input\.type \|\| input\.status\);/);
assert.match(source, /ids: data\.map\(\(record\) => record\.id\)/);
assert.match(source, /if \(input\.type && record\.type !== input\.type\) continue;/);
assert.match(source, /if \(input\.status && record\.status !== input\.status\) continue;/);

assert.match(searchSource, /function getLegacyFallbackLimit\(env: Env, topK: number\): number/);
assert.match(searchSource, /function getLegacyFallbackScoreFactor\(env: Env\): number/);
assert.match(searchSource, /const vectorTopK = Math\.min\(Math\.max\(input\.topK \* 3, input\.topK \+ legacyFallbackLimit\), 50\);/);
assert.match(searchSource, /function isRequireD1Backing\(env: Env\): boolean/);
assert.match(searchSource, /const legacySlots = requireD1Backing\s+\? 0\s+:\s+Math\.max\(0, Math\.min\(input\.topK - d1Records\.length, legacyFallbackLimit\)\);/s);
assert.match(searchSource, /const unbackedDropped = requireD1Backing \? legacyCandidates\.length : 0;/);
assert.match(searchSource, /if \(vectorOutcome\) \{\s+unbackedDropped = vectorOutcome\.unbackedDropped;\s+\}/s);
assert.match(searchSource, /score: record\.score \* getLegacyFallbackScoreFactor\(env\)/);
assert.match(searchSource, /\)\.slice\(0, input\.topK\);/);

assert.match(digestSource, /function shouldArchiveDreamDeletesToLongtail\(env: Env\): boolean \{\s+return readString\(env\.DREAM_ARCHIVE_DELETES_TO_LONGTAIL\) === "true";\s+\}/);
assert.match(digestSource, /async function queueImportantExcerptsForReview/);
assert.match(digestSource, /createMemoryCandidate\(env\.DB, \{/);
assert.match(digestSource, /source: "dream_excerpt"/);
assert.match(digestSource, /const archiveDeletesToLongtail = shouldArchiveDreamDeletesToLongtail\(env\);/);
assert.match(digestSource, /if \(archiveDeletesToLongtail\) \{\s+const lt = await createLongtail/s);
assert.match(digestSource, /async function selectDreamMemoryContext/);
assert.match(digestSource, /existingMemories = await selectDreamMemoryContext\(env, \{/);
assert.match(digestSource, /const results = await searchMemories\(env, \{/);
assert.match(digestSource, /const page = await listMemoriesPage\(env\.DB, \{/);
assert.match(digestSource, /modelResult\.reason !== "model_invalid_json" \|\| modelResult\.finishReason !== "length"/);
assert.match(digestSource, /messages = messages\.slice\(0, nextSize\);/);

assert.match(recallSource, /function readRecallMinScore\(env: Env, override\?: number\): number/);
assert.match(recallSource, /RECALL_MIN_SCORE \?\? 0\.15/);
assert.match(recallSource, /min_score\?: number;/);
assert.match(recallSource, /floored_ids: string\[\];\s+floored_count: number;\s+min_score: number;/);
assert.match(recallSource, /const minScore = readRecallMinScore\(env, input\.min_score\);/);
assert.match(recallSource, /const beforeFloor = \[\.\.\.afterDedup, \.\.\.longtailHits\]/);
assert.match(recallSource, /if \(hit\.score >= minScore\) return true;\s+flooredIds\.push\(hit\.id\);/s);
assert.match(recallSource, /floored_ids: flooredIds,\s+floored_count: flooredIds\.length,\s+min_score: minScore,/s);
assert.match(mcpSource, /min_score: \{ type: "number", minimum: 0, maximum: 1 \}/);
assert.match(mcpSource, /min_score: typeof args\.min_score === "number" \? readNumber\(args\.min_score, 0\.15\) : undefined/);
assert.match(wranglerSource, /crons = \["10 20 \* \* \*"\]/);
assert.match(wranglerSource, /DREAM_MODEL = "workers-ai\/@cf\/meta\/llama-3\.3-70b-instruct-fp8-fast"/);
assert.match(wranglerSource, /DEDUP_COSINE = "0\.9"/);
assert.match(indexSource, /handleDiaryApi\(request, env\)/);
assert.doesNotMatch(indexSource, /runMemoryExtractionBatches/);
assert.match(indexSource, /url\.pathname\.startsWith\("\/v1\/longtail\/"\)/);
assert.match(indexSource, /handleLongtailApi\(request, env\)/);
assert.match(queueProducerSource, /if \(isV2Enabled\(env\)\) return;/);
assert.match(dreamExtractSource, /const DEFAULT_WORKERS_AI_DREAM_MODEL = "workers-ai\/@cf\/meta\/llama-3\.3-70b-instruct-fp8-fast"/);
assert.match(dreamExtractSource, /export function buildDreamExtractPrompt/);
assert.match(dreamExtractSource, /export async function extractDreamMemoriesFromMessages/);
assert.match(digestSource, /source: "dream_extract"/);
assert.match(digestSource, /buildDreamRoutingPlan/);
assert.match(mcpSource, /name: "diary_get"/);
assert.match(mcpSource, /digest_set is deprecated in v3/);
assert.match(dbV2Source, /await db\.batch\(\[ensureLifecycle, markSeen\]\);/);
assert.match(dbV2Source, /export async function fetchLongtailByIds/);
assert.match(dbV2Source, /function candidateLongtailVectorIds/);
assert.match(dbV2Source, /export async function deleteLongtail/);
assert.match(dbV2Source, /deleteByIds\(\[\.\.\.new Set\(vectorIds\)\]\)/);
assert.match(dbV2Source, /DELETE FROM longtail WHERE namespace = \? AND id = \?/);
assert.match(recallSource, /fetchLongtailByIds/);
assert.match(recallSource, /const rowById = new Map\(rows\.map\(\(row\) => \[row\.id, row\]\)\);/);
assert.match(recallSource, /function candidateLongtailIds/);
assert.match(memoriesApiSource, /export async function handleLongtailApi/);
assert.match(memoriesApiSource, /const result = await deleteLongtail\(env, \{ namespace, id \}\);/);
assert.match(memoriesApiSource, /import \{ deleteVectorMemory \} from "\.\.\/memory\/vectorStore";/);
assert.match(memoriesApiSource, /source: "legacy_vectorize"/);
assert.match(adminSource, /\/v1\/longtail\/' \+ encodeURIComponent\(item\.id\)/);
assert.match(adminSource, /worldSelection: \{\}/);
assert.match(adminSource, /@click="selectAllWorldItems\(\)"/);
assert.match(adminSource, /@click="deleteSelectedWorldItems\(\)"/);
assert.match(adminSource, /:key="worldItemKey\(item\)"/);
assert.match(adminSource, /Promise\.allSettled\(batch\.map/);
assert.doesNotMatch(adminSource, /x-show="item\.type !== 'longtail'"/);
// Memory panel: fixed canonical tabs + 全部 for legacy cleanup, and manual creation.
assert.match(adminSource, /get memoryTypes\(\)/);
assert.match(adminSource, /return \['all'\]\.concat\(this\.canonicalMemoryTypes\)/);
assert.match(adminSource, /memoryTypeLabel\(type\)/);
assert.match(adminSource, /memoryType && this\.memoryType !== 'all'/);
assert.match(adminSource, /if \(type === 'all'\)/);
assert.match(adminSource, /openMemoryCreate\(\)/);
assert.match(adminSource, /async createMemory\(\)/);
assert.match(adminSource, /'\/v1\/memories'\), \{\s+method: 'POST'/s);
assert.match(adminSource, /await crypto\.subtle\.digest\('SHA-1', data\)/);
// Types are enforced at the write boundary — no free-form types allowed.
assert.match(extractSource, /import \{ clampMemoryType \} from "\.\/canonicalTypes"/);
assert.match(extractSource, /type: clampMemoryType\(readString\(raw\.type\)\)/);
assert.match(extractSource, /type 只能从这 8 个里选/);
assert.match(extractSource, /type: "fact"/);
assert.match(dbV2Source, /import \{ clampMemoryType \} from "\.\.\/memory\/canonicalTypes"/);
assert.match(dbV2Source, /clampMemoryType\(input\.type, "note"\)/);
assert.match(dbV2Source, /clampMemoryType\(input\.type, "fact"\)/);
assert.match(dbV2Source, /clampMemoryType\(input\.newType, "fact"\)/);
assert.match(source, /import \{ clampMemoryType \} from "\.\/canonicalTypes"/);
assert.match(source, /type: clampMemoryType\(input\.type, "note"\),/);
assert.match(memoriesApiSource, /clampMemoryType\(readString\(body\.type\), "note"\)/);
assert.match(memoriesApiSource, /clampMemoryType\(readString\(body\.type\) \|\| candidate\.type, "note"\)/);
assert.match(digestSource, /memories_to_update 里的 type 只能从这 8 个里选/);
assert.doesNotMatch(extractSource, /type: "project"/);
assert.doesNotMatch(dbV2Source, /input\.newType \?\? "world_fact"/);
assert.match(digestSource, /v2 首次抽取由每 4 小时 extractor 负责/);
assert.doesNotMatch(digestSource, /for \(const memory of digest\.memories_to_add \?\? \[\]\) \{\s+const factKey/s);
assert.doesNotMatch(digestSource, /added \+= 0/);
assert.match(candidateJudgeSource, /judgeResult\.score >= approveMin && judgeResult\.grounded && judgeResult\.durable/);
assert.match(candidateJudgeSource, /judgeResult\.score <= discardMax \|\| !judgeResult\.grounded \|\| !judgeResult\.durable/);

console.log("verify-vector-memory-write: all checks passed");
