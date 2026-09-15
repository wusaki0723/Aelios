// 触发器建期：给一批记忆生成触发器并写入 D1 + Vectorize。
//
// 成本在这里：每条记忆一次 LLM 调用 + 每条触发器三次 embedding。
// 所以 (1) 默认关闭；(2) 只建增量，已经有触发器的记忆跳过；
// (3) 单次有上限，宁可下一晚接着建，不要在一个夜批里把配额烧光。

import {
  listMemoriesUpdatedInRange,
  listMemoryIdsWithTriggers,
  upsertMemoryTrigger,
  deleteTriggersForMemory
} from "../../db/v2";
import { callOpenAICompat } from "../../proxy/openaiAdapter";
import { newId } from "../../utils/ids";
import type { Env, OpenAIChatRequest, OpenAIChatResponse } from "../../types";
import { buildTriggerPrompt, parseTriggerResponse, type TriggerDraft } from "./prompt";
import { upsertTriggerVectors, deleteTriggerVectors } from "./store";

const BUILD_MEMORY_LIMIT = 120;
const TRIGGERS_PER_MEMORY = 4;
// 建期就把低置信度的挡掉，不要让它们占索引也占召回的 topK。
const MIN_TRIGGER_CONFIDENCE = 0.7;

export function isTriggerBuildEnabled(env: Env): boolean {
  const raw = (env.TRIGGER_BUILD ?? "off").trim().toLowerCase();
  return raw === "on" || raw === "true" || raw === "1";
}

function triggerModel(env: Env): string {
  return env.TRIGGER_BUILD_MODEL || env.DREAM_MODEL || "";
}

export async function draftTriggersForMemory(
  env: Env,
  input: { content: string; occurredAt?: string | null }
): Promise<TriggerDraft[]> {
  const model = triggerModel(env);
  if (!model) return [];
  const body: OpenAIChatRequest = {
    model,
    messages: [
      { role: "system", content: "Output JSON only." },
      {
        role: "user",
        content: buildTriggerPrompt({
          content: input.content.slice(0, 600),
          count: TRIGGERS_PER_MEMORY,
          occurredAt: input.occurredAt ?? null
        })
      }
    ],
    temperature: 0,
    max_tokens: 800
  };

  try {
    const response = await callOpenAICompat(env, body);
    if (!response.ok) return [];
    const json = (await response.json()) as OpenAIChatResponse;
    const text = json.choices?.[0]?.message?.content;
    if (typeof text !== "string" || !text) return [];
    return parseTriggerResponse(text, {
      content: input.content,
      minConfidence: MIN_TRIGGER_CONFIDENCE
    });
  } catch (error) {
    console.warn("trigger draft failed", error);
    return [];
  }
}

export interface TriggerBuildStats {
  memories_seen: number;
  memories_built: number;
  triggers_written: number;
  vectors_written: number;
  truncated: boolean;
  skipped_reason?: string;
}

// 夜批调用。rebuild=true 时先摘掉旧触发器再重建（prompt 改版后用）。
export async function runTriggerBuildPhase(
  env: Env,
  input: { namespace: string; startIso: string; endIso: string; rebuild?: boolean }
): Promise<TriggerBuildStats> {
  const base: TriggerBuildStats = {
    memories_seen: 0,
    memories_built: 0,
    triggers_written: 0,
    vectors_written: 0,
    truncated: false
  };
  if (!isTriggerBuildEnabled(env)) return { ...base, skipped_reason: "disabled" };
  if (!env.VECTORIZE) return { ...base, skipped_reason: "no_vectorize" };
  if (!triggerModel(env)) return { ...base, skipped_reason: "no_model" };

  const seeds = await listMemoriesUpdatedInRange(env.DB, {
    namespace: input.namespace,
    startIso: input.startIso,
    endIso: input.endIso,
    limit: BUILD_MEMORY_LIMIT
  });
  base.memories_seen = seeds.length;
  if (seeds.length === 0) return base;

  const existing = input.rebuild
    ? new Set<string>()
    : await listMemoryIdsWithTriggers(
        env.DB,
        input.namespace,
        seeds.map((s) => s.id)
      );

  for (const seed of seeds) {
    if (base.memories_built >= BUILD_MEMORY_LIMIT) {
      base.truncated = true;
      break;
    }
    if (existing.has(seed.id)) continue;
    if (!seed.content.trim()) continue;

    if (input.rebuild) {
      const stale = await deleteTriggersForMemory(env.DB, seed.id);
      await deleteTriggerVectors(env, stale);
    }

    const drafts = await draftTriggersForMemory(env, { content: seed.content });
    if (drafts.length === 0) continue;
    base.memories_built += 1;

    for (const draft of drafts) {
      const vectorId = newId("trg");
      const written = await upsertTriggerVectors(env, {
        namespace: input.namespace,
        memoryId: seed.id,
        vectorId,
        concept: draft.concept,
        bridge: draft.bridge,
        confidence: draft.confidence
      });
      // 向量写失败就不要在 D1 留一条召不回的行。
      if (written === 0) continue;
      await upsertMemoryTrigger(env.DB, {
        namespace: input.namespace,
        memoryId: seed.id,
        concept: draft.concept,
        bridge: draft.bridge,
        confidence: draft.confidence,
        vectorId,
        createdBy: "dream"
      });
      base.triggers_written += 1;
      base.vectors_written += written;
    }
  }

  return base;
}
