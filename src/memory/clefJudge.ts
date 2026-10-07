// 用 Cloudflare 的 clef 审候选 (CLEF_AUTO_REVIEW 开关，默认开；填 false/off 关掉)。
// clef 是 decision 模型：只答选择题、回每个选项的概率，不生成文字，也就不会吐坏 JSON。
// 开着时每天夜整完由它把待审候选全部定掉，只分记住和放下，不再留给人工批；
// 定下的照样进审核页「这周自动定下的」，能逐条撤回。按 Workers AI 用量计费 (输入 token，输出不收)。

import type { Env, MessageRecord } from "../types";
import type { MemoryCandidateRow } from "../db/v2";
import type { JudgeKind, JudgeModelResult } from "./candidateJudge";
import { formatChatLines } from "./chatMaterial";
import { speakerLabel, type DreamSpeakers } from "./speakers";

export const CLEF_MODEL = "@cf/cloudflare/clef";
// 一条候选挂的原文通常就几条；clef 有 64K 上下文，这个量只在贴了大段文字时才会压。
const CLEF_TRANSCRIPT_BUDGET_CHARS = 12_000;
/** 写进 decision_note 的 judge[...] 前缀，审核页显示成「clef · 记住了」。 */
export const CLEF_JUDGE_NAME = "clef";

export function isClefReviewOn(env: Env): boolean {
  const raw = (env.CLEF_AUTO_REVIEW ?? "").trim().toLowerCase();
  return !["off", "false", "0", "no"].includes(raw);
}

type Noul = { type: "noul"; instructions: string; criteria: { true: string; false: string } };

const GROUNDED: Noul = {
  type: "noul",
  instructions: "候选内容能在 transcript 里找到依据吗？",
  criteria: { true: "对话里明确说过，没有编造或过度引申", false: "对话里找不到，或者是推测、夸大" }
};

const QUESTIONS: Record<JudgeKind, Record<string, Noul>> = {
  add: {
    grounded: GROUNDED,
    worth: {
      type: "noul",
      instructions: "这条值得写进长期记忆吗？",
      criteria: {
        true: "一个月后大概率仍成立、以后聊天用得上的稳定事实、偏好、约定或关系信息",
        false: "寒暄、一次性情绪、临时计划、当次任务、工程实现或调试流水"
      }
    }
  },
  update: {
    grounded: GROUNDED,
    worth: {
      type: "noul",
      instructions: "应该用候选的新内容替换 old_memory 吗？",
      criteria: {
        true: "对话里明确修正或更新了旧事实，新版本一个月后仍成立",
        false: "只是同义复述、没有实质变化，或者新内容本身站不住"
      }
    }
  },
  delete: {
    archive: {
      type: "noul",
      instructions: "这条已有记忆该归档（收起来不再用）吗？",
      criteria: {
        true: "过时、被对话否定、重复噪音、或明确不再成立",
        false: "仍然有据、仍然成立、仍然值得留着；或是明确要求记住、后来也没收回的"
      }
    }
  }
};

function pct(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function readNoul(answers: unknown, id: string): number | null {
  if (!answers || typeof answers !== "object") return null;
  const answer = (answers as Record<string, unknown>)[id];
  if (!answer || typeof answer !== "object") return null;
  const value = (answer as { noul?: unknown }).noul;
  return typeof value === "number" && Number.isFinite(value) ? Math.min(Math.max(value, 0), 1) : null;
}

/** 把 clef 的概率换成 judge 通用的结果；记不记由 decideSelfJudge 按 0.5 定，不留中间档。 */
export function clefVerdict(kind: JudgeKind, answers: unknown): JudgeModelResult | null {
  if (kind === "delete") {
    const archive = readNoul(answers, "archive");
    if (archive === null) return null;
    return {
      score: archive,
      grounded: true,
      durable: archive < 0.5,
      shouldDelete: archive >= 0.5,
      reason: `clef：该归档 ${pct(archive)}`
    };
  }
  const grounded = readNoul(answers, "grounded");
  const worth = readNoul(answers, "worth");
  if (grounded === null || worth === null) return null;
  return {
    score: worth,
    grounded: grounded >= 0.5,
    durable: worth >= 0.5,
    shouldDelete: null,
    reason: `clef：有依据 ${pct(grounded)}，${kind === "update" ? "该替换" : "值得长期记"} ${pct(worth)}`
  };
}

export function buildClefInput(
  kind: JudgeKind,
  candidate: MemoryCandidateRow,
  messages: MessageRecord[],
  speakers: DreamSpeakers | null,
  oldMemory: string | null
) {
  const task = {
    add: "记忆候选审核：一条从对话里整理出来的「新增提案」，判断该不该写进长期记忆。",
    update: "记忆候选审核：一条「更新提案」，判断该不该用新内容替换 old_memory。",
    delete: "记忆候选审核：一条「归档提案」，判断这条已有记忆该不该收起来。"
  }[kind];
  return {
    model: "clef",
    state: {
      task,
      ...(speakers ? { speakers: { user: speakers.userName, assistant: speakers.assistantName } } : {}),
      candidate: { action: kind, type: candidate.type, content: candidate.content, fact_key: candidate.fact_key },
      ...(oldMemory ? { old_memory: oldMemory } : {}),
      // 抽取现在看得到长消息的后半截，审核也得看得到，不然后半截里的事永远"没有依据"。
      transcript: formatChatLines(messages, (role) => speakerLabel(role, speakers), {
        floor: 900,
        budget: CLEF_TRANSCRIPT_BUDGET_CHARS
      })
    },
    questions: QUESTIONS[kind]
  };
}

/** 一条候选一次调用。Worker 的 AI 绑定直接回 {answers}；REST 外壳 {result:{answers}} 也认。 */
export async function askClef(env: Env, input: ReturnType<typeof buildClefInput>, kind: JudgeKind): Promise<JudgeModelResult | null> {
  if (!env.AI) throw new Error("clef needs the Workers AI binding");
  type RunArgs = Parameters<Ai["run"]>;
  const raw = (await env.AI.run(CLEF_MODEL as RunArgs[0], input as unknown as RunArgs[1])) as unknown;
  const body = raw && typeof raw === "object" && "result" in raw ? (raw as { result: unknown }).result : raw;
  const answers = body && typeof body === "object" ? (body as { answers?: unknown }).answers : undefined;
  return clefVerdict(kind, answers);
}
