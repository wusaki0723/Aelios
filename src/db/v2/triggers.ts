// memory_triggers CRUD (migration 0016)。
// D1 是本体，Vectorize 是检索镜像——与 memories 同一套约定。
// 只管读写，开关判断在 src/memory/triggers/。

import { nowIso } from "../../utils/time";
import { SQLITE_BIND_BATCH_SIZE, uniqueStrings } from "./shared";

export interface MemoryTriggerRow {
  id: number;
  namespace: string;
  memory_id: string;
  concept: string;
  bridge: string;
  confidence: number;
  vector_id: string | null;
  created_by: string | null;
  created_at: string;
}

export interface MemoryTriggerInput {
  namespace: string;
  memoryId: string;
  concept: string;
  bridge: string;
  confidence: number;
  vectorId: string;
  createdBy?: string | null;
}

// UNIQUE(memory_id, concept) 幂等：重建同一条触发器时更新 bridge/confidence/vector_id，
// 不产生第二行，也不换 id。
export async function upsertMemoryTrigger(
  db: D1Database,
  input: MemoryTriggerInput
): Promise<void> {
  const concept = input.concept.trim();
  if (!input.namespace || !input.memoryId || !concept) return;
  await db
    .prepare(
      `INSERT INTO memory_triggers
         (namespace, memory_id, concept, bridge, confidence, vector_id, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(memory_id, concept) DO UPDATE SET
         bridge = excluded.bridge,
         confidence = excluded.confidence,
         vector_id = excluded.vector_id`
    )
    .bind(
      input.namespace,
      input.memoryId,
      concept,
      input.bridge,
      input.confidence,
      input.vectorId,
      input.createdBy ?? null,
      nowIso()
    )
    .run();
}

// 召回热路径：拿命中的 vector_id 反查它挂着哪条记忆。
export async function listTriggersByVectorIds(
  db: D1Database,
  vectorIds: string[]
): Promise<MemoryTriggerRow[]> {
  const ids = uniqueStrings(vectorIds);
  if (ids.length === 0) return [];
  const out: MemoryTriggerRow[] = [];
  for (let i = 0; i < ids.length; i += SQLITE_BIND_BATCH_SIZE) {
    const batch = ids.slice(i, i + SQLITE_BIND_BATCH_SIZE);
    const placeholders = batch.map(() => "?").join(",");
    const result = await db
      .prepare(
        `SELECT id, namespace, memory_id, concept, bridge, confidence, vector_id, created_by, created_at
           FROM memory_triggers
          WHERE vector_id IN (${placeholders})`
      )
      .bind(...batch)
      .all<MemoryTriggerRow>();
    out.push(...(result.results ?? []));
  }
  return out;
}

export async function listTriggersForMemory(
  db: D1Database,
  memoryId: string
): Promise<MemoryTriggerRow[]> {
  if (!memoryId) return [];
  const result = await db
    .prepare(
      `SELECT id, namespace, memory_id, concept, bridge, confidence, vector_id, created_by, created_at
         FROM memory_triggers
        WHERE memory_id = ?
        ORDER BY confidence DESC`
    )
    .bind(memoryId)
    .all<MemoryTriggerRow>();
  return result.results ?? [];
}

// 记忆被删/被 supersede 时把它的触发器一起摘掉，返回要从 Vectorize 删的 vector_id。
export async function deleteTriggersForMemory(
  db: D1Database,
  memoryId: string
): Promise<string[]> {
  if (!memoryId) return [];
  const rows = await listTriggersForMemory(db, memoryId);
  await db.prepare("DELETE FROM memory_triggers WHERE memory_id = ?").bind(memoryId).run();
  return rows
    .map((row) => row.vector_id)
    .filter((id): id is string => typeof id === "string" && id.length > 0);
}

export async function countTriggers(db: D1Database, namespace: string): Promise<number> {
  const row = await db
    .prepare("SELECT COUNT(*) AS n FROM memory_triggers WHERE namespace = ?")
    .bind(namespace)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

// 已经有触发器的记忆不重复建（建期成本是 LLM 调用，不能每晚重跑全量）。
export async function listMemoryIdsWithTriggers(
  db: D1Database,
  namespace: string,
  memoryIds: string[]
): Promise<Set<string>> {
  const ids = uniqueStrings(memoryIds);
  const out = new Set<string>();
  if (ids.length === 0) return out;
  for (let i = 0; i < ids.length; i += SQLITE_BIND_BATCH_SIZE) {
    const batch = ids.slice(i, i + SQLITE_BIND_BATCH_SIZE);
    const placeholders = batch.map(() => "?").join(",");
    const result = await db
      .prepare(
        `SELECT DISTINCT memory_id FROM memory_triggers
          WHERE namespace = ? AND memory_id IN (${placeholders})`
      )
      .bind(namespace, ...batch)
      .all<{ memory_id: string }>();
    for (const row of result.results ?? []) out.add(row.memory_id);
  }
  return out;
}
