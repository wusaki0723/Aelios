import { callOpenAICompat } from "../proxy/openaiAdapter";
import {
  countMessagesAfter,
  getLatestSummary,
  getMessageCreatedAt,
  listRecentMessagesForSummary,
  upsertSummary,
} from "../db/summaries";
import type { Env, OpenAIChatRequest, OpenAIChatResponse } from "../types";
import { SUMMARY_MAX_CHARS } from "../assembler/types";

// ---------------------------------------------------------------------------
// Defaults (hardcoded, not user-configurable)
// ---------------------------------------------------------------------------

const SUMMARY_EVERY_N_MESSAGES = 50;
const SUMMARY_SOURCE_LIMIT = 120;

// ---------------------------------------------------------------------------
// Sanitize: strip meta/implementation leakage from summary content
// ---------------------------------------------------------------------------

const SANITIZE_PATTERNS: Array<[RegExp, string]> = [
  [/debug-test/gi, ""],
  [/自动记忆测试口令/g, "口令"],
  [/测试口令/g, "口令"],
  [/根据记忆系统/g, ""],
  [/根据系统/g, ""],
  [/记忆系统/g, ""],
  [/标签为?[^，。；\s]+/g, ""],
  [/标签[:：]?[^，。；\s]+/g, ""],
  [/后端实现/g, ""],
  [/Vectorize/gi, ""],
  [/D1\b/g, ""],
  [/[Pp]rompt\s*[Bb]lock/g, ""],
  [/[Ss]ystem\s*[Bb]lock/g, ""],
  [/[，,；;：:]\s*([。.!！?？])/g, "$1"],
  [/\s{2,}/g, " "],
  [/^[，,；;：:\s]+|[，,；;：:\s]+$/g, ""],
];

function sanitizeSummary(text: string): string {
  let result = text;
  for (const [pattern, replacement] of SANITIZE_PATTERNS) {
    result = result.replace(pattern, replacement);
  }
  return result.trim();
}

// ---------------------------------------------------------------------------
// Extract JSON from model output (handles prose wrapping)
// ---------------------------------------------------------------------------

function extractJsonObject(text: string): unknown | null {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    // fall through
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

// ---------------------------------------------------------------------------
// Build the summary prompt
// ---------------------------------------------------------------------------

function buildSummaryPrompt(
  oldSummary: string | null,
  messages: Array<{ role: string; content: string }>
): string {
  const transcript = messages
    .map((m) => `[${m.role}] ${m.content}`)
    .join("\n");

  const oldSection = oldSummary
    ? `旧摘要：\n${oldSummary}\n\n`
    : "";

  return [
    "你是长期对话摘要器。请根据以下对话，生成一段长期稳定的摘要。",
    "只输出 JSON，不要 markdown，不要解释。",
    "",
    "摘要应保留：",
    "- 用户长期偏好、习惯、边界/雷点",
    "- 关系设定、称呼、角色定位",
    "- 长期进行的项目、计划、目标",
    "- 重要事实、承诺、里程碑",
    "- 反复出现的话题或兴趣",
    "",
    "摘要应忽略：",
    "- 普通寒暄、临时语气",
    "- 本轮格式、风格指令",
    "- 调试信息、测试口令、后端实现",
    "- 记忆系统、D1、Vectorize 等技术细节",
    "",
    "摘要应简洁、连贯、自然中文，适合长期记忆。",
    `摘要不超过 ${SUMMARY_MAX_CHARS} 字。`,
    "",
    oldSection + "对话记录：\n" + transcript,
    "",
    '输出格式：{ "content": "长期摘要文本" }',
  ].join("\n");
}

// ---------------------------------------------------------------------------
// maybeUpdateLongTermSummary
//
// Checks if enough new messages have accumulated since the last summary.
// If so, calls the summary model and upserts the result.
// ---------------------------------------------------------------------------

export async function maybeUpdateLongTermSummary(
  env: Env,
  namespace: string
): Promise<{ updated: boolean }> {
  const model = env.SUMMARY_MODEL || env.MEMORY_MODEL;
  if (!model) return { updated: false };

  const latest = await getLatestSummary(env.DB, namespace);

  // Resolve cursor: prefer to_message_id's created_at (avoids missing messages
  // written concurrently with the summary), fallback to updated_at.
  let afterTs: string | null = null;
  if (latest?.to_message_id) {
    afterTs = await getMessageCreatedAt(env.DB, namespace, latest.to_message_id);
  }
  if (!afterTs) {
    afterTs = latest?.updated_at ?? null;
  }

  const newCount = await countMessagesAfter(env.DB, namespace, afterTs);
  if (newCount < SUMMARY_EVERY_N_MESSAGES) return { updated: false };

  const messages = await listRecentMessagesForSummary(env.DB, namespace, SUMMARY_SOURCE_LIMIT);
  if (messages.length === 0) return { updated: false };

  const oldSummary = latest?.content ?? null;
  const prompt = buildSummaryPrompt(oldSummary, messages);

  const request: OpenAIChatRequest = {
    model,
    messages: [
      { role: "system", content: "你是严格的 JSON 生成器。你只输出 JSON。" },
      { role: "user", content: prompt },
    ],
    temperature: 0,
    max_tokens: 800,
    stream: false,
  };

  let response: Response;
  try {
    response = await callOpenAICompat(env, request);
  } catch {
    return { updated: false };
  }
  if (!response.ok) return { updated: false };

  let parsed: OpenAIChatResponse;
  try {
    parsed = (await response.json()) as OpenAIChatResponse;
  } catch {
    return { updated: false };
  }

  const raw = parsed.choices?.[0]?.message?.content;
  const text = typeof raw === "string" ? raw.trim() : "";
  if (!text) return { updated: false };

  const json = extractJsonObject(text);
  if (!json || typeof json !== "object") return { updated: false };

  const content = (json as { content?: unknown }).content;
  if (typeof content !== "string") return { updated: false };

  const sanitized = sanitizeSummary(content);
  if (!sanitized) return { updated: false };

  const truncated =
    sanitized.length <= SUMMARY_MAX_CHARS
      ? sanitized
      : sanitized.slice(0, SUMMARY_MAX_CHARS - 3) + "...";

  const lastMessage = messages[messages.length - 1];

  await upsertSummary(env.DB, {
    namespace,
    content: truncated,
    fromMessageId: messages[0]?.id ?? null,
    toMessageId: lastMessage?.id ?? null,
    messageCount: (latest?.message_count ?? 0) + newCount,
  });

  return { updated: true };
}
