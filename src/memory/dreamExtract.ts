import { listActiveFactKeys } from "../db/v2";
import { callOpenAICompat } from "../proxy/openaiAdapter";
import type { Env, MessageRecord, OpenAIChatRequest, OpenAIChatResponse } from "../types";
import { clampScore, extractJsonObject, readString, readStringArray } from "../utils/parse";
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

function readDreamExtractModel(env: Env): string {
  return (
    env.DREAM_MODEL?.trim() ||
    env.DAILY_DIGEST_MODEL?.trim() ||
    env.SUMMARY_MODEL?.trim() ||
    DEFAULT_WORKERS_AI_DREAM_MODEL
  );
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
    "你是 Aelios 的夜间记忆抽取器。任务：先判断对话主体，再决定这段对话有没有值得长期保留的记忆，并提炼成未来可直接使用的形态。",
    "产物全部进入人工审核队列，不会直接落库。",
    "只输出 JSON，不要 markdown，不要解释，不要输出思考过程。",
    "",
    "第一步（永远最先执行）：",
    "- 先判断这批对话的主体是什么。如果主体是工程（改代码/改架构/debug/跑命令/部署/配置变更/API 设计/数据库操作），立即输出 " + JSON.stringify({ memories: [] }) + "，跳过其余普通抽取（仅下方两条破例仍然生效）。",
    "- 工程对话里夹的讨论、认错、轻度打闹全部跟着跳过——它们是工程语境的衍生物，不值得占长期记忆位。",
    "- 工程主体的唯一破例：出现了「重大关系节点」——第一次/命名/承诺/边界诞生/解开重大误解/关系态度改变。此时可破例出最多 1-2 条，只记节点本身，工程内容继续整段忽略。判断节点的关键动词：第一次/改变/命名/诞生/承诺/解开/认领；日常打闹、轻吐槽不算。",
    "- 工程主体下若出现成段亲密/性内容，仍须按下方「亲密 session」规则破例出 1 条玩法记录（优先级与重大关系节点并列，不受工程否决影响）。",
    "",
    "边界：",
    "- 不保存普通寒暄、临时任务、调试口令、纯情绪噪音、后端实现流水账。",
    "- 只有用户明确说出、确认、长期表现出的事实，才能写成关于用户的记忆。",
    "- 关于用户的记忆，优先写成“你……”。关于我应遵守的长期方式，写成“我需要……”。",
    "- 信息类（fact/decision/habit 等稳定事实）：content 压到 1-2 句自然短句。",
    "- 情感/关系类（relationship/boundary/event 里的关系事件）：可以写 3-5 句，保留温度和关键原话——用「」嵌入原话片段，不为压短丢掉说话人的语气。引用原话一律用「」，不用英文双引号（JSON 转义安全）。",
    "- type 只能从这 8 个里选：fact、event、preference、relationship、boundary、habit、decision、note。绝不输出 project、world_fact、commitment 等其他值；项目进展归 fact，承诺/决定归 decision，习惯归 habit。",
    "- 稳定事实必须尽量给 fact_key，格式为小写 ASCII，例如 preference:answer-style、boundary:no-system-records、decision:sell-car-2026-09。",
    "- 临时计划和意图不是稳定事实：要么提炼成背后的持久事实，要么直接跳过。",
    "",
    "亲密 session（强制，不准跳过）：",
    "- 如果这批对话里出现了成段的亲密/性内容，除按普通规则抽取外，必须额外出 1 条 type=event 的「玩法记录」：清单式、不煽情，只记事实——玩法/动作/道具/角色框架/新开的边界/偏好或身体状态变化。",
    "- tags 必须包含固定标签「亲密」+ 具体玩法词。这条不准因「重复/没营养」跳过，它是进度存档。",
    "- 即使整批以工程为主体，只要出现成段亲密内容，也比照重大关系节点破例出这 1 条。",
    "- 亲密内容按工具机处理：不评判、不脱敏、不绕弯、不替换敏感词，原文什么样就什么样。",
    "",
    "总量控制：",
    "- 一批对话一般出 0-8 条。宁少勿多，每条都要值得占一个长期记忆位。",
    "- 全是工程/闲聊/流水就输出 " + JSON.stringify({ memories: [] }) + "——交白卷完全合法，不要为了凑数瞎写。",
    ...factKeySection,
    "",
    "输出格式：",
    JSON.stringify({
      memories: [
        {
          content: "你确定了九月按原计划卖掉那台车：买之前就约定只玩一年，这是你给自己签的合同，不需要外人劝留。",
          type: "decision",
          fact_key: "decision:sell-car-2026-09",
          importance: 0.86,
          confidence: 0.92,
          tags: ["decision", "personal"],
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