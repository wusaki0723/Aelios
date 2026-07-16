// Aelios 记忆库 v2 召回管线 (母帖 #11 第 2/3 步)
// boot: 冷启动包 (L1 摘要 + 昨天日志 + top pinned 珍贵)，输出稳定、确定性排序。
// recall: 每轮动态召回 (黑话词面 → memories 向量 → world_fact → 长尾兜底)，闸三降权。
//
// 召回逻辑优先级 (母帖第三节，非物理摆放):
//   词面命中(黑话) → 核心(L1 摘要 + 命中珍贵) → 重要记忆+世界知识(向量) → 全空才落长尾
//
// 去重三闸:
//   闸一: 珍贵不进每轮 query 召回池，归 boot 固定供给 (这里 recall 不查 precious)。
//   闸二: 注入前与核心层去重 (recall 命中与 boot 内容做文本去重)。
//   闸三: last_injected_at 近期注入过的降权 (不动 importance)。

import {
  getDailyLog,
  listPrecious,
  listGlossary,
  listRecentMonthlyLogs,
  listRecentWeeklyLogs,
  fetchLongtailByIds,
  matchGlossary,
  markMemoriesInjected,
  markPreciousInjected
} from "../../db/v2";
import { searchMemoriesWithProvenance } from "../search";
import type { MemoryApiRecordWithProvenance } from "../search";
import { filterAndCompressMemories } from "../filter";
import { createEmbedding } from "../embedding";
import { expandRecallByRelations, isRelationExpansionEnabled } from "../relations";
import type { RelationExpansionMeta } from "../relations";
import { loadSpontaneousForBoot } from "../perception";
import type { Env, PerceptionCacheItem } from "../../types";

// --- 开关 ---

export function isV2Enabled(env: Env): boolean {
  return env.MEMORY_LIFECYCLE_ENABLED !== "false";
}

// 闸三: 近期注入过的降权系数。last_injected_at 在窗口内打折扣。
// 窗口/系数做成 env 可配，不配走默认 (30 分钟 / 0.5)。
function injectDecayWindowMs(env: Env): number {
  const mins = Number(env.MEMORY_INJECT_DECAY_WINDOW_MIN);
  return Number.isFinite(mins) && mins > 0 ? mins * 60 * 1000 : 30 * 60 * 1000;
}
function injectDecayFactor(env: Env): number {
  const f = Number(env.MEMORY_INJECT_DECAY_FACTOR);
  return Number.isFinite(f) && f > 0 && f < 1 ? f : 0.5;
}

function readRecallMinScore(env: Env, override?: number): number {
  const raw = override ?? Number(env.RECALL_MIN_SCORE ?? 0.15);
  return Number.isFinite(raw) ? Math.min(Math.max(raw, 0), 1) : 0.15;
}

function decayForLastInjected(
  lastInjectedAt: string | null,
  windowMs: number,
  factor: number,
  now = Date.now()
): number {
  if (!lastInjectedAt) return 1;
  const ts = Date.parse(lastInjectedAt);
  if (!Number.isFinite(ts)) return 1;
  if (now - ts > windowMs) return 1;
  return factor;
}

// =====================================================================
// 闸二: 注入前与核心层去重。
// 核心层 = boot 包里的 precious(L3)。
// 召回命中如果跟核心层内容高度重叠, 模型这轮已知道, 不重复喂。
// 用归一化文本的包含/重叠检测: 召回命中内容被核心层文本包含,
// 或与核心层某条 Jaccard 词集重叠超阈值, 则判为重复, 降到 0 分剔除。
// =====================================================================

const DEDUP_OVERLAP_THRESHOLD = 0.6; // 词集重叠率上限, 超过判重复

function normalizeText(s: string): string {
  return s.toLowerCase().replace(/\s+/g, " ").trim();
}

function tokenize(s: string): Set<string> {
  // 简单分词: 英文按非字母数字拆, 中文按字拆 (BM25 级别不需要精细)。
  const norm = normalizeText(s);
  const tokens = new Set<string>();
  for (const word of norm.split(/[^a-z0-9\u4e00-\u9fff]+/).filter(Boolean)) {
    if (word.length >= 2) tokens.add(word);
  }
  // 中文逐字
  for (const ch of norm) {
    if (/[\u4e00-\u9fff]/.test(ch)) tokens.add(ch);
  }
  return tokens;
}

function jaccardOverlap(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  const union = a.size + b.size - inter;
  return union > 0 ? inter / union : 0;
}

