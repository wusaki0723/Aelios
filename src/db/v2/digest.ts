import { nowIso } from "../../utils/time";

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
