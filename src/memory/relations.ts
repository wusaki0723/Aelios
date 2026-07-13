// LMC-5 Y 轴: dream 夜批 relation-build + recall 2-hop 扩展。
// RELATION_EXPANSION 默认 off：expand 路径不改 seed 结果顺序/内容（除 additive 可选字段不写入）。

import {
  defaultRelationWeight,
  insertMemoryRelation,
  isMemoryRelType,
  listMemoriesUpdatedInRange,
  listRelationsForIds,
  markMemoriesUnderReview,
  listDuplicateFactKeyGroups
} from "../db/v2";
import { fetchMemoriesByIds } from "../db/memories";
import { callOpenAICompat } from "../proxy/openaiAdapter";
import type { Env, MemoryRelType, MemoryRelationRow, OpenAIChatRequest, OpenAIChatResponse } from "../types";
import { createEmbedding } from "./embedding";
import { isRecallableMemory } from "./search";

const RELATION_JUDGE_LIMIT = 200;
const NEIGHBOR_TOP_K = 8;
const SAFE_REL_TYPES = new Set<MemoryRelType>(["same_thread", "derived_from", "supports", "supersedes"]);

export function isRelationExpansionEnabled(env: Env): boolean {
  const raw = (env.RELATION_EXPANSION ?? "off").trim().toLowerCase();
  return raw === "on" || raw === "true" || raw === "1";
}

// ---------------------------------------------------------------------------
// Recall 2-hop expansion
// hop1 score = seed × 0.6 × weight; hop2 = seed × 0.36 × weight
// contradicts: do not boost ranking; attach contradicted_by markers instead.
// ---------------------------------------------------------------------------

export interface RelationExpansionMeta {
  hop: 1 | 2;
  rel_type: string;
  via_id: string;
  weight: number;
}

export interface ExpandableHit {
  id: string;
  content: string;
  type: string;
  score: number;
  source_layer: "glossary" | "memory" | "longtail";
  source: string | null;
  backed: boolean;
  kind: "memory" | "longtail";
  relation?: RelationExpansionMeta;
  contradicted_by?: string[];
}

function otherEnd(edge: MemoryRelationRow, id: string): string | null {
  if (edge.src_id === id) return edge.dst_id;
  if (edge.dst_id === id) return edge.src_id;
  return null;
}

