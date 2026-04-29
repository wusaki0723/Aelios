export interface Env {
  DB: D1Database;
  MEMORY_QUEUE?: Queue<QueueMessage>;
  VECTORIZE?: Vectorize | VectorizeIndex;
  PUBLIC_MODEL_NAME?: string;
  CHAT_MODEL?: string;
  DEFAULT_UPSTREAM_MODEL?: string;
  ALLOW_MODEL_PASSTHROUGH?: string;
  AI_GATEWAY_BASE_URL?: string;
  CHATBOX_API_KEY?: string;
  IM_API_KEY?: string;
  DEBUG_API_KEY?: string;
  CF_AIG_TOKEN?: string;
  ENABLE_AUTO_MEMORY?: string;
  MEMORY_MODE?: string;
  MEMORY_MODEL?: string;
  ENABLE_MEMORY_FILTER?: string;
  MEMORY_FILTER_MODEL?: string;
  VISION_MODEL?: string;
  MEMORY_FILTER_MAX_CANDIDATES?: string;
  MEMORY_FILTER_MAX_OUTPUT?: string;
  MEMORY_EXTRACT_EVERY_N_MESSAGES?: string;
  MEMORY_MIN_IMPORTANCE?: string;
  INJECTION_MODE?: string;
  EMBEDDING_MODEL?: string;
  MEMORY_TOP_K?: string;
  MEMORY_MIN_SCORE?: string;
  ANTHROPIC_CACHE_ENABLED?: string;
  ANTHROPIC_CACHE_TTL?: string;
  ANTHROPIC_CACHE_STABLE_SYSTEM?: string;
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
  keyName: "CHATBOX_API_KEY" | "IM_API_KEY" | "DEBUG_API_KEY";
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
}
