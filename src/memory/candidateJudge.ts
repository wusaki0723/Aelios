// 候选队列自动评审 (母帖 CANDIDATE_JUDGE)
// 抽取器把低置信度候选塞进 memory_candidates，默认等人工在后台点 approve/discard。
// 自动审只有 clef 一条路 (CLEF_AUTO_REVIEW，默认开)：每条候选问 Cloudflare 的 clef 几道是非题，
// 只分记住/放下，不留给人工，见 clefJudge.ts；审核页「这周自动定下的」能逐条撤回。
// 关掉 clef 后候选全部留着：人工在后台批，或者让助手自己用 MCP 的 memory_candidates / memory_review 审。
// Dream 抽完候选后由 cron / 手动入口跑一轮。

import { getMessagesByIds } from "../db/messages";
import {
  archiveMemory,
  checkMemoryRestorable,
  getActiveMemoryByFactKey,
  listMemoryCandidates,
  restoreMemory,
  supersedeMemory,
  updateMemoryCandidateStatus,
  upsertMemoryByFactKey,
  type MemoryCandidateRow
} from "../db/v2";
import type { Env, MessageRecord } from "../types";
import { askClef, buildClefInput, CLEF_JUDGE_NAME, CLEF_MODEL, isClefReviewOn } from "./clefJudge";
import { createVectorMemory } from "./vectorStore";
import { loadSpeakersForNamespace, type DreamSpeakers } from "./speakers";

// listMemoryCandidates 本身按 confidence ASC 排序，正好是"先看最没把握的"，直接复用，
// 不用再为 judge 单独建一个查询。

// clef 一条只花几百 token、不生成文字，一晚把积压清干净。
const CLEF_DEFAULT_MAX_CANDIDATES = 100;
const MAX_CANDIDATES_CAP = 100;
// 只有记住和放下，没有留给人工的中间档：过线就记，不过线就放下，错了靠撤回。
const REMEMBER_MIN = 0.5;

export interface JudgeRunResult {
  ran: boolean;
  judged: number;
  approved: number;
  discarded: number;
  kept: number;
  failed: number;
  model?: string;
  judgedBy?: string;
  reason?: "clef_off" | "no_candidates";
}

function readPositiveInt(value: unknown, fallback: number, max: number): number {
  const parsed = typeof value === "string" ? Number(value) : typeof value === "number" ? value : fallback;
  const numeric = Number.isFinite(parsed) ? parsed : fallback;
  return Math.min(Math.max(Math.floor(numeric), 1), max);
}

export function parseJsonArray(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) return parsed.filter((item): item is string => typeof item === "string");
  } catch {
    // malformed JSON in an old row: 当空数组处理，不阻断评审
  }
  return [];
}

export type JudgeKind = "add" | "update" | "delete";

export interface JudgeModelResult {
  score: number;
  grounded: boolean;
  durable: boolean;
  shouldDelete: boolean | null;
  reason: string;
}

export function judgeKindFor(source: string): JudgeKind {
  if (source === "dream_delete") return "delete";
  if (source === "dream_update") return "update";
  return "add";
}

/** 归档提案要 clef 明说该归档才执行；新增和更新要有依据、过线才记。 */
export function decideClef(kind: JudgeKind, result: JudgeModelResult): "approve" | "discard" {
  if (kind === "delete") {
    return result.shouldDelete === true && result.score >= REMEMBER_MIN ? "approve" : "discard";
  }
  return result.grounded && result.score >= REMEMBER_MIN ? "approve" : "discard";
}

/** 更新和归档提案碰到的那条已有记忆；clef 审更新时附上它，MCP 列候选时也给助手看。 */
export async function loadOldMemoryForCandidate(env: Env, namespace: string, candidate: MemoryCandidateRow): Promise<string | null> {
  const kind = judgeKindFor(candidate.source);
  if (kind === "add") return null;
  const factKey = candidate.fact_key?.trim();
  const target = candidate.target_memory_id
    ? await env.DB.prepare("SELECT content FROM memories WHERE namespace = ? AND id = ?")
        .bind(namespace, candidate.target_memory_id)
        .first<{ content: string }>()
    : kind === "update" && factKey
      ? await getActiveMemoryByFactKey(env.DB, { namespace, factKey })
      : null;
  return target?.content ?? null;
}

async function callClef(
  env: Env,
  namespace: string,
  candidate: MemoryCandidateRow,
  messages: MessageRecord[],
  speakers: DreamSpeakers | null
): Promise<JudgeModelResult | null> {
  const kind = judgeKindFor(candidate.source);
  const oldMemory = kind === "update" ? await loadOldMemoryForCandidate(env, namespace, candidate) : null;
  try {
    return await askClef(env, buildClefInput(kind, candidate, messages, speakers, oldMemory), kind);
  } catch (error) {
    console.error("candidate judge: clef call failed", { id: candidate.id, error });
    return null;
  }
}