// 构建核心层指纹: precious 的文本词集, 供闸二比对。
export interface CoreFingerprint {
  preciousTokens: Set<string>[];
}

export function buildCoreFingerprint(preciousContents: string[]): CoreFingerprint {
  return {
    preciousTokens: preciousContents.filter(Boolean).map(tokenize)
  };
}

// 判断一条召回命中是否与核心层重复。
function isDuplicateWithCore(content: string, core: CoreFingerprint): boolean {
  const hitTokens = tokenize(content);
  if (hitTokens.size === 0) return false;

  for (const pt of core.preciousTokens) {
    if (jaccardOverlap(hitTokens, pt) >= DEDUP_OVERLAP_THRESHOLD) {
      return true;
    }
  }
  return false;
}

// =====================================================================
// boot: 冷启动包，输出稳定 + 确定性排序
// SessionStart 调一次。客户端可塞进缓存前缀吃命中 (母帖第二节)。
// =====================================================================

export interface BootImpressionEntry {
  label: string;
  title: string;
  summary: string;
}

export interface BootPackage {
  impressions: {
    daily: BootImpressionEntry | null;
    weekly: BootImpressionEntry | null;
    monthly: BootImpressionEntry | null;
    max_chars: number;
  };
  precious: Array<{ id: string; content: string; created_at: string }>;
  glossary: Array<{ term: string; definition: string; aliases: string[] }>;
  // LMC-5: spontaneous perception (SessionStart). Absent/empty = do not inject section.
  spontaneous?: PerceptionCacheItem[];
  schema_version: string;
  cache_prefix_end: true;
}

const BOOT_SCHEMA_VERSION = "v3-1";

export async function buildBootPackage(
  env: Env,
  input: { namespace: string }
): Promise<BootPackage> {
  const preciousRows = await listPrecious(env.DB, {
    namespace: input.namespace,
    limit: 20
  });

  // boot 要全量 glossary (冷启动把所有黑话定义塞进)，不是 query 命中。
  const allGlossary = await listAllGlossary(env, input.namespace);

  // 确定性排序: precious 按 created_at 升序 (老的在前，稳定的在前)。
  const precious = preciousRows
    .map((r) => ({ id: r.id, content: r.content, created_at: r.created_at }))
    .sort((a, b) => a.created_at.localeCompare(b.created_at));

  // 闸三对 precious 也记账: boot 被调 = precious 被注入, 记 last_injected_at。
  // 防的是某条 precious 因太相关而被 recall 侧逻辑反复塞 (虽然闸一已把 precious 移出
  // recall 池, 但 boot 每次冷启动都调, 记账让 precious 的注入节奏也可观测、可衰减)。
  if (precious.length > 0) {
    await markPreciousInjected(env.DB, {
      namespace: input.namespace,
      ids: precious.map((p) => p.id)
    });
  }

  // 昨天的日志 (dream 产出)
  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const bootTimeZone = env.DREAM_TIME_ZONE || "Asia/Shanghai";
  const yesterdayLabel = new Intl.DateTimeFormat("en-CA", {
    timeZone: bootTimeZone,
    year: "numeric", month: "2-digit", day: "2-digit"
  }).format(yesterday);
  const dailyLog = await getDailyLog(env.DB, { namespace: input.namespace, date: yesterdayLabel });
  const weeklyRows = await listRecentWeeklyLogs(env.DB, { namespace: input.namespace, limit: 1 });
  const monthlyRows = await listRecentMonthlyLogs(env.DB, { namespace: input.namespace, limit: 1 });
  const impressionMaxChars = (() => {
    const raw = env.IMPRESSION_LADDER_MAX_CHARS;
    if (!raw) return 1000;
    const parsed = Number(raw);
    return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 1000;
  })();

  // LMC-5 spontaneous: 最多 2 条，当天/昨夜 perception_cache；没有就不注入。
  let spontaneous: PerceptionCacheItem[] = [];
  try {
    spontaneous = await loadSpontaneousForBoot(env, {
      namespace: input.namespace,
      timeZone: bootTimeZone
    });
  } catch (error) {
    console.warn("boot: load spontaneous failed", error);
  }

  const weekly = weeklyRows[0] ?? null;
  const monthly = monthlyRows[0] ?? null;

  return {
    impressions: {
      daily: dailyLog
        ? { label: dailyLog.date, title: dailyLog.title, summary: dailyLog.summary }
        : null,
      weekly: weekly
        ? { label: weekly.week, title: weekly.title, summary: weekly.summary }
        : null,
      monthly: monthly
        ? { label: monthly.month, title: monthly.title, summary: monthly.summary }
        : null,
      max_chars: impressionMaxChars
    },
    precious,
    glossary: allGlossary,
    ...(spontaneous.length > 0 ? { spontaneous } : {}),
    schema_version: BOOT_SCHEMA_VERSION,
    cache_prefix_end: true
  };
}

