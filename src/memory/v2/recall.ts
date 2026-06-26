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
  getDigest,
  getDailyLog,
  listPrecious,
  listGlossary,
  matchGlossary,
  markMemoriesInjected,
  markPreciousInjected
} from "../../db/v2";
import { searchMemories } from "../search";
import { createEmbedding } from "../embedding";
import type { Env, MemoryApiRecord } from "../../types";

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
// 核心层 = boot 包里的 digest(L1) + precious(L3)。
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

// 构建核心层指纹: digest + precious 的文本词集, 供闸二比对。
export interface CoreFingerprint {
  digestTokens: Set<string> | null;
  preciousTokens: Set<string>[];
}

export function buildCoreFingerprint(
  digestContent: string | null,
  preciousContents: string[]
): CoreFingerprint {
  return {
    digestTokens: digestContent ? tokenize(digestContent) : null,
    preciousTokens: preciousContents.filter(Boolean).map(tokenize)
  };
}

// 判断一条召回命中是否与核心层重复。
function isDuplicateWithCore(content: string, core: CoreFingerprint): boolean {
  const hitTokens = tokenize(content);
  if (hitTokens.size === 0) return false;

  // 召回命中被 digest 包含: digest 文本里出现了命中的大部分词
  if (core.digestTokens && core.digestTokens.size > 0) {
    if (jaccardOverlap(hitTokens, core.digestTokens) >= DEDUP_OVERLAP_THRESHOLD) {
      return true;
    }
  }
  // 与某条 precious 高度重叠
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

export interface BootPackage {
  digest: { content: string; updated_at: string } | null;
  yesterday_log: { date: string; title: string; summary: string } | null;
  precious: Array<{ id: string; content: string; created_at: string }>;
  glossary: Array<{ term: string; definition: string; aliases: string[] }>;
  schema_version: string;
  cache_prefix_end: true;
}

const BOOT_SCHEMA_VERSION = "v2-1";

export async function buildBootPackage(
  env: Env,
  input: { namespace: string }
): Promise<BootPackage> {
  const digest = await getDigest(env.DB, input.namespace);
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
  const yesterdayLabel = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Singapore",
    year: "numeric", month: "2-digit", day: "2-digit"
  }).format(yesterday);
  const dailyLog = await getDailyLog(env.DB, { namespace: input.namespace, date: yesterdayLabel });

  return {
    digest: digest ? { content: digest.content, updated_at: digest.updated_at } : null,
    yesterday_log: dailyLog ? { date: dailyLog.date, title: dailyLog.title, summary: dailyLog.summary } : null,
    precious,
    glossary: allGlossary,
    schema_version: BOOT_SCHEMA_VERSION,
    cache_prefix_end: true
  };
}

// 服务端自建核心层指纹: 读 digest + precious, 供闸二在调用方没传指纹时用。
// 让闸二默认生效, 不依赖 MCP 客户端配合。
async function buildCoreFingerprintFromDb(
  env: Env,
  namespace: string
): Promise<CoreFingerprint> {
  const digest = await getDigest(env.DB, namespace);
  const preciousRows = await listPrecious(env.DB, { namespace, limit: 50 });
  return buildCoreFingerprint(
    digest?.content ?? null,
    preciousRows.map((r) => r.content)
  );
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
  // 闸二: 调用方传 boot 包的核心层指纹, recall 命中与之去重。
  // 不传则跳过闸二 (向后兼容第 2 步行为)。
  core_fingerprint?: CoreFingerprint;
}

export interface RecallHit {
  id: string;
  content: string;
  type: string;
  score: number;
  source_layer: "glossary" | "memory" | "longtail";
  // 闸二标记: 被核心层去重剔除的命中, 供调试/面板观察。
  deduped_against_core?: boolean;
}

export interface RecallResult {
  hits: RecallHit[];
  glossary_hits: Array<{ term: string; definition: string }>;
  meta: {
    decayed_ids: string[];
    deduped_ids: string[];
    total: number;
  };
}

export async function runRecall(env: Env, input: RecallInput): Promise<RecallResult> {
  const query = input.query.trim();
  if (!query) {
    return { hits: [], glossary_hits: [], meta: { decayed_ids: [], deduped_ids: [], total: 0 } };
  }

  // 1. 黑话词面命中 (L5，不进向量，走词面)
  const glossaryRows = await matchGlossary(env.DB, {
    namespace: input.namespace,
    query
  });
  const glossaryHits = glossaryRows.map((r) => ({ term: r.term, definition: r.definition }));

  // 2. memories 向量召回 (L4 + L6 world_fact，active only)
  //    闸一: 不查 precious。precious 归 boot 固定供给, 不进每轮 query 召回池。
  const k = Math.min(Math.max(Math.floor(input.k ?? 20), 1), 100);
  const memories: MemoryApiRecord[] = await searchMemories(env, {
    namespace: input.namespace,
    query,
    types: input.types,
    topK: k
  });

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
      source_layer: "memory" as const
    };
  });

  // 4. 闸二: 注入前与核心层去重。
  //    调用方传 core_fingerprint (boot 包的 digest + precious 文本指纹)；
  //    不传则服务端自己建 (读 digest + precious), 保证闸二默认生效。
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

  // 5. 长尾兜底 (L6): 只有 glossary + memories 闸二后全空才落 longtail。
  //    母帖逻辑优先级"全空才落长尾"——glossary 命中也算"前面非空"，
  //    有确定词面答案时不再追兜底，避免把 longtail 混进已有黑话答案的请求。
  let longtailHits: RecallHit[] = [];
  if (afterDedup.length === 0 && glossaryHits.length === 0) {
    longtailHits = await recallLongtailFallback(env, input);
  }

  const allHits = [...afterDedup, ...longtailHits]
    .sort((a, b) => b.score - a.score)
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
      total: allHits.length
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
    return matches.map((m) => ({
      id: String(m.metadata?.ref_id ?? m.id),
      content: String(m.metadata?.content ?? ""),
      type: "longtail",
      score: m.score,
      source_layer: "longtail" as const
    }));
  } catch (error) {
    console.error("v2 longtail vector recall failed", error);
    return [];
  }
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
    source_layer: "longtail" as const
  }));
}
