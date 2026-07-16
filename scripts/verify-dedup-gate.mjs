#!/usr/bin/env node
/**
 * Contract + behavioral tests for dedup gate, approve routing, monthly rollup,
 * and boot impressions ladder.
 *
 * Behavioral tests import real production modules (tsx) and mock only env bindings.
 *
 * Run:  npx tsx scripts/verify-dedup-gate.mjs
 * Exit 0 = all checks passed, exit 1 = failure.
 */

import { strict as assert } from "node:assert";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

import { formatBootStable } from "../src/assembler/types.ts";
import { createMemory, getMemoryById } from "../src/db/memories.ts";
import {
  getMonthlyLog,
  getWeeklyLog,
  resolveMemoryFactKey,
  supersedeMemory,
  upsertMemoryByFactKey
} from "../src/db/v2.ts";
import { findSimilarActiveMemory } from "../src/memory/dedupGate.ts";
import { getMonthLabelForWeekStart, runMonthlyRollup } from "../src/memory/monthlyRollup.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function readSource(relPath) {
  return readFileSync(resolve(root, relPath), "utf8");
}

function readDbV2Source() {
  // db/v2.ts may be a barrel; prefer domain modules under db/v2/ when present.
  const dir = resolve(root, "src/db/v2");
  if (existsSync(dir)) {
    const files = readdirSync(dir).filter((name) => name.endsWith(".ts")).sort();
    if (files.length > 0) {
      return files.map((name) => readFileSync(join(dir, name), "utf8")).join("\n");
    }
  }
  return readSource("src/db/v2.ts");
}

// ---------------------------------------------------------------------------
// Static source contract checks
// ---------------------------------------------------------------------------

const dedupGateSource = readSource("src/memory/dedupGate.ts");
const memoriesSource = readSource("src/api/memories.ts");
const digestSource = readSource("src/memory/dailyDigest.ts");
const dbV2Source = readDbV2Source();
const recallSource = readSource("src/memory/v2/recall.ts");
const typesSource = readSource("src/assembler/types.ts");
const embeddingSource = readSource("src/memory/embedding.ts");
const vectorStoreSource = readSource("src/memory/vectorStore.ts");
const monthlyRollupSource = readSource("src/memory/monthlyRollup.ts");
const indexSource = readSource("src/index.ts");
const migrationSource = readSource("migrations/0009_monthly_log.sql");

