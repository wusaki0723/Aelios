// Aelios 记忆库 v2 召回管线 (母帖 #11 第 2/3 步)
// boot: 冷启动包 (L1 摘要 + 昨天日志 + top pinned 珍贵)，输出稳定、确定性排序。
// recall: 每轮动态召回 (黑话词面 → memories 向量+词面 RRF → world_fact → 长尾兜底)，闸三降权。
//
// 召回逻辑优先级 (母帖第三节，非物理摆放):
//   词面命中(黑话) → 核心(L1 摘要 + 命中珍贵) → 重要记忆+世界知识(混合检索) → 全空才落长尾
//
// 去重三闸:
//   闸一: 珍贵不进每轮 query 召回池，归 boot 固定供给 (这里 recall 不查 precious)。
//   闸二: 注入前与核心层去重 (recall 命中与 boot 内容做文本去重)。
//   闸三: last_injected_at 近期注入过的降权 (不动 importance)。

import {
  getDailyLog,
  listPrecious,
  type PreciousRow,
  listGlossary,
  listRecentMonthlyLogs,
  listRecentWeeklyLogs,
  getWeeklyLog,
  fetchLongtailByIds,
  matchGlossary,
  markMemoriesInjected
} from "../../db/v2";
import { getIsoWeekLabelForDateLabel } from "../weeklyRollup";
import { searchMemoriesWithProvenance } from "../search";
import type { MemoryApiRecordWithProvenance } from "../search";
import { filterAndCompressMemories } from "../filter";
import { createEmbedding } from "../embedding";
import { shapeRecallQuery } from "../queryShape";
import { expandRecallByRelations, isRelationExpansionEnabled } from "../relations";
import { fetchTriggeredRecords, isTriggerRecallEnabled, recallByTriggers } from "../triggers";
import type { RelationExpansionMeta } from "../relations";
import { loadSpontaneousForBoot } from "../perception";
import { getYesterdayDateLabel } from "../dreamDates";
import { readDreamTimeZone } from "../dreamEnv";
import { formatDateLabel } from "../../utils/time";
import type { Env, PerceptionCacheItem } from "../../types";

// --- 开关 ---

export function isV2Enabled(env: Env): boolean {
  return env.MEMORY_LIFECYCLE_ENABLED !== "false";
}

// 闸三: 近期注入过的降权系数。last_injected_at 在窗口内打折扣。
// 窗口/系数做成 env 可配，不配走默认 (30 分钟 / 0.5)。
// #37 修正：降权只压排序，不再参与闸四地板判定。修正前 factor(0.15)×命中分 ≤ 地板(0.15)，
// 两闸相乘把"窗口内注入过"变成 30 分钟绝对拉黑——直接追问也召不回，比复读伤得重。
// 现在：地板打在原始相关性分上 (garbage gate)，降权后的分只决定排位；
// 若窗口内那条是唯一相关命中，它照样回来 (排它前面的没人)，这正是想要的行为。
function injectDecayWindowMs(env: Env): number {
  const mins = Number(env.MEMORY_INJECT_DECAY_WINDOW_MIN);
  return Number.isFinite(mins) && mins > 0 ? mins * 60 * 1000 : 30 * 60 * 1000;
}
function injectDecayFactor(env: Env): number {
  const f = Number(env.MEMORY_INJECT_DECAY_FACTOR);
  return Number.isFinite(f) && f > 0 && f < 1 ? f : 0.5;
}

// E 轴: 亲笔记忆 (authored_by 非空) 的排序加成。只影响排序，不影响地板。
// 默认 1.15；上限 2 防手滑。设 "1" 等于关闭。
function authoredBoost(env: Env): number {
  const b = Number(env.MEMORY_AUTHORED_BOOST);
  return Number.isFinite(b) && b >= 1 && b <= 2 ? b : 1.15;
}

function readRecallMinScore(env: Env, override?: number): number {
  const raw = override ?? Number(env.RECALL_MIN_SCORE ?? 0.15);
  return Number.isFinite(raw) ? Math.min(Math.max(raw, 0), 1) : 0.15;
}

