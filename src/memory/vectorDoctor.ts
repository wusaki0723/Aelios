// 向量医生 (vector doctor)：清点 Vectorize 和 D1 的一致性，把 v1 残留/孤儿向量找出来，
// 可选一键清掉，让召回质量可测。
//
// 背景：生产 Vectorize 索引里混着 v1 时代的垃圾——曾经的 P1 bug 让删除操作只删了 D1
// 没删向量 (stale)，还有压根没有对应 D1 行的向量 (orphan)，以及指向非 active D1 行
// 的向量 (superseded/archived/deleted)。这些残留会在 recall 里冒出来当"合法"结果，
// 让召回质量测试没法做。
//
// 枚举方式复用 vectorStore.ts 的两阶段做法：
//   Phase 1 — listVectorIdsViaApi（Vectorize REST /list + cursor 分页）全量枚举 ID，
//             无 query-topK 天花板；/list 不按 namespace 过滤。
//   Phase 2 — getByIds（每批 ≤20，平台硬上限）分批拿完整 metadata，再按
//             metadata.namespace === input.namespace 过滤后进分类。
// 不发明新的枚举方式，避免两处实现漂移。
//
// 分类三类 (以 metadata.ref_id 去查 D1)：
//   backed_active   —— D1 记录存在，memories.status = 'active'（或 longtail 记录存在，
//                       longtail 没有 status 概念，存在即算 active）。
//   backed_inactive —— D1 记录存在，但 status 不是 active（superseded/archived/deleted/...）。
//   orphan          —— D1 里完全找不到这条记录 (v1 残留 / 历史 bug 遗留 / 手工删过 D1 忘了删向量)。
//
// cleanup=true 时只从 Vectorize 删 backed_inactive + orphan，绝不碰 D1——D1 永远是本体。

import type { Env } from "../types";
import { RETENTION_BATCH_SIZE } from "../db/retention";
import { listVectorIdsViaApi } from "./vectorStore";

// Vectorize getByIds platform hard cap (code 40007) — do not raise.
const GETBYIDS_BATCH = 20;
const LIST_PAGE_SIZE = 1000;
// D1 单条语句绑定变量上限，IN (...) 批量查询保持在这个数以下 (跟 db/v2.ts 的
// SQLITE_BIND_BATCH_SIZE 同一个理由：留出余量，别顶到 D1 的硬限制)。
const D1_LOOKUP_BATCH = 90;

export type VectorDoctorClass = "backed_active" | "backed_inactive" | "orphan";

export interface VectorDoctorSample {
  vector_id: string;
  ref_id: string | null;
  type: string;
  content_preview: string;
}

export interface VectorDoctorCleanupFailure {
  vector_id: string;
  error: string;
}

export interface VectorDoctorCleanupResult {
  requested: boolean;
  deleted_count: number;
  failed_count: number;
  failed: VectorDoctorCleanupFailure[];
}

export interface VectorDoctorReport {
  namespace: string;
  scanned_at: string;
  limit: number;
  total_vectors_scanned: number;
  counts: Record<VectorDoctorClass, number>;
  samples: Record<VectorDoctorClass, VectorDoctorSample[]>;
  cleanup?: VectorDoctorCleanupResult;
  errors: string[];
}

export interface VectorDoctorInput {
  namespace: string;
  cleanup?: boolean;
  limit?: number;
}

const SAMPLE_CAP = 50;
// Default generous enough to cover ~1000-vector namespaces in one pass.
const DEFAULT_LIMIT = 1000;
const MAX_LIMIT = 5000;

function getIndexName(env: Env): string {
  return env.VECTORIZE_INDEX_NAME?.trim() || "memo-kb";
}

function clampLimit(value: number | undefined): number {
  if (!Number.isFinite(value)) return DEFAULT_LIMIT;
  return Math.min(Math.max(Math.floor(value as number), 1), MAX_LIMIT);
}

