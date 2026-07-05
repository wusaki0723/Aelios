import { newId } from "../utils/ids";
import { nowIso } from "../utils/time";

export type DreamRunStatus = "running" | "ok" | "skipped" | "error";
export type DreamRunTrigger = "cron" | "manual";

export interface DreamRunRow {
  id: string;
  namespace: string;
  date_label: string;
  started_at: string;
  finished_at: string | null;
  status: DreamRunStatus;
  reason: string | null;
  model: string | null;
  processed_messages: number | null;
  error: string | null;
  trigger: DreamRunTrigger;
}

export async function insertDreamRun(
  db: D1Database,
  input: {
    namespace: string;
    dateLabel: string;
    trigger: DreamRunTrigger;
  }
): Promise<string> {
  const id = newId("drm");
  const startedAt = nowIso();
  await db
    .prepare(
      `INSERT INTO dream_runs (
         id, namespace, date_label, started_at, status, trigger
       ) VALUES (?, ?, ?, ?, 'running', ?)`
    )
    .bind(id, input.namespace, input.dateLabel, startedAt, input.trigger)
    .run();
  return id;
}

export async function finishDreamRun(
  db: D1Database,
  input: {
    id: string;
    status: Exclude<DreamRunStatus, "running">;
    reason?: string | null;
    model?: string | null;
    processedMessages?: number | null;
    error?: string | null;
  }
): Promise<void> {
  await db
    .prepare(
      `UPDATE dream_runs
       SET finished_at = ?,
           status = ?,
           reason = ?,
           model = ?,
           processed_messages = ?,
           error = ?
       WHERE id = ?`
    )
    .bind(
      nowIso(),
      input.status,
      input.reason ?? null,
      input.model ?? null,
      input.processedMessages ?? null,
      input.error ?? null,
      input.id
    )
    .run();
}

export async function listDreamRunsForNamespace(
  db: D1Database,
  input: { namespace: string; sinceIso: string; limit?: number }
): Promise<DreamRunRow[]> {
  const limit = input.limit ?? 200;
  const result = await db
    .prepare(
      `SELECT id, namespace, date_label, started_at, finished_at, status, reason, model,
              processed_messages, error, trigger
       FROM dream_runs
       WHERE namespace = ? AND started_at >= ?
       ORDER BY started_at DESC
       LIMIT ?`
    )
    .bind(input.namespace, input.sinceIso, limit)
    .all<DreamRunRow>();
  return result.results ?? [];
}
