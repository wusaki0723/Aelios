// Aelios 记忆库 v2 数据访问层 (母帖 #11 第 2 步)
// digest / precious / glossary / longtail 的 CRUD + memories 的 fact_key upsert / supersede。
// 调用方负责 MEMORY_LIFECYCLE_ENABLED 总闸；本层只管读写，不判断开关。
//
// v2 写路径 (upsert/supersede/archive) 同时写 D1 和 Vectorize：
// D1 是本体，Vectorize 是检索镜像 (母帖 L6)。只写 D1 不写向量 → recall 召不到。
// 同步用 embedding.ts 的 upsertMemoryEmbedding / deleteMemoryEmbedding (已带 kind:"memory")。

import { upsertMemoryEmbedding } from "../memory/embedding";
import { clampMemoryType } from "../memory/canonicalTypes";
import type { Env, MemoryLifecycleRow, MemoryRecord } from "../types";
import { newId } from "../utils/ids";
import { nowIso } from "../utils/time";

// 读取一条完整 MemoryRecord 用于向量同步。v2 写完 D1 后用它拿全字段。
async function fetchMemoryForSync(
  db: D1Database,
  input: { namespace: string; id: string }
): Promise<MemoryRecord | null> {
  const row = await db
    .prepare("SELECT * FROM memories WHERE namespace = ? AND id = ?")
    .bind(input.namespace, input.id)
    .first<MemoryRecord>();
  return row ?? null;
}

// =====================================================================
// L1 摘要 digest (单行覆盖，每 namespace 一行)
// =====================================================================

export interface DigestRow {
  namespace: string;
  content: string;
  updated_at: string;
}

export async function getDigest(db: D1Database, namespace: string): Promise<DigestRow | null> {
  const row = await db
    .prepare("SELECT namespace, content, updated_at FROM digest WHERE namespace = ?")
    .bind(namespace)
    .first<DigestRow>();
  return row ?? null;
}

// 覆盖式重写：永远小、永不重复 (母帖 L1)。
export async function upsertDigest(
  db: D1Database,
  input: { namespace: string; content: string }
): Promise<DigestRow> {
  const now = nowIso();
  await db
    .prepare(
      `INSERT INTO digest (namespace, content, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(namespace) DO UPDATE SET content = excluded.content, updated_at = excluded.updated_at`
    )
    .bind(input.namespace, input.content, now)
    .run();
  return { namespace: input.namespace, content: input.content, updated_at: now };
}

// =====================================================================
// L3 珍贵记录 precious (打标，含上下文，豁免去重/衰减/删)
// =====================================================================

export interface PreciousRow {
  id: string;
  namespace: string;
  content: string;
  context_message_ids: string | null;
  source: string;
  pinned: number;
  created_at: string;
  last_injected_at: string | null;
}

export interface CreatePreciousInput {
  namespace: string;
  content: string;
  contextMessageIds?: string[];
  source?: string;
}