function readMetaString(metadata: Record<string, unknown>, field: string): string | null {
  const value = metadata[field];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readMetaContentPreview(metadata: Record<string, unknown>): string {
  const fields = ["content", "text", "memory", "summary", "document", "chunk", "value", "title"];
  for (const field of fields) {
    const value = metadata[field];
    if (typeof value === "string" && value.trim()) return value.trim().slice(0, 80);
  }
  return "";
}

// Same fallback the rest of the codebase uses when metadata.ref_id is absent
// (v1-era vectors that predate the ref_id field): strip the "mem_" vector-id
// prefix to recover the D1 memory id. See vectorMetadataToMemoryRecord in
// vectorStore.ts for the canonical version of this fallback.
function deriveRefId(vectorId: string, metadata: Record<string, unknown>): string | null {
  const explicit = readMetaString(metadata, "ref_id");
  if (explicit) return explicit;
  if (vectorId.startsWith("mem_")) return vectorId.slice("mem_".length);
  if (vectorId.startsWith("lt_")) return vectorId.slice("lt_".length);
  return null;
}

interface EnumeratedVector {
  vectorId: string;
  namespace: string;
  kind: "memory" | "longtail";
  refId: string | null;
  type: string;
  contentPreview: string;
}

async function enumerateNamespaceVectors(
  env: Env,
  input: { namespace: string; limit: number }
): Promise<{ vectors: EnumeratedVector[]; errors: string[] }> {
  const errors: string[] = [];
  if (!env.VECTORIZE) {
    return { vectors: [], errors: ["missing_vectorize_binding"] };
  }

  // --- Phase 1: paginated full-index ID discovery via /list ---
  let phase1Ids: string[] = [];
  try {
    let cursor: string | undefined;
    let hasMore = true;
    while (hasMore && phase1Ids.length < input.limit) {
      const remaining = input.limit - phase1Ids.length;
      const page = await listVectorIdsViaApi(env, {
        count: Math.min(LIST_PAGE_SIZE, remaining),
        cursor
      });
      if (page.ids.length === 0) break;
      phase1Ids.push(...page.ids);
      cursor = page.cursor ?? undefined;
      hasMore = page.hasMore && Boolean(cursor);
    }
  } catch (err) {
    errors.push(`phase1_list_failed: ${err instanceof Error ? err.message : String(err)}`);
    return { vectors: [], errors };
  }

  if (phase1Ids.length === 0) return { vectors: [], errors };

  // --- Phase 2: fetch full metadata (incl content) via getByIds in batches ---
  const vectors: EnumeratedVector[] = [];
  for (let i = 0; i < phase1Ids.length; i += GETBYIDS_BATCH) {
    const batch = phase1Ids.slice(i, i + GETBYIDS_BATCH);
    try {
      const fetched = await env.VECTORIZE.getByIds(batch);
      for (const v of fetched) {
        const metadata = (v.metadata || {}) as Record<string, unknown>;
        const metaNamespace = readMetaString(metadata, "namespace");
        if (metaNamespace !== input.namespace) continue;
        const kindRaw = readMetaString(metadata, "kind");
        const kind: "memory" | "longtail" = kindRaw === "longtail" ? "longtail" : "memory";
        vectors.push({
          vectorId: v.id,
          namespace: metaNamespace,
          kind,
          refId: deriveRefId(v.id, metadata),
          type: readMetaString(metadata, "type") || (kind === "longtail" ? "longtail" : "note"),
          contentPreview: readMetaContentPreview(metadata)
        });
      }
    } catch (err) {
      errors.push(`phase2_getbyids_failed: ${err instanceof Error ? err.message : String(err)}`);
      // Partial result — keep what we already collected and stop enumerating further.
      break;
    }
  }

  return { vectors, errors };
}

async function lookupMemoryStatuses(
  db: D1Database,
  namespace: string,
  ids: string[]
): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter(Boolean))];
  const statusById = new Map<string, string>();

  for (let i = 0; i < unique.length; i += D1_LOOKUP_BATCH) {
    const batch = unique.slice(i, i + D1_LOOKUP_BATCH);
    const placeholders = batch.map(() => "?").join(", ");
    const result = await db
      .prepare(`SELECT id, status FROM memories WHERE namespace = ? AND id IN (${placeholders})`)
      .bind(namespace, ...batch)
      .all<{ id: string; status: string }>();
    for (const row of result.results ?? []) {
      statusById.set(row.id, row.status);
    }
  }

  return statusById;
}