// 服务端自建核心层指纹: 读 precious, 供闸二在调用方没传指纹时用。
async function buildCoreFingerprintFromDb(
  env: Env,
  namespace: string
): Promise<CoreFingerprint> {
  const preciousRows = await listPrecious(env.DB, { namespace, limit: 50 });
  return buildCoreFingerprint(preciousRows.map((r) => r.content));
}

async function listAllGlossary(
  env: Env,
  namespace: string
): Promise<Array<{ term: string; definition: string; aliases: string[] }>> {
  const rows = await listGlossary(env.DB, { namespace });
  return rows
    .map((r) => {
      let aliases: string[] = [];
      try {
        const parsed = JSON.parse(r.aliases ?? "[]") as unknown;
        if (Array.isArray(parsed)) aliases = parsed.filter((x): x is string => typeof x === "string");
      } catch {
        aliases = [];
      }
      return { term: r.term, definition: r.definition, aliases };
    })
    .sort((a, b) => a.term.localeCompare(b.term));
}

// =====================================================================
// recall: 每轮动态召回
// UserPromptSubmit 调。闸一: 不查 precious (归 boot)。
// =====================================================================

export interface RecallInput {
  namespace: string;
  query: string;
  k?: number;
  types?: string[];
  min_score?: number;
  // 闸二: 调用方传 boot 包的核心层指纹, recall 命中与之去重。
  // 不传则跳过闸二 (向后兼容第 2 步行为)。
  core_fingerprint?: CoreFingerprint;
  // LMC-5 additive: when true, allow version_status=superseded hits (history). Default false.
  include_history?: boolean;
}

export interface RecallHit {
  id: string;
  content: string;
  type: string;
  score: number;
  source_layer: "glossary" | "memory" | "longtail";
  // 闸二标记: 被核心层去重剔除的命中, 供调试/面板观察。
  deduped_against_core?: boolean;
  // --- provenance (additive)：命中出处，供面板观察清 v2 存量 vs legacy 残留。 ---
  // D1 memories.source 列值 (extract/dream/judge/doctor_rebuild_v2 等)；longtail 固定 "longtail"；无法确定为 null。
  source: string | null;
  // 是否有有效 D1 记录背书 (排除已删除/legacy 孤儿向量)。longtail 命中本来就来自 D1，恒为 true。
  backed: boolean;
  // 与 source_layer 中 memory/longtail 对应，供面板按类型统计 (不含 glossary，glossary 命中走单独的 glossary_hits)。
  kind: "memory" | "longtail";
  // LMC-5 Y 轴 (additive, only when RELATION_EXPANSION on and hit came via edge)
  relation?: RelationExpansionMeta;
  contradicted_by?: string[];
}

export interface RecallResult {
  hits: RecallHit[];
  glossary_hits: Array<{ term: string; definition: string }>;
  meta: {
    decayed_ids: string[];
    deduped_ids: string[];
    floored_ids: string[];
    floored_count: number;
    min_score: number;
    total: number;
    // --- provenance (additive) ---
    // 本次响应里没有 D1 背书的命中数 (RECALL_REQUIRE_D1_BACKING=true 时应恒为 0，因为已被丢弃而非透传)
    unbacked_count: number;
    // RECALL_REQUIRE_D1_BACKING=true 时，因严格过滤被丢弃的孤儿向量命中数
    unbacked_dropped: number;
  };
}

