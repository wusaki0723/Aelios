import type { Env } from "../../types";
import { newId } from "../../utils/ids";
import { nowIso } from "../../utils/time";

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

// =====================================================================
// longtail 向量同步 (dream 种向量用)
// =====================================================================

export async function upsertLongtailEmbedding(
  env: Env,
  input: { id: string; namespace: string; content: string }
): Promise<void> {
  if (!env.VECTORIZE) return;
  const { createEmbedding } = await import("../../memory/embedding");
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
