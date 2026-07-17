import { createMemoryCandidate } from "../../db/v2";
import type { Env } from "../../types";
import { newId } from "../../utils/ids";
import { nowIso } from "../../utils/time";
import { findSimilarActiveMemory } from "../dedupGate";
import type { ExtractedMemory } from "../extract";
import {
  type DailyDigestResult,
  type DigestMemoryDelete,
  type DigestMemoryUpdate,
  type DreamRoutingItem,
  type DreamRoutingPlan,
  resolveWorldFactTarget
} from "./helpers";

export function sanitizeDreamDigestLists(
  updates: DigestMemoryUpdate[],
  deletes: DigestMemoryDelete[]
): { updates: DigestMemoryUpdate[]; deletes: DigestMemoryDelete[] } {
  const deleteIds = new Set((deletes ?? []).map((item) => item.target_id));
  const seenUpdateIds = new Set<string>();
  const cleanedUpdates: DigestMemoryUpdate[] = [];

  for (const item of updates ?? []) {
    if (!item.target_id) continue;
    if (deleteIds.has(item.target_id)) continue;
    if (seenUpdateIds.has(item.target_id)) continue;
    seenUpdateIds.add(item.target_id);
    cleanedUpdates.push(item);
  }

  return { updates: cleanedUpdates, deletes: deletes ?? [] };
}

export async function recordDreamReviewProposal(
  env: Env,
  input: { namespace: string; dateLabel: string; digest: DailyDigestResult; messageIds: string[] }
): Promise<void> {
  await env.DB
    .prepare(
      `INSERT INTO memory_events (id, namespace, event_type, memory_id, payload_json, created_at)
       VALUES (?, ?, ?, NULL, ?, ?)`
    )
    .bind(
      newId("evt"),
      input.namespace,
      "dream_review_proposal",
      JSON.stringify({
        date: input.dateLabel,
        message_ids: input.messageIds,
        title: input.digest.title ?? null,
        summary: input.digest.summary ?? null,
        memories_to_add: input.digest.memories_to_add ?? [],
        memories_to_update: input.digest.memories_to_update ?? [],
        memories_to_delete: input.digest.memories_to_delete ?? []
      }),
      nowIso()
    )
    .run();
}

export async function queueDreamExtractedMemories(
  env: Env,
  input: { namespace: string; memories: ExtractedMemory[]; messageIds: string[] }
): Promise<number> {
  let queued = 0;
  for (const memory of input.memories) {
    try {
      let targetMemoryId: string | null = null;
      let decisionNote: string | null = null;
      const hit = await findSimilarActiveMemory(env, {
        namespace: input.namespace,
        content: memory.content
      });
      if (hit) {
        targetMemoryId = hit.memory.id;
        decisionNote = `dedup_gate: similar to ${hit.memory.id} (score=${hit.score.toFixed(2)})`;
      }
      await createMemoryCandidate(env.DB, {
        namespace: input.namespace,
        type: memory.type,
        content: memory.content,
        factKey: memory.fact_key ?? null,
        confidence: memory.confidence,
        importance: memory.importance,
        tags: memory.tags,
        sourceMessageIds: memory.source_message_ids.length ? memory.source_message_ids : input.messageIds,
        source: "dream_extract",
        targetMemoryId,
        decisionNote
      });
      queued += 1;
    } catch (error) {
      console.warn("dream: failed to queue extracted memory", {
        namespace: input.namespace,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }
  return queued;
}

export function buildDreamRoutingPlan(input: {
  extracted: ExtractedMemory[];
  digest: DailyDigestResult;
  worldFactUpdateIds?: Set<string>;
}): DreamRoutingPlan {
  const items: DreamRoutingItem[] = [];
  const worldFactUpdateIds = input.worldFactUpdateIds ?? new Set<string>();

  for (const memory of input.extracted) {
    items.push({
      destination: "candidate",
      kind: "extract",
      content: memory.content,
      type: memory.type,
      fact_key: memory.fact_key ?? null
    });
  }

  for (const item of input.digest.memories_to_add ?? []) {
    items.push({
      destination: "candidate",
      kind: "add",
      content: item.content,
      type: item.type,
      fact_key: item.fact_key ?? null
    });
  }

  for (const item of input.digest.memories_to_update ?? []) {
    items.push({
      destination: worldFactUpdateIds.has(item.target_id) ? "world_fact_direct" : "candidate",
      kind: "update",
      content: item.content,
      type: item.type,
      target_id: item.target_id
    });
  }

  for (const item of input.digest.memories_to_delete ?? []) {
    items.push({
      destination: "candidate",
      kind: "delete",
      target_id: item.target_id,
      reason: item.reason
    });
  }

  const toCandidates = items.filter((item) => item.destination === "candidate").length;
  return {
    items,
    summary: {
      to_candidates: toCandidates,
      world_fact_direct: items.length - toCandidates
    }
  };
}

/** Resolve world-fact update targets and build routing plan (dry-run / audit path). */
export async function runJudgePhase(
  env: Env,
  input: {
    namespace: string;
    extracted: ExtractedMemory[];
    digest: DailyDigestResult;
  }
): Promise<{ routingPlan: DreamRoutingPlan; worldFactUpdateIds: Set<string> }> {
  const worldFactUpdateIds = new Set<string>();
  for (const item of input.digest.memories_to_update ?? []) {
    const target = await resolveWorldFactTarget(env, { namespace: input.namespace, targetId: item.target_id });
    if (target) worldFactUpdateIds.add(item.target_id);
  }
  const routingPlan = buildDreamRoutingPlan({
    extracted: input.extracted,
    digest: input.digest,
    worldFactUpdateIds
  });
  return { routingPlan, worldFactUpdateIds };
}
