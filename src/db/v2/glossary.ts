import { newId } from "../../utils/ids";
import { nowIso } from "../../utils/time";

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

  const result = await db
    .prepare(
      `SELECT * FROM glossary
       WHERE namespace = ?1 AND status = 'active'
         AND (
           (length(term) >= 2 AND instr(lower(?2), lower(term)) > 0)
           OR EXISTS (
             SELECT 1 FROM json_each(COALESCE(aliases, '[]'))
             WHERE length(json_each.value) >= 2
               AND instr(lower(?2), lower(json_each.value)) > 0
           )
         )
       ORDER BY term`
    )
    .bind(input.namespace, query)
    .all<GlossaryRow>();
  return result.results ?? [];
}
