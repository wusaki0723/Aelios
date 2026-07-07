import { nowIso } from "../utils/time";

export interface TgInboxRow {
  id: number;
  text: string;
}

export interface TgRecentTurn {
  role: "user" | "assistant";
  content: string;
}

export interface TgChatState {
  summary: string;
  recent: TgRecentTurn[];
}

export async function insertInbox(
  db: D1Database,
  input: { chatId: string; messageId?: number; text: string }
): Promise<void> {
  // OR IGNORE: Telegram redelivers the same update after any non-2xx webhook
  // answer; the (chat_id, message_id) unique index makes the retry a no-op.
  await db
    .prepare("INSERT OR IGNORE INTO tg_inbox (chat_id, message_id, text, created_at) VALUES (?, ?, ?, ?)")
    .bind(input.chatId, input.messageId ?? null, input.text, nowIso())
    .run();
}

/**
 * Atomically claim every unprocessed message for this chat. A single UPDATE …
 * RETURNING keeps concurrent queue deliveries from double-processing: the
 * first consumer takes the whole batch, later ones get an empty set.
 */
export async function claimInbox(db: D1Database, chatId: string): Promise<TgInboxRow[]> {
  const result = await db
    .prepare("UPDATE tg_inbox SET processed = 1 WHERE chat_id = ? AND processed = 0 RETURNING id, text")
    .bind(chatId)
    .all<TgInboxRow>();
  return (result.results ?? []).sort((a, b) => a.id - b.id);
}

/** Roll back a failed claim so the queue retry sees the messages again. */
export async function unclaimInbox(db: D1Database, ids: number[]): Promise<void> {
  if (ids.length === 0) return;
  const placeholders = ids.map(() => "?").join(",");
  await db
    .prepare(`UPDATE tg_inbox SET processed = 0 WHERE id IN (${placeholders})`)
    .bind(...ids)
    .run();
}

export async function getChatState(db: D1Database, chatId: string): Promise<TgChatState> {
  const row = await db
    .prepare("SELECT summary, recent_json FROM tg_chat_state WHERE chat_id = ?")
    .bind(chatId)
    .first<{ summary: string; recent_json: string }>();
  if (!row) return { summary: "", recent: [] };

  let recent: TgRecentTurn[] = [];
  try {
    const parsed = JSON.parse(row.recent_json);
    if (Array.isArray(parsed)) recent = parsed as TgRecentTurn[];
  } catch {
    console.warn("tg: corrupt recent_json, resetting recent turns", { chatId });
  }
  return { summary: row.summary ?? "", recent };
}

export async function saveChatState(db: D1Database, chatId: string, state: TgChatState): Promise<void> {
  await db
    .prepare(
      `INSERT INTO tg_chat_state (chat_id, summary, recent_json, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(chat_id) DO UPDATE SET
         summary = excluded.summary,
         recent_json = excluded.recent_json,
         updated_at = excluded.updated_at`
    )
    .bind(chatId, state.summary, JSON.stringify(state.recent), nowIso())
    .run();
}