// approve 的落库语义跟 dream 候选队列的 fact_key 分支一致：
// 有 fact_key 先查是否已有 active 同 key 记忆，有就 supersede (保留历史链)，没有就 upsert 新建；
// 没有 fact_key 就走向量库直接建条目。admin 后台 /v1/candidates/:id/approve 的私有
// createApprovedMemoryFromCandidate 目前是"有 fact_key 就直接 upsertMemoryByFactKey"，
// 不查 active/不 supersede；这里选择跟抽取器自动写路径对齐、保留 supersede 历史，
// 因为 judge 是自动化批量决策，保留可追溯的旧版本比就地覆盖更安全。
export async function approveCandidate(
  env: Env,
  namespace: string,
  candidate: MemoryCandidateRow,
  tags: string[],
  sourceMessageIds: string[],
  source = "judge"
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
        source,
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
      source,
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
    source,
    sourceMessageIds
  });
  return created.id;
}

export async function runCandidateJudge(
  env: Env,
  namespace: string,
  options: { limit?: number } = {}
): Promise<JudgeRunResult> {
  if (!isClefReviewOn(env)) {
    return { ran: false, judged: 0, approved: 0, discarded: 0, kept: 0, failed: 0, reason: "clef_off" };
  }
  const model = CLEF_MODEL;
  const judgedBy = CLEF_JUDGE_NAME;
  const limit = readPositiveInt(options.limit ?? env.JUDGE_MAX_CANDIDATES, CLEF_DEFAULT_MAX_CANDIDATES, MAX_CANDIDATES_CAP);

  const candidates = await listMemoryCandidates(env.DB, { namespace, status: "pending", limit });
  if (candidates.length === 0) {
    return { ran: true, judged: 0, approved: 0, discarded: 0, kept: 0, failed: 0, model, judgedBy, reason: "no_candidates" };
  }

  const speakers = await loadSpeakersForNamespace(env, namespace);

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
        // 找不到任何原始消息可核对：直接判 ungrounded，不必浪费一次调用。
        judgeResult = {
          score: 0,
          grounded: false,
          durable: false,
          shouldDelete: null,
          reason: "没有可核对的原始消息，无法确认是否有据"
        };
      } else {
        const modelResult = await callClef(env, namespace, candidate, messages, speakers);
        if (!modelResult) {
          failed += 1;
          console.error("candidate judge: clef failed or returned no answers", { namespace, id: candidate.id });
          continue;
        }
        judgeResult = modelResult;
      }

      judged += 1;
      const decision = decideClef(judgeKindFor(candidate.source), judgeResult);
      const decisionNote = `${judgeNotePrefix(judgedBy)}${judgeResult.reason}`;

      if (decision === "approve") {
        const memoryId = await approveCandidate(env, namespace, candidate, tags, sourceMessageIds);
        await updateMemoryCandidateStatus(env.DB, {
          namespace,
          id: candidate.id,
          status: "approved",
          targetMemoryId: memoryId,
          decisionNote
        });
        approved += 1;
      } else {
        await updateMemoryCandidateStatus(env.DB, {
          namespace,
          id: candidate.id,
          status: "discarded",
          decisionNote
        });
        discarded += 1;
      }
    } catch (error) {
      failed += 1;
      console.error("candidate judge: failed to judge candidate", { namespace, id: candidate.id, error });
    }
  }

  return { ran: true, judged, approved, discarded, kept, failed, model, judgedBy };
}

// decision_note 前缀：`judge[名字]: ` 是 clef 或助手用 MCP 自己审的，`judge: ` 是以前的代审，
// `undo: ` 是撤回过的。撤回只认这两种 judge 前缀，人工点过的决定不在这里反悔。
const SELF_NOTE = /^judge\[([^\]\n]{1,64})\]: /;

export function judgeNotePrefix(judgedBy: string | undefined): string {
  return judgedBy ? `judge[${judgedBy}]: ` : "judge: ";
}

export interface JudgeNote {
  /** clef 或助手名；以前的代审为 null。 */
  judgedBy: string | null;
  reason: string;
  undone: boolean;
  undoable: boolean;
}

export function parseJudgeNote(note: string | null | undefined): JudgeNote | null {
  const text = note ?? "";
  const undone = text.startsWith("undo: ");
  const body = undone ? text.slice("undo: ".length) : text;
  const self = body.match(SELF_NOTE);
  if (self) return { judgedBy: self[1], reason: body.slice(self[0].length), undone, undoable: !undone };
  if (body.startsWith("judge: ")) return { judgedBy: null, reason: body.slice("judge: ".length), undone, undoable: !undone };
  return null;
}

export type UndoJudgeResult =
  | { ok: true; status: "approved" | "discarded"; memoryId: string | null; restoredId?: string; candidate: MemoryCandidateRow | null }
  | { ok: false; httpStatus: 404 | 409; error: string };

