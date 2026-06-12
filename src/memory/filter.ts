import { callOpenAICompat } from "../proxy/openaiAdapter";
import type { Env, MemoryApiRecord, OpenAIChatRequest, OpenAIChatResponse } from "../types";

const DEFAULT_WORKERS_AI_FILTER_MODEL = "workers-ai/@cf/meta/llama-3.3-70b-instruct-fp8-fast";
const DEFAULT_WORKERS_AI_RERANKER_MODEL = "workers-ai/@cf/baai/bge-reranker-base";

interface CompressedMemoryItem {
  content: string;
}

type CompressedMemorySlot = CompressedMemoryItem | null;

export interface MemoryFilterMeta {
  status: "disabled" | "success" | "error" | "empty";
  provider: "workers-ai" | "openai-compatible";
  model: string;
  raw_count: number;
  candidate_count: number;
  output_count: number;
  reason?: string;
  output_shape?: string;
  reranker_status?: "disabled" | "success" | "error";
  reranker_model?: string;
  reranker_count?: number;
  reranker_reason?: string;
}

const COMPRESSION_RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    memories: {
      type: "array",
      items: {
        anyOf: [{ type: "string" }, { type: "null" }]
      }
    }
  },
  required: ["memories"],
  additionalProperties: false
};

function sanitizeMemoryContent(text: string): string {
  return text
    .replace(/<time_reminder>[^|。\n]*/gi, "")
    .replace(/对话摘要（\d+ 条消息）：?/g, "")
    .replace(/用户话题[:：]/g, "")
    .replace(/助手要点[:：]/g, "")
    .replace(/debug-test/gi, "")
    .replace(/记忆系统/g, "")
    .replace(/自动记忆测试口令/g, "口令")
    .replace(/测试口令/g, "口令")
    .replace(/标签为?[^，。；\s]+/g, "")
    .replace(/标签[:：]?[^，。；\s]+/g, "")
    .replace(/[，,；;：:]\s*([。.!！?？])/g, "$1")
    .replace(/\s{2,}/g, " ")
    .replace(/^[，,；;：:\s]+|[，,；;：:\s]+$/g, "")
    .trim();
}

function isEnabled(env: Env): boolean {
  return env.ENABLE_MEMORY_FILTER !== "false";
}

function getModel(env: Env): string {
  return env.MEMORY_FILTER_MODEL || DEFAULT_WORKERS_AI_FILTER_MODEL;
}

function isRerankerEnabled(env: Env): boolean {
  return env.ENABLE_MEMORY_RERANKER !== "false";
}

function getRerankerModel(env: Env): string {
  return env.MEMORY_RERANKER_MODEL || DEFAULT_WORKERS_AI_RERANKER_MODEL;
}

function workersAiModelName(model: string): string | null {
  const normalized = model.trim();
  if (normalized.startsWith("workers-ai/")) return normalized.slice("workers-ai/".length);
  if (normalized.startsWith("worker/")) return normalized.slice("worker/".length);
  if (normalized.startsWith("@cf/")) return normalized;
  return null;
}

function getWorkersAiModel(env: Env): string | null {
  const model = getModel(env);
  return workersAiModelName(model);
}

function getWorkersAiRerankerModel(env: Env): string | null {
  return workersAiModelName(getRerankerModel(env));
}

