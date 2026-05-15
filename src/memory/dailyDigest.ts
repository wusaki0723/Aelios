import { listMessagesByNamespace } from "../db/messages";
import { readCursor, writeCursor } from "../db/retention";
import { upsertSummary } from "../db/summaries";
import { callOpenAICompat } from "../proxy/openaiAdapter";
import type { Env, MemoryApiRecord, MessageRecord, OpenAIChatRequest, OpenAIChatResponse } from "../types";
import type { ExtractedMemory } from "./extract";
import {
  createVectorMemory,
  deleteVectorMemory,
  getVectorMemory,
  listVectorMemories,
  updateVectorMemory
} from "./vectorStore";

interface DigestMemoryUpdate {
  target_id: string;
  content?: string;
  type?: string;
  importance?: number;
  confidence?: number;
  tags?: string[];
}

interface DigestMemoryDelete {
  target_id: string;
  reason?: string;
}

interface ImportantExcerpt {
  quote: string;
  reason?: string;
  tags?: string[];
  source_message_ids?: string[];
}

interface DailyDigestResult {
  date?: string;
  title?: string;
  summary?: string;
  sections?: Array<{ heading?: string; content?: string }>;
  important_excerpts?: ImportantExcerpt[];
  memories_to_add?: ExtractedMemory[];
  memories_to_update?: DigestMemoryUpdate[];
  memories_to_delete?: DigestMemoryDelete[];
}

interface DailyDigestStats {
  processedMessages: number;
  addedMemories: number;
  updatedMemories: number;
  deletedMemories: number;
  savedExcerpts: number;
  cleanedEmptyMemories: number;
  cursorAdvanced: boolean;
}

const DEFAULT_MAX_MESSAGES = 320;
const DEFAULT_MEMORY_CONTEXT_LIMIT = 250;
const DEFAULT_EXCERPT_LIMIT = 8;
const DEFAULT_EMPTY_MEMORY_MIN_CHARS = 4;
const DEFAULT_TIME_ZONE = "Asia/Singapore";

function readPositiveInt(value: unknown, fallback: number, max: number): number {
  const parsed = typeof value === "string" ? Number(value) : typeof value === "number" ? value : fallback;
  const numeric = Number.isFinite(parsed) ? parsed : fallback;
  return Math.min(Math.max(Math.floor(numeric), 1), max);
}

function clampScore(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.min(Math.max(value, 0), 1) : fallback;
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean);
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function truncate(text: string, maxChars: number): string {
  return text.length <= maxChars ? text : `${text.slice(0, maxChars - 3)}...`;
}

function formatDate(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(date);
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

function normalizeExtractedMemory(value: unknown): ExtractedMemory | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const content = readString(raw.content);
  if (!content) return null;

  return {
    type: readString(raw.type) || "note",
    content,
    importance: clampScore(raw.importance, 0.7),
    confidence: clampScore(raw.confidence, 0.82),
    tags: readStringArray(raw.tags),
    source_message_ids: readStringArray(raw.source_message_ids)
  };
}

function normalizeDigestResult(value: unknown): DailyDigestResult {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const raw = value as Record<string, unknown>;

  const sections = Array.isArray(raw.sections)
    ? raw.sections.flatMap((item): Array<{ heading?: string; content?: string }> => {
        if (!item || typeof item !== "object" || Array.isArray(item)) return [];
        const record = item as Record<string, unknown>;
        const heading = readString(record.heading) ?? undefined;
        const content = readString(record.content) ?? undefined;
        return heading || content ? [{ heading, content }] : [];
      })
    : undefined;

  const important_excerpts = Array.isArray(raw.important_excerpts)
    ? raw.important_excerpts.flatMap((item): ImportantExcerpt[] => {
        if (!item || typeof item !== "object" || Array.isArray(item)) return [];
        const record = item as Record<string, unknown>;
        const quote = readString(record.quote);
        if (!quote) return [];
        return [
          {
            quote,
            reason: readString(record.reason) ?? undefined,
            tags: readStringArray(record.tags),
            source_message_ids: readStringArray(record.source_message_ids)
          }
        ];
      })
    : undefined;

  const memories_to_update = Array.isArray(raw.memories_to_update)
    ? raw.memories_to_update.flatMap((item): DigestMemoryUpdate[] => {
        if (!item || typeof item !== "object" || Array.isArray(item)) return [];
        const record = item as Record<string, unknown>;
        const targetId = readString(record.target_id);
        if (!targetId) return [];
        return [
          {
            target_id: targetId,
            content: readString(record.content) ?? undefined,
            type: readString(record.type) ?? undefined,
            importance: typeof record.importance === "number" ? clampScore(record.importance, 0.7) : undefined,
            confidence: typeof record.confidence === "number" ? clampScore(record.confidence, 0.82) : undefined,
            tags: Array.isArray(record.tags) ? readStringArray(record.tags) : undefined
          }
        ];
      })
    : undefined;

  const memories_to_delete = Array.isArray(raw.memories_to_delete)
    ? raw.memories_to_delete.flatMap((item): DigestMemoryDelete[] => {
        if (!item || typeof item !== "object" || Array.isArray(item)) return [];
        const record = item as Record<string, unknown>;
        const targetId = readString(record.target_id);
        return targetId ? [{ target_id: targetId, reason: readString(record.reason) ?? undefined }] : [];
      })
    : undefined;

  return {
    date: readString(raw.date) ?? undefined,
    title: readString(raw.title) ?? undefined,
    summary: readString(raw.summary) ?? undefined,
    sections,
    important_excerpts,
    memories_to_add: Array.isArray(raw.memories_to_add)
      ? raw.memories_to_add.flatMap((item): ExtractedMemory[] => {
          const memory = normalizeExtractedMemory(item);
          return memory ? [memory] : [];
        })
      : undefined,
    memories_to_update,
    memories_to_delete
  };
}