/**
 * 撤回一条自动决定：放下的补记上；记住的收回 (归档新条，被它顶掉的旧版本复原)；
 * 执行过的归档提案把那条记忆复原。之后记忆被别处改过的，不硬撤，交给记忆页手动处理。
 */
export async function undoJudgeDecision(
  env: Env,
  namespace: string,
  candidate: MemoryCandidateRow
): Promise<UndoJudgeResult> {
  const note = parseJudgeNote(candidate.decision_note);
  if (!note || !note.undoable) {
    return { ok: false, httpStatus: 409, error: "只有还没撤回过的自动审核决定能撤回" };
  }
  const decisionNote = `undo: ${candidate.decision_note}`;

  if (candidate.status === "discarded") {
    if (candidate.source === "dream_delete" && candidate.target_memory_id) {
      const target = await env.DB.prepare("SELECT status FROM memories WHERE namespace = ? AND id = ?")
        .bind(namespace, candidate.target_memory_id)
        .first<{ status: string }>();
      if (target?.status !== "active") {
        return { ok: false, httpStatus: 409, error: "要归档的那条记忆已经不在了，撤回不了" };
      }
    }
    const memoryId = await approveCandidate(
      env,
      namespace,
      candidate,
      parseJsonArray(candidate.tags),
      parseJsonArray(candidate.source_message_ids),
      "review"
    );
    const updated = await updateMemoryCandidateStatus(env.DB, {
      namespace,
      id: candidate.id,
      status: "approved",
      targetMemoryId: memoryId,
      decisionNote
    });
    return { ok: true, status: "approved", memoryId, candidate: updated };
  }

  if (candidate.status !== "approved" || !candidate.target_memory_id) {
    return { ok: false, httpStatus: 409, error: "这条候选没有可撤回的自动决定" };
  }
  const targetId = candidate.target_memory_id;

  if (candidate.source === "dream_delete") {
    const restored = await restoreMemory(env, { namespace, id: targetId });
    if (!restored) {
      return { ok: false, httpStatus: 409, error: "那条记忆已经不在归档里，或者这件事已经记了新版本，撤回不了" };
    }
    const updated = await updateMemoryCandidateStatus(env.DB, {
      namespace,
      id: candidate.id,
      status: "discarded",
      targetMemoryId: targetId,
      decisionNote
    });
    return { ok: true, status: "discarded", memoryId: targetId, restoredId: targetId, candidate: updated };
  }

  const target = await env.DB.prepare(
    `SELECT m.status, m.version_status, m.created_at, m.content, lc.supersedes_id
     FROM memories m
     LEFT JOIN memory_lifecycle lc ON lc.memory_id = m.id
     WHERE m.namespace = ? AND m.id = ?`
  )
    .bind(namespace, targetId)
    .first<{
      status: string;
      version_status: string | null;
      created_at: string;
      content: string;
      supersedes_id: string | null;
    }>();
  if (!target) return { ok: false, httpStatus: 404, error: "记住的那条记忆已经不在了" };
  // 早于候选本身的记忆不是这次记住新建的 (同 key 就地改写)，收回会连旧内容一起丢。
  if (target.created_at < candidate.created_at) {
    return { ok: false, httpStatus: 409, error: "这次记住是改写了已有记忆，撤回会把旧内容一起丢掉，请到记忆页手动改" };
  }
  if (target.status !== "active" || target.version_status === "superseded") {
    return { ok: false, httpStatus: 409, error: "记住的那条记忆之后又变过，撤回不了" };
  }
  // 记住之后又被就地改过 (记忆页编辑、memory_upsert 同 key 写入)：id 和 created_at 不变，
  // 内容已经不是候选那句了。收回会把后来的改动一起归档。不比 updated_at：夜里标 under_review、
  // 重建向量都会刷新它但不动内容，比时间会把没改过的也拦下。
  if (target.content.trim() !== candidate.content.trim()) {
    return { ok: false, httpStatus: 409, error: "记住之后这条记忆又被改过，撤回会把改动一起收走，请到记忆页手动改" };
  }
  // 先确认被顶掉的旧版本还能放回来，再动新条；否则收回新条后两头都不在。
  const previousId = target.supersedes_id;
  if (previousId && !await checkMemoryRestorable(env.DB, { namespace, id: previousId, supersededBy: targetId })) {
    return { ok: false, httpStatus: 409, error: "被这次记住顶掉的旧版本之后又变过，撤回不了" };
  }

  await archiveMemory(env, { namespace, id: targetId });
  let restoredId: string | undefined;
  if (previousId && await restoreMemory(env, { namespace, id: previousId, supersededBy: targetId })) {
    restoredId = previousId;
  }
  const updated = await updateMemoryCandidateStatus(env.DB, {
    namespace,
    id: candidate.id,
    status: "discarded",
    targetMemoryId: targetId,
    decisionNote
  });
  return { ok: true, status: "discarded", memoryId: targetId, ...(restoredId ? { restoredId } : {}), candidate: updated };
}
