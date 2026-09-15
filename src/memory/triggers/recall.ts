// 触发器召回通道：入口扩展，默认关闭，只增不减。
//
// 与 Y 轴 relation 扩展的分工：relation 从已召回的种子往外走，是出口扩展；
// 种子为空时它什么也做不了。触发器走的是另一头——让本来进不了候选池的记忆进池。
// 两者互补，可以同时开。
//
// 硬门限：触发器命中必须过一个很高的余弦闸 (默认 0.85)。这条通道不承担主要召回，
// 它只在「几乎可以肯定该想起这条」的时候补一刀。门限调低会让它开始往池子里灌噪音，
// 而池子后面是 reranker 和闸四，噪音要消耗它们的名额。宁可少召，不要拉稀。

import { listTriggersByVectorIds } from "../../db/v2";
import { fetchMemoriesByIds } from "../../db/memories";
import { createEmbedding } from "../embedding";
import { isRecallableMemory, toMemoryApiRecord } from "../search";
import type { MemoryApiRecordWithProvenance } from "../search";
import { queryTriggerVectors, type TriggerMatch } from "./store";
import type { Env } from "../../types";
import {
  isTriggerRecallEnabled,
  selectTriggeredMemories,
  triggerRecallGate,
  triggerRecallTopK,
  type TriggerRecallOutcome
} from "./select";

export async function recallByTriggers(
  env: Env,
  input: { namespace: string; query: string }
): Promise<TriggerRecallOutcome> {
  const empty: TriggerRecallOutcome = {
    triggered: false,
    reason: "disabled",
    memories: [],
    best_score: 0
  };
  if (!isTriggerRecallEnabled(env)) return empty;
  const query = input.query.trim();
  if (!query) return { ...empty, reason: "empty query" };

  const vector = await createEmbedding(env, query);
  if (!vector) return { ...empty, reason: "embedding failed" };

  const matches = await queryTriggerVectors(env, {
    namespace: input.namespace,
    queryVector: vector,
    topK: triggerRecallTopK(env)
  });
  const outcome = selectTriggeredMemories(matches, {
    gate: triggerRecallGate(env),
    maxTriggers: triggerRecallTopK(env)
  });
  if (!outcome.triggered) return outcome;

  // D1 背书：向量里的 ref_id 可能指向已删除的记忆（孤儿向量）。
  // 与 RECALL_REQUIRE_D1_BACKING 同一条原则——没有 D1 行的命中不往上送。
  const keys = matches
    .filter((m) => outcome.memories.some((mem) => mem.memory_id === m.memory_id))
    .map((m) => m.trigger_key);
  const rows = await listTriggersByVectorIds(env.DB, keys);
  if (rows.length === 0) {
    return { ...outcome, triggered: false, reason: "triggers fired but no D1 backing", memories: [] };
  }
  const backed = new Set(rows.map((row) => row.memory_id));
  const memories = outcome.memories.filter((m) => backed.has(m.memory_id));
  if (memories.length === 0) {
    return { ...outcome, triggered: false, reason: "triggers fired but no D1 backing", memories: [] };
  }
  return { ...outcome, memories };
}

// 把触发器命中的记忆取成候选池格式。
// 只返回「池子里还没有的」——已经被主检索召到的记忆不碰，它的分和顺序保持原样。
// 这是 additive-safe 的全部含义：这条通道只会让候选池变大，不会让已有命中变坏。
export async function fetchTriggeredRecords(
  env: Env,
  input: {
    namespace: string;
    outcome: TriggerRecallOutcome;
    existingIds: Set<string>;
    includeHistory?: boolean;
  }
): Promise<MemoryApiRecordWithProvenance[]> {
  const wanted = input.outcome.memories.filter((m) => !input.existingIds.has(m.memory_id));
  if (wanted.length === 0) return [];

  const rows = await fetchMemoriesByIds(env.DB, {
    namespace: input.namespace,
    ids: wanted.map((m) => m.memory_id)
  });
  const scoreById = new Map(wanted.map((m) => [m.memory_id, m.trigger_score]));

  const out: MemoryApiRecordWithProvenance[] = [];
  for (const row of rows) {
    if (!isRecallableMemory(row, { includeHistory: input.includeHistory })) continue;
    const score = scoreById.get(row.id);
    if (score === undefined) continue;
    // 触发器余弦和记忆余弦不同量纲，这个分只用来把它送进 reranker；
    // 2.5 的 reranker 会重打分，闸四判的是重打之后的分。
    out.push({ ...toMemoryApiRecord(row, score), backed: true });
  }
  return out;
}