function formatTranscript(messages: MessageRecord[]): string {
  return messages
    .map((message) => {
      const role = message.role === "assistant" ? "我(助手)" : "用户";
      return `[${message.id}][${message.created_at}][${role}] ${truncate(message.content.trim(), 1200)}`;
    })
    .join("\n\n");
}

function formatExistingMemories(memories: MemoryApiRecord[]): string {
  if (memories.length === 0) return "[]";
  return JSON.stringify(
    memories.map((memory) => ({
      id: memory.id,
      type: memory.type,
      content: truncate(memory.content, 260),
      importance: memory.importance,
      confidence: memory.confidence,
      pinned: memory.pinned,
      tags: memory.tags
    })),
    null,
    2
  );
}

function buildDigestPrompt(input: {
  dateLabel: string;
  messages: MessageRecord[];
  existingMemories: MemoryApiRecord[];
  excerptLimit: number;
}): string {
  return [
    "你是每日记忆小秘书。请把一天内的原始聊天整理成少量高质量长期记忆。",
    "只输出 JSON，不要 markdown，不要解释。",
    "",
    "总原则：",
    "- 原始聊天不要逐条变成记忆，只保留未来真的会用到的事实、偏好、边界、项目进展、承诺。",
    "- 宁可少记，也不要把临时语气、寒暄、重复话、空内容、调试内容写进长期记忆。",
    "- 当旧记忆和新信息冲突时，优先更新或删除旧记忆，不要并排留下互相打架的版本。",
    "- pinned=true 的旧记忆不能删除，只能在 memories_to_update 中提出更保守的补充。",
    "- 站在“我=助手”的视角写。关于用户，用“你……”；关于助手承诺，用“我需要……”。",
    "- 不要提到 D1、Vectorize、RAG、数据库、记忆系统、代理层等实现细节。",
    "",
    "今天摘要格式：",
    "- title 是 12 字以内标题。",
    "- summary 写成一段自然中文。",
    "- sections 最多 5 段，每段有 heading 和 content。",
    `- important_excerpts 最多 ${input.excerptLimit} 条，quote 必须是值得保留的原文片段。`,
    "- memories_to_add 最多 12 条，每条要短、稳定、可复用。",
    "- memories_to_update 只针对给出的旧记忆 id。",
    "- memories_to_delete 只删除空、重复、明显过期或被新信息否定的旧记忆。",
    "",
    "输出 JSON 结构：",
    JSON.stringify({
      date: input.dateLabel,
      title: "项目整理",
      summary: "今天主要讨论了……",
      sections: [{ heading: "项目", content: "……" }],
      important_excerpts: [
        {
          quote: "用户或助手说过的关键原文",
          reason: "为什么值得保留",
          tags: ["project"],
          source_message_ids: ["msg_x"]
        }
      ],
      memories_to_add: [
        {
          type: "project",
          content: "你正在简化 Aelios 的记忆写入策略。",
          importance: 0.86,
          confidence: 0.92,
          tags: ["project", "aelios"],
          source_message_ids: ["msg_x"]
        }
      ],
      memories_to_update: [
        {
          target_id: "mem_x",
          content: "更新后的旧记忆正文",
          type: "project",
          importance: 0.88,
          confidence: 0.9,
          tags: ["project"]
        }
      ],
      memories_to_delete: [{ target_id: "mem_y", reason: "空内容或重复" }]
    }),
    "",
    "旧长期记忆候选：",
    formatExistingMemories(input.existingMemories),
    "",
    "今日原始聊天：",
    formatTranscript(input.messages)
  ].join("\n");
}

