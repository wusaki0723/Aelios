export interface Env {
  DB: D1Database;
  AI?: Ai;
  MEMORY_QUEUE?: Queue<QueueMessage>;
  VECTORIZE?: Vectorize | VectorizeIndex;
  VECTORIZE_INDEX_NAME?: string;
  CLOUDFLARE_ACCOUNT_ID?: string;
  CLOUDFLARE_API_TOKEN?: string;
  PUBLIC_MODEL_NAME?: string;
  CHAT_MODEL?: string;
  DEFAULT_UPSTREAM_MODEL?: string;
  ALLOW_MODEL_PASSTHROUGH?: string;
  AI_GATEWAY_BASE_URL?: string;
  CHATBOX_API_KEY?: string;
  IM_API_KEY?: string;
  DEBUG_API_KEY?: string;
  MEMORY_MCP_API_KEY?: string;
  GUIDE_DOG_API_KEY?: string;
  CF_AIG_TOKEN?: string;
  ENABLE_AUTO_MEMORY?: string;
  ENABLE_DREAM?: string;
  // --- Aelios 记忆库 v2 行为开关 ---
  // 默认走 v2；只有显式 false 才回退旧路径。
  MEMORY_LIFECYCLE_ENABLED?: string;
  // dream 策略：默认 upsert，可显式 review。
  DREAM_STRATEGY?: string;
  // 是否把 dream 删除的旧记忆收容进 longtail。默认 false，避免新 v2 内容污染旧大库兜底。
  DREAM_ARCHIVE_DELETES_TO_LONGTAIL?: string;
  // 写入模式：默认 upsert，可显式 append。
  MEMORY_WRITE_MODE?: string;
  // patrol 是否只出提案不自动删
  MEMORY_PATROL_DRY_RUN?: string;
  // 是否允许自动删（默认 false 锁死）
  MEMORY_AUTO_DELETE?: string;
  // 闸三降权窗口 (分钟)，默认 30
  MEMORY_INJECT_DECAY_WINDOW_MIN?: string;
  // 闸三降权系数 (0-1)，默认 0.5
  MEMORY_INJECT_DECAY_FACTOR?: string;
  // memory_recall 最低分地板，默认 0.15；调用方可用 min_score 临时覆盖。
  RECALL_MIN_SCORE?: string;
  // true = 丢弃没有有效 D1 记录背书的 Vectorize 命中 (清理 legacy 孤儿向量)，默认 false 保持现状。
  RECALL_REQUIRE_D1_BACKING?: string;
  // LMC-5 Y 轴: 2-hop relation expansion. Default off (undefined/"off"/"false") = recall identical to pre-LMC5.
  // Set "on" or "true" to enable hop1/hop2 expansion after vector seed hits.
  RELATION_EXPANSION?: string;
  ENABLE_DAILY_MEMORY_DIGEST?: string;
  DREAM_NAMESPACE?: string;
  DREAM_MAX_MESSAGES?: string;
  DREAM_MAX_RUNS?: string;
  DREAM_MAX_TOKENS?: string;
  DREAM_MODEL?: string;
  DREAM_MEMORY_CONTEXT_LIMIT?: string;
  DREAM_EXCERPT_LIMIT?: string;
  DREAM_TIME_ZONE?: string;
  DEDUP_COSINE?: string;
  // L4 每区（type）active 条数硬上限，0 或不设 = 关闭（母帖第一节，对抗膨胀的闸）
  MEMORY_ZONE_CAP?: string;
  // 候选队列自动评审（judge），默认关闭
  CANDIDATE_JUDGE_ENABLED?: string;
  JUDGE_MODEL?: string;
  JUDGE_MAX_CANDIDATES?: string;
  // judge 评分阈值：>= APPROVE_MIN 自动入库，<= DISCARD_MAX 自动丢弃，中间留人工
  JUDGE_APPROVE_MIN?: string;
  JUDGE_DISCARD_MAX?: string;
  DAILY_DIGEST_MAX_MESSAGES?: string;
  DAILY_DIGEST_MAX_RUNS?: string;
  DAILY_DIGEST_MAX_TOKENS?: string;
  DAILY_DIGEST_MODEL?: string;
  SUMMARY_MODEL?: string;
  DAILY_DIGEST_MEMORY_CONTEXT_LIMIT?: string;
  DAILY_DIGEST_EXCERPT_LIMIT?: string;
  DAILY_DIGEST_TIME_ZONE?: string;
  // GitHub daily archive pull (cmh-lite client → private repo → nightly cron ingest)
  GITHUB_DAILY_REPO?: string;
  GITHUB_DAILY_PATH?: string;
  GITHUB_DAILY_NAMESPACE?: string;
  GITHUB_DAILY_TOKEN?: string;
  EMPTY_MEMORY_MIN_CHARS?: string;
  MEMORY_MODE?: string;
  ENABLE_MEMORY_FILTER?: string;
  ENABLE_MEMORY_RERANKER?: string;
  MEMORY_RERANKER_MODEL?: string;
  VISION_MODEL?: string;
  MEMORY_FILTER_MAX_CANDIDATES?: string;
  MEMORY_FILTER_MAX_OUTPUT?: string;
  MEMORY_FILTER_MAX_CONTENT_CHARS?: string;
  MEMORY_FILTER_MIN_SCORE?: string;
  MEMORY_FILTER_FAIL_OPEN?: string;
  MEMORY_EXTRACT_EVERY_N_MESSAGES?: string;
  MEMORY_MIN_IMPORTANCE?: string;
  INJECTION_MODE?: string;
  EMBEDDING_MODEL?: string;
  EMBEDDING_DIMENSIONS?: string;
  MEMORY_TOP_K?: string;
  MEMORY_MIN_SCORE?: string;
  MEMORY_LEGACY_VECTOR_FALLBACK_LIMIT?: string;
  MEMORY_LEGACY_VECTOR_FALLBACK_SCORE_FACTOR?: string;
  ANTHROPIC_CACHE_ENABLED?: string;
  ANTHROPIC_CACHE_TTL?: string;
  ANTHROPIC_AUTO_CACHE_ENABLED?: string;
  ANTHROPIC_ROLLING_CACHE_ENABLED?: string;
  ANTHROPIC_ROLLING_CACHE_WINDOW_SIZE?: string;
  ANTHROPIC_CACHE_STABLE_SYSTEM?: string;
  ANTHROPIC_CACHE_USER_ID?: string;
  CUSTOM_ANTHROPIC_MESSAGES_PATH?: string;
  ANTHROPIC_THINKING_ENABLED?: string;
  ANTHROPIC_THINKING_BUDGET?: string;
  FORCE_ANTHROPIC_NATIVE?: string;
  ENABLE_CACHE_API?: string;
  CACHE_DEFAULT_TTL_SECONDS?: string;
  CACHE_MAX_VALUE_BYTES?: string;
}

