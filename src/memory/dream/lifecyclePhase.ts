import {
  createMemoryCandidate,
  resolveMemoryFactKey,
  supersedeMemory,
  upsertDailyLog
} from "../../db/v2";
import type { Env, MessageRecord } from "../../types";
import { readString } from "../../utils/parse";
import type { ExtractedMemory } from "../extract";
import { getVectorMemory } from "../vectorStore";
import {
  type DailyDigestResult,
  resolveWorldFactTarget
} from "./helpers";
import {
  queueDreamExtractedMemories,
  recordDreamReviewProposal,
  sanitizeDreamDigestLists
} from "./judgePhase";

/** supersede / archive / upsert / candidate queue + daily log write */
export async function applyDreamV2(
  env: Env,
  input: {
    namespace: string;
    strategy: "upsert" | "review";
    dateLabel: string;
    messages: MessageRecord[];
    digest: DailyDigestResult;
    messageIds: string[];
    extracted: ExtractedMemory[];
  }
): Promise<{
  added: number;
  updated: number;
  deleted: number;
  queuedCandidates: number;
  longtail: number;
  errors: Array<{ target_id: string; reason: string }>;
}> {
  const { namespace, strategy, dateLabel, digest, messageIds, extracted } = input;
  const isReview = strategy === "review";
  let updated = 0;
  let deleted = 0;
  let queuedCandidates = 0;
  const errors: Array<{ target_id: string; reason: string }> = [];

  if (isReview) {
    queuedCandidates += await queueDreamExtractedMemories(env, {
      namespace,
      memories: extracted,
      messageIds
    });
    await recordDreamReviewProposal(env, { namespace, dateLabel, digest, messageIds });
    return { added: 0, updated: 0, deleted: 0, queuedCandidates, longtail: 0, errors: [] };
  }

  queuedCandidates += await queueDreamExtractedMemories(env, {
    namespace,
    memories: extracted,
    messageIds
  });

  for (const item of digest.memories_to_add ?? []) {
    const content = readString(item.content);
    if (!content) continue;
    try {
      await createMemoryCandidate(env.DB, {
        namespace,
        type: item.type ?? "note",
        content,
        factKey: item.fact_key ?? null,
        confidence: item.confidence ?? 0.72,
        importance: item.importance ?? 0.72,
        tags: item.tags,
        sourceMessageIds: item.source_message_ids.length ? item.source_message_ids : messageIds,
        source: "dream_add"
      });
      queuedCandidates += 1;
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      console.warn("dream: add failed", { namespace, reason });
      errors.push({ target_id: content.slice(0, 40), reason });
    }
  }

  const { updates: memoriesToUpdate, deletes: memoriesToDelete } = sanitizeDreamDigestLists(
    digest.memories_to_update ?? [],
    digest.memories_to_delete ?? []
  );

  for (const item of memoriesToUpdate) {
    try {
      const worldFactTarget = await resolveWorldFactTarget(env, { namespace, targetId: item.target_id });
      if (worldFactTarget && item.content) {
        await supersedeMemory(env, {
          namespace,
          oldId: item.target_id,
          newContent: item.content,
          newType: item.type ?? worldFactTarget.type,
          newFactKey: worldFactTarget.factKey,
          importance: item.importance,
          confidence: item.confidence,
          tags: item.tags,
          source: "dream",
          sourceMessageIds: messageIds,
          reason: "dream_world_fact"
        });
        updated++;
        continue;
      }

      if (!item.content) continue;
      const inheritedFactKey = await resolveMemoryFactKey(env, item.target_id, namespace);
      await createMemoryCandidate(env.DB, {
        namespace,
        type: item.type ?? "note",
        content: item.content,
        factKey: inheritedFactKey,
        confidence: item.confidence ?? 0.72,
        importance: item.importance ?? 0.72,
        tags: item.tags,
        sourceMessageIds: messageIds,
        source: "dream_update",
        targetMemoryId: item.target_id
      });
      queuedCandidates += 1;
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      console.warn("dream: update failed", { namespace, target_id: item.target_id, reason });
      errors.push({ target_id: item.target_id, reason });
    }
  }

  for (const item of memoriesToDelete) {
    try {
      const existing = await getVectorMemory(env, item.target_id, { requireD1Backing: true });
      if (!existing || existing.status !== "active" || existing.pinned) continue;

      await createMemoryCandidate(env.DB, {
        namespace,
        type: existing.type,
        content: existing.content,
        factKey: null,
        confidence: 0.72,
        importance: existing.importance,
        tags: [],
        sourceMessageIds: messageIds,
        source: "dream_delete",
        targetMemoryId: item.target_id,
        decisionNote: item.reason ?? "dream_delete"
      });
      queuedCandidates += 1;
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      console.warn("dream: delete failed", { namespace, target_id: item.target_id, reason });
      errors.push({ target_id: item.target_id, reason });
    }
  }

  await upsertDailyLog(env.DB, {
    namespace,
    date: dateLabel,
    title: digest.title ?? dateLabel,
    summary: digest.summary ?? ""
  });

  return { added: 0, updated, deleted, queuedCandidates, longtail: 0, errors };
}

export async function runLifecyclePhase(
  env: Env,
  input: {
    namespace: string;
    strategy: "upsert" | "review";
    dateLabel: string;
    messages: MessageRecord[];
    digest: DailyDigestResult;
    messageIds: string[];
    extracted: ExtractedMemory[];
  }
): Promise<Awaited<ReturnType<typeof applyDreamV2>>> {
  return applyDreamV2(env, input);
}