function fallbackDigest(dateLabel: string, messages: MessageRecord[]): DailyDigestResult {
  const userMessages = messages.filter((message) => message.role === "user").map((message) => message.content.trim()).filter(Boolean);
  const assistantMessages = messages.filter((message) => message.role === "assistant").map((message) => message.content.trim()).filter(Boolean);

  return {
    date: dateLabel,
    title: "日常对话",
    summary: [
      `${dateLabel} 共沉淀 ${messages.length} 条聊天。`,
      userMessages.length > 0 ? `近期用户重点：${userMessages.slice(-5).map((text) => truncate(text, 120)).join(" / ")}` : "",
      assistantMessages.length > 0 ? `我的回应重点：${assistantMessages.slice(-3).map((text) => truncate(text, 120)).join(" / ")}` : ""
    ].filter(Boolean).join("\n"),
    sections: [],
    important_excerpts: [],
    memories_to_add: [],
    memories_to_update: [],
    memories_to_delete: []
  };
}

function formatDailySummary(result: DailyDigestResult, dateLabel: string, messages: MessageRecord[]): string {
  const parts = [
    `# ${result.date || dateLabel} ${result.title || "每日摘要"}`,
    "",
    result.summary || fallbackDigest(dateLabel, messages).summary || ""
  ];

  for (const section of result.sections ?? []) {
    if (!section.heading && !section.content) continue;
    parts.push("", `## ${section.heading || "要点"}`, section.content || "");
  }

  return parts.join("\n").trim();
}

async function callDigestModel(
  env: Env,
  prompt: string
): Promise<DailyDigestResult | null> {
  const model = env.SUMMARY_MODEL || env.MEMORY_MODEL;
  if (!model) return null;

  const request: OpenAIChatRequest = {
    model,
    messages: [
      { role: "system", content: "你是严格的 JSON 生成器。你只输出 JSON。" },
      { role: "user", content: prompt }
    ],
    temperature: 0,
    max_tokens: 2200,
    stream: false
  };

  try {
    const response = await callOpenAICompat(env, request);
    if (!response.ok) return null;
    const parsed = (await response.json()) as OpenAIChatResponse;
    const message = parsed.choices?.[0]?.message as ({ content?: unknown; reasoning_content?: unknown }) | undefined;
    const content = typeof message?.content === "string" ? message.content.trim() : "";
    const reasoning = typeof message?.reasoning_content === "string" ? message.reasoning_content.trim() : "";
    const json = extractJsonObject(content || reasoning);
    return normalizeDigestResult(json);
  } catch (error) {
    console.error("daily digest model failed", error);
    return null;
  }
}

async function cleanEmptyMemories(
  env: Env,
  namespace: string
): Promise<number> {
  const minChars = readPositiveInt(env.EMPTY_MEMORY_MIN_CHARS, DEFAULT_EMPTY_MEMORY_MIN_CHARS, 20);
  let page: Awaited<ReturnType<typeof listVectorMemories>>;
  try {
    page = await listVectorMemories(env, { namespace, count: 1000 });
  } catch (error) {
    console.error("daily digest: failed to list memories for cleanup", error);
    return 0;
  }
  const records = page.data.filter((record) => !record.pinned && record.content.trim().length < minChars);

  for (const record of records) {
    await deleteVectorMemory(env, record.id);
  }

  return records.length;
}

async function saveDailySummaryMemory(
  env: Env,
  input: { namespace: string; dateLabel: string; content: string; messageIds: string[] }
): Promise<void> {
  await createVectorMemory(env, {
    namespace: input.namespace,
    type: "daily_summary",
    content: input.content,
    importance: 0.66,
    confidence: 0.9,
    tags: ["daily-summary", input.dateLabel],
    source: "daily_digest",
    sourceMessageIds: input.messageIds
  });
}

async function saveImportantExcerpts(
  env: Env,
  input: { namespace: string; dateLabel: string; excerpts: ImportantExcerpt[]; fallbackMessageIds: string[] }
): Promise<number> {
  let saved = 0;
  const limit = readPositiveInt(env.DAILY_DIGEST_EXCERPT_LIMIT, DEFAULT_EXCERPT_LIMIT, 20);

  for (const excerpt of input.excerpts.slice(0, limit)) {
    const quote = readString(excerpt.quote);
    if (!quote) continue;
    const reason = readString(excerpt.reason);
    const content = [`【${input.dateLabel} 重要原文】`, quote, reason ? `保存原因：${reason}` : ""]
      .filter(Boolean)
      .join("\n");

    await createVectorMemory(env, {
      namespace: input.namespace,
      type: "excerpt",
      content,
      importance: 0.72,
      confidence: 0.9,
      tags: uniqueStrings(["important-excerpt", input.dateLabel, ...(excerpt.tags ?? [])]),
      source: "daily_digest",
      sourceMessageIds: excerpt.source_message_ids?.length ? excerpt.source_message_ids : input.fallbackMessageIds
    });
    saved += 1;
  }

  return saved;
}

