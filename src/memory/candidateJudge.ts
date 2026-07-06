// 候选队列自动评审 (母帖 CANDIDATE_JUDGE)
// 抽取器把低置信度候选塞进 memory_candidates，默认全部等人工在后台点 approve/discard。
// 这个模块加一轮自动裁判：明显靠谱的自动 approve 入库，明显不靠谱/编造的自动 discard，
// 只有真正模棱两可的才留给人工——把"每条都要看"变成"只看有分歧的"。
// 默认关闭 (CANDIDATE_JUDGE_ENABLED !== "true" 时零开销)，开启后由 scheduled 在抽取批次后跑一轮。

import { getMessagesByIds } from "../db/messages";
import {
  archiveMemory,
  getActiveMemoryByFactKey,
  listMemoryCandidates,
  supersedeMemory,
  updateMemoryCandidateStatus,
  upsertMemoryByFactKey,
  type MemoryCandidateRow
} from "../db/v2";
import { callOpenAICompat } from "../proxy/openaiAdapter";
import type { Env, MessageRecord, OpenAIChatRequest, OpenAIChatResponse } from "../types";
import { createVectorMemory } from "./vectorStore";

// listMemoryCandidates 本身按 confidence ASC 排序，正好是"先看最没把握的"，直接复用，
// 不用再为 judge 单独建一个查询。

const DEFAULT_MAX_CANDIDATES = 20;
const MAX_CANDIDATES_CAP = 100;
const DEFAULT_APPROVE_MIN = 0.8;
const DEFAULT_DISCARD_MAX = 0.3;
const JUDGE_MAX_TOKENS = 300;

export interface JudgeRunResult {
  ran: boolean;
  judged: number;
  approved: number;
  discarded: number;
  kept: number;
  failed: number;
  model?: string;
  reason?: "judge_disabled" | "missing_model" | "no_candidates";
}

interface JudgeModelResult {
  score: number;
  grounded: boolean;
  durable: boolean;
  reason: string;
}

function readPositiveInt(value: unknown, fallback: number, max: number): number {
  const parsed = typeof value === "string" ? Number(value) : typeof value === "number" ? value : fallback;
  const numeric = Number.isFinite(parsed) ? parsed : fallback;
  return Math.min(Math.max(Math.floor(numeric), 1), max);
}

function readUnitFloat(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, 0), 1);
}

function parseJsonArray(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) return parsed.filter((item): item is string => typeof item === "string");
  } catch {
    // malformed JSON in an old row: 当空数组处理，不阻断评审
  }
  return [];
}