async function lookupLongtailExistence(
  db: D1Database,
  namespace: string,
  ids: string[]
): Promise<Set<string>> {
  const unique = [...new Set(ids.filter(Boolean))];
  const existing = new Set<string>();

  for (let i = 0; i < unique.length; i += D1_LOOKUP_BATCH) {
    const batch = unique.slice(i, i + D1_LOOKUP_BATCH);
    const placeholders = batch.map(() => "?").join(", ");
    const result = await db
      .prepare(`SELECT id FROM longtail WHERE namespace = ? AND id IN (${placeholders})`)
      .bind(namespace, ...batch)
      .all<{ id: string }>();
    for (const row of result.results ?? []) {
      existing.add(row.id);
    }
  }

  return existing;
}

async function deleteVectorsBatched(
  vectorize: NonNullable<Env["VECTORIZE"]>,
  vectorIds: string[]
): Promise<VectorDoctorCleanupResult> {
  let deleted = 0;
  const failed: VectorDoctorCleanupFailure[] = [];

  for (let i = 0; i < vectorIds.length; i += RETENTION_BATCH_SIZE) {
    const batch = vectorIds.slice(i, i + RETENTION_BATCH_SIZE);
    try {
      await vectorize.deleteByIds(batch);
      deleted += batch.length;
    } catch (err) {
      // Vectorize deleteByIds doesn't report per-item failures — attribute the
      // batch error to every vector in it and keep going with the next batch.
      const message = err instanceof Error ? err.message : String(err);
      for (const id of batch) failed.push({ vector_id: id, error: message });
    }
  }

  return { requested: true, deleted_count: deleted, failed_count: failed.length, failed };
}

export async function runVectorDoctor(env: Env, input: VectorDoctorInput): Promise<VectorDoctorReport> {
  const namespace = input.namespace;
  const limit = clampLimit(input.limit);
  const cleanupRequested = input.cleanup === true;

  const { vectors, errors } = await enumerateNamespaceVectors(env, { namespace, limit });

  const memoryRefIds = vectors.filter((v) => v.kind === "memory" && v.refId).map((v) => v.refId as string);
  const longtailRefIds = vectors.filter((v) => v.kind === "longtail" && v.refId).map((v) => v.refId as string);

  const [statusById, longtailExisting] = await Promise.all([
    lookupMemoryStatuses(env.DB, namespace, memoryRefIds),
    lookupLongtailExistence(env.DB, namespace, longtailRefIds)
  ]);

  const counts: Record<VectorDoctorClass, number> = { backed_active: 0, backed_inactive: 0, orphan: 0 };
  const samples: Record<VectorDoctorClass, VectorDoctorSample[]> = {
    backed_active: [],
    backed_inactive: [],
    orphan: []
  };
  const cleanupTargets: string[] = [];

  for (const vector of vectors) {
    let cls: VectorDoctorClass;

    if (vector.kind === "longtail") {
      cls = vector.refId && longtailExisting.has(vector.refId) ? "backed_active" : "orphan";
    } else {
      const status = vector.refId ? statusById.get(vector.refId) : undefined;
      if (status === undefined) cls = "orphan";
      else cls = status === "active" ? "backed_active" : "backed_inactive";
    }

    counts[cls] += 1;
    if (samples[cls].length < SAMPLE_CAP) {
      samples[cls].push({
        vector_id: vector.vectorId,
        ref_id: vector.refId,
        type: vector.type,
        content_preview: vector.contentPreview
      });
    }
    if (cls !== "backed_active") cleanupTargets.push(vector.vectorId);
  }

  const report: VectorDoctorReport = {
    namespace,
    scanned_at: new Date().toISOString(),
    limit,
    total_vectors_scanned: vectors.length,
    counts,
    samples,
    errors
  };

  if (cleanupRequested) {
    if (!env.VECTORIZE) {
      report.cleanup = { requested: true, deleted_count: 0, failed_count: 0, failed: [] };
      report.errors.push("cleanup_skipped_missing_vectorize_binding");
    } else if (cleanupTargets.length === 0) {
      report.cleanup = { requested: true, deleted_count: 0, failed_count: 0, failed: [] };
    } else {
      report.cleanup = await deleteVectorsBatched(env.VECTORIZE, cleanupTargets);
    }
  }

  return report;
}
