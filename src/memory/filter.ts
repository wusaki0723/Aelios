import type { Env, MemoryApiRecord } from "../types";

const DEFAULT_WORKERS_AI_RERANKER_MODEL = "workers-ai/@cf/baai/bge-reranker-base";

export interface MemoryFilterMeta {
  status: "disabled" | "success" | "error" | "empty";
  provider: "workers-ai";
  model: string;
  raw_count: number;
  candidate_count: number;
  output_count: number;
  reason?: string;
  reranker_status?: "disabled" | "success" | "error";
  reranker_model?: string;
  reranker_count?: number;
  reranker_reason?: string;
  fallback_used?: boolean;
}

function isEnabled(env: Env): boolean {
  return env.ENABLE_MEMORY_FILTER !== "false";
}

function isRerankerEnabled(env: Env): boolean {
  return env.ENABLE_MEMORY_RERANKER !== "false";
}

function getRerankerModel(env: Env): string {
  return env.MEMORY_RERANKER_MODEL || DEFAULT_WORKERS_AI_RERANKER_MODEL;
}

function workersAiModelName(model: string): string | null {
  const normalized = model.trim();
  if (normalized.startsWith("workers-ai/")) return normalized.slice("workers-ai/".length);
  if (normalized.startsWith("worker/")) return normalized.slice("worker/".length);
  if (normalized.startsWith("@cf/")) return normalized;
  return null;
}