export interface MemoryMaintenanceQueueMessage {
  type: "memory_maintenance";
  namespace: string;
  conversationId: string;
  fromMessageId: string;
  toMessageId: string;
  source: string;
  idempotencyKey: string;
}

export interface RetentionQueueMessage {
  type: "retention";
  namespace: string;
}

export type QueueMessage = MemoryMaintenanceQueueMessage | RetentionQueueMessage;

export type Scope =
  | "chat:proxy"
  | "memory:read"
  | "memory:write"
  | "cache:read"
  | "cache:write"
  | "debug:read"
  | "export:read";

export type InjectionMode = "rag" | "full" | "hybrid" | "none";
export type MemoryMode = "external" | "builtin" | "hybrid" | "none";

export interface KeyProfile {
  source: string;
  namespace: string;
  scopes: Scope[];
  injectionMode: InjectionMode;
  memoryMode: MemoryMode;
  allowModelPassthrough: boolean;
  debug: boolean;
}

export interface AuthResult {
  ok: true;
  profile: KeyProfile;
  keyName: "CHATBOX_API_KEY" | "IM_API_KEY" | "DEBUG_API_KEY" | "MEMORY_MCP_API_KEY" | "GUIDE_DOG_API_KEY";
}

export interface OpenAIChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | Array<unknown> | null;
  name?: string;
  reasoning_content?: string;
  tool_call_id?: string;
  tool_calls?: unknown;
}

