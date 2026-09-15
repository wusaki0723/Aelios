// 触发器命中的纯选择逻辑：门限、取前 K、按记忆去重。
// 不碰 D1、不碰 Vectorize、不碰 embedding——好测，也好在面板里复算。

import type { Env } from "../../types";

export const DEFAULT_TRIGGER_GATE = 0.85;
export const DEFAULT_TRIGGER_TOP_K = 10;

export function isTriggerRecallEnabled(env: Env): boolean {
  const raw = (env.TRIGGER_RECALL ?? "off").trim().toLowerCase();
  return raw === "on" || raw === "true" || raw === "1";
}

// 门限只允许往上调。调低会让这条通道开始往候选池灌噪音，而池子后面的 reranker
// 和闸四名额有限，噪音是要挤掉真命中的。低于默认值的配置一律按默认值处理。
export function triggerRecallGate(env: Env): number {
  const raw = Number(env.TRIGGER_RECALL_GATE);
  if (!Number.isFinite(raw) || raw <= 0 || raw > 1) return DEFAULT_TRIGGER_GATE;
  return Math.max(raw, DEFAULT_TRIGGER_GATE);
}

export function triggerRecallTopK(env: Env): number {
  const raw = Number(env.TRIGGER_RECALL_TOP_K);
  if (!Number.isFinite(raw) || raw < 1) return DEFAULT_TRIGGER_TOP_K;
  return Math.min(Math.floor(raw), 50);
}

export interface SelectableTriggerMatch {
  trigger_key: string;
  memory_id: string;
  concept: string;
  score: number;
  confidence: number;
}

export interface TriggeredMemory {
  memory_id: string;
  // 命中它的触发器，供面板追溯「为什么这条被想起来了」。
  via_concept: string;
  trigger_score: number;
  trigger_confidence: number;
}

export interface TriggerRecallOutcome {
  triggered: boolean;
  reason: string;
  memories: TriggeredMemory[];
  best_score: number;
}

export function selectTriggeredMemories(
  matches: SelectableTriggerMatch[],
  options: { gate: number; maxTriggers: number }
): TriggerRecallOutcome {
  if (matches.length === 0) {
    return { triggered: false, reason: "no triggers in namespace", memories: [], best_score: 0 };
  }
  const sorted = [...matches]
    .filter((m) => Number.isFinite(m.score))
    .sort((a, b) => b.score - a.score);
  if (sorted.length === 0) {
    return { triggered: false, reason: "no finite scores", memories: [], best_score: 0 };
  }
  const bestScore = sorted[0].score;
  const survivors = sorted.filter((m) => m.score >= options.gate).slice(0, options.maxTriggers);
  if (survivors.length === 0) {
    return {
      triggered: false,
      reason: `no trigger passed gate=${options.gate.toFixed(2)} (best=${bestScore.toFixed(3)})`,
      memories: [],
      best_score: bestScore
    };
  }

  const seen = new Set<string>();
  const memories: TriggeredMemory[] = [];
  for (const m of survivors) {
    if (seen.has(m.memory_id)) continue;
    seen.add(m.memory_id);
    memories.push({
      memory_id: m.memory_id,
      via_concept: m.concept,
      trigger_score: m.score,
      trigger_confidence: m.confidence
    });
  }
  return {
    triggered: true,
    reason: `${survivors.length} trigger(s) fired (gate=${options.gate.toFixed(2)})`,
    memories,
    best_score: bestScore
  };
}
