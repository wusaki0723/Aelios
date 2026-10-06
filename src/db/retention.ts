import { nowIso } from "../utils/time";

// ---------------------------------------------------------------------------
// Batch size for SQL IN clauses and Vectorize deleteByIds.
// D1 limits each statement to 100 bound variables. Queries here bind an extra
// leading param (namespace) on top of the id placeholders, so a batch of N ids
// binds N+1 variables. Keep the batch size below 99 to stay safely under the
// limit; 90 leaves headroom for any future extra params.
// ---------------------------------------------------------------------------

export const RETENTION_BATCH_SIZE = 90;

// ---------------------------------------------------------------------------
// messages: delete rows older than cutoff
// ---------------------------------------------------------------------------

export async function deleteOldMessages(
  db: D1Database,
  namespace: string,
  cutoff: string
): Promise<number> {
  try {
    await db
      .prepare(
        `DELETE FROM message_fts
         WHERE message_id IN (
           SELECT id FROM messages WHERE namespace = ? AND created_at < ?
         )`
      )
      .bind(namespace, cutoff)
      .run();
  } catch (error) {
    console.error("retention: message fts cleanup failed", error);
  }
  const result = await db
    .prepare("DELETE FROM messages WHERE namespace = ? AND created_at < ?")
    .bind(namespace, cutoff)
    .run();
  return result.meta.changes ?? 0;
}

// ---------------------------------------------------------------------------
// usage_logs: delete rows older than cutoff
// ---------------------------------------------------------------------------

export async function deleteOldUsageLogs(
  db: D1Database,
  namespace: string,
  cutoff: string
): Promise<number> {
  const result = await db
    .prepare("DELETE FROM usage_logs WHERE namespace = ? AND created_at < ?")
    .bind(namespace, cutoff)
    .run();
  return result.meta.changes ?? 0;
}

// ---------------------------------------------------------------------------
// memory_events: delete rows older than cutoff
// ---------------------------------------------------------------------------

export async function deleteOldMemoryEvents(
  db: D1Database,
  namespace: string,
  cutoff: string
): Promise<number> {
  const result = await db
    .prepare("DELETE FROM memory_events WHERE namespace = ? AND created_at < ?")
    .bind(namespace, cutoff)
    .run();
  return result.meta.changes ?? 0;
}

// ---------------------------------------------------------------------------
// idempotency_keys: delete rows older than cutoff (namespace-agnostic)
// ---------------------------------------------------------------------------

export async function deleteOldIdempotencyKeys(
  db: D1Database,
  cutoff: string
): Promise<number> {
  const result = await db
    .prepare("DELETE FROM idempotency_keys WHERE created_at < ?")
    .bind(cutoff)
    .run();
  return result.meta.changes ?? 0;
}

// ---------------------------------------------------------------------------
// memories: mark expired — active, non-pinned, non-identity/persona memories
//           whose updated_at is older than cutoff become status=expired.
//           Returns the id/vector_id of newly expired records so caller
//           can sync Vectorize deletion.
// ---------------------------------------------------------------------------

export interface ExpiredMemoryRef {
  id: string;
  vector_id: string | null;
}

