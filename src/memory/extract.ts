import { callOpenAICompat } from "../proxy/openaiAdapter";
import type { Env, MessageRecord, OpenAIChatRequest, OpenAIChatResponse } from "../types";

export interface ExtractedMemory {
  type: string;
  content: string;
  importance: number;
  confidence: number;
  tags: string[];
  source_message_ids: string[];
}

export interface MemoryExtractionResult {
  memories: ExtractedMemory[];
  summary_patch?: string;
}

function normalizeNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.min(Math.max(value, 0), 1) : fallback;
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean);
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

function normalizeMemoryContent(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = sanitizeMemoryContent(value);
  if (!text || text.length > 1000) return null;
  return text;
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

function parseExtraction(text: string): MemoryExtractionResult {
  const parsed = extractJsonObject(text);
  if (!parsed || typeof parsed !== "object") {
    return { memories: [] };
  }

  const raw = parsed as { memories?: unknown; summary_patch?: unknown };
  const memories = Array.isArray(raw.memories) ? raw.memories : [];

  return {
    summary_patch: typeof raw.summary_patch === "string" ? raw.summary_patch : undefined,
    memories: memories.flatMap((item): ExtractedMemory[] => {
      const stringContent = normalizeMemoryContent(item);
      if (stringContent) {
        return [
          {
            type: "note",
            content: stringContent,
            importance: 0.7,
            confidence: 0.8,
            tags: [],
            source_message_ids: []
          }
        ];
      }

      if (!item || typeof item !== "object") return [];
      const record = item as {
        type?: unknown;
        content?: unknown;
        importance?: unknown;
        confidence?: unknown;
        tags?: unknown;
        source_message_ids?: unknown;
      };

      const content = normalizeMemoryContent(record.content);
      if (!content) return [];

      return [
        {
          type: typeof record.type === "string" && record.type.trim() ? record.type.trim() : "note",
          content,
          importance: normalizeNumber(record.importance, 0.5),
          confidence: normalizeNumber(record.confidence, 0.8),
          tags: normalizeStringArray(record.tags),
          source_message_ids: normalizeStringArray(record.source_message_ids)
        }
      ];
    })
  };
}

function buildExtractionPrompt(messages: MessageRecord[]): string {
  const transcript = messages
    .map((message) => {
      const role = message.role === "assistant" ? "我(助手)" : "用户";
      return `[${message.id}][${role}] ${message.content}`;
    })
    .join("\n\n");

  return [
    "你是长期记忆小秘书。请从以下对话中抽取值得长期保存的信息。",
    "你站在“我=助手”的视角写记忆，写给未来的我自己看。",
    "只输出 JSON，不要 markdown，不要解释。",
    "",
    "角色判定（非常重要）：",
    "- [用户] 是正在和我说话的人。",
    "- [我(助手)] 是我自己说过的话。",
    "- 不要把我说过的话误写成用户的偏好、身份、经历或承诺。",
    "- 只有用户明确说出、确认、长期表现出的信息，才能写成关于用户的记忆。",
    "- 如果是我对用户做出的承诺、互动方式或应遵守的边界，用第一人称写：例如“我需要……”“我答应……”“我以后要……”。",
    "",
    "写法要求：",
    "- 尽量不用生硬的“用户/助手”称呼。",
    "- 关于用户的记忆，优先写成“你……”或自然描述，例如“你偏好……”“你正在……”。",
    "- 关于我的责任/承诺/互动方式，写成“我……”例如“我需要在回答时更直接”。",
    "- 不要写成第三人称报告腔，例如“用户表示……”“助手应该……”。",
    "- 每条 content 必须是未来对话可直接使用的自然短句。",
    "",
    "不要保存：",
    "- 普通寒暄",
    "- 临时语气词",
    "- 重复信息",
    "- 未明确表达的猜测",
    "- 只属于本轮 prompt 风格的临时指令",
    "- 记忆系统、debug-test、标签、测试口令、后端实现、D1、Vectorize、RAG、prompt block 等元信息",
    "",
    "优先保存：",
    "- 用户长期偏好",
    "- 项目/计划",
    "- 重要事件",
    "- 承诺",
    "- 边界/雷点",
    "- 关系里程碑",
    "- 反复出现的习惯",
    "",
    "输出格式：",
    JSON.stringify({
      memories: [
        {
          type: "project",
          content: "你正在做一个 Cloudflare Worker 记忆代理。",
          importance: 0.86,
          confidence: 0.94,
          tags: ["project", "cloudflare"],
          source_message_ids: ["msg_x"]
        },
        {
          type: "boundary",
          content: "我需要避免把你的设定或偏好说成系统记录。",
          importance: 0.82,
          confidence: 0.9,
          tags: ["boundary", "style"],
          source_message_ids: ["msg_y"]
        }
      ],
      summary_patch: "本轮讨论了记忆代理，以及我以后应如何记录长期记忆。"
    }),
    "",
    "对话：",
    transcript
  ].join("\n");
}

export async function extractMemoriesFromMessages(
  env: Env,
  messages: MessageRecord[]
): Promise<MemoryExtractionResult> {
  if (!env.MEMORY_MODEL || messages.length === 0) {
    return { memories: [] };
  }

  const request: OpenAIChatRequest = {
    model: env.MEMORY_MODEL,
    messages: [
      {
        role: "system",
        content: "你是严格的 JSON 生成器。你只输出 JSON。"
      },
      {
        role: "user",
        content: buildExtractionPrompt(messages)
      }
    ],
    temperature: 0,
    max_tokens: 900,
    stream: false
  };

  const response = await callOpenAICompat(env, request);
  if (!response.ok) {
    return { memories: [] };
  }

  const parsed = (await response.json()) as OpenAIChatResponse;
  const message = parsed.choices?.[0]?.message as
    | ({ content?: unknown; reasoning_content?: unknown })
    | undefined;
  const content = typeof message?.content === "string" ? message.content.trim() : "";
  const reasoning = typeof message?.reasoning_content === "string" ? message.reasoning_content.trim() : "";
  return parseExtraction(content || reasoning);
}