// 和 dreamExtract.ts 的 extractJsonObject 同样的容错解析：模型偶尔会在 JSON 外面裹一层文字。
function extractJsonObject(text: string): unknown | null {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    // fallthrough to brace-scan
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

function formatTranscript(messages: MessageRecord[]): string {
  return messages
    .map((message) => {
      const role = message.role === "assistant" ? "我(助手)" : "用户";
      return `[${message.id}][${message.created_at}][${role}] ${message.content.trim().slice(0, 900)}`;
    })
    .join("\n\n");
}

function buildJudgePrompt(candidate: MemoryCandidateRow, messages: MessageRecord[]): string {
  const tags = parseJsonArray(candidate.tags);
  const transcript = messages.length > 0 ? formatTranscript(messages) : "(没有能核对的原始消息)";
  return [
    "你是 Aelios 记忆候选队列的自动评审员。任务：判断一条待审记忆候选该自动通过、自动丢弃，还是留给人工复核。",
    "只输出 JSON，不要 markdown，不要解释，不要输出思考过程。",
    "",
    "打分依据 (score 是 0 到 1 的浮点数，综合以下三点)：",
    "- grounded (是否有据)：候选内容必须能在下面的原始对话片段里找到依据，不能是编造或过度引申；找不到依据必须 grounded=false。",
    "- durable (是否长期稳定)：这条记忆一个月后是否还成立；临时计划、一次性情绪、当次任务不算稳定事实。",
    "- non-trivial (是否值得占用长期记忆位)：不是可重新推导的寒暄，不是后端实现细节，不是纯调试噪音。",
    "证据越扎实、越稳定、越非平凡，score 越高；grounded / durable 必须是布尔值；reason 是一句话说明理由。",
    "",
    "输出格式：",
    JSON.stringify({ score: 0.9, grounded: true, durable: true, reason: "对话里用户明确说过这件事，且是长期稳定的事实。" }),
    "",
    "待审候选：",
    JSON.stringify({
      type: candidate.type,
      content: candidate.content,
      fact_key: candidate.fact_key,
      tags
    }),
    "",
    "原始对话片段：",
    transcript
  ].join("\n");
}

async function callJudgeModel(env: Env, model: string, prompt: string): Promise<JudgeModelResult | null> {
  const request: OpenAIChatRequest = {
    model,
    messages: [
      { role: "system", content: "你是严格的 JSON 生成器。你只输出 JSON。" },
      { role: "user", content: prompt }
    ],
    temperature: 0,
    max_tokens: JUDGE_MAX_TOKENS,
    response_format: { type: "json_object" },
    stream: false
  };

  const response = await callOpenAICompat(env, request);
  if (!response.ok) return null;

  const parsed = (await response.json()) as OpenAIChatResponse;
  const message = parsed.choices?.[0]?.message as ({ content?: unknown; reasoning_content?: unknown }) | undefined;
  const content = typeof message?.content === "string" ? message.content.trim() : "";
  const reasoning = typeof message?.reasoning_content === "string" ? message.reasoning_content.trim() : "";
  const raw = extractJsonObject(content || reasoning);
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;

  const obj = raw as Record<string, unknown>;
  const score = typeof obj.score === "number" && Number.isFinite(obj.score) ? Math.min(Math.max(obj.score, 0), 1) : null;
  if (score === null) return null;

  return {
    score,
    grounded: Boolean(obj.grounded),
    durable: Boolean(obj.durable),
    reason: typeof obj.reason === "string" && obj.reason.trim() ? obj.reason.trim().slice(0, 300) : "(评审未给出理由)"
  };
}

// approve 的落库语义跟 dream 候选队列的 fact_key 分支一致：
// 有 fact_key 先查是否已有 active 同 key 记忆，有就 supersede (保留历史链)，没有就 upsert 新建；
// 没有 fact_key 就走向量库直接建条目。admin 后台 /v1/candidates/:id/approve 的私有
// createApprovedMemoryFromCandidate 目前是"有 fact_key 就直接 upsertMemoryByFactKey"，
// 不查 active/不 supersede；这里选择跟抽取器自动写路径对齐、保留 supersede 历史，
// 因为 judge 是自动化批量决策，保留可追溯的旧版本比就地覆盖更安全。
async function approveCandidate(
  env: Env,
  namespace: string,
  candidate: MemoryCandidateRow,
  tags: string[],
  sourceMessageIds: string[]
): Promise<string> {
  if (candidate.source === "dream_delete" && candidate.target_memory_id) {
    const archived = await archiveMemory(env, { namespace, id: candidate.target_memory_id });
    if (!archived) throw new Error("target memory not found");
    return candidate.target_memory_id;
  }

  const factKey = candidate.fact_key?.trim() || null;

  if (factKey) {
    const existing = await getActiveMemoryByFactKey(env.DB, { namespace, factKey });
    if (existing) {
      const result = await supersedeMemory(env, {
        namespace,
        oldId: existing.id,
        newContent: candidate.content,
        newType: candidate.type,
        newFactKey: factKey,
        importance: candidate.importance,
        confidence: candidate.confidence,
        tags,
        source: "judge",
        sourceMessageIds,
        reason: "candidate_judge_approve"
      });
      return result.newId;
    }

    const result = await upsertMemoryByFactKey(env, {
      namespace,
      factKey,
      content: candidate.content,
      type: candidate.type,
      importance: candidate.importance,
      confidence: candidate.confidence,
      tags,
      source: "judge",
      sourceMessageIds
    });
    return result.id;
  }

  const created = await createVectorMemory(env, {
    namespace,
    type: candidate.type,
    content: candidate.content,
    importance: candidate.importance,
    confidence: candidate.confidence,
    tags,
    source: "judge",
    sourceMessageIds
  });
  return created.id;
}

export async function runCandidateJudge(
  env: Env,
  namespace: string,
  options: { limit?: number } = {}
): Promise<JudgeRunResult> {
  if (env.CANDIDATE_JUDGE_ENABLED !== "true") {
    return { ran: false, judged: 0, approved: 0, discarded: 0, kept: 0, failed: 0, reason: "judge_disabled" };
  }

  const model = env.JUDGE_MODEL?.trim() || env.DREAM_MODEL?.trim() || "";
  if (!model) {
    return { ran: false, judged: 0, approved: 0, discarded: 0, kept: 0, failed: 0, reason: "missing_model" };
  }

  const limit = readPositiveInt(options.limit ?? env.JUDGE_MAX_CANDIDATES, DEFAULT_MAX_CANDIDATES, MAX_CANDIDATES_CAP);
  const approveMin = readUnitFloat(env.JUDGE_APPROVE_MIN, DEFAULT_APPROVE_MIN);
  const discardMax = readUnitFloat(env.JUDGE_DISCARD_MAX, DEFAULT_DISCARD_MAX);

  const candidates = await listMemoryCandidates(env.DB, { namespace, status: "pending", limit });
  if (candidates.length === 0) {
    return { ran: true, judged: 0, approved: 0, discarded: 0, kept: 0, failed: 0, model, reason: "no_candidates" };
  }

  let judged = 0;
  let approved = 0;
  let discarded = 0;
  let kept = 0;
  let failed = 0;

  for (const candidate of candidates) {
    // zone_full 候选不是质量问题，是区满了被挡下来的——judge 打分再高也不能替它绕过
    // 每区硬上限，自动 approve 会把刚设的闸拆掉。留给人工或 dream 合并腾位后再处理。
    if (candidate.source === "zone_full") {
      kept += 1;
      continue;
    }
    try {
      const sourceMessageIds = parseJsonArray(candidate.source_message_ids);
      const tags = parseJsonArray(candidate.tags);
      const messages = sourceMessageIds.length > 0
        ? await getMessagesByIds(env.DB, { namespace, ids: sourceMessageIds })
        : [];

      let judgeResult: JudgeModelResult;
      if (messages.length === 0) {
        // 找不到任何原始消息可核对：直接判 ungrounded，不必浪费一次模型调用。
        judgeResult = { score: 0, grounded: false, durable: false, reason: "没有可核对的原始消息，无法确认是否有据" };
      } else {
        const modelResult = await callJudgeModel(env, model, buildJudgePrompt(candidate, messages));
        if (!modelResult) {
          failed += 1;
          console.error("candidate judge: model call failed or returned invalid JSON", { namespace, id: candidate.id });
          continue;
        }
        judgeResult = modelResult;
      }

      judged += 1;
      const decisionNote = `judge: ${judgeResult.reason}`;

      if (judgeResult.score >= approveMin && judgeResult.grounded && judgeResult.durable) {
        const memoryId = await approveCandidate(env, namespace, candidate, tags, sourceMessageIds);
        await updateMemoryCandidateStatus(env.DB, {
          namespace,
          id: candidate.id,
          status: "approved",
          targetMemoryId: memoryId,
          decisionNote
        });
        approved += 1;
      } else if (judgeResult.score <= discardMax || !judgeResult.grounded || !judgeResult.durable) {
        await updateMemoryCandidateStatus(env.DB, {
          namespace,
          id: candidate.id,
          status: "discarded",
          decisionNote
        });
        discarded += 1;
      } else {
        // 模棱两可：留给人工，但把 judge 的理由记进 decision_note，方便复核时参考。
        await updateMemoryCandidateStatus(env.DB, {
          namespace,
          id: candidate.id,
          status: "pending",
          decisionNote
        });
        kept += 1;
      }
    } catch (error) {
      failed += 1;
      console.error("candidate judge: failed to judge candidate", { namespace, id: candidate.id, error });
    }
  }

  return { ran: true, judged, approved, discarded, kept, failed, model };
}
