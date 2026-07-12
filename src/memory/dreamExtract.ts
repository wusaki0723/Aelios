import { listActiveFactKeys } from "../db/v2";
import { callOpenAICompat } from "../proxy/openaiAdapter";
import type { Env, MessageRecord, OpenAIChatRequest, OpenAIChatResponse } from "../types";
import { clampMemoryType } from "./canonicalTypes";
import type { ExtractedMemory } from "./extract";

const DEFAULT_DREAM_EXTRACT_MAX_TOKENS = 1200;
const DEFAULT_WORKERS_AI_DREAM_MODEL = "workers-ai/@cf/openai/gpt-oss-120b";

interface DreamExtractModelResult {
  memories: ExtractedMemory[];
  model?: string;
  reason?: "missing_model" | "model_error" | "model_invalid_json";
  status?: number;
}

function readPositiveInt(value: unknown, fallback: number, max: number): number {
  const parsed = typeof value === "string" ? Number(value) : typeof value === "number" ? value : fallback;
  const numeric = Number.isFinite(parsed) ? parsed : fallback;
  return Math.min(Math.max(Math.floor(numeric), 1), max);
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean);
}

function clampScore(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.min(Math.max(value, 0), 1) : fallback;
}

function readDreamExtractModel(env: Env): string {
  return (
    env.DREAM_MODEL?.trim() ||
    env.DAILY_DIGEST_MODEL?.trim() ||
    env.SUMMARY_MODEL?.trim() ||
    DEFAULT_WORKERS_AI_DREAM_MODEL
  );
}

function extractJsonObject(text: string): unknown | null {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    // Some providers wrap JSON in prose; pull out the outermost object.
  }

  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;

  try {
    return JSON.parse(text.slice(start, end + 1)) as unknown;
  } catch {
    return null;
  }
}

function normalizeCandidate(item: unknown): ExtractedMemory | null {
  if (!item || typeof item !== "object" || Array.isArray(item)) return null;
  const raw = item as Record<string, unknown>;
  const content = readString(raw.content);
  if (!content || content.length > 1000) return null;
  return {
    type: clampMemoryType(readString(raw.type)),
    content,
    importance: clampScore(raw.importance, 0.65),
    confidence: clampScore(raw.confidence, 0.72),
    tags: readStringArray(raw.tags),
    source_message_ids: readStringArray(raw.source_message_ids),
    fact_key: readString(raw.fact_key) ?? undefined
  };
}

function parseExtractModelOutput(text: string): ExtractedMemory[] | null {
  const parsed = extractJsonObject(text);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const raw = parsed as Record<string, unknown>;
  const memories = Array.isArray(raw.memories) ? raw.memories : Array.isArray(raw.candidates) ? raw.candidates : [];
  return memories.flatMap((item): ExtractedMemory[] => {
    const candidate = normalizeCandidate(item);
    return candidate ? [candidate] : [];
  });
}

function formatTranscript(messages: MessageRecord[]): string {
  return messages
    .map((message) => {
      const role = message.role === "assistant" ? "我(助手)" : "用户";
      return `[${message.id}][${message.created_at}][${role}] ${message.content.trim().slice(0, 900)}`;
    })
    .join("\n\n");
}

export function buildDreamExtractPrompt(messages: MessageRecord[], existingFactKeys: string[] = []): string {
  const factKeySection = existingFactKeys.length > 0
    ? [
        "",
        "库里已有的 fact_key（如果新事实和其中一个是同一件事，必须复用那个 fact_key，不要新造相似的 key；只有确实是新事实才发明新 key）：",
        existingFactKeys.join("、")
      ]
    : [];

  return [
    "你是 Aelios 的夜间记忆抽取器。只做一个判断：这段对话有没有值得长期保留的稳定事实，并提炼成一句未来可直接使用的记忆。",
    "产物全部进入人工审核队列，不会直接落库。",
    "只输出 JSON，不要 markdown，不要解释，不要输出思考过程。",
    "",
    "边界：",
    "- 不保存普通寒暄、临时任务、调试口令、纯情绪噪音、后端实现流水账。",
    "- 只有用户明确说出、确认、长期表现出的事实，才能写成关于用户的记忆。",
    "- 关于用户的记忆，优先写成“你……”。关于我应遵守的长期方式，写成“我需要……”。",
    "- 每条 content 必须是一句自然短句。",
    "- type 只能从这 8 个里选：fact、event、preference、relationship、boundary、habit、decision、note。绝不输出 project、world_fact、commitment 等其他值；项目进展归 fact，承诺/决定归 decision，习惯归 habit。",
    "- 稳定事实必须尽量给 fact_key，格式为小写 ASCII，例如 project:aelios-memory-v2、preference:answer-style、boundary:no-system-records。",
    "- 临时计划和意图不是稳定事实：要么提炼成背后的持久事实，要么直接跳过。",
    ...factKeySection,
    "",
    "输出格式：",
    JSON.stringify({
      memories: [
        {
          content: "你正在把 Aelios v2 记忆写入拆成即时捕获和夜间整理两档。",
          type: "fact",
          fact_key: "project:aelios-memory-v2-write-pipeline",
          importance: 0.86,
          confidence: 0.92,
          tags: ["project", "aelios"],
          source_message_ids: ["msg_x"]
        }
      ]
    }),
    "",
    "如果没有值得长期保留的稳定事实，输出：",
    JSON.stringify({ memories: [] }),
    "",
    "对话：",
    formatTranscript(messages)
  ].join("\n");
}

async function callDreamExtractModel(
  env: Env,
  messages: MessageRecord[],
  existingFactKeys: string[]
): Promise<DreamExtractModelResult> {
  const model = readDreamExtractModel(env);
  if (!model) return { memories: [], reason: "missing_model" };

  const request: OpenAIChatRequest = {
    model,
    messages: [
      { role: "system", content: "你是严格的 JSON 生成器。你只输出 JSON。" },
      { role: "user", content: buildDreamExtractPrompt(messages, existingFactKeys) }
    ],
    temperature: 0,
    max_tokens: readPositiveInt(env.DREAM_MAX_TOKENS, DEFAULT_DREAM_EXTRACT_MAX_TOKENS, 4000),
    response_format: { type: "json_object" },
    stream: false
  };

  try {
    const response = await callOpenAICompat(env, request);
    if (!response.ok) return { memories: [], model, reason: "model_error", status: response.status };
    const parsed = (await response.json()) as OpenAIChatResponse;
    const message = parsed.choices?.[0]?.message as ({ content?: unknown; reasoning_content?: unknown }) | undefined;
    const content = typeof message?.content === "string" ? message.content.trim() : "";
    const reasoning = typeof message?.reasoning_content === "string" ? message.reasoning_content.trim() : "";
    const memories = parseExtractModelOutput(content || reasoning);
    if (!memories) return { memories: [], model, reason: "model_invalid_json" };
    return { memories, model };
  } catch (error) {
    console.error("dream extract: model failed", { model, error });
    return { memories: [], model, reason: "model_error" };
  }
}

export async function extractDreamMemoriesFromMessages(
  env: Env,
  input: { namespace: string; messages: MessageRecord[] }
): Promise<DreamExtractModelResult> {
  const existingFactKeys = await listActiveFactKeys(env.DB, { namespace: input.namespace });
  return callDreamExtractModel(env, input.messages, existingFactKeys);
}