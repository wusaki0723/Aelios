import type {
  MemoryRelType,
  MemoryRelationRow
} from "../../types";
import { nowIso } from "../../utils/time";
import { SQLITE_BIND_BATCH_SIZE, uniqueStrings } from "./shared";

export const MEMORY_REL_TYPES: readonly MemoryRelType[] = [
  "supports",
  "contradicts",
  "cause_effect",
  "derived_from",
  "same_thread",
  "supersedes"
] as const;

export function isMemoryRelType(value: string): value is MemoryRelType {
  return (MEMORY_REL_TYPES as readonly string[]).includes(value);
}

// Relation weight policy (SPEC-LMC5 Y 轴 + LMC-5 extension):
// - Spec names same_thread/derived_from as safe (1.0) and contradicts/cause_effect as semantic (0.5).
// - supports/supersedes are not classified in the spec; we treat them as safe/full-weight (1.0):
//   supports affirms without conflict risk; supersedes is an explicit version-chain edge written
//   on confirmed supersede, not a soft semantic guess. Documented deviation from the two-bucket
//   wording only — not a silent weight change.
export function defaultRelationWeight(relType: MemoryRelType): number {
  if (relType === "same_thread" || relType === "derived_from" || relType === "supports" || relType === "supersedes") {
    return 1.0;
  }
  // contradicts, cause_effect
  return 0.5;
}

// listRelationsForIds binds each id twice (src IN (...) OR dst IN (...)).
// 45 * 2 = 90 binds, same headroom as SQLITE_BIND_BATCH_SIZE.
const SQLITE_DOUBLE_BIND_BATCH_SIZE = Math.floor(SQLITE_BIND_BATCH_SIZE / 2);

// =====================================================================
// LMC-5 Y 轴: memory_relations
// 写入有向边；查询双向 (src OR dst)。UNIQUE(src,dst,rel_type) 幂等。
// =====================================================================