export async function runRecall(env: Env, input: RecallInput): Promise<RecallResult> {
  const query = input.query.trim();
  if (!query) {
    const minScore = readRecallMinScore(env, input.min_score);
    return {
      hits: [],
      glossary_hits: [],
      meta: {
        decayed_ids: [], deduped_ids: [], floored_ids: [], floored_count: 0, min_score: minScore, total: 0,
        unbacked_count: 0, unbacked_dropped: 0
      }
    };
  }
  const minScore = readRecallMinScore(env, input.min_score);

  // 1. 黑话词面命中 (L5，不进向量，走词面)
  const glossaryRows = await matchGlossary(env.DB, {
    namespace: input.namespace,
    query
  });
  const glossaryHits = glossaryRows.map((r) => ({ term: r.term, definition: r.definition }));

  // 2. memories 向量召回 (L4 + L6 world_fact，active only)
  //    闸一: 不查 precious。precious 归 boot 固定供给, 不进每轮 query 召回池。
  const k = Math.min(Math.max(Math.floor(input.k ?? 3), 1), 100);
  const searchResult = await searchMemoriesWithProvenance(env, {
    namespace: input.namespace,
    query,
    types: input.types,
    topK: k,
    includeHistory: input.include_history === true
  });
  const rawMemories: MemoryApiRecordWithProvenance[] = searchResult.records;
  // 严格模式下 (RECALL_REQUIRE_D1_BACKING=true) 已经在 search 层丢弃的孤儿向量命中数。
  const unbackedDropped = searchResult.unbacked_dropped;

  // 2.5. 召回精炼: prepareCandidates + reranker，记忆原文直出
  const memories = (await filterAndCompressMemories(env, {
    query,
    memories: rawMemories
  })) as MemoryApiRecordWithProvenance[];

  // 3. 闸三: last_injected_at 近期注入过的降权 (不动 importance)
  const windowMs = injectDecayWindowMs(env);
  const factor = injectDecayFactor(env);
  const decayedIds: string[] = [];
  const scored: RecallHit[] = memories.map((m) => {
    const decay = decayForLastInjected(m.last_injected_at ?? null, windowMs, factor);
    if (decay < 1) decayedIds.push(m.id);
    return {
      id: m.id,
      content: m.content,
      type: m.type,
      score: (m.score ?? 0) * decay,
      source_layer: "memory" as const,
      source: m.source ?? null,
      backed: m.backed,
      kind: "memory" as const
    };
  });

  // 4. 闸二: 注入前与核心层去重。
  //    调用方传 core_fingerprint (boot 包的 precious 文本指纹)；
  //    不传则服务端自己建 (读 precious), 保证闸二默认生效。
  //    recall 命中与之高度重叠的降到 0 分剔除, 不重复喂。
  const dedupedIds: string[] = [];
  const core = input.core_fingerprint ?? (await buildCoreFingerprintFromDb(env, input.namespace));
  const afterDedup = core
    ? scored.filter((h) => {
        if (isDuplicateWithCore(h.content, core)) {
          dedupedIds.push(h.id);
          return false;
        }
        return true;
      })
    : scored;

  // 4.5 LMC-5 Y 轴: 2-hop relation expansion (default off = seed set unchanged).
  // Runs after gate-2 dedup so expanded neighbors are also core-deduped next? We expand
  // from afterDedup seeds, then re-cap at k. Contradicts do not boost rank.
  let afterRelation: RecallHit[] = afterDedup;
  if (isRelationExpansionEnabled(env) && afterDedup.length > 0) {
    try {
      afterRelation = (await expandRecallByRelations(env, {
        namespace: input.namespace,
        seedHits: afterDedup,
        topK: k
      })) as RecallHit[];
    } catch (error) {
      console.error("v2 relation expansion failed; using seed hits", error);
      afterRelation = afterDedup;
    }
  }

  // 5. 长尾兜底 (L6): 只有 glossary + memories 闸二后全空才落 longtail。
  //    母帖逻辑优先级"全空才落长尾"——glossary 命中也算"前面非空"，
  //    有确定词面答案时不再追兜底，避免把 longtail 混进已有黑话答案的请求。
  let longtailHits: RecallHit[] = [];
  if (afterRelation.length === 0 && glossaryHits.length === 0) {
    longtailHits = await recallLongtailFallback(env, input);
  }

  const beforeFloor = [...afterRelation, ...longtailHits]
    .sort((a, b) => b.score - a.score);
  const flooredIds: string[] = [];
  const allHits = beforeFloor
    .filter((hit) => {
      if (hit.score >= minScore) return true;
      flooredIds.push(hit.id);
      return false;
    })
    .slice(0, k);

  // 6. 记 last_injected_at (闸三记账)。
  //    只记实际注入的 (通过闸二没有被剔除的); 珍贵的归 boot 不在这里记。
  const memoryIdsToMark = allHits
    .filter((h) => h.source_layer === "memory")
    .map((h) => h.id);
  if (memoryIdsToMark.length > 0) {
    await markMemoriesInjected(env.DB, {
      namespace: input.namespace,
      ids: memoryIdsToMark
    });
  }

  return {
    hits: allHits,
    glossary_hits: glossaryHits,
    meta: {
      decayed_ids: decayedIds,
      deduped_ids: dedupedIds,
      floored_ids: flooredIds,
      floored_count: flooredIds.length,
      min_score: minScore,
      total: allHits.length,
      unbacked_count: allHits.filter((h) => !h.backed).length,
      unbacked_dropped: unbackedDropped
    }
  };
}

