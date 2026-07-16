import { clampMemoryType } from "../../memory/canonicalTypes";
import { newId } from "../../utils/ids";
import { nowIso } from "../../utils/time";

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
  targetMemoryId?: string | null;
  decisionNote?: string | null;
}

export async function createMemoryCandidate(
  db: D1Database,
  input: CreateMemoryCandidateInput
): Promise<MemoryCandidateRow> {
  // 幂等闸：同一 namespace 下已有等价的 pending 候选就直接复用，不再入队。
  // dream 每晚重跑会对同一目标反复提删除/更新提案，没有这道闸队列会被灌满重复项。
  const dup = input.targetMemoryId
    ? await db
        .prepare(
          `SELECT * FROM memory_candidates
           WHERE namespace = ? AND status = 'pending' AND source = ? AND target_memory_id = ?
           LIMIT 1`
        )
        .bind(input.namespace, input.source ?? "extract", input.targetMemoryId)
        .first<MemoryCandidateRow>()
    : await db
        .prepare(
          `SELECT * FROM memory_candidates
           WHERE namespace = ? AND status = 'pending' AND source = ? AND content = ?
           LIMIT 1`
        )
        .bind(input.namespace, input.source ?? "extract", input.content)
        .first<MemoryCandidateRow>();
  if (dup) return dup;

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
    target_memory_id: input.targetMemoryId ?? null,
    decision_note: input.decisionNote ?? null,
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
