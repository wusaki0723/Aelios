import type { Conversation } from "../types";
import { newId } from "../utils/ids";
import { nowIso } from "../utils/time";

// ── Processing cursor (per-namespace memory extraction checkpoint) ──

export interface ProcessingCursor {
  name: string;
  value: string;
  updated_at: string;
}

export async function getProcessingCursor(
  db: D1Database,
  namespace: string
): Promise<ProcessingCursor | null> {
  const name = `memory_extract_cursor:${namespace}`;
  const row = await db
    .prepare("SELECT name, value, updated_at FROM processing_cursors WHERE name = ?")
    .bind(name)
    .first<ProcessingCursor>();
  return row ?? null;
}

export async function setProcessingCursor(
  db: D1Database,
  namespace: string,
  value: string
): Promise<void> {
  const name = `memory_extract_cursor:${namespace}`;
  const now = nowIso();
  await db
    .prepare(
      `INSERT INTO processing_cursors (name, value, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(name) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
    )
    .bind(name, value, now)
    .run();
}

export async function getOrCreateConversation(
  db: D1Database,
  input: { namespace: string; id?: string }
): Promise<Conversation> {
  const id = input.id || `${input.namespace}:default`;
  const existing = await db
    .prepare("SELECT id, namespace, created_at, updated_at FROM conversations WHERE id = ?")
    .bind(id)
    .first<Conversation>();

  if (existing) return existing;

  const now = nowIso();
  const conversation: Conversation = {
    id,
    namespace: input.namespace,
    created_at: now,
    updated_at: now
  };

  await db
    .prepare("INSERT INTO conversations (id, namespace, created_at, updated_at) VALUES (?, ?, ?, ?)")
    .bind(conversation.id, conversation.namespace, conversation.created_at, conversation.updated_at)
    .run();

  return conversation;
}
