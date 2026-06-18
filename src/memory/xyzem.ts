import { createMemoryEvent } from "../db/memoryEvents";
import { createMemoryRelation, REVIEW_RELATION_TYPES, SAFE_RELATION_TYPES } from "../db/memoryRelations";
import { getMemoryById, listFactKeyConflicts, listMemoriesSince, updateMemory } from "../db/memories";
import type { Env, MemoryRecord } from "../types";
import { markMemoryReviewSynced } from "./state";

function dayAgoIso(): string {
  return new Date(Date.now() - 86_400_000).toISOString();
}

function parseJsonArray(value: string | null): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean)
      : [];
  } catch {
    return [];
  }
}

function overlap(left: string[], right: string[]): string[] {
  const rightSet = new Set(right.map((item) => item.toLowerCase()));
  return left.filter((item) => rightSet.has(item.toLowerCase()));
}

function sameTopicStrength(left: MemoryRecord, right: MemoryRecord): number {
  let score = 0;
  if (left.thread && right.thread && left.thread === right.thread) score += 0.45;
  if (left.type === right.type) score += 0.15;
  score += Math.min(overlap(parseJsonArray(left.tags), parseJsonArray(right.tags)).length * 0.12, 0.3);
  return Math.min(score, 0.9);
}

export async function runZAudit(
  env: Env,
  namespace: string
): Promise<{ conflicts: number; reviewed: number; events: number }> {
  const conflicts = await listFactKeyConflicts(env.DB, { namespace, limit: 200 });
  let reviewed = 0;
  let events = 0;

  for (const conflict of conflicts) {
    const ids = conflict.ids.split(",").map((id) => id.trim()).filter(Boolean);
    const memories: MemoryRecord[] = [];
    for (const id of ids) {
      const memory = await getMemoryById(env.DB, { namespace, id });
      if (memory) memories.push(memory);
    }

    const activeNonPinned = memories.filter((m) => m.status === "active" && !m.pinned);
    const activePinned = memories.filter((m) => m.status === "active" && m.pinned);

    if (activePinned.length > 0 || activeNonPinned.length <= 1) {
      await createMemoryEvent(env.DB, {
        namespace,
        eventType: "z_audit",
        payload: {
          fact_key: conflict.fact_key,
          memory_ids: ids,
          count: conflict.count,
          action: "no_change",
          reason: activePinned.length > 0 ? "pinned_memory_present" : "single_active"
        }
      });
      events += 1;
      continue;
    }

    const ranked = [...activeNonPinned].sort((a, b) => {
      if (a.confidence !== b.confidence) return b.confidence - a.confidence;
      if (a.importance !== b.importance) return b.importance - a.importance;
      return b.updated_at.localeCompare(a.updated_at);
    });

    const best = ranked[0];
    const weaker = ranked.slice(1);

    await createMemoryEvent(env.DB, {
      namespace,
      eventType: "z_audit",
      payload: {
        fact_key: conflict.fact_key,
        memory_ids: ids,
        count: conflict.count,
        action: "keep_best_mark_weaker",
        best_id: best.id,
        weaker_ids: weaker.map((m) => m.id)
      }
    });
    events += 1;

    await updateMemory(env.DB, {
      namespace,
      id: best.id,
      patch: { auditState: "best_candidate" }
    });

    for (const memory of weaker) {
      await markMemoryReviewSynced(env, namespace, memory.id, "weaker_conflict");
      reviewed += 1;
    }
  }

  return { conflicts: conflicts.length, reviewed, events };
}