export interface OpenAIChatRequest {
  model: string;
  messages: OpenAIChatMessage[];
  stream?: boolean;
  temperature?: number;
  max_tokens?: number;
  /** vLLM 系模型的模板开关，如 {enable_thinking: false} 关闭思考链。 */
  chat_template_kwargs?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface OpenAIChatChoice {
  index?: number;
  message?: OpenAIChatMessage;
  finish_reason?: string | null;
  [key: string]: unknown;
}

export interface OpenAIChatResponse {
  id?: string;
  object?: string;
  created?: number;
  model?: string;
  choices?: OpenAIChatChoice[];
  usage?: TokenUsage;
  [key: string]: unknown;
}

export interface TokenUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  input_tokens?: number;
  output_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
  [key: string]: unknown;
}

export interface Conversation {
  id: string;
  namespace: string;
  created_at: string;
  updated_at: string;
}

export interface MessageRecord {
  id: string;
  conversation_id: string;
  namespace: string;
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  source: string | null;
  created_at: string;
}

export type MemoryVersionStatus = "current" | "superseded" | "under_review";

export interface MemoryRecord {
  id: string;
  namespace: string;
  type: string;
  content: string;
  summary: string | null;
  importance: number;
  confidence: number;
  status: "active" | "deleted" | "superseded" | "low_confidence" | string;
  pinned: number;
  tags: string | null;
  source: string | null;
  source_message_ids: string | null;
  vector_id: string | null;
  last_recalled_at: string | null;
  recall_count: number;
  created_at: string;
  updated_at: string;
  expires_at: string | null;
  // LMC-5 Z 轴: 本体列 (0007)。与 memory_lifecycle 侧车双写；读时本体优先。
  fact_key?: string | null;
  version_status?: MemoryVersionStatus | string | null;
  superseded_by?: string | null;
}

// v2 字段侧车表 (母帖 #11 第 1 步，sidecar 版)。
// 不放 memories 本体——ALTER ADD COLUMN 不幂等，会让 fork 部署炸。
// memory_id 关联 memories.id，PRIMARY KEY(memory_id) 一对一。
export interface MemoryLifecycleRow {
  memory_id: string;
  namespace: string;
  fact_key: string | null;
  supersedes_id: string | null;
  superseded_by_id: string | null;
  review_reason: string | null;
  valid_as_of: string | null;
  last_seen_at: string | null;
  seen_count: number;
  last_injected_at: string | null;
}

export interface MemoryApiRecord {
  id: string;
  namespace: string;
  type: string;
  content: string;
  summary: string | null;
  importance: number;
  confidence: number;
  status: string;
  pinned: boolean;
  tags: string[];
  source: string | null;
  source_message_ids: string[];
  vector_id: string | null;
  last_recalled_at: string | null;
  recall_count: number;
  created_at: string;
  updated_at: string;
  expires_at: string | null;
  score?: number;
  // --- v2 字段 (从 memory_lifecycle 侧车表合并来，可选) ---
  fact_key?: string | null;
  supersedes_id?: string | null;
  superseded_by_id?: string | null;
  review_reason?: string | null;
  valid_as_of?: string | null;
  last_seen_at?: string | null;
  seen_count?: number;
  last_injected_at?: string | null;
  // --- LMC-5 Z 轴 (memories 本体，可选 additive) ---
  version_status?: MemoryVersionStatus | string | null;
  superseded_by?: string | null;
}

// LMC-5 Y 轴: relation 边类型
export type MemoryRelType =
  | "supports"
  | "contradicts"
  | "cause_effect"
  | "derived_from"
  | "same_thread"
  | "supersedes";

export interface MemoryRelationRow {
  id: number;
  src_id: string;
  dst_id: string;
  rel_type: MemoryRelType | string;
  weight: number;
  created_by: string | null;
  created_at: string;
}

export interface PerceptionCacheItem {
  id: string;
  content: string;
  importance: number;
}

export interface PerceptionCacheRow {
  namespace: string;
  date: string;
  items: string;
  created_at: string;
}

