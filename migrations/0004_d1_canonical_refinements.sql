-- D1 canonical memory store refinements.
-- audit_state tracks the last z-audit decision per memory.
-- vector_sync_status tracks whether Vectorize is in sync with D1.

ALTER TABLE memories ADD COLUMN audit_state TEXT;
ALTER TABLE memories ADD COLUMN vector_sync_status TEXT;

CREATE INDEX IF NOT EXISTS idx_memories_audit_state
ON memories(namespace, audit_state, status);

CREATE INDEX IF NOT EXISTS idx_memories_vector_sync
ON memories(namespace, vector_sync_status, status);