export async function expireOldMemories(
  db: D1Database,
  namespace: string,
  cutoff: string
): Promise<{ count: number; expired: ExpiredMemoryRef[] }> {
  const now = nowIso();

  // First, select the records that will be expired. A memory counts as in use
  // when it was last rewritten, recalled (last_injected_at) or seen again
  // (last_seen_at), whichever is latest; recall only writes the lifecycle row.
  const toExpire = await db
    .prepare(
      `SELECT m.id, m.vector_id
       FROM memories m
       LEFT JOIN memory_lifecycle lc ON lc.memory_id = m.id
       WHERE m.namespace = ?
         AND m.status = 'active'
         AND m.pinned = 0
         AND m.type NOT IN ('identity', 'persona')
         AND MAX(
           m.updated_at,
           COALESCE(lc.last_injected_at, m.updated_at),
           COALESCE(lc.last_seen_at, m.updated_at)
         ) < ?`
    )
    .bind(namespace, cutoff)
    .all<ExpiredMemoryRef>();

  const expired = toExpire.results ?? [];
  if (expired.length === 0) return { count: 0, expired: [] };

  // Then mark exactly those expired, so the caller's FTS/Vectorize cleanup
  // matches what changed.
  const ids = expired.map((m) => m.id);
  const statements: D1PreparedStatement[] = [];
  for (let i = 0; i < ids.length; i += RETENTION_BATCH_SIZE) {
    const batch = ids.slice(i, i + RETENTION_BATCH_SIZE);
    const placeholders = batch.map(() => "?").join(", ");
    statements.push(
      db
        .prepare(
          `UPDATE memories
           SET status = 'expired', updated_at = ?
           WHERE namespace = ? AND status = 'active' AND id IN (${placeholders})`
        )
        .bind(now, namespace, ...batch)
    );
  }
  await db.batch(statements);

  return { count: expired.length, expired };
}

// ---------------------------------------------------------------------------
// memories: list hard-deletable rows — status in (deleted, superseded, expired)
//           and updated_at older than cutoff
// ---------------------------------------------------------------------------

export interface HardDeletableMemory {
  id: string;
  vector_id: string | null;
}

export async function listHardDeletableMemories(
  db: D1Database,
  namespace: string,
  cutoff: string
): Promise<HardDeletableMemory[]> {
  const result = await db
    .prepare(
      `SELECT id, vector_id
       FROM memories
       WHERE namespace = ?
         AND status IN ('deleted', 'superseded', 'expired')
         AND updated_at < ?`
    )
    .bind(namespace, cutoff)
    .all<HardDeletableMemory>();
  return result.results ?? [];
}

// ---------------------------------------------------------------------------
// memories: hard delete by ids (single batch).
//           Caller is responsible for batching via hardDeleteMemoriesBatched.
// ---------------------------------------------------------------------------

async function hardDeleteMemoriesBatch(
  db: D1Database,
  namespace: string,
  ids: string[]
): Promise<number> {
  if (ids.length === 0) return 0;
  const placeholders = ids.map(() => "?").join(", ");
  try {
    await db
      .prepare(`DELETE FROM memory_fts WHERE memory_id IN (${placeholders})`)
      .bind(...ids)
      .run();
  } catch (error) {
    console.error("retention: memory fts hard-delete cleanup failed", error);
  }
  const result = await db
    .prepare(
      `DELETE FROM memories WHERE namespace = ? AND id IN (${placeholders})`
    )
    .bind(namespace, ...ids)
    .run();
  return result.meta.changes ?? 0;
}

// ---------------------------------------------------------------------------
// memories: hard delete in batches of RETENTION_BATCH_SIZE
// ---------------------------------------------------------------------------

export async function hardDeleteMemoriesBatched(
  db: D1Database,
  namespace: string,
  ids: string[]
): Promise<number> {
  let total = 0;
  for (let i = 0; i < ids.length; i += RETENTION_BATCH_SIZE) {
    const batch = ids.slice(i, i + RETENTION_BATCH_SIZE);
    total += await hardDeleteMemoriesBatch(db, namespace, batch);
  }
  return total;
}

// ---------------------------------------------------------------------------
// processing_cursors: read cursor value (returns null if not set)
// ---------------------------------------------------------------------------

export async function readCursor(
  db: D1Database,
  name: string
): Promise<string | null> {
  const row = await db
    .prepare("SELECT value FROM processing_cursors WHERE name = ?")
    .bind(name)
    .first<{ value: string }>();
  return row?.value ?? null;
}

// ---------------------------------------------------------------------------
// processing_cursors: upsert cursor value
// ---------------------------------------------------------------------------

export async function writeCursor(
  db: D1Database,
  name: string,
  value: string
): Promise<void> {
  const now = nowIso();
  await db
    .prepare(
      `INSERT INTO processing_cursors (name, value, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT(name) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
    )
    .bind(name, value, now)
    .run();
}