function getProvider(env: Env): "workers-ai" | "openai-compatible" {
  return getWorkersAiModel(env) ? "workers-ai" : "openai-compatible";
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function getMaxCandidates(env: Env): number {
  const value = Number(env.MEMORY_FILTER_MAX_CANDIDATES || 12);
  return Number.isFinite(value) ? clamp(Math.floor(value), 1, 50) : 12;
}

function getMaxOutput(env: Env): number {
  const value = Number(env.MEMORY_FILTER_MAX_OUTPUT || 5);
  return Number.isFinite(value) ? clamp(Math.floor(value), 1, 20) : 5;
}

function getMaxContentChars(env: Env): number {
  const value = Number(env.MEMORY_FILTER_MAX_CONTENT_CHARS || 700);
  return Number.isFinite(value) ? clamp(Math.floor(value), 120, 3000) : 700;
}

function getMaxOutputChars(env: Env): number {
  const value = Number(env.MEMORY_FILTER_OUTPUT_CHARS || 300);
  return Number.isFinite(value) ? clamp(Math.floor(value), 60, 1000) : 300;
}

function getMaxTokens(env: Env): number {
  const value = Number(env.MEMORY_FILTER_MAX_TOKENS || 1400);
  return Number.isFinite(value) ? clamp(Math.floor(value), 200, 4000) : 1400;
}

function getFilterMinScore(env: Env): number {
  const value = Number(env.MEMORY_FILTER_MIN_SCORE || env.MEMORY_MIN_SCORE || 0.35);
  return Number.isFinite(value) ? clamp(value, 0, 1) : 0.35;
}

function truncateText(text: string, maxChars: number): string {
  return text.length > maxChars ? `${text.slice(0, maxChars).trim()}...` : text;
}

function normalizeForDedupe(text: string): string {
  return text
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[，,。.!！?？；;：:“”"'`、\[\]【】（）()<>《》]/g, "");
}

function compareMemoryQuality(a: MemoryApiRecord, b: MemoryApiRecord): number {
  if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;

  const scoreA = typeof a.score === "number" ? a.score : -1;
  const scoreB = typeof b.score === "number" ? b.score : -1;
  if (scoreA !== scoreB) return scoreB - scoreA;

  if (a.importance !== b.importance) return b.importance - a.importance;
  return b.confidence - a.confidence;
}

function prepareCandidates(env: Env, memories: MemoryApiRecord[]): MemoryApiRecord[] {
  const minScore = getFilterMinScore(env);
  const sorted = memories
    .flatMap((memory): MemoryApiRecord[] => {
      const content = sanitizeMemoryContent(memory.content);
      if (!content) return [];
      if (!memory.pinned && typeof memory.score === "number" && memory.score < minScore) return [];
      return [{ ...memory, content }];
    })
    .sort(compareMemoryQuality);

  const seenIds = new Set<string>();
  const seenContent = new Set<string>();
  const result: MemoryApiRecord[] = [];

  for (const memory of sorted) {
    const normalized = normalizeForDedupe(memory.content);
    if (!normalized || seenIds.has(memory.id) || seenContent.has(normalized)) continue;
    seenIds.add(memory.id);
    seenContent.add(normalized);
    result.push(memory);
    if (result.length >= getMaxCandidates(env)) break;
  }

  return result;
}

function extractJsonArrayFromString(text: string): unknown[] | null {
  const trimmed = text.trim();
  if (!trimmed) return null;

  try {
    return extractJsonArray(JSON.parse(trimmed) as unknown);
  } catch {
    // Some providers still wrap JSON in a short sentence; extract the JSON part.
  }

  const objectStart = trimmed.indexOf("{");
  const objectEnd = trimmed.lastIndexOf("}");
  if (objectStart !== -1 && objectEnd > objectStart) {
    try {
      return extractJsonArray(JSON.parse(trimmed.slice(objectStart, objectEnd + 1)) as unknown);
    } catch {
      // Fall through to array extraction.
    }
  }

  const start = trimmed.indexOf("[");
  const end = trimmed.lastIndexOf("]");
  if (start === -1 || end === -1 || end <= start) return null;

  try {
    const parsed = JSON.parse(trimmed.slice(start, end + 1)) as unknown;
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function extractJsonArray(value: unknown): unknown[] | null {
  if (Array.isArray(value)) return value;
  if (typeof value === "string") return extractJsonArrayFromString(value);
  if (!value || typeof value !== "object") return null;

  const object = value as {
    memories?: unknown;
    response?: unknown;
    result?: unknown;
    text?: unknown;
    output?: unknown;
  };

  if (Array.isArray(object.memories)) return object.memories;

  for (const field of [object.response, object.result, object.text, object.output]) {
    const array = extractJsonArray(field);
    if (array) return array;
  }

  return null;
}

function parseCompressedItems(value: unknown): CompressedMemorySlot[] | null {
  const array = extractJsonArray(value);
  if (!array) return null;
  const isNullishLiteral = (text: string): boolean => ["null", "undefined", "none"].includes(text.trim().toLowerCase());

  const items: CompressedMemorySlot[] = [];
  for (const item of array) {
    if (item === null) {
      items.push(null);
      continue;
    }

    if (typeof item === "string") {
      const sanitized = sanitizeMemoryContent(item);
      items.push(sanitized && !isNullishLiteral(sanitized) ? { content: sanitized } : null);
      continue;
    }

    if (!item || typeof item !== "object") {
      items.push(null);
      continue;
    }
    const record = item as { id?: unknown; content?: unknown; compressed_content?: unknown };
    const content =
      typeof record.content === "string"
        ? record.content
        : typeof record.compressed_content === "string"
          ? record.compressed_content
          : null;

    if (content) {
      const sanitized = sanitizeMemoryContent(content);
      items.push(sanitized && !isNullishLiteral(sanitized) ? { content: sanitized } : null);
    } else {
      items.push(null);
    }
  }

  return items;
}

function buildPrompt(input: {
  query: string;
  memories: MemoryApiRecord[];
  maxContentChars: number;
  maxOutputChars: number;
}): string {
  const memories = input.memories.map((memory) => truncateText(memory.content, input.maxContentChars));

  return [
    "你是长期记忆压缩器。候选记忆已经由 reranker 选好并按相关性排序。",
    "你的任务只是在不改变事实的前提下，把每条候选压缩成适合放进 prompt 的短句。",
    "这是数据库检索后的记忆压缩任务，不是聊天续写、角色扮演或内容创作。",
    "候选可能包含成年人自愿亲密关系、偏好或边界；相关时只按事实记忆中性概括保留。",
    "不要续写亲密场景，不要生成新的色情内容，不要因为候选含成年人自愿亲密内容就拒绝、说教或删除。",
    "",
    "压缩规则：",
    "- 必须按输入顺序逐条输出，输出数组长度必须与候选记忆数量一致。",
    "- 根据当前用户消息做轻量分拣；明显无关、只沾边、会增加噪音的候选输出 null。",
    "- 相关候选输出压缩短句；不要重排、合并或把一条候选拆成多条。",
    "- 不要输出编号、id、index、score、type、tags 或其他元数据。",
    "- 不要添加候选记忆里没有的新事实。",
    "- 成年人自愿亲密内容只压缩成事实、偏好、边界或关系记忆；不得扩写成场景描写。",
    "- 不要输出“对话摘要”“用户话题”“助手要点”“time_reminder”等包装词。",
    "- 不要输出记忆系统、debug-test、标签、测试口令等调试/后端元信息。",
    "- 如果候选里有真实口令，只保留口令本身，不要保留“测试”“标签”“debug”等包装词。",
    `- 每条 content 控制在 ${input.maxOutputChars} 个中文字以内。`,
    "",
    "只输出 JSON，不要 markdown，不要解释。格式：",
    `{"memories":["压缩后的相关记忆",null]}`,
    "",
    `当前用户消息：${input.query}`,
    "",
    `候选记忆：${JSON.stringify(memories)}`
  ].join("\n");
}

function mergeCompressedItems(memories: MemoryApiRecord[], items: CompressedMemorySlot[]): MemoryApiRecord[] {
  const result: MemoryApiRecord[] = [];

  for (let index = 0; index < items.length && index < memories.length; index += 1) {
    const memory = memories[index];
    const item = items[index];
    if (!memory || !item) continue;
    result.push({
      ...memory,
      content: item.content
    });
  }

  return result;
}

function describeModelOutput(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (typeof value !== "object") return typeof value;

  const object = value as { response?: unknown; memories?: unknown; result?: unknown; output?: unknown; text?: unknown };
  if (Array.isArray(object.memories)) return "object.memories_array";
  if (typeof object.response === "string") return "object.response_string";
  if (object.response && typeof object.response === "object") return "object.response_object";
  if (typeof object.result === "string") return "object.result_string";
  if (object.result && typeof object.result === "object") return "object.result_object";
  if (typeof object.output === "string") return "object.output_string";
  if (typeof object.text === "string") return "object.text_string";
  return "object";
}

async function callWorkersAiFilter(env: Env, prompt: string, model: string, maxTokens: number): Promise<unknown> {
  if (!env.AI) return "";

  return env.AI.run(model, {
    messages: [
      {
        role: "system",
        content: "你是严格的 JSON 生成器。你只输出 JSON。"
      },
      {
        role: "user",
        content: prompt
      }
    ],
    temperature: 0,
    max_tokens: maxTokens,
    response_format: {
      type: "json_schema",
      json_schema: COMPRESSION_RESPONSE_SCHEMA
    }
  });
}

async function callOpenAICompatFilter(env: Env, prompt: string, model: string, maxTokens: number): Promise<string> {
  const normalizedModel = model.trim().toLowerCase();
  const supportsEnableThinkingField = normalizedModel !== "cerebras/gpt-oss-120b";
  const request: OpenAIChatRequest = {
    model,
    messages: [
      {
        role: "system",
        content: "你是严格的 JSON 生成器。你只输出 JSON。"
      },
      {
        role: "user",
        content: prompt
      }
    ],
    temperature: 0,
    max_tokens: maxTokens,
    response_format: {
      type: "json_object"
    },
    stream: false
  };
  if (supportsEnableThinkingField) request.enable_thinking = false;

  const response = await callOpenAICompat(env, request);
  if (!response.ok) return "";

  const parsed = (await response.json()) as OpenAIChatResponse;
  const message = parsed.choices?.[0]?.message;
  const content = typeof message?.content === "string" ? message.content.trim() : "";
  const reasoning = typeof message?.reasoning_content === "string" ? message.reasoning_content.trim() : "";
  return content || reasoning;
}

function readRerankerResponse(value: unknown): Array<{ id: number; score: number }> | null {
  if (!value || typeof value !== "object") return null;
  const object = value as { response?: unknown; result?: unknown; data?: unknown };
  const rows = Array.isArray(object.response)
    ? object.response
    : Array.isArray(object.result)
      ? object.result
      : Array.isArray(object.data)
        ? object.data
        : null;
  if (!rows) return null;

  const result: Array<{ id: number; score: number }> = [];
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const item = row as { id?: unknown; index?: unknown; score?: unknown };
    const id = typeof item.id === "number" ? item.id : typeof item.index === "number" ? item.index : NaN;
    const score = typeof item.score === "number" ? item.score : NaN;
    if (Number.isInteger(id) && Number.isFinite(score)) result.push({ id, score });
  }

  return result.length > 0 ? result : null;
}

async function rerankMemories(
  env: Env,
  input: { query: string; memories: MemoryApiRecord[]; topK: number; maxContentChars: number }
): Promise<{
  data: MemoryApiRecord[];
  status: "disabled" | "success" | "error";
  model: string;
  reason?: string;
}> {
  const model = getRerankerModel(env);
  const workersAiModel = getWorkersAiRerankerModel(env);

  if (!isRerankerEnabled(env)) {
    return {
      data: input.memories.slice(0, input.topK),
      status: "disabled",
      model,
      reason: "reranker_disabled"
    };
  }

  if (!env.AI || !workersAiModel) {
    return {
      data: input.memories.slice(0, input.topK),
      status: "disabled",
      model,
      reason: !env.AI ? "missing_workers_ai_binding" : "unsupported_reranker_provider"
    };
  }

  try {
    const output = await env.AI.run(workersAiModel, {
      query: input.query,
      top_k: input.topK,
      contexts: input.memories.map((memory) => ({
        text: truncateText(memory.content, input.maxContentChars)
      }))
    });
    const rows = readRerankerResponse(output);
    if (!rows) {
      return {
        data: input.memories.slice(0, input.topK),
        status: "error",
        model,
        reason: "invalid_reranker_output"
      };
    }

    const used = new Set<number>();
    const reranked: MemoryApiRecord[] = [];
    for (const row of rows.sort((a, b) => b.score - a.score)) {
      if (used.has(row.id)) continue;
      const memory = input.memories[row.id];
      if (!memory) continue;
      used.add(row.id);
      reranked.push({ ...memory, score: row.score });
      if (reranked.length >= input.topK) break;
    }

    return {
      data: reranked.length > 0 ? reranked : input.memories.slice(0, input.topK),
      status: reranked.length > 0 ? "success" : "error",
      model,
      ...(reranked.length > 0 ? {} : { reason: "empty_reranker_output" })
    };
  } catch (error) {
    console.error("memory reranker failed", error);
    return {
      data: input.memories.slice(0, input.topK),
      status: "error",
      model,
      reason: error instanceof Error && error.message ? error.message : "reranker_error"
    };
  }
}

export async function filterAndCompressMemories(
  env: Env,
  input: { query: string; memories: MemoryApiRecord[] }
): Promise<MemoryApiRecord[]> {
  const result = await filterAndCompressMemoriesWithMeta(env, input);
  return result.data;
}

export async function filterAndCompressMemoriesWithMeta(
  env: Env,
  input: { query: string; memories: MemoryApiRecord[] }
): Promise<{ data: MemoryApiRecord[]; meta: MemoryFilterMeta }> {
  const query = input.query.trim();
  const provider = getProvider(env);
  const model = getModel(env);
  const baseMeta = {
    provider,
    model,
    raw_count: input.memories.length,
    candidate_count: 0,
    output_count: input.memories.length
  };

  if (!isEnabled(env) || !query) {
    return {
      data: input.memories,
      meta: {
        ...baseMeta,
        status: "disabled",
        reason: !query ? "empty_query" : "filter_disabled"
      }
    };
  }

  const maxOutput = getMaxOutput(env);
  const candidates = prepareCandidates(env, input.memories);
  if (candidates.length === 0) {
    return {
      data: [],
      meta: {
        ...baseMeta,
        status: "empty",
        candidate_count: 0,
        output_count: 0,
        reason: "no_candidates"
      }
    };
  }

  const activeMeta = {
    ...baseMeta,
    candidate_count: candidates.length,
    output_count: 0
  };
  const reranked = await rerankMemories(env, {
    query,
    memories: candidates,
    topK: maxOutput,
    maxContentChars: getMaxContentChars(env)
  });
  const prompt = buildPrompt({
    query,
    memories: reranked.data,
    maxContentChars: getMaxContentChars(env),
    maxOutputChars: getMaxOutputChars(env)
  });
  const maxTokens = getMaxTokens(env);

  try {
    const output =
      provider === "openai-compatible"
        ? await callOpenAICompatFilter(env, prompt, model, maxTokens)
        : await callWorkersAiFilter(env, prompt, getWorkersAiModel(env) || model, maxTokens);
    if (!output) {
      return {
        data: [],
        meta: {
          ...activeMeta,
          status: "error",
          reason: "empty_model_output",
          output_shape: describeModelOutput(output),
          reranker_status: reranked.status,
          reranker_model: reranked.model,
          reranker_count: reranked.data.length,
          ...(reranked.reason ? { reranker_reason: reranked.reason } : {})
        }
      };
    }

    const items = parseCompressedItems(output);
    if (!items) {
      return {
        data: [],
        meta: {
          ...activeMeta,
          status: "error",
          reason: "invalid_model_output",
          output_shape: describeModelOutput(output),
          reranker_status: reranked.status,
          reranker_model: reranked.model,
          reranker_count: reranked.data.length,
          ...(reranked.reason ? { reranker_reason: reranked.reason } : {})
        }
      };
    }

    if (items.length !== reranked.data.length) {
      return {
        data: [],
        meta: {
          ...activeMeta,
          status: "error",
          reason: "slot_count_mismatch",
          output_shape: describeModelOutput(output),
          reranker_status: reranked.status,
          reranker_model: reranked.model,
          reranker_count: reranked.data.length,
          ...(reranked.reason ? { reranker_reason: reranked.reason } : {})
        }
      };
    }

    const filtered = mergeCompressedItems(reranked.data, items).slice(0, maxOutput);
    return {
      data: filtered,
      meta: {
        ...activeMeta,
        status: "success",
        output_count: filtered.length,
        output_shape: describeModelOutput(output),
        reranker_status: reranked.status,
        reranker_model: reranked.model,
        reranker_count: reranked.data.length,
        ...(reranked.reason ? { reranker_reason: reranked.reason } : {})
      }
    };
  } catch (error) {
    console.error("memory filter failed", error);
    return {
      data: [],
      meta: {
        ...activeMeta,
        status: "error",
        reason: error instanceof Error && error.message ? error.message : "model_error",
        reranker_status: reranked.status,
        reranker_model: reranked.model,
        reranker_count: reranked.data.length,
        ...(reranked.reason ? { reranker_reason: reranked.reason } : {})
      }
    };
  }
}
