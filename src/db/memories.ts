import type { MemoryRecord } from "../types";
import { newId } from "../utils/ids";
import { nowIso } from "../utils/time";

export interface CreateMemoryInput {
  namespace: string;
  type: string;
  content: string;
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
  thread?: string | null;
  riskLevel?: string | null;
  urgencyLevel?: string | null;
  tensionScore?: number | null;
  responsePosture?: string | null;
  auditState?: string | null;
  vectorSyncStatus?: string | null;
}

export interface ListMemoryFilters {
  namespace: string;
  type?: string;
  status?: string;
  thread?: string;
  factKey?: string;
  limit: number;
  offset?: number;
}

export interface ListMemoryPage {
  records: MemoryRecord[];
  hasMore: boolean;
  nextOffset: number | null;
}

export interface UpdateMemoryInput {
  type?: string;
  content?: string;
  summary?: string | null;
  importance?: number;
  confidence?: number;
  status?: string;
  pinned?: boolean;
  tags?: string[];
  sourceMessageIds?: string[];
  expiresAt?: string | null;
  factKey?: string | null;
  thread?: string | null;
  riskLevel?: string | null;
  urgencyLevel?: string | null;
  tensionScore?: number | null;
  responsePosture?: string | null;
  auditState?: string | null;
  vectorSyncStatus?: string | null;
}