export async function insertMemoryRelation(
  db: D1Database,
  input: {
    srcId: string;
    dstId: string;
    relType: MemoryRelType | string;
    weight?: number;
    createdBy?: string | null;
  }
): Promise<"inserted" | "ignored" | "invalid"> {
  if (!isMemoryRelType(input.relType)) return "invalid";
  if (!input.srcId || !input.dstId || input.srcId === input.dstId) return "invalid";
  const weight =
    typeof input.weight === "number" && Number.isFinite(input.weight)
      ? input.weight
      : defaultRelationWeight(input.relType);
  const now = nowIso();
  try {
    const r = await db
      .prepare(
        `INSERT OR IGNORE INTO memory_relations (src_id, dst_id, rel_type, weight, created_by, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .bind(input.srcId, input.dstId, input.relType, weight, input.createdBy ?? "dream", now)
      .run();
    return (r.meta?.changes ?? 0) > 0 ? "inserted" : "ignored";
  } catch (error) {
    console.error("insertMemoryRelation failed", { input, error });
    return "invalid";
  }
}

// 双向查邻居边：seed id 出现在 src 或 dst 的所有边。
// Batch size accounts for double-bind (src IN + dst IN) so total binds stay ≤ D1's 100 limit.
export async function listRelationsForIds(
  db: D1Database,
  memoryIds: string[]
): Promise<MemoryRelationRow[]> {
  const ids = uniqueStrings(memoryIds);
  if (ids.length === 0) return [];
  const rows: MemoryRelationRow[] = [];
  for (let index = 0; index < ids.length; index += SQLITE_DOUBLE_BIND_BATCH_SIZE) {
    const batch = ids.slice(index, index + SQLITE_DOUBLE_BIND_BATCH_SIZE);
    const placeholders = batch.map(() => "?").join(", ");
    // 同一批 id 用于 src 与 dst 两个 IN 子句（binds = 2 × batch.length）
    const result = await db
      .prepare(
        `SELECT id, src_id, dst_id, rel_type, weight, created_by, created_at
         FROM memory_relations
         WHERE src_id IN (${placeholders}) OR dst_id IN (${placeholders})`
      )
      .bind(...batch, ...batch)
      .all<MemoryRelationRow>();
    rows.push(...(result.results ?? []));
  }
  // 去重 (同一边可能因多个 seed 被拉两次)
  const seen = new Set<number>();
  return rows.filter((row) => {
    if (seen.has(row.id)) return false;
    seen.add(row.id);
    return true;
  });
}

// =====================================================================
// 记忆星图：GET /api/relations/graph 数据层
// 选取：有边端点优先入选，再按 importance desc + created_at desc 补齐到 limit。
// =====================================================================

export interface RelationGraphNode {
  id: string;
  label: string;
  type: string;
  importance: number;
  pinned: boolean;
  version_status: string | null;
  created_at: string;
}

export interface RelationGraphEdge {
  src: string;
  dst: string;
  rel_type: string;
  weight: number;
}

export interface RelationGraphResult {
  nodes: RelationGraphNode[];
  edges: RelationGraphEdge[];
  meta: {
    total_nodes: number;
    total_edges: number;
    truncated: boolean;
  };
}

interface GraphMemoryRow {
  id: string;
  type: string;
  content: string;
  summary: string | null;
  importance: number;
  pinned: number;
  version_status: string | null;
  created_at: string;
}

function graphNodeLabel(row: { summary: string | null; content: string }): string {
  const summary = (row.summary ?? "").trim();
  if (summary) return summary;
  const content = (row.content ?? "").trim();
  return content.length > 60 ? content.slice(0, 60) : content;
}

function compareGraphImportance(a: GraphMemoryRow, b: GraphMemoryRow): number {
  if (b.importance !== a.importance) return b.importance - a.importance;
  return b.created_at < a.created_at ? -1 : b.created_at > a.created_at ? 1 : 0;
}

// namespace 占 1 个 bind，id 批大小 ≤ 90 以遵守 D1 100 绑定上限。
const GRAPH_ID_BIND_BATCH_SIZE = SQLITE_BIND_BATCH_SIZE;

async function fetchActiveGraphMemoriesByIds(
  db: D1Database,
  namespace: string,
  memoryIds: string[]
): Promise<GraphMemoryRow[]> {
  const ids = uniqueStrings(memoryIds);
  if (ids.length === 0) return [];
  const rows: GraphMemoryRow[] = [];
  for (let index = 0; index < ids.length; index += GRAPH_ID_BIND_BATCH_SIZE) {
    const batch = ids.slice(index, index + GRAPH_ID_BIND_BATCH_SIZE);
    const placeholders = batch.map(() => "?").join(", ");
    const result = await db
      .prepare(
        `SELECT id, type, content, summary, importance, pinned, version_status, created_at
         FROM memories
         WHERE namespace = ?
           AND status = 'active'
           AND id IN (${placeholders})`
      )
      .bind(namespace, ...batch)
      .all<GraphMemoryRow>();
    rows.push(...(result.results ?? []));
  }
  return rows;
}

export async function getRelationsGraph(
  db: D1Database,
  input: { namespace: string; limit?: number }
): Promise<RelationGraphResult> {
  const limit = Math.min(Math.max(Math.floor(input.limit ?? 400), 1), 800);
  const namespace = input.namespace;

  const totalRow = await db
    .prepare(`SELECT COUNT(*) AS count FROM memories WHERE namespace = ? AND status = 'active'`)
    .bind(namespace)
    .first<{ count: number }>();
  const totalNodes = Number(totalRow?.count ?? 0);

  // 两端都在本 namespace active 记忆上的边（边表本身无 namespace 列）
  const edgeResult = await db
    .prepare(
      `SELECT r.src_id AS src_id, r.dst_id AS dst_id, r.rel_type AS rel_type, r.weight AS weight
       FROM memory_relations r
       INNER JOIN memories s ON s.id = r.src_id AND s.namespace = ? AND s.status = 'active'
       INNER JOIN memories d ON d.id = r.dst_id AND d.namespace = ? AND d.status = 'active'`
    )
    .bind(namespace, namespace)
    .all<{ src_id: string; dst_id: string; rel_type: string; weight: number }>();
  const allEdges = edgeResult.results ?? [];
  const totalEdges = allEdges.length;

  const connectedIds = new Set<string>();
  for (const edge of allEdges) {
    connectedIds.add(edge.src_id);
    connectedIds.add(edge.dst_id);
  }

  const [connectedRows, topRows] = await Promise.all([
    fetchActiveGraphMemoriesByIds(db, namespace, [...connectedIds]),
    db
      .prepare(
        `SELECT id, type, content, summary, importance, pinned, version_status, created_at
         FROM memories
         WHERE namespace = ? AND status = 'active'
         ORDER BY importance DESC, created_at DESC
         LIMIT ?`
      )
      .bind(namespace, limit)
      .all<GraphMemoryRow>()
      .then((r) => r.results ?? [])
  ]);

  const connectedSorted = [...connectedRows].sort(compareGraphImportance);
  const selected: GraphMemoryRow[] = [];
  const selectedIds = new Set<string>();

  // 1) 有边连着的记忆优先入选（按 importance 截断到 limit）
  for (const row of connectedSorted) {
    if (selected.length >= limit) break;
    selected.push(row);
    selectedIds.add(row.id);
  }
  // 2) 再补高 importance 的 active 记忆
  for (const row of topRows) {
    if (selected.length >= limit) break;
    if (selectedIds.has(row.id)) continue;
    selected.push(row);
    selectedIds.add(row.id);
  }

  const nodes: RelationGraphNode[] = selected.map((row) => ({
    id: row.id,
    label: graphNodeLabel(row),
    type: row.type,
    importance: row.importance,
    pinned: Boolean(row.pinned),
    version_status: row.version_status ?? null,
    created_at: row.created_at
  }));

  const edges: RelationGraphEdge[] = allEdges
    .filter((edge) => selectedIds.has(edge.src_id) && selectedIds.has(edge.dst_id))
    .map((edge) => ({
      src: edge.src_id,
      dst: edge.dst_id,
      rel_type: edge.rel_type,
      weight: edge.weight
    }));

  return {
    nodes,
    edges,
    meta: {
      total_nodes: totalNodes,
      total_edges: totalEdges,
      truncated: nodes.length < totalNodes
    }
  };
}
