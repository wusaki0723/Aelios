// 向量补齐 (vector backfill)：从 D1 这一侧出发，找出"有记忆没向量"的 active 记忆并补上。
//
// 背景：vector_reindex 和 vector_doctor 都从 Vectorize 那一侧枚举 (listVectorIdsViaApi)，
// 只能发现"有向量没记忆"，发现不了反方向。直接写 D1 的记忆 (手工 SQL、迁移、
// embedding 当时失败被 syncMemoryVector 吞掉的错误) 会在 D1 和 FTS 里齐全，
// 但 Vectorize 里没有向量，语义召回永远召不到，关键词召回又照常，所以没人会发现。
//
// 做法：
//   1. D1 列出 namespace 下全部 active 记忆 (id / vector_id / 参与 embedding 的字段)。
//   2. 按 vector_id 分批 getByIds (≤20，平台硬上限) 问 Vectorize 有没有。
//      不走 listVectorIdsViaApi，所以只要 VECTORIZE binding，不要 CF API token。
//   3. 分类：
//        ok       —— 向量在，metadata 跟 D1 对得上。
//        missing  —— 向量不在。
//        stale    —— 向量在，但 content / type / tags / status 跟 D1 不一致
//                    (更新时 embedding 失败留下的旧向量，召回会拿到旧内容)。
//        no_vector_id —— D1 行没有 vector_id，只报告不修 (修要写 D1，这里不碰本体)。
//   4. dry_run=false 时对 missing + stale 调 upsertMemoryEmbedding，跟正常写入路径同一个函数，
//      向量 id 和 metadata 形状不会漂移。每次最多修 limit 条，剩下的在 remaining 里报出来。
//
// getByIds 某一批失败时，这一批既不算 ok 也不算 missing (记进 unchecked)，
// 避免一次 Vectorize 抖动就把整库重新 embed 一遍。
// Vectorize 写入是异步生效的，刚补完立刻再查可能还显示 missing，重复 upsert 是幂等的，无害。

import type { Env, MemoryRecord } from "../types";
import { upsertMemoryEmbedding } from "./embedding";

// Vectorize getByIds platform hard cap (code 40007) — do not raise.
const GETBYIDS_BATCH = 20;
const SAMPLE_CAP = 50;
const DEFAULT_REPAIR_LIMIT = 20;
const MAX_REPAIR_LIMIT = 200;
const MAX_SCAN = 5000;

export type VectorBackfillClass = "ok" | "missing" | "stale" | "no_vector_id";

export interface VectorBackfillSample {
  id: string;
  vector_id: string | null;
  type: string;
  content_preview: string;
  reason?: string;
}

export interface VectorBackfillRepairFailure {
  id: string;
  error: string;
}

export interface VectorBackfillRepairResult {
  attempted: number;
  repaired: number;
  failed_count: number;
  failed: VectorBackfillRepairFailure[];
  remaining: number;
}

export interface VectorBackfillReport {
  namespace: string;
  scanned_at: string;
  dry_run: boolean;
  limit: number;
  active_memories: number;
  unchecked: number;
  counts: Record<VectorBackfillClass, number>;
  samples: Record<Exclude<VectorBackfillClass, "ok">, VectorBackfillSample[]>;
  repair?: VectorBackfillRepairResult;
  errors: string[];
}

export interface VectorBackfillInput {
  namespace: string;
  dryRun?: boolean;
  limit?: number;
}

function clampLimit(value: number | undefined): number {
  if (!Number.isFinite(value)) return DEFAULT_REPAIR_LIMIT;
  return Math.min(Math.max(Math.floor(value as number), 1), MAX_REPAIR_LIMIT);
}

function readMetaString(metadata: Record<string, unknown>, field: string): string | null {
  const value = metadata[field];
  return typeof value === "string" ? value : null;
}

// 只比参与 embedding 文本 (type + tags + content) 和召回过滤 (status) 的字段；
// importance / updated_at 之类漂了不影响召回，不值得为它重新 embed。
// tags 两边都是 JSON 字符串，解析后再比，免得空格/空值写法不同被误判。
// status 缺省按 active，跟 vectorMetadataToMemoryRecord 的召回口径一致。
function normalizeTags(raw: string | null): string {
  try {
    const parsed = JSON.parse(raw || "[]") as unknown;
    return JSON.stringify(Array.isArray(parsed) ? parsed : []);
  } catch {
    return raw ?? "";
  }
}

