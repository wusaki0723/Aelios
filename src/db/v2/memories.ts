import { upsertMemoryEmbedding } from "../../memory/embedding";
import { clampMemoryType } from "../../memory/canonicalTypes";
import type {
  Env,
  MemoryLifecycleRow,
  MemoryRecord,
  PerceptionCacheItem,
  PerceptionCacheRow
} from "../../types";
import { newId } from "../../utils/ids";
import { nowIso } from "../../utils/time";
import { insertMemoryRelation } from "./relations";
import { SQLITE_BIND_BATCH_SIZE, uniqueStrings } from "./shared";

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
      `SELECT DISTINCT COALESCE(m.fact_key, lc.fact_key) AS fact_key
       FROM memories m
       LEFT JOIN memory_lifecycle lc ON lc.memory_id = m.id
       WHERE m.namespace = ? AND m.status = 'active'
         AND (m.version_status IS NULL OR m.version_status != 'superseded')
         AND COALESCE(m.fact_key, lc.fact_key) IS NOT NULL
         AND COALESCE(m.fact_key, lc.fact_key) != ''
       ORDER BY fact_key
       LIMIT ?`
    )
    .bind(input.namespace, limit)
    .all<{ fact_key: string }>();
  return (result.results ?? []).map((row) => row.fact_key);
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

  // 先查同 fact_key 的 current active memory：本体 fact_key 优先，侧车兜底。
  // version_status=superseded 不参与 upsert 命中（LMC-5）。
  const existing = await db
    .prepare(
      `SELECT m.id FROM memories m
       LEFT JOIN memory_lifecycle lc ON lc.memory_id = m.id
       WHERE m.namespace = ? AND m.status = 'active'
         AND (m.version_status IS NULL OR m.version_status IN ('current', 'under_review'))
         AND (m.fact_key = ? OR (m.fact_key IS NULL AND lc.fact_key = ?))
       ORDER BY m.updated_at DESC
       LIMIT 1`
    )
    .bind(input.namespace, input.factKey, input.factKey)
    .first<{ id: string }>();

  if (existing) {
    // 更新 memories 本体 (v1 列 + LMC-5 fact_key/version_status)
    await db
      .prepare(
        `UPDATE memories SET content = ?, type = ?, importance = ?, confidence = ?,
          tags = ?, source = ?, source_message_ids = ?, updated_at = ?,
          fact_key = ?, version_status = COALESCE(version_status, 'current')
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
        input.factKey,
        existing.id
      )
      .run();
    // 更新侧车表 v2 字段
    await db
      .prepare(
        `UPDATE memory_lifecycle SET fact_key = ?, valid_as_of = ?, last_seen_at = ?, seen_count = seen_count + 1
         WHERE memory_id = ?`
      )
      .bind(input.factKey, input.validAsOf ?? null, now, existing.id)
      .run();
    await syncMemoryVector(env, { namespace: input.namespace, id: existing.id });
    return { id: existing.id, created: false };
  }

  // 新增：先插 memories 本体 (v1 列 + vector_id + LMC-5 版本列)，再插侧车行。
  const id = newId("mem");
  const vectorId = `mem_${id}`;
  await db
    .prepare(
      `INSERT INTO memories (
        id, namespace, type, content, importance, confidence, status, pinned,
        tags, source, source_message_ids, vector_id, created_at, updated_at, expires_at,
        fact_key, version_status, superseded_by
      ) VALUES (?, ?, ?, ?, ?, ?, 'active', 0, ?, ?, ?, ?, ?, ?, null, ?, 'current', null)`
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
      now,
      input.factKey
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

export async function resolveMemoryFactKey(
  env: Env,
  id: string,
  namespace?: string
): Promise<string | null> {
  const row = await env.DB
    .prepare(
      `SELECT m.fact_key, m.namespace, m.status, m.version_status FROM memories m WHERE m.id = ?`
    )
    .bind(id)
    .first<{
      fact_key: string | null;
      namespace: string;
      status: string;
      version_status: string | null;
    }>();
  if (!row) return null;
  if (namespace && row.namespace !== namespace) return null;
  if (row.status !== "active" || row.version_status === "superseded") return null;
  if (row.fact_key) return row.fact_key;
  const lifecycle = await env.DB
    .prepare(`SELECT fact_key FROM memory_lifecycle WHERE memory_id = ?`)
    .bind(id)
    .first<{ fact_key: string | null }>();
  return lifecycle?.fact_key ?? null;
}

export async function getActiveMemoryByFactKey(
  db: D1Database,
  input: { namespace: string; factKey: string }
): Promise<ActiveFactKeyMemory | null> {
  const row = await db
    .prepare(
      `SELECT m.id, m.namespace, m.type, m.content, COALESCE(m.fact_key, lc.fact_key) AS fact_key
       FROM memories m
       LEFT JOIN memory_lifecycle lc ON lc.memory_id = m.id
       WHERE m.namespace = ? AND m.status = 'active'
         AND (m.version_status IS NULL OR m.version_status IN ('current', 'under_review'))
         AND (m.fact_key = ? OR (m.fact_key IS NULL AND lc.fact_key = ?))
       ORDER BY m.updated_at DESC
       LIMIT 1`
    )
    .bind(input.namespace, input.factKey, input.factKey)
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

// supersede: 把 oldId 标 superseded，新条目进 active。
// LMC-5 Z 轴: 旧条 status='superseded' + version_status='superseded' + superseded_by=新 id；
// 新条继承 fact_key (newFactKey 优先，否则沿用旧条)，version_status='current'。旧条不删。
// 侧车表仍写 supersedes_id / superseded_by_id / review_reason (兼容既有链查询)。
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
    .prepare(
      `SELECT id, status, vector_id, fact_key, type FROM memories WHERE namespace = ? AND id = ?`
    )
    .bind(input.namespace, input.oldId)
    .first<{
      id: string;
      status: string;
      vector_id: string | null;
      fact_key: string | null;
      type: string;
    }>();

  const nextId = newId("mem");
  const nextVectorId = `mem_${nextId}`;

  // 继承 fact_key：显式 newFactKey > 旧条本体 > 侧车
  let inheritedFactKey = input.newFactKey ?? null;
  if (inheritedFactKey === null || inheritedFactKey === undefined) {
    if (old?.fact_key) {
      inheritedFactKey = old.fact_key;
    } else if (old) {
      const lc = await db
        .prepare("SELECT fact_key FROM memory_lifecycle WHERE memory_id = ?")
        .bind(old.id)
        .first<{ fact_key: string | null }>();
      inheritedFactKey = lc?.fact_key ?? null;
    }
  }
  const newFactKey = inheritedFactKey;

  if (!old) {
    await db
      .prepare(
        `INSERT INTO memories (
          id, namespace, type, content, importance, confidence, status, pinned,
          tags, source, source_message_ids, vector_id, created_at, updated_at, expires_at,
          fact_key, version_status, superseded_by
        ) VALUES (?, ?, ?, ?, ?, ?, 'active', 0, ?, ?, ?, ?, ?, ?, null, ?, 'current', null)`
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
        now,
        newFactKey
      )
      .run();
    await db
      .prepare(
        `INSERT INTO memory_lifecycle (
          memory_id, namespace, fact_key, supersedes_id, review_reason, valid_as_of, last_seen_at, seen_count, last_injected_at
        ) VALUES (?, ?, ?, NULL, ?, ?, ?, 0, NULL)`
      )
      .bind(nextId, input.namespace, newFactKey, input.reason ?? null, input.validAsOf ?? null, now)
      .run();
    await syncMemoryVector(env, { namespace: input.namespace, id: nextId });
    return { oldStatus: "missing", newId: nextId };
  }

  // 1. 旧条：status + version_status + superseded_by (本体不删)
  await db
    .prepare(
      `UPDATE memories
       SET status = 'superseded', version_status = 'superseded', superseded_by = ?, updated_at = ?
       WHERE id = ?`
    )
    .bind(nextId, now, old.id)
    .run();
  // 确保旧条侧车行存在再更新
  await db
    .prepare(
      `INSERT OR IGNORE INTO memory_lifecycle (memory_id, namespace, seen_count)
       VALUES (?, ?, 0)`
    )
    .bind(old.id, input.namespace)
    .run();
  await db
    .prepare(
      `UPDATE memory_lifecycle SET superseded_by_id = ?, review_reason = ? WHERE memory_id = ?`
    )
    .bind(nextId, input.reason ?? null, old.id)
    .run();

  // 2. 插新条目 (current，继承 fact_key)
  await db
    .prepare(
      `INSERT INTO memories (
        id, namespace, type, content, importance, confidence, status, pinned,
        tags, source, source_message_ids, vector_id, created_at, updated_at, expires_at,
        fact_key, version_status, superseded_by
      ) VALUES (?, ?, ?, ?, ?, ?, 'active', 0, ?, ?, ?, ?, ?, ?, null, ?, 'current', null)`
    )
    .bind(
      nextId,
      input.namespace,
      clampMemoryType(input.newType ?? old.type, "fact"),
      input.newContent,
      input.importance ?? 0.6,
      input.confidence ?? 0.8,
      JSON.stringify(input.tags ?? []),
      input.source ?? "supersede",
      JSON.stringify(input.sourceMessageIds ?? []),
      nextVectorId,
      now,
      now,
      newFactKey
    )
    .run();
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
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        await env.VECTORIZE?.deleteByIds([old.vector_id]);
        break;
      } catch (error) {
        if (attempt === 0) continue;
        console.error("v2 vector delete (supersede old) failed", { id: old.id, error });
      }
    }
  }

  // 4. 可选：建 supersedes 边 (Y 轴，幂等)
  try {
    await insertMemoryRelation(db, {
      srcId: nextId,
      dstId: old.id,
      relType: "supersedes",
      weight: 1.0,
      createdBy: "manual"
    });
  } catch (error) {
    console.warn("v2 supersede relation edge insert failed", { oldId: old.id, newId: nextId, error });
  }

  return { oldStatus: old.status, newId: nextId };
}

// LMC-5 Z 轴: 把一对 current 事实标 under_review（不 supersede、不改 status=active）。
export async function markMemoriesUnderReview(
  db: D1Database,
  input: { namespace: string; ids: string[]; reason?: string | null }
): Promise<number> {
  const ids = uniqueStrings(input.ids);
  if (ids.length === 0) return 0;
  const now = nowIso();
  let changed = 0;
  for (const id of ids) {
    const r = await db
      .prepare(
        `UPDATE memories
         SET version_status = 'under_review', updated_at = ?
         WHERE namespace = ? AND id = ?
           AND status = 'active'
           AND (version_status IS NULL OR version_status = 'current' OR version_status = 'under_review')`
      )
      .bind(now, input.namespace, id)
      .run();
    if ((r.meta?.changes ?? 0) > 0) changed += 1;
    if (input.reason) {
      await db
        .prepare(
          `INSERT OR IGNORE INTO memory_lifecycle (memory_id, namespace, seen_count) VALUES (?, ?, 0)`
        )
        .bind(id, input.namespace)
        .run();
      await db
        .prepare(
          `UPDATE memory_lifecycle SET review_reason = ? WHERE memory_id = ? AND namespace = ?`
        )
        .bind(input.reason, id, input.namespace)
        .run();
    }
  }
  return changed;
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
  // INSERT-before-UPDATE order preserved; statements batched for D1 latency.
  const statements: D1PreparedStatement[] = ids.map((id) =>
    db
      .prepare(
        `INSERT OR IGNORE INTO memory_lifecycle (memory_id, namespace, seen_count, last_injected_at)
         VALUES (?, ?, 0, ?)`
      )
      .bind(id, input.namespace, injectedAt)
  );

  for (let index = 0; index < ids.length; index += SQLITE_BIND_BATCH_SIZE) {
    const batch = ids.slice(index, index + SQLITE_BIND_BATCH_SIZE);
    const placeholders = batch.map(() => "?").join(", ");
    statements.push(
      db
        .prepare(
          `UPDATE memory_lifecycle SET last_injected_at = ? WHERE memory_id IN (${placeholders})`
        )
        .bind(injectedAt, ...batch)
    );
  }

  for (let index = 0; index < statements.length; index += SQLITE_BIND_BATCH_SIZE) {
    await db.batch(statements.slice(index, index + SQLITE_BIND_BATCH_SIZE));
  }
}

export async function listActiveMemories(
  db: D1Database,
  input: { namespace: string; type?: string; limit: number }
): Promise<Array<{ id: string; content: string; type: string; fact_key: string | null; importance: number; last_injected_at: string | null }>> {
  const limit = Math.min(Math.max(Math.floor(input.limit), 1), 200);
  let sql = `SELECT m.id, m.content, m.type, COALESCE(m.fact_key, lc.fact_key) AS fact_key, m.importance, lc.last_injected_at
             FROM memories m
             LEFT JOIN memory_lifecycle lc ON lc.memory_id = m.id
             WHERE m.namespace = ? AND m.status = 'active'
               AND (m.version_status IS NULL OR m.version_status != 'superseded')`;
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

export async function listMemoriesUpdatedInRange(
  db: D1Database,
  input: { namespace: string; startIso: string; endIso: string; limit?: number }
): Promise<Array<{ id: string; content: string; type: string; vector_id: string | null; fact_key: string | null }>> {
  const limit = Math.min(Math.max(Math.floor(input.limit ?? 200), 1), 500);
  const result = await db
    .prepare(
      `SELECT id, content, type, vector_id, fact_key
       FROM memories
       WHERE namespace = ?
         AND status = 'active'
         AND (version_status IS NULL OR version_status != 'superseded')
         AND updated_at >= ? AND updated_at < ?
       ORDER BY updated_at DESC
       LIMIT ?`
    )
    .bind(input.namespace, input.startIso, input.endIso, limit)
    .all<{ id: string; content: string; type: string; vector_id: string | null; fact_key: string | null }>();
  return result.results ?? [];
}

// 梦境收成 (dream harvest)：当天夜里新写入的记忆，不看 status——
// 当夜出生又被替代的也算新生，状态交给前端展示。
export async function listMemoriesCreatedInRange(
  db: D1Database,
  input: { namespace: string; startIso: string; endIso: string; limit?: number }
): Promise<Array<{ id: string; type: string; content: string; importance: number; status: string; created_at: string }>> {
  const limit = Math.min(Math.max(Math.floor(input.limit ?? 200), 1), 500);
  const result = await db
    .prepare(
      `SELECT id, type, content, importance, status, created_at
       FROM memories
       WHERE namespace = ?
         AND created_at >= ? AND created_at < ?
       ORDER BY created_at DESC
       LIMIT ?`
    )
    .bind(input.namespace, input.startIso, input.endIso, limit)
    .all<{ id: string; type: string; content: string; importance: number; status: string; created_at: string }>();
  return result.results ?? [];
}

// 梦境收成：当天转入沉眠的记忆 (superseded / archived)，superseded_by 指出被谁接替。
export async function listMemoriesGoneDormantInRange(
  db: D1Database,
  input: { namespace: string; startIso: string; endIso: string; limit?: number }
): Promise<Array<{ id: string; type: string; content: string; importance: number; status: string; superseded_by: string | null; updated_at: string }>> {
  const limit = Math.min(Math.max(Math.floor(input.limit ?? 200), 1), 500);
  const result = await db
    .prepare(
      `SELECT id, type, content, importance, status, superseded_by, updated_at
       FROM memories
       WHERE namespace = ?
         AND status IN ('superseded', 'archived')
         AND updated_at >= ? AND updated_at < ?
       ORDER BY updated_at DESC
       LIMIT ?`
    )
    .bind(input.namespace, input.startIso, input.endIso, limit)
    .all<{ id: string; type: string; content: string; importance: number; status: string; superseded_by: string | null; updated_at: string }>();
  return result.results ?? [];
}

// 同 fact_key 的 current/active 多版本对 (z_audit 用)
export async function listDuplicateFactKeyGroups(
  db: D1Database,
  input: { namespace: string; limit?: number }
): Promise<Array<{ fact_key: string; ids: string[] }>> {
  const limit = Math.min(Math.max(Math.floor(input.limit ?? 50), 1), 200);
  // 优先 memories.fact_key，并入 lifecycle 兜底
  const result = await db
    .prepare(
      `SELECT COALESCE(m.fact_key, lc.fact_key) AS fact_key, m.id AS id
       FROM memories m
       LEFT JOIN memory_lifecycle lc ON lc.memory_id = m.id
       WHERE m.namespace = ?
         AND m.status = 'active'
         AND (m.version_status IS NULL OR m.version_status IN ('current', 'under_review'))
         AND COALESCE(m.fact_key, lc.fact_key) IS NOT NULL
         AND COALESCE(m.fact_key, lc.fact_key) != ''
       ORDER BY fact_key, m.updated_at DESC`
    )
    .bind(input.namespace)
    .all<{ fact_key: string; id: string }>();

  const groups = new Map<string, string[]>();
  for (const row of result.results ?? []) {
    const list = groups.get(row.fact_key) ?? [];
    list.push(row.id);
    groups.set(row.fact_key, list);
  }
  return [...groups.entries()]
    .filter(([, ids]) => ids.length >= 2)
    .slice(0, limit)
    .map(([fact_key, ids]) => ({ fact_key, ids }));
}

// =====================================================================
// LMC-5 spontaneous: perception_cache
// =====================================================================

export async function upsertPerceptionCache(
  db: D1Database,
  input: { namespace: string; date: string; items: PerceptionCacheItem[] }
): Promise<PerceptionCacheRow> {
  const now = nowIso();
  const itemsJson = JSON.stringify(input.items.slice(0, 2));
  await db
    .prepare(
      `INSERT INTO perception_cache (namespace, date, items, created_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(namespace, date) DO UPDATE SET
         items = excluded.items,
         created_at = excluded.created_at`
    )
    .bind(input.namespace, input.date, itemsJson, now)
    .run();
  return { namespace: input.namespace, date: input.date, items: itemsJson, created_at: now };
}

export async function getPerceptionCache(
  db: D1Database,
  input: { namespace: string; date: string }
): Promise<PerceptionCacheRow | null> {
  const row = await db
    .prepare("SELECT namespace, date, items, created_at FROM perception_cache WHERE namespace = ? AND date = ?")
    .bind(input.namespace, input.date)
    .first<PerceptionCacheRow>();
  return row ?? null;
}

export function parsePerceptionItems(row: PerceptionCacheRow | null): PerceptionCacheItem[] {
  if (!row?.items) return [];
  try {
    const parsed = JSON.parse(row.items) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .flatMap((item): PerceptionCacheItem[] => {
        if (!item || typeof item !== "object" || Array.isArray(item)) return [];
        const rec = item as Record<string, unknown>;
        const id = typeof rec.id === "string" ? rec.id : "";
        const content = typeof rec.content === "string" ? rec.content : "";
        if (!id || !content) return [];
        const importance =
          typeof rec.importance === "number" && Number.isFinite(rec.importance) ? rec.importance : 0.5;
        return [{ id, content, importance }];
      })
      .slice(0, 2);
  } catch {
    return [];
  }
}

// perception picker 候选：importance 高 + 近 7 天未召回 + active/current
export async function listPerceptionCandidates(
  db: D1Database,
  input: {
    namespace: string;
    minImportance?: number;
    notRecalledSinceIso: string;
    excludeIds?: string[];
    limit?: number;
  }
): Promise<Array<{ id: string; content: string; importance: number; last_recalled_at: string | null }>> {
  const limit = Math.min(Math.max(Math.floor(input.limit ?? 20), 1), 100);
  const minImportance = input.minImportance ?? 0.7;
  const result = await db
    .prepare(
      `SELECT id, content, importance, last_recalled_at
       FROM memories
       WHERE namespace = ?
         AND status = 'active'
         AND (version_status IS NULL OR version_status IN ('current', 'under_review'))
         AND importance >= ?
         AND (last_recalled_at IS NULL OR last_recalled_at < ?)
       ORDER BY importance DESC, updated_at DESC
       LIMIT ?`
    )
    .bind(input.namespace, minImportance, input.notRecalledSinceIso, limit)
    .all<{ id: string; content: string; importance: number; last_recalled_at: string | null }>();

  const exclude = new Set(input.excludeIds ?? []);
  return (result.results ?? []).filter((row) => !exclude.has(row.id));
}