// --- 周块附带 (#35，过渡方案) ---
// 病：召回出来全是原子碎片，没有宏观上下文。weekly_log 本身已经是聚好的、
// 可读的、带时间范围的块，但只有显式 diary_get 拿得到。
//
// 与 embedding.ts 的隔离不变量的关系：那条不变量禁的是「daily/weekly/monthly_log
// 永不 embed、永不进检索通道」。这里不 embed、不查向量、不混进 hits 数组，
// 走的是命中之后按周 join 取整块，属于附带上下文，不是检索结果。
// 所以周块必须留在 week_blocks 字段里，谁都不许把它 push 进 hits。
//
// 二档 scenarios 表上线后，取值源换成真正的场景块，这段整体退役。
function isWeekBlockEnabled(env: Env): boolean {
  return env.RECALL_WEEK_BLOCKS !== "false";
}
function weekBlockLimit(env: Env): number {
  const n = Number(env.RECALL_WEEK_BLOCK_LIMIT);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 2;
}

function dateLabelInTimeZone(iso: string, timeZone: string): string | null {
  const ts = Date.parse(iso);
  if (!Number.isFinite(ts)) return null;
  return formatDateLabel(new Date(ts), timeZone);
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

// Worker isolates make this best-effort: each isolate has its own map, no cross-isolate sharing.
const BOOT_CACHE_TTL_MS = 60_000;
const bootPackageCache = new Map<string, { expiresAt: number; value: BootPackage }>();

export async function buildBootPackage(
  env: Env,
  input: { namespace: string; preciousRows?: PreciousRow[] }
): Promise<BootPackage> {
  const cached = bootPackageCache.get(input.namespace);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }

  const bootTimeZone = readDreamTimeZone(env);
  const yesterdayLabel = getYesterdayDateLabel(bootTimeZone);

  const [preciousRows, allGlossary, dailyLog, weeklyRows, monthlyRows, spontaneous] = await Promise.all([
    input.preciousRows
      ? Promise.resolve(input.preciousRows)
      : listPrecious(env.DB, { namespace: input.namespace, limit: 20 }),
    listAllGlossary(env, input.namespace),
    getDailyLog(env.DB, { namespace: input.namespace, date: yesterdayLabel }),
    listRecentWeeklyLogs(env.DB, { namespace: input.namespace, limit: 1 }),
    listRecentMonthlyLogs(env.DB, { namespace: input.namespace, limit: 1 }),
    loadSpontaneousForBoot(env, { namespace: input.namespace, timeZone: bootTimeZone }).catch((error) => {
      console.warn("boot: load spontaneous failed", error);
      return [] as PerceptionCacheItem[];
    })
  ]);

  // 确定性排序: 先取最新 20 条 (listPrecious DESC)，再按 created_at 升序展示 (老的在前，稳定的在前)。
  const precious = preciousRows
    .slice(0, 20)
    .map((r) => ({ id: r.id, content: r.content, created_at: r.created_at }))
    .sort((a, b) => a.created_at.localeCompare(b.created_at));

  // Injection accounting (markPreciousInjected) is the caller's responsibility so it
  // stays off the response path via waitUntil / fire-and-forget and is not cached.

  const impressionMaxChars = (() => {
    const raw = env.IMPRESSION_LADDER_MAX_CHARS;
    if (!raw) return 1000;
    const parsed = Number(raw);
    return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 1000;
  })();

  const weekly = weeklyRows[0] ?? null;
  const monthly = monthlyRows[0] ?? null;

  const pkg: BootPackage = {
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

  bootPackageCache.set(input.namespace, {
    expiresAt: Date.now() + BOOT_CACHE_TTL_MS,
    value: pkg
  });
  return pkg;
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
  // Prior human turns. Thin queries ("那个呢") reuse this as embedding context.
  recent?: string[];
  k?: number;
  types?: string[];
  min_score?: number;
  // 闸二: 调用方传 boot 包的核心层指纹, recall 命中与之去重。
  // 不传则跳过闸二 (向后兼容第 2 步行为)。
  core_fingerprint?: CoreFingerprint;
  // LMC-5 additive: when true, allow version_status=superseded hits (history). Default false.
  include_history?: boolean;
  // #35: 调用方已经从别处给了模型哪几周的周记，这里就不重复带。
  // 同时构建 boot 和 recall 的调用方 (chatCompletions) 应当传 boot 那条 weekly 的 label；
  // 只调 recall 的调用方 (hook 走 /v1/memory/recall) 不传，否则会白丢最有用的那块。
  exclude_weeks?: string[];
  // When set (chat hot path), injection accounting is scheduled off the response path.
  waitUntil?: (promise: Promise<unknown>) => void;
  // Gateway applies the unified surface budget first, then marks only those ids.
  skip_inject_mark?: boolean;
  // False = nomination pool for a later reranker. Default true for explicit search.
  grounded?: boolean;
  // Week diaries are impressions, not evidence. Only attach when the question is temporal.
  attach_week_blocks?: boolean;
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
  // #37: 原始相关性分 (降权/加成前)。闸四地板判这个；score 是排序分。缺省时两者相同。
  raw_score?: number;
  // E 轴: 亲笔署名与响应倾向 (0011)。authored 命中吃排序加成，供面板观察。
  authored_by?: string | null;
  response_tendency?: string | null;
  // Keep recording time separate from effective/event time for evidence selection.
  recorded_date?: string | null;
  event_date?: string | null;
  fact_key?: string | null;
  source_message_ids?: string[];
  // LMC-5 Y 轴 (additive, only when RELATION_EXPANSION on and hit came via edge)
  relation?: RelationExpansionMeta;
  contradicted_by?: string[];
}

// #35: 命中记忆所在那一周的 weekly_log 整块。跟 hits 平行，不参与 min_score 过滤，
// 不占 k 的名额 —— 它是上下文，不是命中。
export interface RecallWeekBlock {
  week: string;
  start_date: string;
  end_date: string;
  title: string;
  summary: string;
  // 哪几条命中把这一周带出来的，供面板追溯，也方便二档迁移时对照。
  seed_ids: string[];
}

export interface RecallResult {
  hits: RecallHit[];
  glossary_hits: Array<{ term: string; definition: string }>;
  week_blocks: RecallWeekBlock[];
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
      week_blocks: [],
      meta: {
        decayed_ids: [], deduped_ids: [], floored_ids: [], floored_count: 0, min_score: minScore, total: 0,
        unbacked_count: 0, unbacked_dropped: 0
      }
    };
  }
  const minScore = readRecallMinScore(env, input.min_score);

  const shaped = shapeRecallQuery({ query, recent: input.recent });
  const glossaryQuery = shaped.thin
    ? [query, ...(input.recent ?? [])].filter(Boolean).join("\n")
    : query;

  // 1. 黑话词面命中 (L5，不进向量，走词面)
  const glossaryRows = await matchGlossary(env.DB, {
    namespace: input.namespace,
    query: glossaryQuery
  });
  const glossaryHits = glossaryRows.map((r) => ({ term: r.term, definition: r.definition }));

  // 2. memories 混合召回 (向量 + 词面 RRF，L4 + L6 world_fact，active only)
  //    闸一: 不查 precious。precious 归 boot 固定供给, 不进每轮 query 召回池。
  const k = Math.min(Math.max(Math.floor(input.k ?? 8), 1), 100);
  const searchResult = await searchMemoriesWithProvenance(env, {
    namespace: input.namespace,
    query: shaped.embeddingQuery,
    lexicalTokens: shaped.lexicalTokens,
    types: input.types,
    topK: k,
    includeHistory: input.include_history === true,
    waitUntil: input.waitUntil,
    grounded: input.grounded !== false,
    skipRecallMark: input.skip_inject_mark === true || input.grounded === false
  });
  // 复制一份：下面触发器通道会往池子里 push，不要改到 searchResult 自己的数组。
  const rawMemories: MemoryApiRecordWithProvenance[] = [...searchResult.records];

  // 2.25 触发器通道 (入口扩展，默认 off)。
  // 与 4.5 的 relation 扩展分工：那边从已召回的种子往外走，是出口扩展，种子为空时
  // 它什么也做不了；这边把本来进不了候选池的记忆送进来——问题和记忆语义相关但几乎
  // 不共享词汇的那一类，主检索第一跳就空了，触发器是唯一还能把它捞回来的路。
  //
  // 只 union，不改已有命中的分和顺序。新进来的记忆和别的候选一样，要过 2.5 的
  // reranker 和闸四才算数——这条通道负责"让它有机会被看见"，不负责"让它赢"。
  if (isTriggerRecallEnabled(env)) {
    try {
      const outcome = await recallByTriggers(env, {
        namespace: input.namespace,
        query: shaped.embeddingQuery
      });
      if (outcome.triggered) {
        const extra = await fetchTriggeredRecords(env, {
          namespace: input.namespace,
          outcome,
          existingIds: new Set(rawMemories.map((m) => m.id)),
          includeHistory: input.include_history === true
        });
        rawMemories.push(...extra);
      }
    } catch (error) {
      console.error("trigger recall failed; using seed pool", error);
    }
  }
  // 严格模式下 (RECALL_REQUIRE_D1_BACKING=true) 已经在 search 层丢弃的孤儿向量命中数。
  const unbackedDropped = searchResult.unbacked_dropped;

  // 2.5. Rank with the reranker, but do not apply the auto-injection
  // 2-item budget here. MCP / REST active recall needs the full k;
  // the gateway surface trims after this.
  const memories = (await filterAndCompressMemories(env, {
    query,
    memories: rawMemories,
    maxOutput: k
  })) as MemoryApiRecordWithProvenance[];

  // 3. 闸三: last_injected_at 近期注入过的降权 (不动 importance)。
  //    #37: score 是排序分 (原始分 × 降权 × 亲笔加成)；raw_score 是原始相关性分，闸四地板判它。
  const windowMs = injectDecayWindowMs(env);
  const factor = injectDecayFactor(env);
  const boost = authoredBoost(env);
  const decayedIds: string[] = [];
  // #35: 记下每条命中的事实时间，末尾按周取块用。valid_as_of 是事实生效时间，
  // 比入库时间准；没有才退回 created_at。
  const timeByMemoryId = new Map<string, string>();
  const scored: RecallHit[] = memories.map((m) => {
    const decay = decayForLastInjected(m.last_injected_at ?? null, windowMs, factor);
    if (decay < 1) decayedIds.push(m.id);
    const factTime = m.valid_as_of ?? m.created_at;
    if (factTime) timeByMemoryId.set(m.id, factTime);
    const rawScore = m.score ?? 0;
    const authored = m.authored_by ?? null;
    return {
      id: m.id,
      content: m.content,
      type: m.type,
      score: rawScore * decay * (authored ? boost : 1),
      raw_score: rawScore,
      source_layer: "memory" as const,
      source: m.source ?? null,
      backed: m.backed,
      kind: "memory" as const,
      authored_by: authored,
      response_tendency: m.response_tendency ?? null,
      recorded_date: m.created_at ?? null,
      event_date: m.valid_as_of ?? null,
      fact_key: m.fact_key ?? null,
      source_message_ids: m.source_message_ids
    };
  });

  // 4. 闸二: 注入前与核心层去重。
  //    调用方传 core_fingerprint (boot 包的 precious 文本指纹)；
  //    不传则服务端自己建 (读 precious), 保证闸二默认生效。
  //    recall 命中与之高度重叠的降到 0 分剔除, 不重复喂。
  //    buildCoreFingerprint always returns an object — always filter when we have hits.
  //    Skip the DB fingerprint fallback when scored is empty (nothing to dedupe).
  const dedupedIds: string[] = [];
  let afterDedup = scored;
  if (scored.length > 0) {
    const core =
      input.core_fingerprint ?? (await buildCoreFingerprintFromDb(env, input.namespace));
    afterDedup = scored.filter((h) => {
      if (isDuplicateWithCore(h.content, core)) {
        dedupedIds.push(h.id);
        return false;
      }
      return true;
    });
  }

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

  // 闸四: 绝对分数地板。#37 后判原始相关性分 (raw_score)，不判降权后的排序分——
  // 地板管"跟问题相不相关"，闸三管"最近喂过没有"，两闸各司其职不再相乘。
  // 关系扩展/长尾命中没有 raw_score，退回 score (它们不经闸三，两者本来就相等)。
  const beforeFloor = [...afterRelation, ...longtailHits]
    .sort((a, b) => b.score - a.score);
  const flooredIds: string[] = [];
  const allHits = beforeFloor
    .filter((hit) => {
      // Nomination pools stay wide for the later reranker. Explicit search
      // still drops scores that only cleared the padded lexical floor.
      if (input.grounded === false) return true;
      if ((hit.raw_score ?? hit.score) >= minScore) return true;
      flooredIds.push(hit.id);
      return false;
    })
    .slice(0, k);

  // 6. 记 last_injected_at (闸三记账)。
  //    只记实际注入的 (通过闸二没有被剔除的); 珍贵的归 boot 不在这里记。
  const memoryIdsToMark = allHits
    .filter((h) => h.source_layer === "memory")
    .map((h) => h.id);
  if (memoryIdsToMark.length > 0 && !input.skip_inject_mark) {
    const markPromise = markMemoriesInjected(env.DB, {
      namespace: input.namespace,
      ids: memoryIdsToMark
    });
    if (input.waitUntil) {
      input.waitUntil(markPromise);
    } else {
      await markPromise;
    }
  }

  // 7. #35 周块附带。失败不影响召回主体，吞掉记日志。
  let weekBlocks: RecallWeekBlock[] = [];
  if (isWeekBlockEnabled(env) && allHits.length > 0 && input.attach_week_blocks !== false) {
    try {
      weekBlocks = await collectWeekBlocks(env, {
        namespace: input.namespace,
        hits: allHits,
        timeByMemoryId,
        decayedIds: new Set(decayedIds),
        excludeWeeks: input.exclude_weeks
      });
    } catch (error) {
      console.error("v2 week block attach failed", error);
      weekBlocks = [];
    }
  }

  return {
    hits: allHits,
    glossary_hits: glossaryHits,
    week_blocks: weekBlocks,
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

// #35 周块附带。把命中记忆按事实时间归到 ISO 周，取那一周的 weekly_log 整块。
//
// 两条约束的落法：
//   闸三延伸 —— weekly_log 表没有 last_injected_at 列，工单也定了不动 schema，
//   所以周块不自己记账，跟着种子走：种子被闸三降权 (近期注入过) 就不带它的周。
//   同一块连轮复读因此自动收敛，不需要新列。
//   与 boot 去重 —— 交给调用方传 exclude_weeks，这里不自己猜。
//   第一版我在这儿写死"剔掉最近一周，因为 boot 恒带它"，2026-08-07 生产验收当场打脸：
//   weekly_log 的滚动比当前日期落后一两周 (daily 满 7 天才 rollup)，所以"最近一周"
//   往往正是命中最密的那一周；而 hook 走的 /v1/memory/recall 根本不调 boot。
//   结果是最有用的块被白扔。去重责任属于同时持有 boot 和 recall 的那一层。
export async function collectWeekBlocks(
  env: Env,
  input: {
    namespace: string;
    hits: RecallHit[];
    timeByMemoryId: Map<string, string>;
    decayedIds: Set<string>;
    excludeWeeks?: string[];
  }
): Promise<RecallWeekBlock[]> {
  const timeZone = readDreamTimeZone(env);

  const seedsByWeek = new Map<string, string[]>();
  for (const hit of input.hits) {
    if (hit.source_layer !== "memory") continue;
    if (input.decayedIds.has(hit.id)) continue;
    const factTime = input.timeByMemoryId.get(hit.id);
    if (!factTime) continue;
    const dateLabel = dateLabelInTimeZone(factTime, timeZone);
    if (!dateLabel) continue;
    const week = getIsoWeekLabelForDateLabel(dateLabel, timeZone);
    const seeds = seedsByWeek.get(week);
    if (seeds) seeds.push(hit.id);
    else seedsByWeek.set(week, [hit.id]);
  }
  if (seedsByWeek.size === 0) return [];

  for (const week of input.excludeWeeks ?? []) seedsByWeek.delete(week);
  if (seedsByWeek.size === 0) return [];

  // 命中多的周排前面；打平了按周从新到旧。
  const ranked = [...seedsByWeek.entries()]
    .sort((a, b) => b[1].length - a[1].length || b[0].localeCompare(a[0]))
    .slice(0, weekBlockLimit(env));

  const rows = await Promise.all(
    ranked.map(([week]) => getWeeklyLog(env.DB, { namespace: input.namespace, week }))
  );

  return rows.flatMap((row, i) => {
    if (!row) return [];
    return [{
      week: row.week,
      start_date: row.start_date,
      end_date: row.end_date,
      title: row.title,
      summary: row.summary,
      seed_ids: ranked[i][1]
    }];
  });
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