async function applyMemoryUpdates(
  env: Env,
  input: { namespace: string; updates: DigestMemoryUpdate[]; deletes: DigestMemoryDelete[] }
): Promise<{ updated: number; deleted: number }> {
  let updated = 0;
  let deleted = 0;

  for (const item of input.updates) {
    const existing = await getVectorMemory(env, item.target_id);
    if (!existing || existing.namespace !== input.namespace || existing.status !== "active") continue;

    const next = await updateVectorMemory(env, item.target_id, {
      type: item.type,
      content: item.content,
      importance: item.importance,
      confidence: item.confidence,
      tags: item.tags
    });

    if (next) updated += 1;
  }

  for (const item of input.deletes) {
    const existing = await getVectorMemory(env, item.target_id);
    if (!existing || existing.status !== "active" || existing.pinned) continue;
    await deleteVectorMemory(env, item.target_id);
    deleted += 1;
  }

  return { updated, deleted };
}

export async function runDailyMemoryDigest(
  env: Env,
  namespace: string
): Promise<{ ran: boolean; stats?: DailyDigestStats }> {
  if (env.ENABLE_DAILY_MEMORY_DIGEST === "false") return { ran: false };

  const cursorName = `daily_digest:${namespace}`;
  const cursor = await readCursor(env.DB, cursorName);
  const maxMessages = readPositiveInt(env.DAILY_DIGEST_MAX_MESSAGES, DEFAULT_MAX_MESSAGES, 1000);
  const messages = await listMessagesByNamespace(env.DB, namespace, cursor, maxMessages);
  if (messages.length === 0) return { ran: false };

  const timeZone = readString(env.DAILY_DIGEST_TIME_ZONE) || DEFAULT_TIME_ZONE;
  const lastMessage = messages[messages.length - 1];
  const dateLabel = formatDate(new Date(lastMessage.created_at), timeZone);
  const memoryContextLimit = readPositiveInt(
    env.DAILY_DIGEST_MEMORY_CONTEXT_LIMIT,
    DEFAULT_MEMORY_CONTEXT_LIMIT,
    1000
  );
  let existingMemories: MemoryApiRecord[] = [];
  try {
    existingMemories = (await listVectorMemories(env, {
      namespace,
      count: memoryContextLimit
    })).data;
  } catch (error) {
    console.error("daily digest: failed to list existing vector memories", error);
  }
  const cleanedEmptyMemories = await cleanEmptyMemories(env, namespace);

  const prompt = buildDigestPrompt({
    dateLabel,
    messages,
    existingMemories,
    excerptLimit: readPositiveInt(env.DAILY_DIGEST_EXCERPT_LIMIT, DEFAULT_EXCERPT_LIMIT, 20)
  });
  const digest = (await callDigestModel(env, prompt)) ?? fallbackDigest(dateLabel, messages);
  const summaryContent = formatDailySummary(digest, dateLabel, messages);
  const messageIds = messages.map((message) => message.id);

  await upsertSummary(env.DB, {
    namespace,
    content: summaryContent,
    fromMessageId: messages[0]?.id ?? null,
    toMessageId: lastMessage.id,
    messageCount: messages.length
  });
  await saveDailySummaryMemory(env, {
    namespace,
    dateLabel,
    content: summaryContent,
    messageIds
  });

  const updates = await applyMemoryUpdates(env, {
    namespace,
    updates: digest.memories_to_update ?? [],
    deletes: digest.memories_to_delete ?? []
  });

  let addedMemories = 0;
  for (const memory of digest.memories_to_add ?? []) {
    const saved = await createVectorMemory(env, {
      namespace,
      type: memory.type,
      content: memory.content,
      importance: memory.importance,
      confidence: memory.confidence,
      tags: memory.tags,
      source: "daily_digest",
      sourceMessageIds: memory.source_message_ids.length ? memory.source_message_ids : messageIds
    });
    if (saved) addedMemories += 1;
  }

  const savedExcerpts = await saveImportantExcerpts(env, {
    namespace,
    dateLabel,
    excerpts: digest.important_excerpts ?? [],
    fallbackMessageIds: messageIds
  });

  await writeCursor(env.DB, cursorName, lastMessage.created_at);

  return {
    ran: true,
    stats: {
      processedMessages: messages.length,
      addedMemories,
      updatedMemories: updates.updated,
      deletedMemories: updates.deleted,
      savedExcerpts,
      cleanedEmptyMemories,
      cursorAdvanced: true
    }
  };
}
