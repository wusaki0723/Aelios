-- Telegram bot layer: per-chat inbox (debounce buffer) + rolling summary state.

CREATE TABLE IF NOT EXISTS tg_inbox (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chat_id TEXT NOT NULL,
  message_id INTEGER,
  text TEXT NOT NULL,
  created_at TEXT NOT NULL,
  processed INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_tg_inbox_chat_processed ON tg_inbox (chat_id, processed);

-- Telegram redelivers the same update when the webhook answers non-2xx; the
-- unique index + INSERT OR IGNORE makes redelivery idempotent.
CREATE UNIQUE INDEX IF NOT EXISTS idx_tg_inbox_chat_message ON tg_inbox (chat_id, message_id)
  WHERE message_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS tg_chat_state (
  chat_id TEXT PRIMARY KEY,
  summary TEXT NOT NULL DEFAULT '',
  recent_json TEXT NOT NULL DEFAULT '[]',
  updated_at TEXT NOT NULL
);