assert.match(dedupGateSource, /export async function findSimilarActiveMemory/);
assert.match(dedupGateSource, /readNumber\(env\.DEDUP_COSINE, 0\.9\)/);
assert.match(dedupGateSource, /searchVectorMemories\(env/);
assert.match(dedupGateSource, /getMemoryById\(env\.DB/);
assert.match(dedupGateSource, /d1Row\.version_status === "superseded"/);
assert.match(dedupGateSource, /fail-open/);
assert.doesNotMatch(dedupGateSource, /function isActiveNonSuperseded/);

assert.match(memoriesSource, /findSimilarActiveMemory/);
assert.match(memoriesSource, /action: "upserted" \| "superseded" \| "created"/);
assert.match(memoriesSource, /reason: "dedup_gate_supersede"/);
assert.match(memoriesSource, /reason: "approve_update"/);
assert.match(memoriesSource, /target_gone_fallback/);
assert.match(memoriesSource, /excludeIds: candidate\.target_memory_id/);

assert.match(digestSource, /findSimilarActiveMemory/);
assert.match(digestSource, /dedup_gate: similar to/);
assert.match(digestSource, /resolveMemoryFactKey/);
assert.doesNotMatch(digestSource, /source: "dream_update"[\s\S]{0,200}factKey: null/);

assert.match(dbV2Source, /export async function resolveMemoryFactKey/);
assert.match(dbV2Source, /version_status === "superseded"/);
assert.match(dbV2Source, /monthly_log/);
assert.match(dbV2Source, /listWeeklyLogsBeforeStartDate/);
assert.match(dbV2Source, /for \(let attempt = 0; attempt < 2; attempt/);

assert.match(recallSource, /listRecentWeeklyLogs/);
assert.match(recallSource, /listRecentMonthlyLogs/);
assert.match(recallSource, /impressions:/);
assert.doesNotMatch(recallSource, /yesterday_log/);

assert.match(typesSource, /<impressions>/);
assert.match(typesSource, /buildImpressionsLadder/);
assert.match(typesSource, /summaryBudget/);

assert.match(embeddingSource, /daily_log \/ weekly_log \/ monthly_log 永不 embed/);
assert.doesNotMatch(vectorStoreSource, /daily_log/);
assert.doesNotMatch(vectorStoreSource, /weekly_log/);
assert.doesNotMatch(vectorStoreSource, /monthly_log/);

assert.match(monthlyRollupSource, /export async function runMonthlyRollup/);
assert.match(monthlyRollupSource, /!existingMonthly && weeklyLogs\.length < 2/);
assert.match(monthlyRollupSource, /DIARY_MODEL/);
assert.match(monthlyRollupSource, /existingMonthly/);
assert.match(monthlyRollupSource, /本月周记/);
assert.match(monthlyRollupSource, /Asia\/Shanghai/);
assert.doesNotMatch(monthlyRollupSource, /DAILY_DIGEST_MODEL/);

assert.match(indexSource, /\/admin\/monthly-rollup/);
assert.match(indexSource, /runMonthlyRollup/);

assert.match(migrationSource, /CREATE TABLE IF NOT EXISTS monthly_log/);
assert.match(migrationSource, /PRIMARY KEY \(namespace, month\)/);

// ---------------------------------------------------------------------------
// In-memory D1 mock — only env.DB binding; real db/v2 + db/memories SQL paths
// ---------------------------------------------------------------------------

const NOW = "2026-07-16T00:00:00.000Z";

function defaultMemory(overrides) {
  return {
    id: overrides.id,
    namespace: overrides.namespace ?? "default",
    type: overrides.type ?? "fact",
    content: overrides.content ?? "",
    summary: overrides.summary ?? null,
    importance: overrides.importance ?? 0.6,
    confidence: overrides.confidence ?? 0.8,
    status: overrides.status ?? "active",
    pinned: overrides.pinned ?? 0,
    tags: overrides.tags ?? "[]",
    source: overrides.source ?? null,
    source_message_ids: overrides.source_message_ids ?? "[]",
    vector_id: overrides.vector_id ?? `mem_${overrides.id}`,
    last_recalled_at: null,
    recall_count: 0,
    created_at: overrides.created_at ?? NOW,
    updated_at: overrides.updated_at ?? NOW,
    expires_at: overrides.expires_at ?? null,
    fact_key: overrides.fact_key ?? null,
    version_status: overrides.version_status ?? "current",
    superseded_by: overrides.superseded_by ?? null
  };
}

function createMockD1() {
  const state = {
    memories: new Map(),
    lifecycle: new Map(),
    relations: [],
    weeklyLogs: new Map(),
    monthlyLogs: new Map()
  };

  function getById(id) {
    return state.memories.get(id) ?? null;
  }

  function findActiveByFactKey(namespace, factKey) {
    for (const memory of state.memories.values()) {
      if (memory.namespace !== namespace || memory.status !== "active") continue;
      if (memory.version_status === "superseded") continue;
      const lifecycleFactKey = state.lifecycle.get(memory.id)?.fact_key ?? null;
      const effective = memory.fact_key ?? lifecycleFactKey;
      if (effective === factKey) return memory;
    }
    return null;
  }

  function prepare(sql) {
    const normalized = sql.replace(/\s+/g, " ").trim();
    let binds = [];
    const stmt = {
      bind(...args) {
        binds = args;
        return stmt;
      },
      async run() {
        if (normalized.startsWith("UPDATE memories SET status = 'superseded'")) {
          const [nextId, updatedAt, id] = binds;
          const row = getById(id);
          if (row) {
            row.status = "superseded";
            row.version_status = "superseded";
            row.superseded_by = nextId;
            row.updated_at = updatedAt;
          }
          return { meta: { changes: row ? 1 : 0 } };
        }
        if (normalized.includes("UPDATE memories SET content = ?")) {
          const [
            content,
            type,
            importance,
            confidence,
            tags,
            source,
            sourceMessageIds,
            updatedAt,
            factKey,
            id
          ] = binds;
          const row = getById(id);
          if (row) {
            row.content = content;
            row.type = type;
            row.importance = importance;
            row.confidence = confidence;
            row.tags = tags;
            row.source = source;
            row.source_message_ids = sourceMessageIds;
            row.updated_at = updatedAt;
            row.fact_key = factKey;
            row.version_status = row.version_status ?? "current";
          }
          const lc = state.lifecycle.get(id) ?? { memory_id: id, namespace: row?.namespace ?? "default", seen_count: 0 };
          lc.fact_key = factKey;
          lc.valid_as_of = binds[binds.length - 4] ?? null;
          lc.last_seen_at = updatedAt;
          state.lifecycle.set(id, lc);
          return { meta: { changes: row ? 1 : 0 } };
        }
        if (normalized.startsWith("INSERT OR IGNORE INTO memory_lifecycle (memory_id, namespace, seen_count)")) {
          const [memoryId, namespace] = binds;
          if (!state.lifecycle.has(memoryId)) {
            state.lifecycle.set(memoryId, { memory_id: memoryId, namespace, seen_count: 0 });
            return { meta: { changes: 1 } };
          }
          return { meta: { changes: 0 } };
        }
        if (normalized.startsWith("INSERT OR IGNORE INTO memory_lifecycle (memory_id, namespace, fact_key")) {
          const [memoryId, namespace, factKey, validAsOf, lastSeenAt] = binds;
          state.lifecycle.set(memoryId, {
            memory_id: memoryId,
            namespace,
            fact_key: factKey,
            valid_as_of: validAsOf,
            last_seen_at: lastSeenAt,
            seen_count: 0
          });
          return { meta: { changes: 1 } };
        }
        if (normalized.startsWith("INSERT INTO memory_lifecycle (")) {
          const parts = binds;
          const memoryId = parts[0];
          state.lifecycle.set(memoryId, {
            memory_id: memoryId,
            namespace: parts[1],
            fact_key: parts[2] ?? null,
            supersedes_id: parts[3] ?? null,
            review_reason: parts[4] ?? null,
            valid_as_of: parts[5] ?? null,
            last_seen_at: parts[6] ?? NOW,
            seen_count: 0
          });
          return { meta: { changes: 1 } };
        }
        if (normalized.startsWith("UPDATE memory_lifecycle SET superseded_by_id")) {
          const [supersededById, reviewReason, memoryId] = binds;
          const lc = state.lifecycle.get(memoryId) ?? { memory_id: memoryId, namespace: "default", seen_count: 0 };
          lc.superseded_by_id = supersededById;
          lc.review_reason = reviewReason;
          state.lifecycle.set(memoryId, lc);
          return { meta: { changes: 1 } };
        }
        if (normalized.startsWith("UPDATE memory_lifecycle SET fact_key")) {
          const [factKey, validAsOf, lastSeenAt, memoryId] = binds;
          const lc = state.lifecycle.get(memoryId) ?? { memory_id: memoryId, namespace: "default", seen_count: 0 };
          lc.fact_key = factKey;
          lc.valid_as_of = validAsOf;
          lc.last_seen_at = lastSeenAt;
          state.lifecycle.set(memoryId, lc);
          return { meta: { changes: 1 } };
        }
        if (normalized.startsWith("INSERT INTO memories (")) {
          if (normalized.includes("fact_key, version_status, superseded_by")) {
            const [
              id,
              namespace,
              type,
              content,
              importance,
              confidence,
              tags,
              source,
              sourceMessageIds,
              vectorId,
              createdAt,
              updatedAt,
              factKey
            ] = binds;
            state.memories.set(
              id,
              defaultMemory({
                id,
                namespace,
                type,
                content,
                importance,
                confidence,
                tags,
                source,
                source_message_ids: sourceMessageIds,
                vector_id: vectorId,
                created_at: createdAt,
                updated_at: updatedAt,
                fact_key: factKey,
                version_status: "current"
              })
            );
            return { meta: { changes: 1 } };
          }
          const [
            id,
            namespace,
            type,
            content,
            summary,
            importance,
            confidence,
            status,
            pinned,
            tags,
            source,
            sourceMessageIds,
            vectorId,
            createdAt,
            updatedAt,
            expiresAt
          ] = binds;
          state.memories.set(
            id,
            defaultMemory({
              id,
              namespace,
              type,
              content,
              summary,
              importance,
              confidence,
              status,
              pinned,
              tags,
              source,
              source_message_ids: sourceMessageIds,
              vector_id: vectorId,
              created_at: createdAt,
              updated_at: updatedAt,
              expires_at: expiresAt
            })
          );
          return { meta: { changes: 1 } };
        }
        if (normalized.startsWith("INSERT OR IGNORE INTO memory_relations")) {
          state.relations.push({
            src_id: binds[0],
            dst_id: binds[1],
            rel_type: binds[2],
            weight: binds[3]
          });
          return { meta: { changes: 1 } };
        }
        if (normalized.includes("INSERT INTO monthly_log")) {
          const [namespace, month, title, summary, sourceWeekCount, createdAt, updatedAt] = binds;
          const key = `${namespace}:${month}`;
          const existing = state.monthlyLogs.get(key);
          state.monthlyLogs.set(key, {
            namespace,
            month,
            title,
            summary,
            source_week_count: sourceWeekCount,
            created_at: existing?.created_at ?? createdAt,
            updated_at: updatedAt
          });
          return { meta: { changes: 1 } };
        }
        if (normalized.startsWith("DELETE FROM weekly_log")) {
          const [namespace, ...weeks] = binds;
          let changes = 0;
          for (const week of weeks) {
            const key = `${namespace}:${week}`;
            if (state.weeklyLogs.delete(key)) changes += 1;
          }
          return { meta: { changes } };
        }
        return { meta: { changes: 0 } };
      },
      async first() {
        if (normalized === "SELECT * FROM memories WHERE namespace = ? AND id = ?") {
          const [namespace, id] = binds;
          const row = getById(id);
          return row && row.namespace === namespace ? { ...row } : null;
        }
        if (normalized.includes("SELECT m.fact_key, m.namespace, m.status, m.version_status FROM memories m WHERE m.id = ?")) {
          const [id] = binds;
          const row = getById(id);
          if (!row) return null;
          return {
            fact_key: row.fact_key,
            namespace: row.namespace,
            status: row.status,
            version_status: row.version_status
          };
        }
        if (normalized === "SELECT fact_key FROM memory_lifecycle WHERE memory_id = ?") {
          const [memoryId] = binds;
          const lc = state.lifecycle.get(memoryId);
          return lc ? { fact_key: lc.fact_key ?? null } : null;
        }
        if (normalized.includes("SELECT id, status, vector_id, fact_key, type FROM memories WHERE namespace = ? AND id = ?")) {
          const [namespace, id] = binds;
          const row = getById(id);
          if (!row || row.namespace !== namespace) return null;
          return {
            id: row.id,
            status: row.status,
            vector_id: row.vector_id,
            fact_key: row.fact_key,
            type: row.type
          };
        }
        if (normalized.includes("SELECT m.id FROM memories m")) {
          const [namespace, factKey] = binds;
          const row = findActiveByFactKey(namespace, factKey);
          return row ? { id: row.id } : null;
        }
        if (normalized.includes("FROM monthly_log") && normalized.includes("month = ?")) {
          const [namespace, month] = binds;
          const row = state.monthlyLogs.get(`${namespace}:${month}`);
          return row ? { ...row } : null;
        }
        if (normalized.includes("FROM weekly_log") && normalized.includes("week = ?")) {
          const [namespace, week] = binds;
          const row = state.weeklyLogs.get(`${namespace}:${week}`);
          return row ? { ...row } : null;
        }
        return null;
      },
      async all() {
        if (normalized.startsWith("SELECT * FROM memories WHERE namespace = ? AND id = ?")) {
          const first = await stmt.first();
          return { results: first ? [first] : [] };
        }
        if (normalized.includes("FROM weekly_log") && normalized.includes("start_date < ?")) {
          const [namespace, beforeStartDate] = binds;
          const results = [...state.weeklyLogs.values()]
            .filter((row) => row.namespace === namespace && row.start_date < beforeStartDate)
            .sort((a, b) => a.start_date.localeCompare(b.start_date));
          return { results };
        }
        return { results: [] };
      }
    };
    return stmt;
  }

  return {
    prepare,
    async batch(stmts) {
      const results = [];
      for (const s of stmts) {
        results.push(await s.run());
      }
      return results;
    },
    _state: state
  };
}

function makeVectorMatch({ id, namespace, content, score = 0.95, type = "fact" }) {
  const vectorId = `mem_${id}`;
  return {
    id: vectorId,
    score,
    metadata: {
      namespace,
      status: "active",
      content,
      ref_id: id,
      type,
      importance: 0.6,
      confidence: 0.8,
      pinned: false,
      tags: "[]",
      source: "",
      source_message_ids: "[]",
      created_at: NOW,
      updated_at: NOW
    }
  };
}

function makeEnv(overrides = {}) {
  const db = createMockD1();
  const vectorMatches = overrides.vectorMatches ?? [];
  const vectorizeThrows = overrides.vectorizeThrows === true;

  const env = {
    DEDUP_COSINE: "0.9",
    MEMORY_MIN_SCORE: "0.1",
    DB: db,
    AI: {
      run: async () => ({ data: [Array.from({ length: 64 }, () => 0.1)] })
    },
    VECTORIZE: {
      query: async () => {
        if (vectorizeThrows) throw new Error("embedding unavailable");
        return { matches: vectorMatches };
      },
      upsert: async () => {},
      deleteByIds: async () => {},
      getByIds: async () => []
    },
    ...overrides
  };
  delete env.vectorMatches;
  delete env.vectorizeThrows;
  return env;
}

function seedWeeklyLog(db, input) {
  const namespace = input.namespace ?? "default";
  const week = input.week;
  db._state.weeklyLogs.set(`${namespace}:${week}`, {
    namespace,
    week,
    start_date: input.start_date,
    end_date: input.end_date ?? input.start_date,
    title: input.title ?? "",
    summary: input.summary ?? "",
    source_days: input.source_days ?? 1,
    updated_at: input.updated_at ?? NOW
  });
}

function seedMonthlyLog(db, input) {
  const namespace = input.namespace ?? "default";
  const month = input.month;
  db._state.monthlyLogs.set(`${namespace}:${month}`, {
    namespace,
    month,
    title: input.title ?? "",
    summary: input.summary ?? "",
    source_week_count: input.source_week_count ?? 2,
    created_at: input.created_at ?? NOW,
    updated_at: input.updated_at ?? NOW
  });
}

function makeMonthlyRollupEnv(overrides = {}) {
  const rollupJson = JSON.stringify({
    title: overrides.rollupTitle ?? "五月印象",
    summary: overrides.rollupSummary ?? "这个月延续了之前的氛围，并吸收了新的周记线索。"
  });
  return makeEnv({
    DREAM_TIME_ZONE: "Asia/Shanghai",
    AI: {
      run: async () => ({ response: rollupJson })
    },
    ...overrides
  });
}

function seedMemory(db, input) {
  db._state.memories.set(
    input.id,
    defaultMemory({
      namespace: input.namespace ?? "default",
      type: input.type ?? "fact",
      content: input.content ?? "",
      fact_key: input.fact_key ?? null,
      status: input.status ?? "active",
      version_status: input.version_status ?? "current",
      vector_id: input.vector_id ?? `mem_${input.id}`,
      ...input
    })
  );
  if (input.lifecycle_fact_key) {
    db._state.lifecycle.set(input.id, {
      memory_id: input.id,
      namespace: input.namespace ?? "default",
      fact_key: input.lifecycle_fact_key,
      seen_count: 0
    });
  }
}

async function createApprovedMemoryFromCandidate(env, input) {
  if (input.factKey) {
    const result = await upsertMemoryByFactKey(env, {
      namespace: input.namespace,
      factKey: input.factKey,
      type: input.type,
      content: input.content,
      confidence: input.confidence ?? 0.8,
      importance: input.importance ?? 0.6,
      tags: input.tags ?? [],
      source: input.source ?? "review",
      sourceMessageIds: input.sourceMessageIds ?? []
    });
    return { id: result.id, action: "upserted" };
  }

  const hit = await findSimilarActiveMemory(env, {
    namespace: input.namespace,
    content: input.content,
    excludeIds: input.excludeIds
  });
  if (hit) {
    const result = await supersedeMemory(env, {
      namespace: input.namespace,
      oldId: hit.memory.id,
      newContent: input.content,
      newType: input.type,
      newFactKey: null,
      reason: "dedup_gate_supersede"
    });
    return { id: result.newId, action: "superseded", supersededId: hit.memory.id };
  }

  const created = await createMemory(env.DB, {
    namespace: input.namespace,
    type: input.type,
    content: input.content,
    confidence: input.confidence ?? 0.8,
    importance: input.importance ?? 0.6,
    tags: input.tags ?? [],
    source: input.source ?? "review",
    sourceMessageIds: input.sourceMessageIds ?? []
  });
  return { id: created.id, action: "created" };
}

async function approveCandidate(env, candidate, body = {}) {
  const content = body.content ?? candidate.content;
  const type = body.type ?? candidate.type;
  const factKey = body.fact_key === null ? null : body.fact_key ?? candidate.fact_key;

  if (candidate.target_memory_id) {
    const target = await getMemoryById(env.DB, {
      namespace: candidate.namespace,
      id: candidate.target_memory_id
    });
    const targetActive =
      target && target.status === "active" && target.version_status !== "superseded";
    if (targetActive) {
      const result = await supersedeMemory(env, {
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

  const approval = await createApprovedMemoryFromCandidate(env, {
    namespace: candidate.namespace,
    type,
    content,
    factKey,
    source: "review",
    excludeIds: candidate.target_memory_id ? [candidate.target_memory_id] : undefined
  });

  const targetGone =
    candidate.target_memory_id &&
    (() => {
      const target = env.DB._state.memories.get(candidate.target_memory_id);
      return !target || target.status !== "active";
    })();

  return {
    memory_id: approval.id,
    action: approval.action,
    ...(approval.supersededId ? { superseded_id: approval.supersededId } : {}),
    ...(targetGone ? { decision_note: "target_gone_fallback" } : {})
  };
}

// ---------------------------------------------------------------------------
// Behavioral tests: real dedup gate + approve routing
// ---------------------------------------------------------------------------

{
  const env = makeEnv({
    vectorMatches: [
      makeVectorMatch({
        id: "mem_old",
        namespace: "default",
        content: "旧内容",
        score: 0.95
      })
    ]
  });
  seedMemory(env.DB, {
    id: "mem_old",
    namespace: "default",
    type: "fact",
    content: "旧内容",
    fact_key: "saki_tool_company_stance"
  });

  const result = await createApprovedMemoryFromCandidate(env, {
    namespace: "default",
    type: "fact",
    content: "旧内容加一句",
    factKey: null,
    source: "review"
  });
  assert.equal(result.action, "superseded");
  assert.equal(result.supersededId, "mem_old");
  const old = env.DB._state.memories.get("mem_old");
  assert.equal(old.version_status, "superseded");
  const next = env.DB._state.memories.get(result.id);
  assert.equal(next.fact_key, "saki_tool_company_stance");
}

{
  const env = makeEnv();
  const result = await createApprovedMemoryFromCandidate(env, {
    namespace: "default",
    type: "note",
    content: "全新记忆",
    factKey: null,
    source: "review"
  });
  assert.equal(result.action, "created");
  assert.ok(env.DB._state.memories.has(result.id));
}

{
  const env = makeEnv();
  seedMemory(env.DB, {
    id: "mem_existing",
    namespace: "default",
    type: "fact",
    content: "已有",
    fact_key: "user_city"
  });
  const result = await createApprovedMemoryFromCandidate(env, {
    namespace: "default",
    type: "fact",
    content: "上海",
    factKey: "user_city",
    source: "review"
  });
  assert.equal(result.action, "upserted");
  assert.equal(result.id, "mem_existing");
  assert.equal(env.DB._state.memories.get("mem_existing").content, "上海");
}

{
  const env = makeEnv();
  seedMemory(env.DB, {
    id: "mem_target",
    namespace: "default",
    type: "fact",
    content: "目标",
    fact_key: "topic_a"
  });
  const response = await approveCandidate(env, {
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
    vectorMatches: [
      makeVectorMatch({
        id: "mem_similar",
        namespace: "default",
        content: "相似",
        score: 0.92,
        fact_key: "topic_b"
      })
    ]
  });
  seedMemory(env.DB, {
    id: "mem_target",
    namespace: "default",
    type: "fact",
    content: "已废弃",
    fact_key: "topic_b",
    status: "superseded",
    version_status: "superseded"
  });
  seedMemory(env.DB, {
    id: "mem_similar",
    namespace: "default",
    type: "fact",
    content: "相似",
    fact_key: "topic_b"
  });

  const response = await approveCandidate(env, {
    namespace: "default",
    content: "新候选",
    type: "fact",
    fact_key: null,
    target_memory_id: "mem_target",
    source: "dream_update"
  });
  assert.equal(response.action, "superseded");
  assert.equal(response.superseded_id, "mem_similar");
  assert.equal(response.decision_note, "target_gone_fallback");
}

{
  const env = makeEnv({ vectorizeThrows: true });
  const result = await createApprovedMemoryFromCandidate(env, {
    namespace: "default",
    type: "note",
    content: "fail-open 写入",
    factKey: null,
    source: "review"
  });
  assert.equal(result.action, "created");
}

{
  const env = makeEnv();
  seedMemory(env.DB, {
    id: "mem_active",
    namespace: "default",
    fact_key: "topic_a",
    status: "active",
    version_status: "current"
  });
  const inherited = await resolveMemoryFactKey(env, "mem_active", "default");
  assert.equal(inherited, "topic_a");

  seedMemory(env.DB, {
    id: "mem_superseded",
    namespace: "default",
    fact_key: "topic_b",
    status: "superseded",
    version_status: "superseded"
  });
  const blocked = await resolveMemoryFactKey(env, "mem_superseded", "default");
  assert.equal(blocked, null);
}

// ---------------------------------------------------------------------------
// Monthly rollup orphan guard (real runMonthlyRollup + D1 mock)
// ---------------------------------------------------------------------------

{
  const env = makeMonthlyRollupEnv();
  seedWeeklyLog(env.DB, {
    week: "2026-W20",
    start_date: "2026-05-11",
    title: "orphan",
    summary: "single week without monthly"
  });

  const stats = await runMonthlyRollup(env, "default");
  const detail = stats.details.find((item) => item.month === "2026-05");
  assert.ok(detail);
  assert.equal(detail.status, "skipped");
  assert.equal(detail.reason, "orphan_weeks");
  assert.equal(detail.source_weeks, 1);

  const retained = await getWeeklyLog(env.DB, { namespace: "default", week: "2026-W20" });
  assert.ok(retained);
  assert.equal(await getMonthlyLog(env.DB, { namespace: "default", month: "2026-05" }), null);
}

{
  const env = makeMonthlyRollupEnv({
    rollupTitle: "五月刷新",
    rollupSummary: "已有月记吸收了迟到的单周线索。"
  });
  seedMonthlyLog(env.DB, {
    month: "2026-05",
    title: "旧五月",
    summary: "先前月度印象。",
    source_week_count: 2
  });
  seedWeeklyLog(env.DB, {
    week: "2026-W20",
    start_date: "2026-05-11",
    title: "straggler",
    summary: "late week to merge"
  });

  const stats = await runMonthlyRollup(env, "default");
  const detail = stats.details.find((item) => item.month === "2026-05");
  assert.ok(detail);
  assert.equal(detail.status, "rolled_up");
  assert.equal(detail.source_weeks, 1);
  assert.equal(detail.deleted_weeks, 1);

  const merged = await getMonthlyLog(env.DB, { namespace: "default", month: "2026-05" });
  assert.ok(merged);
  assert.equal(merged.title, "五月刷新");
  assert.equal(merged.summary, "已有月记吸收了迟到的单周线索。");
  assert.equal(merged.source_week_count, 1);
  assert.equal(await getWeeklyLog(env.DB, { namespace: "default", week: "2026-W20" }), null);
}

// ---------------------------------------------------------------------------
// Monthly rollup month grouping (real helper)
// ---------------------------------------------------------------------------

{
  const weeklyLogs = [
    { week: "2026-W10", start_date: "2026-03-02", title: "w10a", summary: "a" },
    { week: "2026-W11", start_date: "2026-03-09", title: "w11", summary: "b" },
    { week: "2026-W20", start_date: "2026-05-11", title: "orphan", summary: "c" }
  ];
  const byMonth = new Map();
  for (const row of weeklyLogs) {
    const month = getMonthLabelForWeekStart(row.start_date, "Asia/Shanghai");
    const bucket = byMonth.get(month) ?? [];
    bucket.push(row);
    byMonth.set(month, bucket);
  }
  const march = byMonth.get("2026-03") ?? [];
  assert.equal(march.length, 2);
  assert.equal((byMonth.get("2026-05") ?? []).length, 1);
  const eligible = [...byMonth.entries()].filter(([, rows]) => rows.length >= 2);
  assert.equal(eligible.length, 1);
  assert.equal(eligible[0][0], "2026-03");
}

// ---------------------------------------------------------------------------
// Boot impressions ladder (real formatBootStable)
// ---------------------------------------------------------------------------

{
  const text = formatBootStable({
    impressions: {
      daily: { label: "2026-07-15", title: "昨日", summary: "聊了缓存" },
      weekly: { label: "2026-W28", title: "本周", summary: "x".repeat(500) },
      monthly: { label: "2026-07", title: "本月", summary: "y".repeat(500) },
      max_chars: 1000
    },
    precious: [],
    glossary: [],
    schema_version: "v3-1",
    cache_prefix_end: true
  });
  assert.match(text, /<impressions>/);
  assert.match(text, /2026-07-15·昨日/);
  assert.ok(text.includes("2026-W28·本周") || text.includes("2026-07-15·昨日"));
  assert.ok(text.length <= 1000 + "<impressions>\n</impressions>".length + 10);
  assert.doesNotMatch(text, /<yesterday_log>/);
}

{
  const oversizedDaily = formatBootStable({
    impressions: {
      daily: { label: "2026-07-15", title: "昨日", summary: "z".repeat(2000) },
      weekly: null,
      monthly: null,
      max_chars: 100
    },
    precious: [],
    glossary: [],
    schema_version: "v3-1",
    cache_prefix_end: true
  });
  assert.match(oversizedDaily, /<impressions>/);
  assert.match(oversizedDaily, /2026-07-15·昨日/);
  assert.ok(oversizedDaily.length <= 100 + "<impressions>\n</impressions>".length + 5);
}

console.log("verify-dedup-gate: all checks passed");