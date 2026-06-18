-- LMC-5 XYZEM coordinates for the D1-backed memory store.
-- D1/SQLite supports additive ALTER TABLE migrations; existing rows keep
-- nullable coordinates and remain recallable without backfill.

ALTER TABLE memories ADD COLUMN fact_key TEXT;
ALTER TABLE memories ADD COLUMN thread TEXT;
ALTER TABLE memories ADD COLUMN risk_level TEXT;
ALTER TABLE memories ADD COLUMN urgency_level TEXT;
ALTER TABLE memories ADD COLUMN tension_score REAL;
ALTER TABLE memories ADD COLUMN response_posture TEXT;

CREATE INDEX IF NOT EXISTS idx_memories_fact_key
ON memories(namespace, fact_key, status);

CREATE INDEX IF NOT EXISTS idx_memories_thread
ON memories(namespace, thread, status);

CREATE INDEX IF NOT EXISTS idx_memories_experience
ON memories(namespace, risk_level, urgency_level, tension_score, status);

CREATE TABLE IF NOT EXISTS memory_relations (
  id TEXT PRIMARY KEY,
  namespace TEXT NOT NULL DEFAULT 'default',
  source_id TEXT NOT NULL,
  target_id TEXT NOT NULL,
  relation_type TEXT NOT NULL,
  strength REAL NOT NULL DEFAULT 1.0,
  created_at TEXT NOT NULL,
  UNIQUE(namespace, source_id, target_id, relation_type)
);

CREATE INDEX IF NOT EXISTS idx_memory_relations_source
ON memory_relations(namespace, source_id);

CREATE INDEX IF NOT EXISTS idx_memory_relations_target
ON memory_relations(namespace, target_id);

CREATE INDEX IF NOT EXISTS idx_memory_relations_type
ON memory_relations(namespace, relation_type);