// 长尾兜底: 母帖第六节"只在前面全空时兜底"。
// 优先走向量兜底 (Vectorize 按 kind:"longtail" 过滤查),向量索引还没数据时
// 退回 content LIKE 占位。dream 第 4 步填 longtail 向量后, 这条路径自动生效。
async function recallLongtailFallback(env: Env, input: RecallInput): Promise<RecallHit[]> {
  const vectorHits = await recallLongtailByVector(env, input);
  if (vectorHits.length > 0) return vectorHits;
  return recallLongtailByLike(env, input);
}

// 向量兜底: longtail 在 dream 第 4 步种向量后, 按 kind:"longtail" 召回。
// 向量库没数据 (第 2/3 步) 或 embedding 不可用时返回空, 触发 LIKE 占位分支。
async function recallLongtailByVector(
  env: Env,
  input: RecallInput
): Promise<RecallHit[]> {
  if (!env.VECTORIZE || !input.query.trim()) return [];
  const vector = await createEmbedding(env, input.query);
  if (!vector) return [];
  try {
    const result = await env.VECTORIZE.query(vector, {
      topK: 5,
      namespace: input.namespace,
      returnMetadata: true,
      filter: { namespace: input.namespace, kind: "longtail" } as VectorizeVectorMetadataFilter
    } as unknown as Parameters<typeof env.VECTORIZE.query>[1]);
    const matches = (result?.matches ?? []) as Array<{
      id: string;
      score: number;
      metadata?: Record<string, unknown>;
    }>;
    const candidateIds = matches.flatMap((match) => candidateLongtailIds(match));
    const rows = await fetchLongtailByIds(env.DB, { namespace: input.namespace, ids: candidateIds });
    const rowById = new Map(rows.map((row) => [row.id, row]));
    return matches.flatMap((match) => {
      for (const id of candidateLongtailIds(match)) {
        const row = rowById.get(id);
        if (!row) continue;
        return [{
          id: row.id,
          content: row.content,
          type: "longtail",
          score: match.score,
          source_layer: "longtail" as const,
          // longtail 表本身就是 D1 行 (fetchLongtailByIds 命中才走到这里)，不经 memories.source，天然有背书。
          source: "longtail",
          backed: true,
          kind: "longtail" as const
        }];
      }
      return [];
    });
  } catch (error) {
    console.error("v2 longtail vector recall failed", error);
    return [];
  }
}

function candidateLongtailIds(match: { id: string; metadata?: Record<string, unknown> }): string[] {
  const ids: string[] = [];
  const refId = match.metadata?.ref_id;
  if (typeof refId === "string" && refId.trim()) ids.push(refId.trim());
  if (match.id.trim()) {
    ids.push(match.id.trim());
    if (match.id.startsWith("lt_lt_")) ids.push(match.id.slice("lt_".length));
  }
  return [...new Set(ids)];
}

// LIKE 占位兜底: longtail 表第 2/3 步还没向量索引时, 按 content LIKE 子串匹配。
// dream 第 4 步种向量后, recallLongtailByVector 会先命中, 这条路径退居二线。
async function recallLongtailByLike(
  env: Env,
  input: RecallInput
): Promise<RecallHit[]> {
  const like = `%${input.query.trim().replace(/[\\%_]/g, "\\$&")}%`;
  let result: D1Result<{ id: string; content: string }>;
  try {
    result = await env.DB
      .prepare(
        `SELECT id, content FROM longtail WHERE namespace = ? AND content LIKE ? ESCAPE '\\'
         ORDER BY ts DESC LIMIT 5`
      )
      .bind(input.namespace, like)
      .all<{ id: string; content: string }>();
  } catch {
    return [];
  }
  return (result.results ?? []).map((r) => ({
    id: r.id,
    content: r.content,
    type: "longtail",
    score: 0.1,
    source_layer: "longtail" as const,
    source: "longtail",
    backed: true,
    kind: "longtail" as const
  }));
}