export async function expandRecallByRelations(
  env: Env,
  input: {
    namespace: string;
    seedHits: ExpandableHit[];
    topK: number;
  }
): Promise<ExpandableHit[]> {
  if (!isRelationExpansionEnabled(env)) {
    return input.seedHits;
  }

  const seeds = input.seedHits.filter((h) => h.source_layer === "memory");
  if (seeds.length === 0) return input.seedHits;

  const seedById = new Map(seeds.map((h) => [h.id, h]));
  const seedIds = [...seedById.keys()];
  const hop1Edges = await listRelationsForIds(env.DB, seedIds);

  // hop1 candidates
  type Candidate = {
    id: string;
    score: number;
    relation?: RelationExpansionMeta;
    contradictedBy: Set<string>;
  };
  const candidates = new Map<string, Candidate>();

  function bump(id: string, score: number, relation: RelationExpansionMeta | undefined, contradictedBySeed?: string) {
    if (seedById.has(id)) {
      // seed already present: only attach contradict markers, never change seed score via contradicts
      if (contradictedBySeed) {
        const existing = candidates.get(id) ?? {
          id,
          score: seedById.get(id)!.score,
          contradictedBy: new Set<string>()
        };
        existing.contradictedBy.add(contradictedBySeed);
        candidates.set(id, existing);
      }
      return;
    }
    const prev = candidates.get(id);
    const nextScore = prev ? Math.max(prev.score, score) : score;
    const contradictedBy = prev?.contradictedBy ?? new Set<string>();
    if (contradictedBySeed) contradictedBy.add(contradictedBySeed);
    candidates.set(id, {
      id,
      score: nextScore,
      relation: prev?.relation && prev.score >= nextScore ? prev.relation : relation,
      contradictedBy
    });
  }

  const hop1NeighborIds: string[] = [];
  for (const edge of hop1Edges) {
    for (const seedId of seedIds) {
      const neighbor = otherEnd(edge, seedId);
      if (!neighbor) continue;
      const seed = seedById.get(seedId);
      if (!seed) continue;
      const weight = typeof edge.weight === "number" ? edge.weight : 1;
      if (edge.rel_type === "contradicts") {
        // 不提升排序，只标记
        bump(neighbor, 0, undefined, seedId);
        bump(seedId, seed.score, undefined, neighbor);
        continue;
      }
      const hopScore = seed.score * 0.6 * weight;
      bump(neighbor, hopScore, {
        hop: 1,
        rel_type: edge.rel_type,
        via_id: seedId,
        weight
      });
      hop1NeighborIds.push(neighbor);
    }
  }

  // hop2 from hop1 neighbors (excluding seeds)
  const hop1Unique = [...new Set(hop1NeighborIds)].filter((id) => !seedById.has(id));
  if (hop1Unique.length > 0) {
    const hop2Edges = await listRelationsForIds(env.DB, hop1Unique);
    for (const edge of hop2Edges) {
      for (const midId of hop1Unique) {
        const neighbor = otherEnd(edge, midId);
        if (!neighbor || seedById.has(neighbor)) continue;
        const mid = candidates.get(midId);
        if (!mid || !mid.relation) continue;
        // hop2 score relative to original seed: seed × 0.36 × weight
        // recover seed score from mid.relation.via_id
        const seed = seedById.get(mid.relation.via_id);
        if (!seed) continue;
        const weight = typeof edge.weight === "number" ? edge.weight : 1;
        if (edge.rel_type === "contradicts") {
          bump(neighbor, 0, undefined, midId);
          continue;
        }
        const hopScore = seed.score * 0.36 * weight;
        bump(neighbor, hopScore, {
          hop: 2,
          rel_type: edge.rel_type,
          via_id: midId,
          weight
        });
      }
    }
  }

  // Fetch D1 rows for expansion candidates (not already seeds)
  const needFetch = [...candidates.keys()].filter((id) => !seedById.has(id));
  const fetched =
    needFetch.length > 0
      ? await fetchMemoriesByIds(env.DB, { namespace: input.namespace, ids: needFetch })
      : [];
  const rowById = new Map(fetched.map((r) => [r.id, r]));

  const expandedHits: ExpandableHit[] = [];

  // Seeds first (preserve score; attach contradict markers if any)
  for (const seed of input.seedHits) {
    const c = candidates.get(seed.id);
    const contradicted_by = c && c.contradictedBy.size > 0 ? [...c.contradictedBy] : undefined;
    expandedHits.push(contradicted_by ? { ...seed, contradicted_by } : { ...seed });
  }

  for (const [id, c] of candidates) {
    if (seedById.has(id)) continue;
    if (c.score <= 0 && c.contradictedBy.size === 0) continue;
    // Pure contradict markers without score don't inject as hits
    if (c.score <= 0) continue;
    const row = rowById.get(id);
    if (!row || !isRecallableMemory(row)) continue;
    expandedHits.push({
      id: row.id,
      content: row.content,
      type: row.type,
      score: c.score,
      source_layer: "memory",
      source: row.source ?? "relation_expansion",
      backed: true,
      kind: "memory",
      relation: c.relation,
      contradicted_by: c.contradictedBy.size > 0 ? [...c.contradictedBy] : undefined
    });
  }

  // Merge, sort by score, cap at topK (不得增加注入体积上限)
  expandedHits.sort((a, b) => b.score - a.score);
  return expandedHits.slice(0, input.topK);
}

// ---------------------------------------------------------------------------
// Dream relation-build phase
// ---------------------------------------------------------------------------

export interface RelationBuildStats {
  judged: number;
  inserted: number;
  ignored: number;
  truncated: boolean;
  skipped_reason?: string;
}

function readDreamModel(env: Env): string {
  return env.DREAM_MODEL || env.DAILY_DIGEST_MODEL || env.SUMMARY_MODEL || "workers-ai/@cf/openai/gpt-oss-120b";
}

