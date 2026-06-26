-- Aelios 记忆库 v2 (母帖 #11 第 1 步)
-- 全部用 CREATE TABLE IF NOT EXISTS，天生幂等。
-- 不动现有 memories 表 (不加列)——v2 字段进 memory_lifecycle 侧车表，
-- 靠 memory_id 关联。这样所有 fork 部署都不会因 ALTER ADD COLUMN 重复列炸。
-- 代码层默认读写这些 v2 表；只有 MEMORY_LIFECYCLE_ENABLED=false 才走旧路径。
--
-- L2 raw_messages 的口径：复用现有 messages 表 (0001 已建)，ts = created_at。
-- Vectorize 复用 memo-kb，用 metadata.kind 区分: memory | precious | longtail。

-- =====================================================================
-- L4 + L6 v2 字段侧车表 (不改 memories 本体)
-- =====================================================================
-- 一行对应一条 memories 记录的 v2 元数据。memory_id 关联 memories.id。
-- fact_key: 同一件事按 key upsert，从源头止增 (L4)
-- supersedes_id / superseded_by_id: world_fact 推翻链 (L6)
-- review_reason: doctor/patrol 提案理由
-- valid_as_of: world_fact 有效时点
-- last_seen_at / seen_count: 命中计数
-- last_injected_at: 闸三节奏，近期注入过的降权 (不动 importance)
--
-- fact_key 语义：status 在 memories 表，跨表 partial unique SQLite 做不到，
-- 因此侧车表只建普通索引，靠应用层 (upsertMemoryByFactKey 先查 active
-- 对应的侧车行再写) 保证同一 namespace + fact_key 的 active 语义。
-- 这是为了 fork 安全 (ALTER ADD COLUMN 不幂等) 主动让出的 DB 层硬约束。
CREATE TABLE IF NOT EXISTS memory_lifecycle (
  memory_id TEXT NOT NULL,
  namespace TEXT NOT NULL DEFAULT 'default',
  fact_key TEXT,
  supersedes_id TEXT,
  superseded_by_id TEXT,
  review_reason TEXT,
  valid_as_of TEXT,
  last_seen_at TEXT,
  seen_count INTEGER NOT NULL DEFAULT 0,
  last_injected_at TEXT,
  PRIMARY KEY (memory_id)
);

-- fact_key upsert 查询用 (应用层先查再写，这个索引加速查 active 同 key)
CREATE INDEX IF NOT EXISTS idx_lifecycle_namespace_factkey
ON memory_lifecycle(namespace, fact_key) WHERE fact_key IS NOT NULL;

-- supersede 链查询用
CREATE INDEX IF NOT EXISTS idx_lifecycle_supersedes
ON memory_lifecycle(supersedes_id) WHERE supersedes_id IS NOT NULL;

-- =====================================================================
-- L1 摘要 (单行覆盖，每 namespace 一行)
-- =====================================================================
CREATE TABLE IF NOT EXISTS digest (
  namespace TEXT PRIMARY KEY,
  content TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- =====================================================================
-- L3 珍贵记录 (打标，含上下文，豁免去重/衰减/删)
-- =====================================================================
CREATE TABLE IF NOT EXISTS precious (
  id TEXT PRIMARY KEY,
  namespace TEXT NOT NULL DEFAULT 'default',
  content TEXT NOT NULL,
  context_message_ids TEXT,          -- JSON 数组，单拎一句以后看不懂
  source TEXT NOT NULL DEFAULT 'human',  -- human | secretary
  pinned INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  last_injected_at TEXT              -- 闸三节奏，珍贵也记，防复读
);

CREATE INDEX IF NOT EXISTS idx_precious_namespace_created
ON precious(namespace, created_at);

CREATE INDEX IF NOT EXISTS idx_precious_pinned
ON precious(pinned);

-- =====================================================================
-- L5 黑话 glossary (词面召回，不进向量库)
-- 第 1 步精确/子串匹配；BM25/FTS5 留到后续召回管线升级。
-- =====================================================================
CREATE TABLE IF NOT EXISTS glossary (
  id TEXT PRIMARY KEY,
  namespace TEXT NOT NULL DEFAULT 'default',
  term TEXT NOT NULL,
  aliases TEXT,                      -- JSON 数组
  definition TEXT NOT NULL,
  examples TEXT,                     -- JSON 数组
  status TEXT NOT NULL DEFAULT 'active',
  updated_at TEXT NOT NULL,
  last_seen_at TEXT,
  seen_count INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_glossary_namespace_status
ON glossary(namespace, status);

CREATE INDEX IF NOT EXISTS idx_glossary_term
ON glossary(namespace, term);

-- =====================================================================
-- L6 长尾收容所 (raw 删除前的遗物，只在前面全空时兜底)
-- =====================================================================
CREATE TABLE IF NOT EXISTS longtail (
  id TEXT PRIMARY KEY,
  namespace TEXT NOT NULL DEFAULT 'default',
  content TEXT NOT NULL,
  ts TEXT NOT NULL,
  source_message_ids TEXT            -- JSON 数组
);

CREATE INDEX IF NOT EXISTS idx_longtail_namespace_ts
ON longtail(namespace, ts);
