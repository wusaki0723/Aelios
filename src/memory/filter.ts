import { callOpenAICompat } from "../proxy/openaiAdapter";
import type { Env, MemoryApiRecord, OpenAIChatRequest, OpenAIChatResponse } from "../types";

const DEFAULT_WORKERS_AI_FILTER_MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";

interface FilteredMemoryItem {
  id: string;
  content: string;
}

export interface MemoryFilterMeta {
  status: "disabled" | "success" | "fallback" | "empty";
  provider: "workers-ai" | "openai-compatible";
  model: string;
  raw_count: number;
  candidate_count: number;
  output_count: number;
  reason?: string;
  output_shape?: string;
}

const FILTER_RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    memories: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          content: { type: "string" }
        },
        required: ["id", "content"],
        additionalProperties: false
      }
    }
  },
  required: ["memories"],
  additionalProperties: false
};

function sanitizeMemoryContent(text: string): string {
  return text
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

function getProvider(env: Env): "workers-ai" | "openai-compatible" {
  return env.MEMORY_FILTER_PROVIDER === "openai-compatible" ? "openai-compatible" : "workers-ai";
}

function getModel(env: Env): string {
  return env.MEMORY_FILTER_MODEL || DEFAULT_WORKERS_AI_FILTER_MODEL;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function getMaxCandidates(env: Env): number {
  const value = Number(env.MEMORY_FILTER_MAX_CANDIDATES || 12);
  return Number.isFinite(value) ? clamp(Math.floor(value), 1, 50) : 12;
}

function getMaxOutput(env: Env): number {
  const value = Number(env.MEMORY_FILTER_MAX_OUTPUT || 6);
  return Number.isFinite(value) ? clamp(Math.floor(value), 1, 20) : 6;
}

function getMaxContentChars(env: Env): number {
  const value = Number(env.MEMORY_FILTER_MAX_CONTENT_CHARS || 700);
  return Number.isFinite(value) ? clamp(Math.floor(value), 120, 3000) : 700;
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

function parseFilteredItems(value: unknown): FilteredMemoryItem[] | null {
  const array = extractJsonArray(value);
  if (!array) return null;

  const items: FilteredMemoryItem[] = [];
  for (const item of array) {
    if (!item || typeof item !== "object") continue;
    const record = item as { id?: unknown; content?: unknown; compressed_content?: unknown };
    const id = typeof record.id === "string" ? record.id : null;
    const content =
      typeof record.content === "string"
        ? record.content
        : typeof record.compressed_content === "string"
          ? record.compressed_content
          : null;

    if (id && content) {
      const sanitized = sanitizeMemoryContent(content);
      if (sanitized) items.push({ id, content: sanitized });
    }
  }

  return items;
}

function buildPrompt(input: {
  query: string;
  memories: MemoryApiRecord[];
  maxOutput: number;
  maxContentChars: number;
}): string {
  const candidates = input.memories.map((memory, index) => ({
    index: index + 1,
    id: memory.id,
    type: memory.type,
    importance: memory.importance,
    pinned: memory.pinned,
    score: typeof memory.score === "number" ? Number(memory.score.toFixed(4)) : undefined,
    tags: memory.tags,
    content: memory.content
  }));

  return [
    "你是长期记忆分拣器。你的任务是从候选记忆中挑出对当前用户消息真正有帮助的记忆，并压缩成短句。",
    "候选已按相关度初筛；score 越高越相关。",
    "",
    "规则：",
    "- 只保留与当前用户消息、长期偏好、正在进行的项目或稳定关系信息有关的记忆。",
    "- 删除寒暄、重复、牵强、明显无关的记忆。",
    "- 同一事实只保留一条，优先保留 score 更高或 pinned=true 的版本。",
    "- pinned=true 的记忆除非明显无关，否则优先保留。",
    "- 不要添加候选记忆里没有的新事实。",
    "- 不要输出记忆系统、debug-test、标签、测试口令等调试/后端元信息。",
    "- 如果候选里有真实口令，只保留口令本身，不要保留“测试”“标签”“debug”等包装词。",
    "- 没有相关记忆时输出空数组。",
    "- 每条 content 控制在 60 个中文字以内。",
    `- 最多输出 ${input.maxOutput} 条。`,
    "",
    "只输出 JSON，不要 markdown，不要解释。格式：",
    `{"memories":[{"id":"mem_xxx","content":"压缩后的记忆"}]}`,
    "",
    `当前用户消息：${input.query}`,
    "",
    `候选记忆：${JSON.stringify(candidates.map((candidate) => ({
      ...candidate,
      content: truncateText(candidate.content, input.maxContentChars)
    })))}`
  ].join("\n");
}

function mergeFilteredItems(memories: MemoryApiRecord[], items: FilteredMemoryItem[]): MemoryApiRecord[] {
  const byId = new Map(memories.map((memory) => [memory.id, memory]));
  const result: MemoryApiRecord[] = [];

  for (const item of items) {
    const memory = byId.get(item.id);
    if (!memory) continue;
    result.push({
      ...memory,
      content: item.content
    });
  }

  return result;
}

function buildFallbackMemories(memories: MemoryApiRecord[], maxOutput: number): MemoryApiRecord[] {
  return memories.slice(0, maxOutput).map((memory) => ({
    ...memory,
    content: truncateText(memory.content, 160)
  }));
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

async function callWorkersAiFilter(env: Env, prompt: string): Promise<unknown> {
  if (!env.AI) return "";

  return env.AI.run(getModel(env), {
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
    max_tokens: 700,
    response_format: {
      type: "json_schema",
      json_schema: FILTER_RESPONSE_SCHEMA
    }
  });
}

async function callOpenAICompatFilter(env: Env, prompt: string): Promise<string> {
  if (!env.MEMORY_FILTER_MODEL) return "";

  const request: OpenAIChatRequest = {
    model: env.MEMORY_FILTER_MODEL,
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
    max_tokens: 700,
    stream: false
  };

  const response = await callOpenAICompat(env, request);
  if (!response.ok) return "";

  const parsed = (await response.json()) as OpenAIChatResponse;
  const content = parsed.choices?.[0]?.message?.content;
  return typeof content === "string" ? content : "";
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

  const fallback = buildFallbackMemories(candidates, maxOutput);
  const activeMeta = {
    ...baseMeta,
    candidate_count: candidates.length,
    output_count: fallback.length
  };
  const prompt = buildPrompt({
    query,
    memories: candidates,
    maxOutput,
    maxContentChars: getMaxContentChars(env)
  });

  try {
    const output =
      provider === "openai-compatible"
        ? await callOpenAICompatFilter(env, prompt)
        : await callWorkersAiFilter(env, prompt);
    if (!output) {
      return {
        data: fallback,
        meta: {
          ...activeMeta,
          status: "fallback",
          reason: "empty_model_output",
          output_shape: describeModelOutput(output)
        }
      };
    }

    const items = parseFilteredItems(output);
    if (!items) {
      return {
        data: fallback,
        meta: {
          ...activeMeta,
          status: "fallback",
          reason: "invalid_model_output",
          output_shape: describeModelOutput(output)
        }
      };
    }

    const filtered = mergeFilteredItems(candidates, items).slice(0, maxOutput);
    return {
      data: filtered,
      meta: {
        ...activeMeta,
        status: "success",
        output_count: filtered.length,
        output_shape: describeModelOutput(output)
      }
    };
  } catch (error) {
    console.error("memory filter failed", error);
    return {
      data: fallback,
      meta: {
        ...activeMeta,
        status: "fallback",
        reason: error instanceof Error && error.message ? error.message : "model_error"
      }
    };
  }
}