function extractJsonArray(text: string): unknown[] {
  try {
    const parsed = JSON.parse(text) as unknown;
    if (Array.isArray(parsed)) return parsed;
    if (parsed && typeof parsed === "object" && Array.isArray((parsed as { relations?: unknown }).relations)) {
      return (parsed as { relations: unknown[] }).relations;
    }
  } catch {
    // fall through
  }
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start === -1 || end <= start) return [];
  try {
    const parsed = JSON.parse(text.slice(start, end + 1)) as unknown;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function judgeRelationsForPair(
  env: Env,
  input: { src: { id: string; content: string }; neighbors: Array<{ id: string; content: string }> }
): Promise<Array<{ dst_id: string; rel_type: MemoryRelType }>> {
  if (input.neighbors.length === 0) return [];
  const model = readDreamModel(env);
  const prompt = [
    "你是记忆关系判定器。给定一条源记忆和若干邻居记忆，判断是否存在关系。",
    "只输出 JSON 数组，不要 markdown。每项: {\"dst_id\":\"...\",\"rel_type\":\"...\"}",
    "rel_type 只允许: supports, contradicts, cause_effect, derived_from, same_thread, supersedes。",
    "没有关系就输出 []。不要发明 id。",
    "",
    `源记忆 id=${input.src.id}: ${input.src.content.slice(0, 400)}`,
    "",
    "邻居:",
    ...input.neighbors.map((n, i) => `${i + 1}. id=${n.id}: ${n.content.slice(0, 300)}`)
  ].join("\n");

  const body: OpenAIChatRequest = {
    model,
    messages: [
      { role: "system", content: "Output JSON only." },
      { role: "user", content: prompt }
    ],
    temperature: 0,
    max_tokens: 600
  };

  try {
    const response = await callOpenAICompat(env, body);
    if (!response.ok) return [];
    const json = (await response.json()) as OpenAIChatResponse;
    const text = json.choices?.[0]?.message?.content;
    const content = typeof text === "string" ? text : "";
    if (!content) return [];
    const arr = extractJsonArray(content);
    const out: Array<{ dst_id: string; rel_type: MemoryRelType }> = [];
    const allowedIds = new Set(input.neighbors.map((n) => n.id));
    for (const item of arr) {
      if (!item || typeof item !== "object" || Array.isArray(item)) continue;
      const rec = item as Record<string, unknown>;
      const dst = typeof rec.dst_id === "string" ? rec.dst_id : "";
      const rel = typeof rec.rel_type === "string" ? rec.rel_type.trim() : "";
      if (!dst || !allowedIds.has(dst)) continue;
      if (!isMemoryRelType(rel)) continue;
      out.push({ dst_id: dst, rel_type: rel });
    }
    return out;
  } catch (error) {
    console.warn("relation judge failed", error);
    return [];
  }
}

async function vectorNeighbors(
  env: Env,
  input: { namespace: string; content: string; excludeId: string; topK: number }
): Promise<Array<{ id: string; content: string; score: number }>> {
  if (!env.VECTORIZE) return [];
  const vector = await createEmbedding(env, input.content);
  if (!vector) return [];
  try {
    const result = await env.VECTORIZE.query(vector, {
      topK: input.topK + 4,
      namespace: input.namespace,
      returnMetadata: true,
      filter: { namespace: input.namespace, kind: "memory" } as VectorizeVectorMetadataFilter
    } as unknown as Parameters<typeof env.VECTORIZE.query>[1]);
    const matches = (result?.matches ?? []) as Array<{
      id: string;
      score: number;
      metadata?: Record<string, unknown>;
    }>;
    // Preserve first-seen score per id so callers (z_audit) can reuse without a second embed/query.
    const scoreById = new Map<string, number>();
    const ids: string[] = [];
    for (const m of matches) {
      const ref = m.metadata?.ref_id;
      const id = typeof ref === "string" && ref.trim() ? ref.trim() : m.id.replace(/^mem_/, "");
      if (!id || id === input.excludeId) continue;
      if (scoreById.has(id)) continue;
      scoreById.set(id, m.score);
      ids.push(id);
    }
    if (ids.length === 0) return [];
    const rows = await fetchMemoriesByIds(env.DB, { namespace: input.namespace, ids });
    return rows
      .filter((r) => isRecallableMemory(r))
      .slice(0, input.topK)
      .map((r) => ({ id: r.id, content: r.content, score: scoreById.get(r.id) ?? 0 }));
  } catch (error) {
    console.error("relation vectorNeighbors failed", error);
    return [];
  }
}

export async function runRelationBuildPhase(
  env: Env,
  input: { namespace: string; startIso: string; endIso: string }
): Promise<RelationBuildStats> {
  if (!env.VECTORIZE) {
    return { judged: 0, inserted: 0, ignored: 0, truncated: false, skipped_reason: "no_vectorize" };
  }

  const seeds = await listMemoriesUpdatedInRange(env.DB, {
    namespace: input.namespace,
    startIso: input.startIso,
    endIso: input.endIso,
    limit: RELATION_JUDGE_LIMIT
  });

  let judged = 0;
  let inserted = 0;
  let ignored = 0;
  let truncated = false;

  for (const seed of seeds) {
    // Cap is enforced only at top of loop; judged never exceeds RELATION_JUDGE_LIMIT.
    if (judged >= RELATION_JUDGE_LIMIT) {
      truncated = true;
      break;
    }
    const neighbors = await vectorNeighbors(env, {
      namespace: input.namespace,
      content: seed.content,
      excludeId: seed.id,
      topK: NEIGHBOR_TOP_K
    });
    if (neighbors.length === 0) continue;

    judged += 1;

    const judgments = await judgeRelationsForPair(env, {
      src: { id: seed.id, content: seed.content },
      neighbors
    });

    for (const j of judgments) {
      const weight = SAFE_REL_TYPES.has(j.rel_type) ? 1.0 : defaultRelationWeight(j.rel_type);
      const result = await insertMemoryRelation(env.DB, {
        srcId: seed.id,
        dstId: j.dst_id,
        relType: j.rel_type,
        weight,
        createdBy: "dream"
      });
      if (result === "inserted") inserted += 1;
      else if (result === "ignored") ignored += 1;
    }
  }

  if (truncated) {
    console.warn("dream relation-build truncated at judge cap", {
      namespace: input.namespace,
      cap: RELATION_JUDGE_LIMIT,
      judged,
      seedCount: seeds.length
    });
  }

  return { judged, inserted, ignored, truncated };
}

// ---------------------------------------------------------------------------
// Z 轴 z_audit: 同 fact_key 或高相似且语义冲突 → under_review + contradicts，永不 auto-supersede
// ---------------------------------------------------------------------------

export interface ZAuditPair {
  left_id: string;
  right_id: string;
  fact_key?: string | null;
  reason: string;
}

export interface ZAuditStats {
  pairs: ZAuditPair[];
  marked_under_review: number;
  edges_inserted: number;
}

const SIMILARITY_CONFLICT_MIN = 0.88;

/**
 * LLM judgment: high vector similarity alone is not conflict.
 * Spec requires "高相似且语义冲突" — only mark under_review + contradicts when the model
 * confirms a genuine contradiction. On LLM failure, return false (prefer miss over false positive).
 */
async function judgeSemanticConflict(
  env: Env,
  left: { id: string; content: string },
  right: { id: string; content: string }
): Promise<boolean> {
  const model = readDreamModel(env);
  const prompt = [
    "你是记忆冲突审核器。判断两条记忆是否语义矛盾（不能同时为真）。",
    "高相似或同主题不等于冲突；只有事实对立才算 contradicts。",
    '只输出 JSON 对象，不要 markdown：{"contradicts": true} 或 {"contradicts": false}',
    "",
    `A id=${left.id}: ${left.content.slice(0, 400)}`,
    `B id=${right.id}: ${right.content.slice(0, 400)}`
  ].join("\n");

  const body: OpenAIChatRequest = {
    model,
    messages: [
      { role: "system", content: "Output JSON only." },
      { role: "user", content: prompt }
    ],
    temperature: 0,
    max_tokens: 80
  };

  try {
    const response = await callOpenAICompat(env, body);
    if (!response.ok) return false;
    const json = (await response.json()) as OpenAIChatResponse;
    const text = json.choices?.[0]?.message?.content;
    const content = typeof text === "string" ? text.trim() : "";
    if (!content) return false;
    // Accept raw object or fenced/embedded JSON
    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch {
      const start = content.indexOf("{");
      const end = content.lastIndexOf("}");
      if (start === -1 || end <= start) return false;
      try {
        parsed = JSON.parse(content.slice(start, end + 1));
      } catch {
        return false;
      }
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return false;
    return (parsed as { contradicts?: unknown }).contradicts === true;
  } catch (error) {
    console.warn("z_audit contradiction judge failed", error);
    return false;
  }
}

export async function runZAuditPhase(
  env: Env,
  input: { namespace: string; startIso: string; endIso: string }
): Promise<ZAuditStats> {
  const pairs: ZAuditPair[] = [];
  let marked = 0;
  let edges = 0;

  // 1) same fact_key multi current — multi-current same key is itself the conflict signal
  //    (spec OR branch: 同 fact_key …). No LLM needed.
  //
  // Edge policy for groups with >2 ids (ids ordered updated_at DESC, so ids[0] is newest):
  //   Create contradicts edges from each older id → newest (N-1 edges), not full pairwise.
  //   Rationale: review queue is "which current versions conflict with the latest claim";
  //   N-1 edges scale better than N*(N-1)/2 and still cover every non-newest member.
  //   All ids in the group are marked under_review.
  const groups = await listDuplicateFactKeyGroups(env.DB, { namespace: input.namespace, limit: 40 });
  for (const group of groups) {
    if (group.ids.length < 2) continue;
    const newest = group.ids[0]!;
    const older = group.ids.slice(1);

    marked += await markMemoriesUnderReview(env.DB, {
      namespace: input.namespace,
      ids: group.ids,
      reason: `z_audit:duplicate_fact_key:${group.fact_key}`
    });

    for (const olderId of older) {
      pairs.push({
        left_id: olderId,
        right_id: newest,
        fact_key: group.fact_key,
        reason: `duplicate_fact_key:${group.fact_key}`
      });
      const edge = await insertMemoryRelation(env.DB, {
        srcId: olderId,
        dstId: newest,
        relType: "contradicts",
        weight: 0.5,
        createdBy: "dream"
      });
      if (edge === "inserted") edges += 1;
    }
  }

  // 2) high-similarity + LLM-confirmed semantic conflict among today's updates
  const recent = await listMemoriesUpdatedInRange(env.DB, {
    namespace: input.namespace,
    startIso: input.startIso,
    endIso: input.endIso,
    limit: 40
  });

  if (env.VECTORIZE && recent.length > 1) {
    const seenPair = new Set(pairs.map((p) => [p.left_id, p.right_id].sort().join("|")));
    for (const seed of recent.slice(0, 20)) {
      // Single embed + single vector query + D1 fetch; reuse scores (no second pass).
      let neighbors: Array<{ id: string; content: string; score: number }>;
      try {
        neighbors = await vectorNeighbors(env, {
          namespace: input.namespace,
          content: seed.content,
          excludeId: seed.id,
          topK: 3
        });
      } catch (error) {
        console.warn("z_audit similarity probe failed", error);
        continue;
      }

      for (const neighbor of neighbors) {
        if (neighbor.score < SIMILARITY_CONFLICT_MIN) continue;
        const key = [seed.id, neighbor.id].sort().join("|");
        if (seenPair.has(key)) continue;

        // Spec: 高相似且语义冲突 — similarity is necessary but not sufficient.
        const contradicts = await judgeSemanticConflict(
          env,
          { id: seed.id, content: seed.content },
          { id: neighbor.id, content: neighbor.content }
        );
        if (!contradicts) continue;

        seenPair.add(key);
        pairs.push({
          left_id: seed.id,
          right_id: neighbor.id,
          reason: `high_similarity_conflict:${neighbor.score.toFixed(3)}`
        });
        marked += await markMemoriesUnderReview(env.DB, {
          namespace: input.namespace,
          ids: [seed.id, neighbor.id],
          reason: `z_audit:high_similarity_conflict`
        });
        const edge = await insertMemoryRelation(env.DB, {
          srcId: seed.id,
          dstId: neighbor.id,
          relType: "contradicts",
          weight: 0.5,
          createdBy: "dream"
        });
        if (edge === "inserted") edges += 1;
      }
    }
  }

  // 永不 auto-supersede — 只入队 under_review + contradicts
  return { pairs, marked_under_review: marked, edges_inserted: edges };
}