function getWorkersAiRerankerModel(env: Env): string | null {
  return workersAiModelName(getRerankerModel(env));
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function getMaxCandidates(env: Env): number {
  const value = Number(env.MEMORY_FILTER_MAX_CANDIDATES || 12);
  return Number.isFinite(value) ? clamp(Math.floor(value), 1, 50) : 12;
}

function getMaxOutput(env: Env): number {
  const value = Number(env.MEMORY_FILTER_MAX_OUTPUT || 3);
  return Number.isFinite(value) ? clamp(Math.floor(value), 1, 20) : 3;
}

function getMaxContentChars(env: Env): number {
  const value = Number(env.MEMORY_FILTER_MAX_CONTENT_CHARS || 700);
  return Number.isFinite(value) ? clamp(Math.floor(value), 120, 3000) : 700;
}

function getFilterMinScore(env: Env): number {
  const value = Number(env.MEMORY_FILTER_MIN_SCORE || env.MEMORY_MIN_SCORE || 0.1);
  return Number.isFinite(value) ? clamp(value, 0, 1) : 0.1;
}

function truncateText(text: string, maxChars: number): string {
  return text.length > maxChars ? `${text.slice(0, maxChars).trim()}...` : text;
}

function sanitizeMemoryContent(text: string): string {
  return text
    .replace(/<time_reminder>[^|。\n]*/gi, "")
    .replace(/对话摘要（\d+ 条消息）：?/g, "")
    .replace(/用户话题[:：]/g, "")
    .replace(/助手要点[:：]/g, "")
    .replace(/debug-test/gi, "")
    .replace(/记忆系统/g, "")
    .replace(/自动记忆测试口令/g, "口令")
    .replace(/测试口令/g, "口令")
    .replace(/标签为?[^，。；\s]+/g, "")
    .replace(/标签[:：]?[^，。；\s]+/g, "")
    .replace(/[，,；;：:]\s*([。.!！?？])/g, "$1")
    .replace(/\s{2,}/g, " ")
    .replace(/^[，,；;：:\s]+|[，,；;：:\s]+$/g, "")
    .trim();
}

function normalizeForDedupe(text: string): string {
  return text
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[，,。.!！?？；;：:“”"'`、\[\]【】（）()<>《》]/g, "");
}

function compareMemoryQuality(a: MemoryApiRecord, b: MemoryApiRecord): number {
  if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;

  const scoreA = typeof a.score === "number" ? a.score : -1;
  const scoreB = typeof b.score === "number" ? b.score : -1;
  if (scoreA !== scoreB) return scoreB - scoreA;

  if (a.importance !== b.importance) return b.importance - a.importance;
  return b.confidence - a.confidence;
}

function prepareCandidates(env: Env, memories: MemoryApiRecord[]): MemoryApiRecord[] {
  const minScore = getFilterMinScore(env);
  const sorted = memories
    .flatMap((memory): MemoryApiRecord[] => {
      const content = sanitizeMemoryContent(memory.content);
      if (!content) return [];
      if (!memory.pinned && typeof memory.score === "number" && memory.score < minScore) return [];
      return [{ ...memory, content }];
    })
    .sort(compareMemoryQuality);

  const seenIds = new Set<string>();
  const seenContent = new Set<string>();
  const result: MemoryApiRecord[] = [];

  for (const memory of sorted) {
    const normalized = normalizeForDedupe(memory.content);
    if (!normalized || seenIds.has(memory.id) || seenContent.has(normalized)) continue;
    seenIds.add(memory.id);
    seenContent.add(normalized);
    result.push(memory);
    if (result.length >= getMaxCandidates(env)) break;
  }

  return result;
}

function readRerankerResponse(value: unknown): Array<{ id: number; score: number }> | null {
  if (!value || typeof value !== "object") return null;
  const object = value as { response?: unknown; result?: unknown; data?: unknown };
  const rows = Array.isArray(object.response)
    ? object.response
    : Array.isArray(object.result)
      ? object.result
      : Array.isArray(object.data)
        ? object.data
        : null;
  if (!rows) return null;

  const result: Array<{ id: number; score: number }> = [];
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const item = row as { id?: unknown; index?: unknown; score?: unknown };
    const id = typeof item.id === "number" ? item.id : typeof item.index === "number" ? item.index : NaN;
    const score = typeof item.score === "number" ? item.score : NaN;
    if (Number.isInteger(id) && Number.isFinite(score)) result.push({ id, score });
  }

  return result.length > 0 ? result : null;
}

async function rerankMemories(
  env: Env,
  input: { query: string; memories: MemoryApiRecord[]; topK: number; maxContentChars: number }
): Promise<{
  data: MemoryApiRecord[];
  status: "disabled" | "success" | "error";
  model: string;
  reason?: string;
}> {
  const model = getRerankerModel(env);
  const workersAiModel = getWorkersAiRerankerModel(env);

  if (!isRerankerEnabled(env)) {
    return {
      data: input.memories.slice(0, input.topK),
      status: "disabled",
      model,
      reason: "reranker_disabled"
    };
  }

  if (!env.AI || !workersAiModel) {
    return {
      data: input.memories.slice(0, input.topK),
      status: "disabled",
      model,
      reason: !env.AI ? "missing_workers_ai_binding" : "unsupported_reranker_provider"
    };
  }

  try {
    const output = await env.AI.run(workersAiModel, {
      query: input.query,
      top_k: input.topK,
      contexts: input.memories.map((memory) => ({
        text: truncateText(memory.content, input.maxContentChars)
      }))
    });
    const rows = readRerankerResponse(output);
    if (!rows) {
      return {
        data: input.memories.slice(0, input.topK),
        status: "error",
        model,
        reason: "invalid_reranker_output"
      };
    }

    const used = new Set<number>();
    const reranked: MemoryApiRecord[] = [];
    for (const row of rows.sort((a, b) => b.score - a.score)) {
      if (used.has(row.id)) continue;
      const memory = input.memories[row.id];
      if (!memory) continue;
      used.add(row.id);
      reranked.push({ ...memory, score: row.score });
      if (reranked.length >= input.topK) break;
    }

    return {
      data: reranked.length > 0 ? reranked : input.memories.slice(0, input.topK),
      status: reranked.length > 0 ? "success" : "error",
      model,
      ...(reranked.length > 0 ? {} : { reason: "empty_reranker_output" })
    };
  } catch (error) {
    console.error("memory reranker failed", error);
    return {
      data: input.memories.slice(0, input.topK),
      status: "error",
      model,
      reason: error instanceof Error && error.message ? error.message : "reranker_error"
    };
  }
}

export async function filterAndCompressMemories(
  env: Env,
  input: { query: string; memories: MemoryApiRecord[] }
): Promise<MemoryApiRecord[]> {
  const result = await filterAndCompressMemoriesWithMeta(env, input);
  return result.data;
}

function buildFailOpenResult(
  reranked: { data: MemoryApiRecord[]; status: "disabled" | "success" | "error"; model: string; reason?: string },
  maxOutput: number,
  errorMeta: MemoryFilterMeta
): { data: MemoryApiRecord[]; meta: MemoryFilterMeta } {
  const fallbackData = reranked.data.slice(0, maxOutput);
  return {
    data: fallbackData,
    meta: { ...errorMeta, output_count: fallbackData.length, fallback_used: true }
  };
}

export async function filterAndCompressMemoriesWithMeta(
  env: Env,
  input: { query: string; memories: MemoryApiRecord[] }
): Promise<{ data: MemoryApiRecord[]; meta: MemoryFilterMeta }> {
  const query = input.query.trim();
  const model = getRerankerModel(env);
  const baseMeta = {
    provider: "workers-ai" as const,
    model,
    raw_count: input.memories.length,
    candidate_count: 0,
    output_count: input.memories.length
  };

  if (!isEnabled(env) || !query) {
    return {
      data: input.memories,
      meta: {
        ...baseMeta,
        status: "disabled",
        reason: !query ? "empty_query" : "filter_disabled"
      }
    };
  }

  const maxOutput = getMaxOutput(env);
  const candidates = prepareCandidates(env, input.memories);
  if (candidates.length === 0) {
    return {
      data: [],
      meta: {
        ...baseMeta,
        status: "empty",
        candidate_count: 0,
        output_count: 0,
        reason: "no_candidates"
      }
    };
  }

  const activeMeta = {
    ...baseMeta,
    candidate_count: candidates.length,
    output_count: 0
  };
  const failOpen = env.MEMORY_FILTER_FAIL_OPEN === "true";

  try {
    const reranked = await rerankMemories(env, {
      query,
      memories: candidates,
      topK: maxOutput,
      maxContentChars: getMaxContentChars(env)
    });
    const filtered = reranked.data.slice(0, maxOutput);
    if (filtered.length === 0) {
      const errorMeta: MemoryFilterMeta = {
        ...activeMeta,
        status: "error",
        reason: reranked.reason ?? "empty_reranker_output",
        reranker_status: reranked.status,
        reranker_model: reranked.model,
        reranker_count: reranked.data.length,
        ...(reranked.reason ? { reranker_reason: reranked.reason } : {})
      };
      if (failOpen) return buildFailOpenResult(reranked, maxOutput, errorMeta);
      return { data: [], meta: errorMeta };
    }

    return {
      data: filtered,
      meta: {
        ...activeMeta,
        status: "success",
        output_count: filtered.length,
        reranker_status: reranked.status,
        reranker_model: reranked.model,
        reranker_count: reranked.data.length,
        ...(reranked.reason ? { reranker_reason: reranked.reason } : {})
      }
    };
  } catch (error) {
    console.error("memory filter failed", error);
    const errorMeta: MemoryFilterMeta = {
      ...activeMeta,
      status: "error",
      reason: error instanceof Error && error.message ? error.message : "reranker_error"
    };
    if (failOpen) {
      return {
        data: candidates.slice(0, maxOutput),
        meta: { ...errorMeta, output_count: Math.min(candidates.length, maxOutput), fallback_used: true }
      };
    }
    return { data: [], meta: errorMeta };
  }
}