export async function createPrecious(db: D1Database, input: CreatePreciousInput): Promise<PreciousRow> {
  const id = newId("pcz");
  const now = nowIso();
  const record: PreciousRow = {
    id,
    namespace: input.namespace,
    content: input.content,
    context_message_ids: JSON.stringify(input.contextMessageIds ?? []),
    source: input.source ?? "human",
    pinned: 1,
    created_at: now,
    last_injected_at: null
  };

  await db
    .prepare(
      `INSERT INTO precious (id, namespace, content, context_message_ids, source, pinned, created_at, last_injected_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      record.id,
      record.namespace,
      record.content,
      record.context_message_ids,
      record.source,
      record.pinned,
      record.created_at,
      record.last_injected_at
    )
    .run();

  return record;
}

export async function getPreciousById(
  db: D1Database,
  input: { namespace: string; id: string }
): Promise<PreciousRow | null> {
  const row = await db
    .prepare("SELECT * FROM precious WHERE namespace = ? AND id = ?")
    .bind(input.namespace, input.id)
    .first<PreciousRow>();
  return row ?? null;
}

export async function listPrecious(
  db: D1Database,
  input: { namespace: string; limit: number }
): Promise<PreciousRow[]> {
  const limit = Math.min(Math.max(Math.floor(input.limit), 1), 200);
  const result = await db
    .prepare(
      `SELECT * FROM precious WHERE namespace = ? AND pinned = 1
       ORDER BY created_at DESC LIMIT ?`
    )
    .bind(input.namespace, limit)
    .all<PreciousRow>();
  return result.results ?? [];
}

export async function deletePrecious(
  db: D1Database,
  input: { namespace: string; id: string }
): Promise<boolean> {
  const r = await db
    .prepare("DELETE FROM precious WHERE namespace = ? AND id = ?")
    .bind(input.namespace, input.id)
    .run();
  return (r.meta?.changes ?? 0) > 0;
}

// 闸三：记 last_injected_at，近期注入过的降权 (不动 importance/pinned)。
export async function markPreciousInjected(
  db: D1Database,
  input: { namespace: string; ids: string[] }
): Promise<void> {
  const ids = uniqueStrings(input.ids);
  if (ids.length === 0) return;
  const stamp = nowIso();
  for (let i = 0; i < ids.length; i += SQLITE_BIND_BATCH_SIZE) {
    const batch = ids.slice(i, i + SQLITE_BIND_BATCH_SIZE);
    const placeholders = batch.map(() => "?").join(", ");
    await db
      .prepare(
        `UPDATE precious SET last_injected_at = ? WHERE namespace = ? AND id IN (${placeholders})`
      )
      .bind(stamp, input.namespace, ...batch)
      .run();
  }
}

// =====================================================================
// L5 黑话 glossary (词面召回，不进向量库)
// 第 1 步精确匹配；BM25/FTS5 留到第 3 步。
// =====================================================================

export interface GlossaryRow {
  id: string;
  namespace: string;
  term: string;
  aliases: string | null;
  definition: string;
  examples: string | null;
  status: string;
  updated_at: string;
  last_seen_at: string | null;
  seen_count: number;
}

export interface UpsertGlossaryInput {
  namespace: string;
  term: string;
  aliases?: string[];
  definition: string;
  examples?: string[];
}

// upsert by (namespace, term)：同一个 term 改定义不新增。
export async function upsertGlossary(db: D1Database, input: UpsertGlossaryInput): Promise<GlossaryRow> {
  const now = nowIso();
  const existing = await db
    .prepare("SELECT * FROM glossary WHERE namespace = ? AND term = ?")
    .bind(input.namespace, input.term)
    .first<GlossaryRow>();

  if (existing) {
    await db
      .prepare(
        `UPDATE glossary SET aliases = ?, definition = ?, examples = ?, updated_at = ?
         WHERE namespace = ? AND id = ?`
      )
      .bind(
        JSON.stringify(input.aliases ?? []),
        input.definition,
        JSON.stringify(input.examples ?? []),
        now,
        input.namespace,
        existing.id
      )
      .run();
    return { ...existing, aliases: JSON.stringify(input.aliases ?? []), definition: input.definition, examples: JSON.stringify(input.examples ?? []), updated_at: now };
  }

  const id = newId("glo");
  const record: GlossaryRow = {
    id,
    namespace: input.namespace,
    term: input.term,
    aliases: JSON.stringify(input.aliases ?? []),
    definition: input.definition,
    examples: JSON.stringify(input.examples ?? []),
    status: "active",
    updated_at: now,
    last_seen_at: null,
    seen_count: 0
  };
  await db
    .prepare(
      `INSERT INTO glossary (id, namespace, term, aliases, definition, examples, status, updated_at, last_seen_at, seen_count)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(record.id, record.namespace, record.term, record.aliases, record.definition, record.examples, record.status, record.updated_at, record.last_seen_at, record.seen_count)
    .run();
  return record;
}

export async function listGlossary(
  db: D1Database,
  input: { namespace: string; status?: string }
): Promise<GlossaryRow[]> {
  const status = input.status ?? "active";
  const result = await db
    .prepare("SELECT * FROM glossary WHERE namespace = ? AND status = ? ORDER BY term")
    .bind(input.namespace, status)
    .all<GlossaryRow>();
  return result.results ?? [];
}

export async function updateGlossary(
  db: D1Database,
  input: { namespace: string; id: string; term?: string; aliases?: string[]; definition?: string; examples?: string[]; status?: string }
): Promise<GlossaryRow | null> {
  const existing = await db
    .prepare("SELECT * FROM glossary WHERE namespace = ? AND id = ?")
    .bind(input.namespace, input.id)
    .first<GlossaryRow>();
  if (!existing) return null;

  const term = input.term ?? existing.term;
  const aliases = input.aliases === undefined ? existing.aliases : JSON.stringify(input.aliases);
  const definition = input.definition ?? existing.definition;
  const examples = input.examples === undefined ? existing.examples : JSON.stringify(input.examples);
  const status = input.status ?? existing.status;
  const updatedAt = nowIso();

  await db
    .prepare(
      `UPDATE glossary
       SET term = ?, aliases = ?, definition = ?, examples = ?, status = ?, updated_at = ?
       WHERE namespace = ? AND id = ?`
    )
    .bind(term, aliases, definition, examples, status, updatedAt, input.namespace, input.id)
    .run();

  return {
    ...existing,
    term,
    aliases,
    definition,
    examples,
    status,
    updated_at: updatedAt
  };
}

export async function deleteGlossary(
  db: D1Database,
  input: { namespace: string; id: string }
): Promise<boolean> {
  const row = await updateGlossary(db, { namespace: input.namespace, id: input.id, status: "deleted" });
  return Boolean(row);
}

// 词面命中查询：term 或 任一 alias 作为子串出现在 query 里即命中。
// 母帖第二节："消息里一出现 term / alias 就静默注入 definition"——
// 不是要求整条 query 等于 term，而是 term 出现在 query 文本里。
// term 长度 < 2 的跳过 (避免单字符误命中)。
export async function matchGlossary(
  db: D1Database,
  input: { namespace: string; query: string }
): Promise<GlossaryRow[]> {
  const query = input.query.trim();
  if (!query) return [];

  const all = await listGlossary(db, { namespace: input.namespace });
  const lowered = query.toLowerCase();
  const hits: GlossaryRow[] = [];

  for (const row of all) {
    const termLower = row.term.toLowerCase();
    if (termLower.length >= 2 && lowered.includes(termLower)) {
      hits.push(row);
      continue;
    }

    let aliases: string[] = [];
    try {
      const parsed = JSON.parse(row.aliases ?? "[]") as unknown;
      if (Array.isArray(parsed)) aliases = parsed.filter((x): x is string => typeof x === "string");
    } catch {
      aliases = [];
    }
    if (aliases.some((a) => a.length >= 2 && lowered.includes(a.toLowerCase()))) {
      hits.push(row);
    }
  }

  return hits;
}

// =====================================================================
// L6 长尾收容所 longtail (raw 删除前遗物，只在前面全空时兜底)
// =====================================================================

export interface LongtailRow {
  id: string;
  namespace: string;
  content: string;
  ts: string;
  source_message_ids: string | null;
}

export async function createLongtail(
  db: D1Database,
  input: { namespace: string; content: string; sourceMessageIds?: string[] }
): Promise<LongtailRow> {
  const id = newId("lt");
  const now = nowIso();
  const record: LongtailRow = {
    id,
    namespace: input.namespace,
    content: input.content,
    ts: now,
    source_message_ids: JSON.stringify(input.sourceMessageIds ?? [])
  };
  await db
    .prepare("INSERT INTO longtail (id, namespace, content, ts, source_message_ids) VALUES (?, ?, ?, ?, ?)")
    .bind(record.id, record.namespace, record.content, record.ts, record.source_message_ids)
    .run();
  return record;
}

export async function listLongtail(
  db: D1Database,
  input: { namespace: string; limit: number }
): Promise<LongtailRow[]> {
  const limit = Math.min(Math.max(Math.floor(input.limit), 1), 200);
  const result = await db
    .prepare(
      `SELECT id, namespace, content, ts, source_message_ids
       FROM longtail
       WHERE namespace = ?
       ORDER BY ts DESC
       LIMIT ?`
    )
    .bind(input.namespace, limit)
    .all<LongtailRow>();
  return result.results ?? [];
}

export async function fetchLongtailByIds(
  db: D1Database,
  input: { namespace: string; ids: string[] }
): Promise<LongtailRow[]> {
  const ids = [...new Set(input.ids.map((id) => id.trim()).filter(Boolean))];
  if (ids.length === 0) return [];
  const placeholders = ids.map(() => "?").join(", ");
  const result = await db
    .prepare(
      `SELECT id, namespace, content, ts, source_message_ids
       FROM longtail
       WHERE namespace = ? AND id IN (${placeholders})`
    )
    .bind(input.namespace, ...ids)
    .all<LongtailRow>();
  return result.results ?? [];
}

function candidateLongtailRecordIds(id: string): string[] {
  const trimmed = id.trim();
  if (!trimmed) return [];
  const ids = [trimmed];
  if (trimmed.startsWith("lt_lt_")) ids.push(trimmed.slice("lt_".length));
  return [...new Set(ids)];
}

function candidateLongtailVectorIds(id: string): string[] {
  return [...new Set(candidateLongtailRecordIds(id).flatMap((recordId) => [recordId, `lt_${recordId}`]))];
}

export async function deleteLongtail(
  env: Env,
  input: { namespace: string; id: string }
): Promise<"deleted" | "not_found" | "vector_error"> {
  const recordIds = candidateLongtailRecordIds(input.id);
  if (recordIds.length === 0) return "not_found";
  const placeholders = recordIds.map(() => "?").join(", ");
  const existing = await env.DB
    .prepare(`SELECT id FROM longtail WHERE namespace = ? AND id IN (${placeholders}) LIMIT 1`)
    .bind(input.namespace, ...recordIds)
    .first<{ id: string }>();

  if (env.VECTORIZE) {
    try {
      const vectorIds = [
        ...candidateLongtailVectorIds(input.id),
        ...(existing ? candidateLongtailVectorIds(existing.id) : [])
      ];
      await env.VECTORIZE.deleteByIds([...new Set(vectorIds)]);
    } catch (error) {
      console.error("longtail vector delete failed, keeping D1 row", { id: input.id, error });
      return "vector_error";
    }
  }

  if (!existing) return "deleted";

  await env.DB
    .prepare("DELETE FROM longtail WHERE namespace = ? AND id = ?")
    .bind(input.namespace, existing.id)
    .run();
  return "deleted";
}

export interface MemoryTypeCount {
  type: string;
  count: number;
}

export async function countActiveMemoriesByType(
  db: D1Database,
  namespace: string
): Promise<MemoryTypeCount[]> {
  const result = await db
    .prepare(
      `SELECT type, COUNT(*) AS count
       FROM memories
       WHERE namespace = ? AND status = 'active'
       GROUP BY type
       ORDER BY type`
    )
    .bind(namespace)
    .all<MemoryTypeCount>();
  return result.results ?? [];
}

// L4 每区硬上限用：单个 type 当前 active 条数。
export async function countActiveMemoriesOfType(
  db: D1Database,
  input: { namespace: string; type: string }
): Promise<number> {
  const row = await db
    .prepare("SELECT COUNT(*) AS count FROM memories WHERE namespace = ? AND status = 'active' AND type = ?")
    .bind(input.namespace, input.type)
    .first<{ count: number }>();
  return row?.count ?? 0;
}

// 抽取器判重用：库里已有的 fact_key 列表，防止同一件事被重复造 key。
// fact_key 存在 memory_lifecycle 侧车表，不在 memories 本体 (见文件头注释)，所以要 join。
export async function listActiveFactKeys(
  db: D1Database,
  input: { namespace: string; limit?: number }
): Promise<string[]> {
  const limit = Math.min(Math.max(Math.floor(input.limit ?? 300), 1), 1000);
  const result = await db
    .prepare(
      `SELECT DISTINCT lc.fact_key AS fact_key
       FROM memories m
       JOIN memory_lifecycle lc ON lc.memory_id = m.id
       WHERE m.namespace = ? AND m.status = 'active' AND lc.fact_key IS NOT NULL AND lc.fact_key != ''
       ORDER BY lc.fact_key
       LIMIT ?`
    )
    .bind(input.namespace, limit)
    .all<{ fact_key: string }>();
  return (result.results ?? []).map((row) => row.fact_key);
}

export interface MemoryCandidateRow {
  id: string;
  namespace: string;
  type: string;
  content: string;
  fact_key: string | null;
  confidence: number;
  importance: number;
  tags: string | null;
  source_message_ids: string | null;
  source: string;
  status: string;
  target_memory_id: string | null;
  decision_note: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateMemoryCandidateInput {
  namespace: string;
  type: string;
  content: string;
  factKey?: string | null;
  confidence?: number;
  importance?: number;
  tags?: string[];
  sourceMessageIds?: string[];
  source?: string;
}

export async function createMemoryCandidate(
  db: D1Database,
  input: CreateMemoryCandidateInput
): Promise<MemoryCandidateRow> {
  const id = newId("cand");
  const now = nowIso();
  const record: MemoryCandidateRow = {
    id,
    namespace: input.namespace,
    type: clampMemoryType(input.type, "note"),
    content: input.content,
    fact_key: input.factKey ?? null,
    confidence: input.confidence ?? 0.5,
    importance: input.importance ?? 0.5,
    tags: JSON.stringify(input.tags ?? []),
    source_message_ids: JSON.stringify(input.sourceMessageIds ?? []),
    source: input.source ?? "extract",
    status: "pending",
    target_memory_id: null,
    decision_note: null,
    created_at: now,
    updated_at: now
  };

  await db
    .prepare(
      `INSERT INTO memory_candidates (
        id, namespace, type, content, fact_key, confidence, importance, tags,
        source_message_ids, source, status, target_memory_id, decision_note,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      record.id,
      record.namespace,
      record.type,
      record.content,
      record.fact_key,
      record.confidence,
      record.importance,
      record.tags,
      record.source_message_ids,
      record.source,
      record.status,
      record.target_memory_id,
      record.decision_note,
      record.created_at,
      record.updated_at
    )
    .run();

  return record;
}

export async function listMemoryCandidates(
  db: D1Database,
  input: { namespace: string; status?: string; limit: number }
): Promise<MemoryCandidateRow[]> {
  const limit = Math.min(Math.max(Math.floor(input.limit), 1), 200);
  const status = input.status ?? "pending";
  const result = await db
    .prepare(
      `SELECT *
       FROM memory_candidates
       WHERE namespace = ? AND status = ?
       ORDER BY confidence ASC, created_at DESC
       LIMIT ?`
    )
    .bind(input.namespace, status, limit)
    .all<MemoryCandidateRow>();
  return result.results ?? [];
}

export async function countMemoryCandidates(
  db: D1Database,
  input: { namespace: string; status?: string }
): Promise<number> {
  const status = input.status ?? "pending";
  const row = await db
    .prepare("SELECT COUNT(*) AS count FROM memory_candidates WHERE namespace = ? AND status = ?")
    .bind(input.namespace, status)
    .first<{ count: number }>();
  return row?.count ?? 0;
}

export async function getMemoryCandidateById(
  db: D1Database,
  input: { namespace: string; id: string }
): Promise<MemoryCandidateRow | null> {
  const row = await db
    .prepare("SELECT * FROM memory_candidates WHERE namespace = ? AND id = ?")
    .bind(input.namespace, input.id)
    .first<MemoryCandidateRow>();
  return row ?? null;
}

export async function updateMemoryCandidateStatus(
  db: D1Database,
  input: { namespace: string; id: string; status: string; targetMemoryId?: string | null; decisionNote?: string | null }
): Promise<MemoryCandidateRow | null> {
  const now = nowIso();
  await db
    .prepare(
      `UPDATE memory_candidates
       SET status = ?, target_memory_id = ?, decision_note = ?, updated_at = ?
       WHERE namespace = ? AND id = ?`
    )
    .bind(
      input.status,
      input.targetMemoryId ?? null,
      input.decisionNote ?? null,
      now,
      input.namespace,
      input.id
    )
    .run();
  return getMemoryCandidateById(db, input);
}

// =====================================================================
// memories v2: fact_key upsert + supersede (侧车表版)
// v2 字段 (fact_key/supersedes_*/last_injected_at 等) 进 memory_lifecycle 侧车表，
// 不在 memories 本体加列 (ALTER ADD COLUMN 不幂等，会让 fork 部署炸)。
// memories 表只写 v1 列 + status；侧车表靠 memory_id 关联，PRIMARY KEY 一对一。
// =====================================================================

export interface MemoryV2Patch {
  type?: string;
  content?: string;
  summary?: string | null;
  importance?: number;
  confidence?: number;
  status?: string;
  pinned?: boolean;
  tags?: string[];
  source?: string | null;
  sourceMessageIds?: string[];
  expiresAt?: string | null;
  factKey?: string | null;
  validAsOf?: string | null;
}

// D1 limits each statement to 100 bound variables. Some batched queries bind
// an extra leading param (e.g. last_injected_at) on top of the id placeholders,
// so N ids bind N+1 variables. Keep the batch size under 99 to stay safe; 90
// leaves headroom for any future extra params.
const SQLITE_BIND_BATCH_SIZE = 90;

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter((value) => value.trim()))];
}

// 批量查侧车行 (search.ts 合并 v2 字段用)。不存在的 memory_id 不返回。
// D1/SQLite has a hard variable limit; never put hundreds of ids into one IN (...).
export async function fetchMemoryLifecycleRows(
  db: D1Database,
  memoryIds: string[]
): Promise<MemoryLifecycleRow[]> {
  const ids = uniqueStrings(memoryIds);
  if (ids.length === 0) return [];

  const rows: MemoryLifecycleRow[] = [];
  for (let index = 0; index < ids.length; index += SQLITE_BIND_BATCH_SIZE) {
    const batch = ids.slice(index, index + SQLITE_BIND_BATCH_SIZE);
    const placeholders = batch.map(() => "?").join(", ");
    const result = await db
      .prepare(`SELECT * FROM memory_lifecycle WHERE memory_id IN (${placeholders})`)
      .bind(...batch)
      .all<MemoryLifecycleRow>();
    rows.push(...(result.results ?? []));
  }
  return rows;
}

// 按 fact_key upsert：同 namespace + fact_key 已有 active 就更新，否则新增。
// fact_key 语义：侧车表只有普通索引；应用层先查 active memories 对应的侧车行再写。
// status 在 memories 表，跨表 partial unique SQLite 做不到，并发窗口靠 D1 单写缩小。
// 同时写 D1 (本体) 和 Vectorize (检索镜像)，设 vector_id，否则 recall 召不到。
export async function upsertMemoryByFactKey(
  env: Env,
  input: { namespace: string; factKey: string; content: string; type?: string; importance?: number; confidence?: number; tags?: string[]; source?: string | null; sourceMessageIds?: string[]; validAsOf?: string | null }
): Promise<{ id: string; created: boolean }> {
  const db = env.DB;
  const now = nowIso();

  // 先查同 fact_key 的 active memory：memories join 侧车表。
  const existing = await db
    .prepare(
      `SELECT m.id FROM memories m
       JOIN memory_lifecycle lc ON lc.memory_id = m.id
       WHERE m.namespace = ? AND m.status = 'active' AND lc.fact_key = ?`
    )
    .bind(input.namespace, input.factKey)
    .first<{ id: string }>();

  if (existing) {
    // 更新 memories 本体 (v1 列)
    await db
      .prepare(
        `UPDATE memories SET content = ?, type = ?, importance = ?, confidence = ?,
          tags = ?, source = ?, source_message_ids = ?, updated_at = ?
         WHERE id = ?`
      )
      .bind(
        input.content,
        clampMemoryType(input.type, "fact"),
        input.importance ?? 0.6,
        input.confidence ?? 0.8,
        JSON.stringify(input.tags ?? []),
        input.source ?? null,
        JSON.stringify(input.sourceMessageIds ?? []),
        now,
        existing.id
      )
      .run();
    // 更新侧车表 v2 字段
    await db
      .prepare(
        `UPDATE memory_lifecycle SET valid_as_of = ?, last_seen_at = ?, seen_count = seen_count + 1
         WHERE memory_id = ?`
      )
      .bind(input.validAsOf ?? null, now, existing.id)
      .run();
    await syncMemoryVector(env, { namespace: input.namespace, id: existing.id });
    return { id: existing.id, created: false };
  }

  // 新增：先插 memories 本体 (v1 列 + vector_id)，再插侧车行。
  const id = newId("mem");
  const vectorId = `mem_${id}`;
  await db
    .prepare(
      `INSERT INTO memories (
        id, namespace, type, content, importance, confidence, status, pinned,
        tags, source, source_message_ids, vector_id, created_at, updated_at, expires_at
      ) VALUES (?, ?, ?, ?, ?, ?, 'active', 0, ?, ?, ?, ?, ?, ?, null)`
    )
    .bind(
      id,
      input.namespace,
      clampMemoryType(input.type, "fact"),
      input.content,
      input.importance ?? 0.6,
      input.confidence ?? 0.8,
      JSON.stringify(input.tags ?? []),
      input.source ?? null,
      JSON.stringify(input.sourceMessageIds ?? []),
      vectorId,
      now,
      now
    )
    .run();

  await db
    .prepare(
      `INSERT INTO memory_lifecycle (
        memory_id, namespace, fact_key, valid_as_of, last_seen_at, seen_count, last_injected_at
      ) VALUES (?, ?, ?, ?, ?, 0, NULL)`
    )
    .bind(id, input.namespace, input.factKey, input.validAsOf ?? null, now)
    .run();

  await syncMemoryVector(env, { namespace: input.namespace, id });
  return { id, created: true };
}

export interface ActiveFactKeyMemory {
  id: string;
  namespace: string;
  type: string;
  content: string;
  fact_key: string | null;
}

export async function getActiveMemoryByFactKey(
  db: D1Database,
  input: { namespace: string; factKey: string }
): Promise<ActiveFactKeyMemory | null> {
  const row = await db
    .prepare(
      `SELECT m.id, m.namespace, m.type, m.content, lc.fact_key
       FROM memories m
       JOIN memory_lifecycle lc ON lc.memory_id = m.id
       WHERE m.namespace = ? AND m.status = 'active' AND lc.fact_key = ?
       ORDER BY m.updated_at DESC
       LIMIT 1`
    )
    .bind(input.namespace, input.factKey)
    .first<ActiveFactKeyMemory>();
  return row ?? null;
}

export async function markMemorySeen(
  db: D1Database,
  input: { namespace: string; id: string }
): Promise<void> {
  const seenAt = nowIso();
  const ensureLifecycle = db
    .prepare(
      `INSERT OR IGNORE INTO memory_lifecycle (memory_id, namespace, seen_count, last_seen_at)
       VALUES (?, ?, 0, ?)`
    )
    .bind(input.id, input.namespace, seenAt);
  const markSeen = db
    .prepare(
      `UPDATE memory_lifecycle
       SET last_seen_at = ?, seen_count = seen_count + 1
       WHERE memory_id = ? AND namespace = ?`
    )
    .bind(seenAt, input.id, input.namespace);
  await db.batch([ensureLifecycle, markSeen]);
}

// 同步一条 memory 到 Vectorize。读 D1 全字段后 upsert embedding。
// 失败不抛错——D1 是本体，向量是镜像；向量失败不该阻断 D1 写入。
async function syncMemoryVector(
  env: Env,
  input: { namespace: string; id: string }
): Promise<void> {
  try {
    const record = await fetchMemoryForSync(env.DB, input);
    if (record) await upsertMemoryEmbedding(env, record);
  } catch (error) {
    console.error("v2 vector sync failed", { id: input.id, error });
  }
}

// supersede: 把 oldId 标 superseded，新条目进 active，supersede 链挂侧车表。
// memories 只改 status；侧车表记 supersedes_id / superseded_by_id / review_reason。
// 同时同步 Vectorize：新条目 upsert，旧条目下架 (向量库只索引 active)。
export async function supersedeMemory(
  env: Env,
  input: {
    namespace: string;
    oldId: string;
    newContent: string;
    newType?: string;
    newFactKey?: string | null;
    validAsOf?: string | null;
    reason?: string | null;
    importance?: number;
    confidence?: number;
    tags?: string[];
    source?: string | null;
    sourceMessageIds?: string[];
  }
): Promise<{ oldStatus: string; newId: string }> {
  const db = env.DB;
  const now = nowIso();
  const old = await db
    .prepare("SELECT id, status, vector_id FROM memories WHERE namespace = ? AND id = ?")
    .bind(input.namespace, input.oldId)
    .first<{ id: string; status: string; vector_id: string | null }>();
  if (!old) throw new Error("memory to supersede not found");

  const nextId = newId("mem");
  const nextVectorId = `mem_${nextId}`;
  const newFactKey = input.newFactKey ?? null;

  // 1. 旧条目标 superseded (memories 本体只改 status)
  await db
    .prepare("UPDATE memories SET status = 'superseded', updated_at = ? WHERE id = ?")
    .bind(now, old.id)
    .run();
  // 旧条目侧车行记 superseded_by_id + review_reason
  await db
    .prepare(
      `UPDATE memory_lifecycle SET superseded_by_id = ?, review_reason = ? WHERE memory_id = ?`
    )
    .bind(nextId, input.reason ?? null, old.id)
    .run();

  // 2. 插新条目 (memories 本体，v1 列)
  await db
    .prepare(
      `INSERT INTO memories (
        id, namespace, type, content, importance, confidence, status, pinned,
        tags, source, source_message_ids, vector_id, created_at, updated_at, expires_at
      ) VALUES (?, ?, ?, ?, ?, ?, 'active', 0, ?, ?, ?, ?, ?, ?, null)`
    )
    .bind(
      nextId,
      input.namespace,
      clampMemoryType(input.newType, "fact"),
      input.newContent,
      input.importance ?? 0.6,
      input.confidence ?? 0.8,
      JSON.stringify(input.tags ?? []),
      input.source ?? "supersede",
      JSON.stringify(input.sourceMessageIds ?? []),
      nextVectorId,
      now,
      now
    )
    .run();
  // 新条目侧车行记 supersedes_id + fact_key + valid_as_of
  await db
    .prepare(
      `INSERT INTO memory_lifecycle (
        memory_id, namespace, fact_key, supersedes_id, review_reason, valid_as_of, last_seen_at, seen_count, last_injected_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, NULL)`
    )
    .bind(nextId, input.namespace, newFactKey, old.id, input.reason ?? null, input.validAsOf ?? null, now)
    .run();

  // 3. 同步向量：新条目 upsert，旧条目下架
  await syncMemoryVector(env, { namespace: input.namespace, id: nextId });
  if (old.vector_id) {
    try {
      await env.VECTORIZE?.deleteByIds([old.vector_id]);
    } catch (error) {
      console.error("v2 vector delete (supersede old) failed", { id: old.id, error });
    }
  }

  return { oldStatus: old.status, newId: nextId };
}

// archive: 软下架，status='archived'，不动 supersede 链。
// 同时从 Vectorize 下架 (向量库只索引 active)。
export async function archiveMemory(
  env: Env,
  input: { namespace: string; id: string }
): Promise<boolean> {
  const db = env.DB;
  const now = nowIso();
  const existing = await db
    .prepare("SELECT id, vector_id FROM memories WHERE namespace = ? AND id = ?")
    .bind(input.namespace, input.id)
    .first<{ id: string; vector_id: string | null }>();
  if (!existing) return false;

  await db
    .prepare("UPDATE memories SET status = 'archived', updated_at = ? WHERE namespace = ? AND id = ?")
    .bind(now, input.namespace, input.id)
    .run();

  if (existing.vector_id) {
    try {
      await env.VECTORIZE?.deleteByIds([existing.vector_id]);
    } catch (error) {
      console.error("v2 vector delete (archive) failed", { id: input.id, error });
    }
  }
  return true;
}

// hard delete: D1 (本体+侧车) + 向量都删。memory_delete 在 v2 开时用。
export async function deleteMemoryV2(
  env: Env,
  input: { namespace: string; id: string }
): Promise<boolean> {
  const db = env.DB;
  const existing = await db
    .prepare("SELECT id, vector_id FROM memories WHERE namespace = ? AND id = ?")
    .bind(input.namespace, input.id)
    .first<{ id: string; vector_id: string | null }>();
  if (!existing) return false;

  // 先下架向量再删 D1：向量删除失败时保留 D1 作 tombstone，
  // 否则 searchWithVectorize 会把 stale vector 当 legacy 记录放回召回（删除后复活）。
  if (existing.vector_id && env.VECTORIZE) {
    try {
      await env.VECTORIZE.deleteByIds([existing.vector_id]);
    } catch (error) {
      console.error("v2 vector delete (hard) failed, keeping D1 tombstone", { id: input.id, error });
      return false;
    }
  }

  await db.prepare("DELETE FROM memory_lifecycle WHERE memory_id = ?").bind(input.id).run();
  await db
    .prepare("DELETE FROM memories WHERE namespace = ? AND id = ?")
    .bind(input.namespace, input.id)
    .run();
  return true;
}

// =====================================================================
// memories v2: 闸三 last_injected_at 降权记账 (写侧车表)
// =====================================================================

export async function markMemoriesInjected(
  db: D1Database,
  input: { namespace: string; ids: string[] }
): Promise<void> {
  const ids = uniqueStrings(input.ids);
  if (ids.length === 0) return;
  const injectedAt = nowIso();

  // 没有侧车行的 memory_id 用 INSERT OR IGNORE 自动建一行 (只有 last_injected_at)。
  // 这样老 v1 记忆第一次被注入也能记账。
  for (const id of ids) {
    await db
      .prepare(
        `INSERT OR IGNORE INTO memory_lifecycle (memory_id, namespace, seen_count, last_injected_at)
         VALUES (?, ?, 0, ?)`
      )
      .bind(id, input.namespace, injectedAt)
      .run();
  }

  for (let index = 0; index < ids.length; index += SQLITE_BIND_BATCH_SIZE) {
    const batch = ids.slice(index, index + SQLITE_BIND_BATCH_SIZE);
    const placeholders = batch.map(() => "?").join(", ");
    await db
      .prepare(
        `UPDATE memory_lifecycle SET last_injected_at = ? WHERE memory_id IN (${placeholders})`
      )
      .bind(injectedAt, ...batch)
      .run();
  }
}

export async function listActiveMemories(
  db: D1Database,
  input: { namespace: string; type?: string; limit: number }
): Promise<Array<{ id: string; content: string; type: string; fact_key: string | null; importance: number; last_injected_at: string | null }>> {
  const limit = Math.min(Math.max(Math.floor(input.limit), 1), 200);
  let sql = `SELECT m.id, m.content, m.type, lc.fact_key, m.importance, lc.last_injected_at
             FROM memories m
             LEFT JOIN memory_lifecycle lc ON lc.memory_id = m.id
             WHERE m.namespace = ? AND m.status = 'active'`;
  const binds: unknown[] = [input.namespace];
  if (input.type) {
    sql += " AND m.type = ?";
    binds.push(input.type);
  }
  sql += " ORDER BY m.pinned DESC, m.importance DESC, m.updated_at DESC LIMIT ?";
  binds.push(limit);
  const result = await db.prepare(sql).bind(...binds).all();
  return (result.results ?? []) as Array<{ id: string; content: string; type: string; fact_key: string | null; importance: number; last_injected_at: string | null }>;
}

// =====================================================================
// 昨天日志 daily_log (dream 每天写一条，boot 读"昨天")
// =====================================================================

export interface DailyLogRow {
  namespace: string;
  date: string;
  title: string;
  summary: string;
  updated_at: string;
}

export async function getDailyLog(
  db: D1Database,
  input: { namespace: string; date: string }
): Promise<DailyLogRow | null> {
  const row = await db
    .prepare("SELECT namespace, date, title, summary, updated_at FROM daily_log WHERE namespace = ? AND date = ?")
    .bind(input.namespace, input.date)
    .first<DailyLogRow>();
  return row ?? null;
}

export async function upsertDailyLog(
  db: D1Database,
  input: { namespace: string; date: string; title: string; summary: string }
): Promise<DailyLogRow> {
  const now = nowIso();
  await db
    .prepare(
      `INSERT INTO daily_log (namespace, date, title, summary, updated_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(namespace, date) DO UPDATE SET title = excluded.title, summary = excluded.summary, updated_at = excluded.updated_at`
    )
    .bind(input.namespace, input.date, input.title, input.summary, now)
    .run();
  return { namespace: input.namespace, date: input.date, title: input.title, summary: input.summary, updated_at: now };
}

// =====================================================================
// longtail 向量同步 (dream 种向量用)
// =====================================================================

export async function upsertLongtailEmbedding(
  env: Env,
  input: { id: string; namespace: string; content: string }
): Promise<void> {
  if (!env.VECTORIZE) return;
  const { createEmbedding } = await import("../memory/embedding");
  const vector = await createEmbedding(env, input.content);
  if (!vector) return;
  await env.VECTORIZE.upsert([
    {
      id: `lt_${input.id}`,
      namespace: input.namespace,
      values: vector,
      metadata: {
        namespace: input.namespace,
        kind: "longtail",
        ref_id: input.id,
        content: input.content
      }
    }
  ]);
}
