import { callOpenAICompat } from "../proxy/openaiAdapter";
import type { Env, MemoryApiRecord, OpenAIChatRequest, OpenAIChatResponse } from "../types";

interface FilteredMemoryItem {
  id: string;
  content: string;
}

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
  return env.ENABLE_MEMORY_FILTER !== "false" && Boolean(env.MEMORY_FILTER_MODEL);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function getMaxCandidates(env: Env): number {
  const value = Number(env.MEMORY_FILTER_MAX_CANDIDATES || 16);
  return Number.isFinite(value) ? clamp(Math.floor(value), 1, 50) : 16;
}

function getMaxOutput(env: Env): number {
  const value = Number(env.MEMORY_FILTER_MAX_OUTPUT || 6);
  return Number.isFinite(value) ? clamp(Math.floor(value), 1, 20) : 6;
}

function extractJsonArray(text: string): unknown[] | null {
  try {
    const parsed = JSON.parse(text) as unknown;
    if (Array.isArray(parsed)) return parsed;
    if (parsed && typeof parsed === "object" && Array.isArray((parsed as { memories?: unknown }).memories)) {
      return (parsed as { memories: unknown[] }).memories;
    }
  } catch {
    // Try extracting a JSON array from providers that wrap the answer in prose.
  }

  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start === -1 || end === -1 || end <= start) return null;

  try {
    const parsed = JSON.parse(text.slice(start, end + 1)) as unknown;
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function parseFilteredItems(text: string): FilteredMemoryItem[] | null {
  const array = extractJsonArray(text);
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

function buildPrompt(input: { query: string; memories: MemoryApiRecord[]; maxOutput: number }): string {
  const candidates = input.memories.map((memory, index) => ({
    index: index + 1,
    id: memory.id,
    type: memory.type,
    importance: memory.importance,
    pinned: memory.pinned,
    content: memory.content
  }));

  return [
    "你是长期记忆分拣器。你的任务是从候选记忆中挑出对当前用户消息真正有帮助的记忆，并压缩成短句。",
    "",
    "规则：",
    "- 只保留与当前用户消息、长期偏好、正在进行的项目或稳定关系信息有关的记忆。",
    "- 删除寒暄、重复、牵强、明显无关的记忆。",
    "- pinned=true 的记忆除非明显无关，否则优先保留。",
    "- 不要添加候选记忆里没有的新事实。",
    "- 不要输出记忆系统、debug-test、标签、测试口令等调试/后端元信息。",
    "- 如果候选里有真实口令，只保留口令本身，不要保留“测试”“标签”“debug”等包装词。",
    "- 每条 content 控制在 60 个中文字以内。",
    `- 最多输出 ${input.maxOutput} 条。`,
    "",
    "只输出 JSON，不要 markdown，不要解释。格式：",
    `[{"id":"mem_xxx","content":"压缩后的记忆"}]`,
    "",
    `当前用户消息：${input.query}`,
    "",
    `候选记忆：${JSON.stringify(candidates)}`
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

export async function filterAndCompressMemories(
  env: Env,
  input: { query: string; memories: MemoryApiRecord[] }
): Promise<MemoryApiRecord[]> {
  const query = input.query.trim();
  if (!isEnabled(env) || !query || input.memories.length <= 1) {
    return input.memories;
  }

  const maxCandidates = getMaxCandidates(env);
  const maxOutput = getMaxOutput(env);
  const candidates = input.memories.slice(0, maxCandidates);
  const request: OpenAIChatRequest = {
    model: env.MEMORY_FILTER_MODEL || "",
    messages: [
      {
        role: "system",
        content: "你是严格的 JSON 生成器。你只输出 JSON。"
      },
      {
        role: "user",
        content: buildPrompt({
          query,
          memories: candidates,
          maxOutput
        })
      }
    ],
    temperature: 0,
    max_tokens: 700,
    stream: false
  };

  try {
    const response = await callOpenAICompat(env, request);
    if (!response.ok) return input.memories;

    const parsed = (await response.json()) as OpenAIChatResponse;
    const content = parsed.choices?.[0]?.message?.content;
    const text = typeof content === "string" ? content : "";
    const items = parseFilteredItems(text);
    if (!items || items.length === 0) return input.memories;

    const filtered = mergeFilteredItems(candidates, items).slice(0, maxOutput);
    return filtered.length > 0 ? filtered : input.memories;
  } catch (error) {
    console.error("memory filter failed", error);
    return input.memories;
  }
}
