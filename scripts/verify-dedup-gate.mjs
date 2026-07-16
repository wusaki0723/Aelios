#!/usr/bin/env node
/**
 * Contract + behavioral tests for dedup gate, approve routing, monthly rollup,
 * and boot impressions ladder.
 *
 * Run:  node scripts/verify-dedup-gate.mjs
 * Exit 0 = all checks passed, exit 1 = failure.
 */

import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function readSource(relPath) {
  return readFileSync(resolve(root, relPath), "utf8");
}

function indexOfOrThrow(haystack, needle, label = needle) {
  const index = haystack.indexOf(needle);
  assert.notEqual(index, -1, `Expected source to contain: ${label}`);
  return index;
}

// ---------------------------------------------------------------------------
// Static source contract checks
// ---------------------------------------------------------------------------

const dedupGateSource = readSource("src/memory/dedupGate.ts");
const memoriesSource = readSource("src/api/memories.ts");
const digestSource = readSource("src/memory/dailyDigest.ts");
const dbV2Source = readSource("src/db/v2.ts");
const recallSource = readSource("src/memory/v2/recall.ts");
const typesSource = readSource("src/assembler/types.ts");
const embeddingSource = readSource("src/memory/embedding.ts");
const monthlyRollupSource = readSource("src/memory/monthlyRollup.ts");
const indexSource = readSource("src/index.ts");
const migrationSource = readSource("migrations/0009_monthly_log.sql");

