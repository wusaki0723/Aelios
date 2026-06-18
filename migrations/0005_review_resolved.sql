-- Add resolved_at column to memory_events for review queue tracking.
-- Events with resolved_at IS NULL are pending; non-null means resolved.

ALTER TABLE memory_events ADD COLUMN resolved_at TEXT;

CREATE INDEX IF NOT EXISTS idx_memory_events_unresolved
ON memory_events(namespace, event_type, resolved_at);