export async function createMemory(db: D1Database, input: CreateMemoryInput): Promise<MemoryRecord> {
  const id = newId("mem");
  const now = nowIso();
  const vectorId = `mem_${id}`;
  const record: MemoryRecord = {
    id,
    namespace: input.namespace,
    type: input.type,
    content: input.content,
    summary: input.summary ?? null,
    importance: input.importance ?? 0.5,
    confidence: input.confidence ?? 0.8,
    status: input.status ?? "active",
    pinned: input.pinned ? 1 : 0,
    tags: JSON.stringify(input.tags ?? []),
    source: input.source ?? null,
    source_message_ids: JSON.stringify(input.sourceMessageIds ?? []),
    vector_id: vectorId,
    last_recalled_at: null,
    recall_count: 0,
    created_at: now,
    updated_at: now,
    expires_at: input.expiresAt ?? null,
    fact_key: input.factKey ?? null,
    thread: input.thread ?? null,
    risk_level: input.riskLevel ?? null,
    urgency_level: input.urgencyLevel ?? null,
    tension_score: input.tensionScore ?? null,
    response_posture: input.responsePosture ?? null,
    audit_state: input.auditState ?? null,
    vector_sync_status: input.vectorSyncStatus ?? null
  };

  await db
    .prepare(
      `INSERT INTO memories (
        id, namespace, type, content, summary, importance, confidence, status,
        pinned, tags, source, source_message_ids, vector_id, created_at, updated_at, expires_at,
        fact_key, thread, risk_level, urgency_level, tension_score, response_posture,
        audit_state, vector_sync_status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      record.id,
      record.namespace,
      record.type,
      record.content,
      record.summary,
      record.importance,
      record.confidence,
      record.status,
      record.pinned,
      record.tags,
      record.source,
      record.source_message_ids,
      record.vector_id,
      record.created_at,
      record.updated_at,
      record.expires_at,
      record.fact_key,
      record.thread,
      record.risk_level,
      record.urgency_level,
      record.tension_score,
      record.response_posture,
      record.audit_state,
      record.vector_sync_status
    )
    .run();

  return record;
}

export async function listMemoriesPage(db: D1Database, filters: ListMemoryFilters): Promise<ListMemoryPage> {
  let sql = "SELECT * FROM memories WHERE namespace = ?";
  const binds: unknown[] = [filters.namespace];

  if (filters.type) {
    sql += " AND type = ?";
    binds.push(filters.type);
  }

  if (filters.status) {
    sql += " AND status = ?";
    binds.push(filters.status);
  }

  if (filters.thread) {
    sql += " AND thread = ?";
    binds.push(filters.thread);
  }

  if (filters.factKey) {
    sql += " AND fact_key = ?";
    binds.push(filters.factKey);
  }

  const offset = Math.max(Math.floor(filters.offset ?? 0), 0);
  const limit = Math.max(Math.floor(filters.limit), 1);
  sql += " ORDER BY pinned DESC, importance DESC, updated_at DESC LIMIT ? OFFSET ?";
  binds.push(limit + 1, offset);

  const result = await db
    .prepare(sql)
    .bind(...binds)
    .all<MemoryRecord>();

  const rows = result.results ?? [];
  const records = rows.slice(0, limit);

  return {
    records,
    hasMore: rows.length > limit,
    nextOffset: rows.length > limit ? offset + records.length : null
  };
}

export async function listMemories(db: D1Database, filters: ListMemoryFilters): Promise<MemoryRecord[]> {
  const page = await listMemoriesPage(db, filters);
  return page.records;
}

export async function getMemoryById(
  db: D1Database,
  input: { namespace: string; id: string }
): Promise<MemoryRecord | null> {
  const record = await db
    .prepare("SELECT * FROM memories WHERE namespace = ? AND id = ?")
    .bind(input.namespace, input.id)
    .first<MemoryRecord>();

  return record ?? null;
}

export async function fetchMemoriesByIds(
  db: D1Database,
  input: { namespace: string; ids: string[] }
): Promise<MemoryRecord[]> {
  if (input.ids.length === 0) return [];

  const D1_IN_BATCH_SIZE = 90;
  const results: MemoryRecord[] = [];

  for (let i = 0; i < input.ids.length; i += D1_IN_BATCH_SIZE) {
    const batch = input.ids.slice(i, i + D1_IN_BATCH_SIZE);
    const placeholders = batch.map(() => "?").join(", ");
    const result = await db
      .prepare(`SELECT * FROM memories WHERE namespace = ? AND id IN (${placeholders})`)
      .bind(input.namespace, ...batch)
      .all<MemoryRecord>();
    results.push(...(result.results ?? []));
  }

  return results;
}

export async function updateMemory(
  db: D1Database,
  input: { namespace: string; id: string; patch: UpdateMemoryInput }
): Promise<MemoryRecord | null> {
  const assignments: string[] = [];
  const binds: unknown[] = [];

  function set(column: string, value: unknown): void {
    assignments.push(`${column} = ?`);
    binds.push(value);
  }

  if (input.patch.type !== undefined) set("type", input.patch.type);
  if (input.patch.content !== undefined) set("content", input.patch.content);
  if (input.patch.summary !== undefined) set("summary", input.patch.summary);
  if (input.patch.importance !== undefined) set("importance", input.patch.importance);
  if (input.patch.confidence !== undefined) set("confidence", input.patch.confidence);
  if (input.patch.status !== undefined) set("status", input.patch.status);
  if (input.patch.pinned !== undefined) set("pinned", input.patch.pinned ? 1 : 0);
  if (input.patch.tags !== undefined) set("tags", JSON.stringify(input.patch.tags));
  if (input.patch.sourceMessageIds !== undefined) set("source_message_ids", JSON.stringify(input.patch.sourceMessageIds));
  if (input.patch.expiresAt !== undefined) set("expires_at", input.patch.expiresAt);
  if (input.patch.factKey !== undefined) set("fact_key", input.patch.factKey);
  if (input.patch.thread !== undefined) set("thread", input.patch.thread);
  if (input.patch.riskLevel !== undefined) set("risk_level", input.patch.riskLevel);
  if (input.patch.urgencyLevel !== undefined) set("urgency_level", input.patch.urgencyLevel);
  if (input.patch.tensionScore !== undefined) set("tension_score", input.patch.tensionScore);
  if (input.patch.responsePosture !== undefined) set("response_posture", input.patch.responsePosture);
  if (input.patch.auditState !== undefined) set("audit_state", input.patch.auditState);
  if (input.patch.vectorSyncStatus !== undefined) set("vector_sync_status", input.patch.vectorSyncStatus);

  if (assignments.length === 0) {
    return getMemoryById(db, input);
  }

  set("updated_at", nowIso());

  await db
    .prepare(`UPDATE memories SET ${assignments.join(", ")} WHERE namespace = ? AND id = ?`)
    .bind(...binds, input.namespace, input.id)
    .run();

  return getMemoryById(db, input);
}

export async function softDeleteMemory(
  db: D1Database,
  input: { namespace: string; id: string }
): Promise<MemoryRecord | null> {
  return updateMemory(db, {
    namespace: input.namespace,
    id: input.id,
    patch: {
      status: "deleted"
    }
  });
}

export async function listActiveMemoriesByFactKey(
  db: D1Database,
  input: { namespace: string; factKey: string; limit?: number }
): Promise<MemoryRecord[]> {
  const factKey = input.factKey.trim();
  if (!factKey) return [];
  const limit = Math.min(Math.max(Math.floor(input.limit ?? 10), 1), 50);
  const result = await db
    .prepare(
      `SELECT * FROM memories
       WHERE namespace = ?
         AND fact_key = ?
         AND status = 'active'
       ORDER BY pinned DESC, updated_at DESC
       LIMIT ?`
    )
    .bind(input.namespace, factKey, limit)
    .all<MemoryRecord>();
  return result.results ?? [];
}

export async function listMemoriesSince(
  db: D1Database,
  input: { namespace: string; since: string; limit?: number }
): Promise<MemoryRecord[]> {
  const limit = Math.min(Math.max(Math.floor(input.limit ?? 500), 1), 1000);
  const result = await db
    .prepare(
      `SELECT * FROM memories
       WHERE namespace = ?
         AND created_at >= ?
         AND status = 'active'
       ORDER BY created_at ASC
       LIMIT ?`
    )
    .bind(input.namespace, input.since, limit)
    .all<MemoryRecord>();
  return result.results ?? [];
}

export async function listFactKeyConflicts(
  db: D1Database,
  input: { namespace: string; limit?: number }
): Promise<Array<{ fact_key: string; ids: string; count: number }>> {
  const limit = Math.min(Math.max(Math.floor(input.limit ?? 100), 1), 1000);
  const result = await db
    .prepare(
      `SELECT fact_key, group_concat(id) AS ids, count(*) AS count
       FROM memories
       WHERE namespace = ?
         AND fact_key IS NOT NULL
         AND fact_key != ''
         AND status IN ('active', 'review')
       GROUP BY fact_key
       HAVING count(*) > 1
       ORDER BY count DESC, fact_key
       LIMIT ?`
    )
    .bind(input.namespace, limit)
    .all<{ fact_key: string; ids: string; count: number }>();
  return result.results ?? [];
}

export async function listExperienceSimilarMemories(
  db: D1Database,
  input: {
    namespace: string;
    riskLevel?: string | null;
    urgencyLevel?: string | null;
    tensionScore?: number | null;
    excludeIds: string[];
    limit: number;
  }
): Promise<Array<MemoryRecord & { score: number }>> {
  const binds: unknown[] = [input.namespace, ...input.excludeIds];
  const excludeClause = input.excludeIds.length > 0 ? `AND id NOT IN (${input.excludeIds.map(() => "?").join(", ")})` : "";
  const clauses: string[] = ["namespace = ?", "status = 'active'"];
  if (excludeClause) clauses.push(excludeClause.slice(4));
  if (input.riskLevel) {
    clauses.push("risk_level = ?");
    binds.push(input.riskLevel);
  }
  if (input.urgencyLevel) {
    clauses.push("urgency_level = ?");
    binds.push(input.urgencyLevel);
  }
  if (typeof input.tensionScore === "number" && Number.isFinite(input.tensionScore)) {
    clauses.push("tension_score IS NOT NULL");
  }
  binds.push(Math.min(Math.max(Math.floor(input.limit), 1), 50));

  const result = await db
    .prepare(
      `SELECT * FROM memories
       WHERE ${clauses.join(" AND ")}
       ORDER BY importance DESC, updated_at DESC
       LIMIT ?`
    )
    .bind(...binds)
    .all<MemoryRecord>();

  const tension = input.tensionScore;
  return (result.results ?? []).map((record) => {
    const tensionScore =
      typeof tension === "number" && typeof record.tension_score === "number"
        ? Math.max(0, 1 - Math.abs(record.tension_score - tension))
        : 0.5;
    const riskScore = input.riskLevel && record.risk_level === input.riskLevel ? 0.2 : 0;
    const urgencyScore = input.urgencyLevel && record.urgency_level === input.urgencyLevel ? 0.2 : 0;
    return { ...record, score: Math.min(0.78, 0.35 + tensionScore * 0.25 + riskScore + urgencyScore) };
  });
}

export async function searchMemoriesByText(
  db: D1Database,
  input: { namespace: string; query: string; types?: string[]; limit: number }
): Promise<Array<MemoryRecord & { score: number }>> {
  const query = input.query.trim().replace(/\s+/g, " ").slice(0, 500);
  const like = `%${query.replace(/[\\%_]/g, "\\$&")}%`;
  let sql = "SELECT * FROM memories WHERE namespace = ? AND status = 'active'";
  const binds: unknown[] = [input.namespace];

  if (query) {
    sql += " AND (content LIKE ? ESCAPE '\\' OR summary LIKE ? ESCAPE '\\' OR tags LIKE ? ESCAPE '\\' OR type LIKE ? ESCAPE '\\')";
    binds.push(like, like, like, like);
  }

  if (input.types && input.types.length > 0) {
    sql += ` AND type IN (${input.types.map(() => "?").join(", ")})`;
    binds.push(...input.types);
  }

  sql += " ORDER BY pinned DESC, importance DESC, updated_at DESC LIMIT ?";
  binds.push(input.limit);

  let result: D1Result<MemoryRecord>;
  try {
    result = await db
      .prepare(sql)
      .bind(...binds)
      .all<MemoryRecord>();
  } catch (error) {
    console.error("text memory search failed", error);
    return [];
  }

  const lowered = query.toLowerCase();
  return (result.results ?? []).map((record) => ({
    ...record,
    score: lowered && record.content.toLowerCase().includes(lowered) ? 0.75 : 0.5
  }));
}

export async function markMemoriesRecalled(
  db: D1Database,
  input: { namespace: string; ids: string[] }
): Promise<void> {
  if (input.ids.length === 0) return;

  const D1_IN_BATCH_SIZE = 90;
  const now = nowIso();

  for (let i = 0; i < input.ids.length; i += D1_IN_BATCH_SIZE) {
    const batch = input.ids.slice(i, i + D1_IN_BATCH_SIZE);
    const placeholders = batch.map(() => "?").join(", ");
    await db
      .prepare(
        `UPDATE memories
         SET last_recalled_at = ?, recall_count = recall_count + 1
         WHERE namespace = ? AND id IN (${placeholders})`
      )
      .bind(now, input.namespace, ...batch)
      .run();
  }
}