export async function runMetabolismPatrol(
  env: Env,
  namespace: string
): Promise<{ suggestions: number; events: number }> {
  const suggestions: Array<Record<string, unknown>> = [];
  const duplicateFacts = await listFactKeyConflicts(env.DB, { namespace, limit: 100 });
  for (const conflict of duplicateFacts) {
    suggestions.push({
      action: "review",
      severity: "critical",
      reason: "fact_key has multiple active/review memories",
      fact_key: conflict.fact_key,
      memory_ids: conflict.ids.split(",").map((id) => id.trim()).filter(Boolean)
    });
  }

  const reviewRows = await env.DB
    .prepare(
      `SELECT id FROM memories
       WHERE namespace = ?
         AND status = 'review'
       ORDER BY updated_at DESC
       LIMIT 50`
    )
    .bind(namespace)
    .all<{ id: string }>();
  if ((reviewRows.results ?? []).length > 0) {
    suggestions.push({
      action: "review",
      severity: "warning",
      reason: "memories waiting for review",
      memory_ids: (reviewRows.results ?? []).map((row) => row.id)
    });
  }

  const staleRows = await env.DB
    .prepare(
      `SELECT id FROM memories
       WHERE namespace = ?
         AND status = 'active'
         AND pinned = 0
         AND expires_at IS NOT NULL
         AND expires_at < ?
       ORDER BY expires_at ASC
       LIMIT 50`
    )
    .bind(namespace, new Date().toISOString())
    .all<{ id: string }>();
  if ((staleRows.results ?? []).length > 0) {
    suggestions.push({
      action: "archive_or_review",
      severity: "warning",
      reason: "active memories past expires_at",
      memory_ids: (staleRows.results ?? []).map((row) => row.id)
    });
  }

  if (suggestions.length > 0) {
    await createMemoryEvent(env.DB, {
      namespace,
      eventType: "m_patrol",
      payload: { suggestions }
    });
    return { suggestions: suggestions.length, events: 1 };
  }

  return { suggestions: 0, events: 0 };
}

export async function runRelationBuild(
  env: Env,
  namespace: string,
  options: { sinceIso?: string } = {}
): Promise<{ scanned: number; inserted: number; review: number }> {
  const memories = await listMemoriesSince(env.DB, {
    namespace,
    since: options.sinceIso ?? dayAgoIso(),
    limit: 500
  });
  let inserted = 0;
  let review = 0;

  for (let index = 0; index < memories.length; index += 1) {
    const current = memories[index];
    const previous = memories[index - 1];
    if (previous && current.created_at >= previous.created_at) {
      if (await createMemoryRelation(env.DB, {
        namespace,
        sourceId: previous.id,
        targetId: current.id,
        relationType: "temporal_sequence",
        strength: 0.45
      })) {
        inserted += 1;
      }
    }

    for (let j = 0; j < index; j += 1) {
      const candidate = memories[j];
      const strength = sameTopicStrength(current, candidate);
      if (strength >= 0.4 && SAFE_RELATION_TYPES.has("same_topic")) {
        if (await createMemoryRelation(env.DB, {
          namespace,
          sourceId: current.id,
          targetId: candidate.id,
          relationType: "same_topic",
          strength
        })) {
          inserted += 1;
        }
        break;
      }
    }
  }

  const factGroups = new Map<string, string[]>();
  for (const memory of memories) {
    if (!memory.fact_key) continue;
    factGroups.set(memory.fact_key, [...(factGroups.get(memory.fact_key) ?? []), memory.id]);
  }
  for (const [factKey, ids] of factGroups.entries()) {
    if (ids.length <= 1 || !REVIEW_RELATION_TYPES.has("contradicts")) continue;
    await createMemoryEvent(env.DB, {
      namespace,
      eventType: "y_relation_review",
      payload: {
        relation_type: "contradicts",
        fact_key: factKey,
        memory_ids: ids,
        reason: "multiple new memories share fact_key; needs human or Z-axis review"
      }
    });
    review += 1;
  }

  return { scanned: memories.length, inserted, review };
}

export async function runXyzemNightlyMaintenance(
  env: Env,
  namespace: string
): Promise<{ zAudit: Awaited<ReturnType<typeof runZAudit>>; patrol: Awaited<ReturnType<typeof runMetabolismPatrol>>; relations: Awaited<ReturnType<typeof runRelationBuild>> }> {
  const zAudit = await runZAudit(env, namespace);
  const patrol = await runMetabolismPatrol(env, namespace);
  const relations = await runRelationBuild(env, namespace);
  return { zAudit, patrol, relations };
}
