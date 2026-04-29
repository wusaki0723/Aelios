import type { MessageRecord, SummaryRecord } from "../types";
import { newId } from "../utils/ids";
import { nowIso } from "../utils/time";

// ---------------------------------------------------------------------------
// Get the latest summary for a namespace
// ---------------------------------------------------------------------------

export async function getLatestSummary(
  db: D1Database,
  namespace: string
): Promise<SummaryRecord | null> {
  const row = await db
    .prepare(
      `SELECT id, namespace, conversation_id, content, from_message_id, to_message_id,
              message_count, vector_id, created_at, updated_at
       FROM summaries
       WHERE namespace = ?
       ORDER BY updated_at DESC
       LIMIT 1`
    )
    .bind(namespace)
    .first<SummaryRecord>();
  return row ?? null;
}

// ---------------------------------------------------------------------------
// Upsert summary — one per namespace, replaces any existing
// ---------------------------------------------------------------------------

export async function upsertSummary(
  db: D1Database,
  input: {
    namespace: string;
    content: string;
    fromMessageId?: string | null;
    toMessageId?: string | null;
    messageCount?: number;
  }
): Promise<SummaryRecord> {
  const now = nowIso();
  const existing = await getLatestSummary(db, input.namespace);

  if (existing) {
    await db
      .prepare(
        `UPDATE summaries
         SET content = ?, from_message_id = ?, to_message_id = ?,
             message_count = ?, updated_at = ?
         WHERE id = ?`
      )
      .bind(
        input.content,
        input.fromMessageId ?? null,
        input.toMessageId ?? null,
        input.messageCount ?? 0,
        now,
        existing.id
      )
      .run();

    return {
      ...existing,
      content: input.content,
      from_message_id: input.fromMessageId ?? null,
      to_message_id: input.toMessageId ?? null,
      message_count: input.messageCount ?? 0,
      updated_at: now,
    };
  }

  const id = newId("sum");
  const record: SummaryRecord = {
    id,
    namespace: input.namespace,
    conversation_id: null,
    content: input.content,
    from_message_id: input.fromMessageId ?? null,
    to_message_id: input.toMessageId ?? null,
    message_count: input.messageCount ?? 0,
    vector_id: null,
    created_at: now,
    updated_at: now,
  };

  await db
    .prepare(
      `INSERT INTO summaries (id, namespace, conversation_id, content, from_message_id,
                              to_message_id, message_count, vector_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      record.id,
      record.namespace,
      record.conversation_id,
      record.content,
      record.from_message_id,
      record.to_message_id,
      record.message_count,
      record.vector_id,
      record.created_at,
      record.updated_at
    )
    .run();

  return record;
}

// ---------------------------------------------------------------------------
// Count user/assistant messages after a given timestamp or message id
// ---------------------------------------------------------------------------

export async function countMessagesAfter(
  db: D1Database,
  namespace: string,
  afterCreatedAt: string | null
): Promise<number> {
  if (!afterCreatedAt) {
    // No previous summary — count all user/assistant messages
    const row = await db
      .prepare(
        `SELECT COUNT(*) as cnt FROM messages
         WHERE namespace = ? AND role IN ('user', 'assistant')`
      )
      .bind(namespace)
      .first<{ cnt: number }>();
    return row?.cnt ?? 0;
  }

  const row = await db
    .prepare(
      `SELECT COUNT(*) as cnt FROM messages
       WHERE namespace = ? AND role IN ('user', 'assistant') AND created_at > ?`
    )
    .bind(namespace, afterCreatedAt)
    .first<{ cnt: number }>();
  return row?.cnt ?? 0;
}

// ---------------------------------------------------------------------------
// Get a message's created_at by id (used to resolve summary cursor)
// ---------------------------------------------------------------------------

export async function getMessageCreatedAt(
  db: D1Database,
  namespace: string,
  messageId: string
): Promise<string | null> {
  const row = await db
    .prepare(
      `SELECT created_at FROM messages WHERE namespace = ? AND id = ?`
    )
    .bind(namespace, messageId)
    .first<{ created_at: string }>();
  return row?.created_at ?? null;
}

// ---------------------------------------------------------------------------
// List recent user/assistant messages for summary generation
// ---------------------------------------------------------------------------

export async function listRecentMessagesForSummary(
  db: D1Database,
  namespace: string,
  limit: number
): Promise<MessageRecord[]> {
  const result = await db
    .prepare(
      `SELECT id, conversation_id, namespace, role, content, source, created_at
       FROM messages
       WHERE namespace = ? AND role IN ('user', 'assistant')
       ORDER BY created_at DESC
       LIMIT ?`
    )
    .bind(namespace, limit)
    .all<MessageRecord>();

  // Reverse so oldest first
  return (result.results ?? []).reverse();
}