function staleReason(memory: MemoryRecord, metadata: Record<string, unknown>): string | null {
  if (readMetaString(metadata, "content") !== memory.content) return "content";
  if (readMetaString(metadata, "type") !== memory.type) return "type";
  if (normalizeTags(readMetaString(metadata, "tags")) !== normalizeTags(memory.tags)) return "tags";
  if ((readMetaString(metadata, "status") || "active") !== "active") return "status";
  return null;
}

function toSample(memory: MemoryRecord, reason?: string): VectorBackfillSample {
  return {
    id: memory.id,
    vector_id: memory.vector_id,
    type: memory.type,
    content_preview: memory.content.slice(0, 80),
    ...(reason ? { reason } : {})
  };
}

async function listActiveMemories(db: D1Database, namespace: string): Promise<MemoryRecord[]> {
  const result = await db
    .prepare(
      `SELECT * FROM memories
       WHERE namespace = ? AND status = 'active'
       ORDER BY created_at ASC, id ASC
       LIMIT ?`
    )
    .bind(namespace, MAX_SCAN)
    .all<MemoryRecord>();
  return result.results ?? [];
}

export async function runVectorBackfill(env: Env, input: VectorBackfillInput): Promise<VectorBackfillReport> {
  const namespace = input.namespace;
  const dryRun = input.dryRun !== false;
  const limit = clampLimit(input.limit);
  const errors: string[] = [];
  const counts: Record<VectorBackfillClass, number> = { ok: 0, missing: 0, stale: 0, no_vector_id: 0 };
  const samples: VectorBackfillReport["samples"] = { missing: [], stale: [], no_vector_id: [] };

  const memories = await listActiveMemories(env.DB, namespace);
  const report: VectorBackfillReport = {
    namespace,
    scanned_at: new Date().toISOString(),
    dry_run: dryRun,
    limit,
    active_memories: memories.length,
    unchecked: 0,
    counts,
    samples,
    errors
  };
  if (memories.length >= MAX_SCAN) errors.push(`scan_truncated_at_${MAX_SCAN}`);

  if (!env.VECTORIZE) {
    errors.push("missing_vectorize_binding");
    report.unchecked = memories.length;
    return report;
  }

  const targets: MemoryRecord[] = [];
  const record = (cls: Exclude<VectorBackfillClass, "ok">, memory: MemoryRecord, reason?: string) => {
    counts[cls] += 1;
    if (samples[cls].length < SAMPLE_CAP) samples[cls].push(toSample(memory, reason));
  };

  const withVectorId: MemoryRecord[] = [];
  for (const memory of memories) {
    if (memory.vector_id) withVectorId.push(memory);
    else record("no_vector_id", memory);
  }

  const missing: MemoryRecord[] = [];
  const stale: MemoryRecord[] = [];
  for (let i = 0; i < withVectorId.length; i += GETBYIDS_BATCH) {
    const batch = withVectorId.slice(i, i + GETBYIDS_BATCH);
    let found: Map<string, Record<string, unknown>>;
    try {
      const vectors = await env.VECTORIZE.getByIds(batch.map((memory) => memory.vector_id as string));
      found = new Map(vectors.map((v) => [v.id, (v.metadata || {}) as Record<string, unknown>]));
    } catch (err) {
      errors.push(`getbyids_failed: ${err instanceof Error ? err.message : String(err)}`);
      report.unchecked += batch.length;
      continue;
    }

    for (const memory of batch) {
      const metadata = found.get(memory.vector_id as string);
      if (!metadata) {
        record("missing", memory);
        missing.push(memory);
        continue;
      }
      const reason = staleReason(memory, metadata);
      if (reason) {
        record("stale", memory, reason);
        stale.push(memory);
      } else {
        counts.ok += 1;
      }
    }
  }
  // 先补完全没有向量的 (召回里彻底隐身)，再补内容过期的。
  targets.push(...missing, ...stale);

  if (dryRun) return report;

  const repair: VectorBackfillRepairResult = {
    attempted: 0,
    repaired: 0,
    failed_count: 0,
    failed: [],
    remaining: 0
  };
  const batch = targets.slice(0, limit);
  for (const memory of batch) {
    repair.attempted += 1;
    try {
      const ok = await upsertMemoryEmbedding(env, memory);
      if (ok) repair.repaired += 1;
      else repair.failed.push({ id: memory.id, error: "embedding_failed" });
    } catch (err) {
      repair.failed.push({ id: memory.id, error: err instanceof Error ? err.message : String(err) });
    }
  }
  repair.failed_count = repair.failed.length;
  // 本次没补上的 (失败的 + 超出 limit 的) 都算剩下，下次再跑还会被找出来。
  repair.remaining = targets.length - repair.repaired;
  report.repair = repair;
  return report;
}
