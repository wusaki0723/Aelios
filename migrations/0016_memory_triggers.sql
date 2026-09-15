-- Trigger 召回通道 (借鉴 T-Mem, EMNLP 2026: trigger-augmented retrieval)
--
-- 病：现有召回只做「描述性召回」——问题和记忆在字面或向量上相似才召得回。
-- 「联想式召回」召不回：问题和记忆语义相关但共享词汇几乎为零时，第一跳就空了，
-- Y 轴 relation 扩展也因此无从展开 (它从种子出发，没有种子就没有扩展)。
--
-- 药：写入期给每条记忆挂若干「触发器」——比记忆本身高一两级的语义锚点，
-- 或提到就大概率该想起这条记忆的强关联场景。召回时先查触发器索引，
-- 命中的触发器把它挂的 memory_id 并进候选池。触发器是「入口扩展」，
-- 与 relation 的「出口扩展」互补。
--
-- concept: 2-6 词的短名词短语，触发器本体。
-- bridge:  一句话说明「为什么这是该记忆的合法触发器」，格式 <记忆里的线索> -> <一步推理>。
--          bridge 自己也参与检索 (三视图之一)，所以它不是注释，是可检索文本。
-- confidence: 知情人听到 concept 能联想回这条记忆的可靠程度。建期按阈值过滤。
--
-- 幂等：UNIQUE(memory_id, concept) —— 同一条记忆同一个概念只存一条，重建时 upsert。
--
-- 回滚说明 (D1 / SQLite):
--   1. DROP TABLE IF EXISTS memory_triggers;
--   2. Vectorize 侧向量按 namespace 前缀 "trg:" 清理 (见 src/memory/triggers/store.ts)；
--      不清也不影响正确性——现有召回永远看不到它们 (namespace 严格相等比较挡掉)。
--   3. 回滚后 TRIGGER_RECALL 保持 off。

CREATE TABLE IF NOT EXISTS memory_triggers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  namespace TEXT NOT NULL,
  memory_id TEXT NOT NULL,
  concept TEXT NOT NULL,
  bridge TEXT NOT NULL DEFAULT '',
  confidence REAL NOT NULL DEFAULT 0.0,
  vector_id TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL,
  UNIQUE(memory_id, concept)
);

CREATE INDEX IF NOT EXISTS idx_memory_triggers_memory
ON memory_triggers(memory_id);

CREATE INDEX IF NOT EXISTS idx_memory_triggers_namespace
ON memory_triggers(namespace);

-- 召回热路径：拿到 vector_id 反查挂了哪条记忆。
CREATE INDEX IF NOT EXISTS idx_memory_triggers_vector
ON memory_triggers(vector_id) WHERE vector_id IS NOT NULL;
