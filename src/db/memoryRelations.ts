import type { MemoryRecord } from "../types";
import { newId } from "../utils/ids";
import { nowIso } from "../utils/time";

export interface MemoryRelationRecord {
  id: string;
  namespace: string;
  source_id: string;
  target_id: string;
  relation_type: string;
  strength: number;
  created_at: string;
}

export const SAFE_RELATION_TYPES = new Set([
  "same_issue",
  "same_project",
  "same_tool",
  "same_event",
  "same_topic",
  "temporal_sequence",
  "emotional_link",
  "in_thread",
  "same_person",
  "in_episode",
  "instance_of",
  "derived_from"
]);

export const REVIEW_RELATION_TYPES = new Set(["contradicts", "cause_effect", "supports"]);

export const SYMMETRIC_RELATION_TYPES = new Set([
  "same_issue",
  "same_project",
  "same_tool",
  "same_event",
  "same_topic",
  "emotional_link",
  "in_thread",
  "same_person",
  "in_episode",
  "instance_of",
  "contradicts"
]);

export function normalizeRelationType(value: string): string {
  const clean = value.trim();
  return clean === "contradiction" ? "contradicts" : clean;
}

export function normalizeRelationPair(
  sourceId: string,
  targetId: string,
  relationType: string
): { sourceId: string; targetId: string; relationType: string } {
  const normalizedType = normalizeRelationType(relationType);
  if (SYMMETRIC_RELATION_TYPES.has(normalizedType) && sourceId > targetId) {
    return { sourceId: targetId, targetId: sourceId, relationType: normalizedType };
  }
  return { sourceId, targetId, relationType: normalizedType };
}

export async function createMemoryRelation(
  db: D1Database,
  input: { namespace: string; sourceId: string; targetId: string; relationType: string; strength?: number }
): Promise<boolean> {
  if (input.sourceId === input.targetId) return false;
  const pair = normalizeRelationPair(input.sourceId, input.targetId, input.relationType);
  if (!SAFE_RELATION_TYPES.has(pair.relationType)) return false;
  const strength =
    typeof input.strength === "number" && Number.isFinite(input.strength)
      ? Math.min(Math.max(input.strength, 0), 1)
      : 1;
  const result = await db
    .prepare(
      `INSERT OR IGNORE INTO memory_relations (
        id, namespace, source_id, target_id, relation_type, strength, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(newId("rel"), input.namespace, pair.sourceId, pair.targetId, pair.relationType, strength, nowIso())
    .run();
  return Boolean(result.meta.changes);
}

export async function listRelationExpandedMemories(
  db: D1Database,
  input: { namespace: string; baseIds: string[]; limit: number }
): Promise<Array<MemoryRecord & { score: number }>> {
  const baseIds = [...new Set(input.baseIds.filter(Boolean))];
  if (baseIds.length === 0) return [];

  const scores = new Map<string, number>();
  let frontier = baseIds;
  const baseSet = new Set(baseIds);
  const typeWeights = new Map([
    ["same_event", 1.0],
    ["same_topic", 0.95],
    ["same_project", 0.9],
    ["same_issue", 0.85],
    ["same_tool", 0.75],
    ["in_thread", 0.8],
    ["same_person", 0.78],
    ["in_episode", 0.78],
    ["instance_of", 0.72],
    ["derived_from", 0.7],
    ["temporal_sequence", 0.55],
    ["emotional_link", 0.5]
  ]);

  for (const depth of [1, 2]) {
    if (frontier.length === 0) break;
    const placeholders = frontier.map(() => "?").join(", ");
    const result = await db
      .prepare(
        `SELECT source_id, target_id, relation_type, strength
         FROM memory_relations
         WHERE namespace = ?
           AND (source_id IN (${placeholders}) OR target_id IN (${placeholders}))`
      )
      .bind(input.namespace, ...frontier, ...frontier)
      .all<MemoryRelationRecord>();

    const nextFrontier = new Set<string>();
    for (const relation of result.results ?? []) {
      if (!SAFE_RELATION_TYPES.has(relation.relation_type)) continue;
      if (depth === 1 && relation.strength < 0.4) continue;
      if (depth === 2 && relation.strength < 0.7) continue;
      const relatedId = frontier.includes(relation.source_id) ? relation.target_id : relation.source_id;
      if (baseSet.has(relatedId)) continue;
      const depthWeight = depth === 1 ? 0.35 : 0.16;
      const typeWeight = typeWeights.get(relation.relation_type) ?? 0.5;
      const score = Math.min(0.82, Math.max(0, relation.strength) * typeWeight * depthWeight);
      scores.set(relatedId, Math.max(scores.get(relatedId) ?? 0, score));
      if (depth === 1) nextFrontier.add(relatedId);
    }
    frontier = [...nextFrontier].filter((id) => !baseSet.has(id));
  }

  const ids = [...scores.keys()].slice(0, Math.max(input.limit * 3, input.limit));
  if (ids.length === 0) return [];
  const placeholders = ids.map(() => "?").join(", ");
  const rows = await db
    .prepare(
      `SELECT * FROM memories
       WHERE namespace = ?
         AND status = 'active'
         AND id IN (${placeholders})`
    )
    .bind(input.namespace, ...ids)
    .all<MemoryRecord>();

  return (rows.results ?? [])
    .map((record) => ({ ...record, score: scores.get(record.id) ?? 0 }))
    .sort((a, b) => b.score + b.importance * 0.05 - (a.score + a.importance * 0.05))
    .slice(0, input.limit);
}