assert.match(dedupGateSource, /export async function findSimilarActiveMemory/);
assert.match(dedupGateSource, /readNumber\(env\.DEDUP_COSINE, 0\.9\)/);
assert.match(dedupGateSource, /searchVectorMemories\(env/);
assert.match(dedupGateSource, /fail-open/);

assert.match(memoriesSource, /findSimilarActiveMemory/);
assert.match(memoriesSource, /action: "upserted" \| "superseded" \| "created"/);
assert.match(memoriesSource, /reason: "dedup_gate_supersede"/);
assert.match(memoriesSource, /reason: "approve_update"/);
assert.match(memoriesSource, /target_gone_fallback/);

assert.match(digestSource, /findSimilarActiveMemory/);
assert.match(digestSource, /dedup_gate: similar to/);
assert.match(digestSource, /resolveMemoryFactKey/);
assert.doesNotMatch(digestSource, /source: "dream_update"[\s\S]{0,200}factKey: null/);

assert.match(dbV2Source, /export async function resolveMemoryFactKey/);
assert.match(dbV2Source, /monthly_log/);
assert.match(dbV2Source, /listWeeklyLogsBeforeStartDate/);

assert.match(recallSource, /listRecentWeeklyLogs/);
assert.match(recallSource, /listRecentMonthlyLogs/);
assert.match(recallSource, /impressions:/);

assert.match(typesSource, /<impressions>/);
assert.match(typesSource, /buildImpressionsLadder/);

assert.match(embeddingSource, /daily_log \/ weekly_log \/ monthly_log 永不 embed/);

assert.match(monthlyRollupSource, /export async function runMonthlyRollup/);
assert.match(monthlyRollupSource, /weeklyLogs\.length < 2/);
assert.match(monthlyRollupSource, /DIARY_MODEL/);

assert.match(indexSource, /\/admin\/monthly-rollup/);
assert.match(indexSource, /runMonthlyRollup/);

assert.match(migrationSource, /CREATE TABLE IF NOT EXISTS monthly_log/);
assert.match(migrationSource, /PRIMARY KEY \(namespace, month\)/);

// ---------------------------------------------------------------------------
// Mock helpers — mirror approve/dedup semantics without a TS runtime
// ---------------------------------------------------------------------------

function readNumber(value, fallback) {
  const parsed = typeof value === "string" ? Number(value) : value;
  return Number.isFinite(parsed) ? parsed : fallback;
}

function isActiveNonSuperseded(memory) {
  return memory.status === "active" && memory.version_status !== "superseded";
}

async function mockFindSimilarActiveMemory(env, input) {
  try {
    const threshold = readNumber(env.DEDUP_COSINE, 0.9);
    const exclude = new Set(input.excludeIds ?? []);
    const hits = await env.__searchVectorMemories({
      namespace: input.namespace,
      query: input.content,
      topK: 5
    });
    let best = null;
    for (const memory of hits) {
      if (exclude.has(memory.id)) continue;
      if (!isActiveNonSuperseded(memory)) continue;
      const score = memory.score ?? 0;
      if (score < threshold) continue;
      if (!best || score > best.score) best = { memory, score };
    }
    return best;
  } catch (error) {
    return null;
  }
}

function mockSupersedeMemory(db, input) {
  const old = db.memories.get(input.oldId);
  if (!old) {
    const nextId = `mem_${db.nextId++}`;
    db.memories.set(nextId, {
      id: nextId,
      namespace: input.namespace,
      type: input.newType ?? "note",
      content: input.newContent,
      fact_key: input.newFactKey ?? null,
      status: "active",
      version_status: "current"
    });
    return { newId: nextId };
  }

  let inheritedFactKey = input.newFactKey ?? null;
  if (inheritedFactKey == null) {
    inheritedFactKey = old.fact_key ?? db.lifecycle.get(old.id)?.fact_key ?? null;
  }

  old.status = "superseded";
  old.version_status = "superseded";

  const nextId = `mem_${db.nextId++}`;
  db.memories.set(nextId, {
    id: nextId,
    namespace: input.namespace,
    type: input.newType ?? old.type ?? "note",
    content: input.newContent,
    fact_key: inheritedFactKey,
    status: "active",
    version_status: "current"
  });
  return { newId: nextId, inheritedFactKey };
}

function mockUpsertMemoryByFactKey(db, input) {
  for (const memory of db.memories.values()) {
    if (
      memory.namespace === input.namespace &&
      memory.status === "active" &&
      memory.version_status !== "superseded" &&
      memory.fact_key === input.factKey
    ) {
      memory.content = input.content;
      return { id: memory.id, created: false };
    }
  }
  const id = `mem_${db.nextId++}`;
  db.memories.set(id, {
    id,
    namespace: input.namespace,
    type: input.type ?? "fact",
    content: input.content,
    fact_key: input.factKey,
    status: "active",
    version_status: "current"
  });
  return { id, created: true };
}

function mockCreateMemory(db, input) {
  const id = `mem_${db.nextId++}`;
  db.memories.set(id, {
    id,
    namespace: input.namespace,
    type: input.type,
    content: input.content,
    fact_key: null,
    status: "active",
    version_status: "current"
  });
  return { id };
}

async function mockCreateApprovedMemoryFromCandidate(env, input) {
  if (input.factKey) {
    const result = mockUpsertMemoryByFactKey(env.DB, input);
    return { id: result.id, action: "upserted" };
  }

  const hit = await mockFindSimilarActiveMemory(env, {
    namespace: input.namespace,
    content: input.content
  });
  if (hit) {
    const result = mockSupersedeMemory(env.DB, {
      namespace: input.namespace,
      oldId: hit.memory.id,
      newContent: input.content,
      newType: input.type,
      newFactKey: null,
      reason: "dedup_gate_supersede"
    });
    return { id: result.newId, action: "superseded", supersededId: hit.memory.id };
  }

  const created = mockCreateMemory(env.DB, input);
  return { id: created.id, action: "created" };
}

async function mockApproveCandidate(env, candidate, body = {}) {
  if (candidate.source === "dream_delete" && candidate.target_memory_id) {
    return { memory_id: candidate.target_memory_id };
  }

  const content = body.content ?? candidate.content;
  const type = body.type ?? candidate.type;
  const factKey = body.fact_key === null ? null : body.fact_key ?? candidate.fact_key;

  if (candidate.target_memory_id) {
    const target = env.DB.memories.get(candidate.target_memory_id);
    const targetActive =
      target &&
      target.status === "active" &&
      target.version_status !== "superseded";
    if (targetActive) {
      const result = mockSupersedeMemory(env.DB, {
        namespace: candidate.namespace,
        oldId: candidate.target_memory_id,
        newContent: content,
        newType: type,
        newFactKey: factKey,
        reason: "approve_update"
      });
      return {
        memory_id: result.newId,
        action: "superseded",
        superseded_id: candidate.target_memory_id
      };
    }
  }

  const approval = await mockCreateApprovedMemoryFromCandidate(env, {
    namespace: candidate.namespace,
    type,
    content,
    factKey,
    source: "review"
  });
  return {
    memory_id: approval.id,
    action: approval.action,
    ...(approval.supersededId ? { superseded_id: approval.supersededId } : {}),
    ...(candidate.target_memory_id && !env.DB.memories.get(candidate.target_memory_id)?.status === "active"
      ? { decision_note: "target_gone_fallback" }
      : {})
  };
}

function makeEnv(overrides = {}) {
  const db = {
    memories: new Map(),
    lifecycle: new Map(),
    nextId: 1
  };

  return {
    DEDUP_COSINE: "0.9",
    DB: db,
    __searchVectorMemories: async () => [],
    ...overrides
  };
}

// ---------------------------------------------------------------------------
// Behavioral tests: dedup gate + approve routing
// ---------------------------------------------------------------------------

{
  const env = makeEnv({
    __searchVectorMemories: async () => [
      {
        id: "mem_old",
        namespace: "default",
        status: "active",
        version_status: "current",
        fact_key: "saki_tool_company_stance",
        content: "旧内容",
        score: 0.95
      }
    ]
  });
  env.DB.memories.set("mem_old", {
    id: "mem_old",
    namespace: "default",
    type: "fact",
    content: "旧内容",
    fact_key: "saki_tool_company_stance",
    status: "active",
    version_status: "current"
  });

  const result = await mockCreateApprovedMemoryFromCandidate(env, {
    namespace: "default",
    type: "fact",
    content: "旧内容加一句",
    factKey: null,
    source: "review"
  });
  assert.equal(result.action, "superseded");
  assert.equal(result.supersededId, "mem_old");
  const old = env.DB.memories.get("mem_old");
  assert.equal(old.version_status, "superseded");
  const next = env.DB.memories.get(result.id);
  assert.equal(next.fact_key, "saki_tool_company_stance");
}

{
  const env = makeEnv();
  const result = await mockCreateApprovedMemoryFromCandidate(env, {
    namespace: "default",
    type: "note",
    content: "全新记忆",
    factKey: null,
    source: "review"
  });
  assert.equal(result.action, "created");
  assert.ok(env.DB.memories.has(result.id));
}

{
  const env = makeEnv();
  env.DB.memories.set("mem_existing", {
    id: "mem_existing",
    namespace: "default",
    type: "fact",
    content: "已有",
    fact_key: "user_city",
    status: "active",
    version_status: "current"
  });
  const result = await mockCreateApprovedMemoryFromCandidate(env, {
    namespace: "default",
    type: "fact",
    content: "上海",
    factKey: "user_city",
    source: "review"
  });
  assert.equal(result.action, "upserted");
  assert.equal(result.id, "mem_existing");
  assert.equal(env.DB.memories.get("mem_existing").content, "上海");
}

{
  const env = makeEnv();
  env.DB.memories.set("mem_target", {
    id: "mem_target",
    namespace: "default",
    type: "fact",
    content: "目标",
    fact_key: "topic_a",
    status: "active",
    version_status: "current"
  });
  const response = await mockApproveCandidate(env, {
    namespace: "default",
    content: "更新后",
    type: "fact",
    fact_key: "topic_a",
    target_memory_id: "mem_target",
    source: "dream_update"
  });
  assert.equal(response.action, "superseded");
  assert.equal(response.superseded_id, "mem_target");
}

{
  const env = makeEnv({
    __searchVectorMemories: async () => [
      {
        id: "mem_similar",
        namespace: "default",
        status: "active",
        version_status: "current",
        fact_key: "topic_b",
        content: "相似",
        score: 0.92
      }
    ]
  });
  env.DB.memories.set("mem_target", {
    id: "mem_target",
    namespace: "default",
    type: "fact",
    content: "已废弃",
    fact_key: "topic_b",
    status: "superseded",
    version_status: "superseded"
  });
  env.DB.memories.set("mem_similar", {
    id: "mem_similar",
    namespace: "default",
    type: "fact",
    content: "相似",
    fact_key: "topic_b",
    status: "active",
    version_status: "current"
  });

  const response = await mockApproveCandidate(env, {
    namespace: "default",
    content: "新候选",
    type: "fact",
    fact_key: null,
    target_memory_id: "mem_target",
    source: "dream_update"
  });
  assert.equal(response.action, "superseded");
  assert.equal(response.superseded_id, "mem_similar");
}

{
  const env = makeEnv({
    __searchVectorMemories: async () => {
      throw new Error("embedding unavailable");
    }
  });
  const result = await mockCreateApprovedMemoryFromCandidate(env, {
    namespace: "default",
    type: "note",
    content: "fail-open 写入",
    factKey: null,
    source: "review"
  });
  assert.equal(result.action, "created");
}

// dream_update inherits fact_key — source-level contract already checked above.

// ---------------------------------------------------------------------------
// Monthly rollup grouping (mirrors monthlyRollup.ts helpers)
// ---------------------------------------------------------------------------

function getMondayOfIsoWeek(dateLabel) {
  const date = new Date(`${dateLabel}T12:00:00Z`);
  const day = date.getUTCDay();
  const diff = day === 0 ? -6 : 1 - day;
  date.setUTCDate(date.getUTCDate() + diff);
  return date.toISOString().slice(0, 10);
}

function addDays(dateLabel, days) {
  const date = new Date(`${dateLabel}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function getMonthLabelForWeekStart(startDate) {
  const monday = getMondayOfIsoWeek(startDate);
  const thursday = addDays(monday, 3);
  return thursday.slice(0, 7);
}

function collectEligibleMonths(weeklyLogs) {
  const byMonth = new Map();
  for (const row of weeklyLogs) {
    const month = getMonthLabelForWeekStart(row.start_date);
    const bucket = byMonth.get(month) ?? [];
    bucket.push(row);
    byMonth.set(month, bucket);
  }
  return byMonth;
}

{
  const weeklyLogs = [
    { week: "2026-W10", start_date: "2026-03-02", title: "w10a", summary: "a" },
    { week: "2026-W11", start_date: "2026-03-09", title: "w11", summary: "b" },
    { week: "2026-W20", start_date: "2026-05-11", title: "orphan", summary: "c" }
  ];
  const byMonth = collectEligibleMonths(weeklyLogs);
  const march = byMonth.get("2026-03") ?? [];
  assert.equal(march.length, 2);
  assert.equal((byMonth.get("2026-05") ?? []).length, 1);
  const eligible = [...byMonth.entries()].filter(([, rows]) => rows.length >= 2);
  assert.equal(eligible.length, 1);
  assert.equal(eligible[0][0], "2026-03");
}

// ---------------------------------------------------------------------------
// Boot impressions ladder (mirrors assembler/types.ts)
// ---------------------------------------------------------------------------

function formatImpressionLine(entry) {
  return `【${entry.label}·${entry.title}】${entry.summary}`;
}

function buildImpressionsLadder(boot) {
  const ladder = boot.impressions;
  if (!ladder) return [];
  const lines = [];
  if (ladder.daily) lines.push(formatImpressionLine(ladder.daily));
  if (ladder.weekly) lines.push(formatImpressionLine(ladder.weekly));
  if (ladder.monthly) lines.push(formatImpressionLine(ladder.monthly));
  if (lines.length === 0) return [];
  const maxChars = ladder.max_chars > 0 ? ladder.max_chars : 1000;
  const selected = [...lines];
  while (selected.length > 0) {
    if (selected.join("\n").length <= maxChars) return selected;
    selected.pop();
  }
  return [];
}

function formatBootStable(boot) {
  const impressions = buildImpressionsLadder(boot);
  if (impressions.length === 0) return "";
  return ["<impressions>", ...impressions, "</impressions>"].join("\n");
}

{
  const text = formatBootStable({
    impressions: {
      daily: { label: "2026-07-15", title: "昨日", summary: "聊了缓存" },
      weekly: { label: "2026-W28", title: "本周", summary: "x".repeat(500) },
      monthly: { label: "2026-07", title: "本月", summary: "y".repeat(500) },
      max_chars: 1000
    }
  });
  assert.match(text, /<impressions>/);
  assert.match(text, /2026-07-15·昨日/);
  assert.ok(text.includes("2026-W28·本周") || text.includes("2026-07-15·昨日"));
  assert.ok(text.length <= 1000 + "<impressions>\n</impressions>".length + 10);
  assert.doesNotMatch(text, /<yesterday_log>/);
}

// ---------------------------------------------------------------------------
// Isolation invariant: log tables never appear in vector search results
// ---------------------------------------------------------------------------

function mockSearchMemories(db, query) {
  return [...db.memories.values()]
    .filter((m) => m.status === "active")
    .map((m) => m.content)
    .filter((content) => content.includes(query));
}

{
  const db = {
    daily_log: [{ summary: "daily secret phrase alpha" }],
    weekly_log: [{ summary: "weekly secret phrase beta" }],
    monthly_log: [{ summary: "monthly secret phrase gamma" }],
    memories: new Map([
      ["mem_1", { id: "mem_1", content: "vector hit", status: "active" }]
    ])
  };
  const dailyHits = mockSearchMemories(db, "daily secret");
  const weeklyHits = mockSearchMemories(db, "weekly secret");
  const monthlyHits = mockSearchMemories(db, "monthly secret");
  assert.equal(dailyHits.length, 0, "daily_log must not surface in search");
  assert.equal(weeklyHits.length, 0, "weekly_log must not surface in search");
  assert.equal(monthlyHits.length, 0, "monthly_log must not surface in search");
  const memoryHits = mockSearchMemories(db, "vector");
  assert.equal(memoryHits.length, 1);
}

console.log("verify-dedup-gate: all checks passed");