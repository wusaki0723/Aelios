// 触发器向量的写入与检索。
//
// 隔离不变量（重要）：触发器向量和记忆向量共用 memo-kb 索引，但 namespace 一律写成
// `trg:<真实 namespace>`。searchVectorMemories 除了带 filter 的查询，还跑一条不带
// filter 的 legacy 查询兜底迁移期向量，靠 `md.namespace !== input.namespace` 严格
// 相等来挡。只要触发器的 namespace 串带上 `trg:` 前缀，它就永远等不上任何真实
// namespace，现有召回一条也看不见。改这个前缀等于把触发器直接漏进记忆召回结果里。
//
// 三视图：一条触发器写三个向量——concept、bridge、两者拼接。召回时按 trigger_key
// 聚合取最大值，等价于 T-Mem 的 nanmax(cos_c, cos_b, cos_j)：三个角度里只要有一个
// 对上就算命中，不因为另外两个不像而被平均掉。

import { createEmbedding } from "../embedding";
import type { Env } from "../../types";

export const TRIGGER_NS_PREFIX = "trg:";

export type TriggerView = "concept" | "bridge" | "joint";

export function triggerNamespace(namespace: string): string {
  return `${TRIGGER_NS_PREFIX}${namespace}`;
}

export function triggerViewVectorId(vectorId: string, view: TriggerView): string {
  return `${vectorId}#${view[0]}`;
}

export interface TriggerVectorInput {
  namespace: string;
  memoryId: string;
  vectorId: string;
  concept: string;
  bridge: string;
  confidence: number;
}

// 三视图 upsert。embedding 失败的视图跳过，不让整条触发器失败——
// 少一个视图只是少一个角度，仍然可召回。
export async function upsertTriggerVectors(
  env: Env,
  input: TriggerVectorInput
): Promise<number> {
  if (!env.VECTORIZE) return 0;
  const ns = triggerNamespace(input.namespace);
  const joint = input.bridge ? `${input.concept}。${input.bridge}` : input.concept;
  const views: Array<[TriggerView, string]> = [
    ["concept", input.concept],
    ["bridge", input.bridge],
    ["joint", joint]
  ];

  const vectors: VectorizeVector[] = [];
  for (const [view, text] of views) {
    if (!text.trim()) continue;
    const values = await createEmbedding(env, text);
    if (!values) continue;
    vectors.push({
      id: triggerViewVectorId(input.vectorId, view),
      namespace: ns,
      values,
      metadata: {
        namespace: ns,
        kind: "trigger",
        view,
        trigger_key: input.vectorId,
        memory_ns: input.namespace,
        ref_id: input.memoryId,
        concept: input.concept,
        confidence: input.confidence
      }
    });
  }
  if (vectors.length === 0) return 0;
  await env.VECTORIZE.upsert(vectors);
  return vectors.length;
}

export async function deleteTriggerVectors(env: Env, vectorIds: string[]): Promise<void> {
  if (!env.VECTORIZE || vectorIds.length === 0) return;
  const views: TriggerView[] = ["concept", "bridge", "joint"];
  const ids = vectorIds.flatMap((vid) => views.map((view) => triggerViewVectorId(vid, view)));
  await env.VECTORIZE.deleteByIds(ids);
}

export interface TriggerMatch {
  trigger_key: string;
  memory_id: string;
  concept: string;
  // nanmax over the three views.
  score: number;
  view: TriggerView;
  confidence: number;
}

// 查触发器索引，按 trigger_key 取三视图最大分。
// 只查带 namespace 的那一路——触发器没有迁移期遗留向量，不需要 legacy 兜底，
// 也不该给它开那条不带 filter 的口子。
export async function queryTriggerVectors(
  env: Env,
  input: { namespace: string; queryVector: number[]; topK: number }
): Promise<TriggerMatch[]> {
  if (!env.VECTORIZE) return [];
  const ns = triggerNamespace(input.namespace);
  // 三视图意味着同一条触发器最多占 3 个返回位，所以按 3 倍取回再聚合，
  // 否则 topK 会被同一条触发器的三个视图吃满。
  const topK = Math.min(Math.max(Math.floor(input.topK), 1) * 3, 100);
  const result = await env.VECTORIZE.query(input.queryVector, {
    topK,
    namespace: ns,
    returnMetadata: "all",
    filter: { namespace: ns, kind: "trigger" }
  });

  const best = new Map<string, TriggerMatch>();
  for (const match of result.matches) {
    const md = (match.metadata || {}) as Record<string, unknown>;
    // 双保险：即使过滤器失效也不接受非触发器向量，避免污染候选池。
    if (md.kind !== "trigger") continue;
    if (typeof md.namespace !== "string" || md.namespace !== ns) continue;
    if (typeof md.memory_ns !== "string" || md.memory_ns !== input.namespace) continue;
    const key = typeof md.trigger_key === "string" ? md.trigger_key : "";
    const memoryId = typeof md.ref_id === "string" ? md.ref_id : "";
    if (!key || !memoryId) continue;
    const score = typeof match.score === "number" && Number.isFinite(match.score) ? match.score : Number.NaN;
    if (!Number.isFinite(score)) continue;
    const view = (md.view === "bridge" || md.view === "joint" ? md.view : "concept") as TriggerView;
    const existing = best.get(key);
    if (existing && existing.score >= score) continue;
    best.set(key, {
      trigger_key: key,
      memory_id: memoryId,
      concept: typeof md.concept === "string" ? md.concept : "",
      score,
      view,
      confidence: typeof md.confidence === "number" ? md.confidence : 0
    });
  }
  return [...best.values()].sort((a, b) => b.score - a.score);
}
