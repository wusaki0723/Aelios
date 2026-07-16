-- LMC-5 三件套 (SPEC-LMC5.md)
-- 1) Y 轴: memory_relations 有向关系图
-- 2) Z 轴: memories 本体 fact_key / version_status / superseded_by 事实版本化
-- 3) spontaneous: perception_cache 夜批感知缓存
--
-- 边方向约定 (Y 轴):
--   写入时按 LLM 判定的有向边存一条 (src → dst, rel_type)。
--   查询时双向匹配: WHERE src_id = ? OR dst_id = ?，邻居 = 另一端。
--   UNIQUE(src_id, dst_id, rel_type) 保证幂等；反向边如需存在须显式再插一条。
--
-- 回滚说明 (D1 / SQLite):
--   1. DROP TABLE IF EXISTS memory_relations;
--   2. DROP TABLE IF EXISTS perception_cache;
--   3. 列无法安全 DROP (SQLite < 3.35 或 D1 限制): 应用层停止读写即可。
--      若引擎支持: ALTER TABLE memories DROP COLUMN fact_key;
--                   ALTER TABLE memories DROP COLUMN version_status;
--                   ALTER TABLE memories DROP COLUMN superseded_by;
--   4. 回滚后 recall/dream 新 phase 应关闭 (RELATION_EXPANSION 保持 off)。
--   注意: 回滚不会恢复被 supersede 写入的 version_status 语义变更。

-- =====================================================================
-- Y 轴: typed relation 图
-- =====================================================================
CREATE TABLE IF NOT EXISTS memory_relations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  src_id TEXT NOT NULL,
  dst_id TEXT NOT NULL,
  rel_type TEXT NOT NULL CHECK (rel_type IN (
    'supports', 'contradicts', 'cause_effect', 'derived_from', 'same_thread', 'supersedes'
  )),
  weight REAL NOT NULL DEFAULT 1.0,
  created_by TEXT,
  created_at TEXT NOT NULL,
  UNIQUE(src_id, dst_id, rel_type)
);

CREATE INDEX IF NOT EXISTS idx_memory_relations_src
ON memory_relations(src_id);

CREATE INDEX IF NOT EXISTS idx_memory_relations_dst
ON memory_relations(dst_id);

CREATE INDEX IF NOT EXISTS idx_memory_relations_type
ON memory_relations(rel_type);

-- =====================================================================
-- Z 轴: memories 本体事实版本列
-- fact_key 与 memory_lifecycle.fact_key 双写；读时 memories 优先，侧车兜底。
-- version_status: current | superseded | under_review（schema CHECK + 应用层校验）
-- =====================================================================
-- D1/SQLite: ADD COLUMN 不可逆；migration 元表保证只跑一次。
ALTER TABLE memories ADD COLUMN fact_key TEXT;
ALTER TABLE memories ADD COLUMN version_status TEXT DEFAULT 'current'
  CHECK (version_status IN ('current', 'superseded', 'under_review'));
ALTER TABLE memories ADD COLUMN superseded_by TEXT;

CREATE INDEX IF NOT EXISTS idx_memories_fact_key
ON memories(namespace, fact_key) WHERE fact_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_memories_version_status
ON memories(namespace, version_status);

-- 从侧车表回填 fact_key（已有 lifecycle 行）
UPDATE memories
SET fact_key = (
  SELECT lc.fact_key FROM memory_lifecycle lc WHERE lc.memory_id = memories.id
)
WHERE (fact_key IS NULL OR fact_key = '')
  AND EXISTS (
    SELECT 1 FROM memory_lifecycle lc
    WHERE lc.memory_id = memories.id AND lc.fact_key IS NOT NULL AND lc.fact_key != ''
  );

-- 已 status=superseded 的行对齐 version_status
UPDATE memories
SET version_status = 'superseded'
WHERE status = 'superseded'
  AND (version_status IS NULL OR version_status = '' OR version_status = 'current');

-- 其余 active 行确保 version_status 有默认值
UPDATE memories
SET version_status = 'current'
WHERE version_status IS NULL OR version_status = '';

-- =====================================================================
-- spontaneous: 夜批感知缓存
-- items: JSON 数组 [{id, content, importance}]
-- =====================================================================
CREATE TABLE IF NOT EXISTS perception_cache (
  namespace TEXT NOT NULL DEFAULT 'default',
  date TEXT NOT NULL,
  items TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (namespace, date)
);

CREATE INDEX IF NOT EXISTS idx_perception_cache_date
ON perception_cache(date);
