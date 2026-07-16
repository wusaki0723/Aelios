import { getMemoryById } from "../db/memories";
import type { Env, MemoryApiRecord } from "../types";
import { readNumber } from "../utils/request";
import { searchVectorMemories } from "./vectorStore";

export interface SimilarHit {
  memory: MemoryApiRecord;
  score: number;
}

export async function findSimilarActiveMemory(
  env: Env,
  input: { namespace: string; content: string; excludeIds?: string[] }
): Promise<SimilarHit | null> {
  try {
    const threshold = readNumber(env.DEDUP_COSINE, 0.9);
    const exclude = new Set(input.excludeIds ?? []);
    const hits = await searchVectorMemories(env, {
      namespace: input.namespace,
      query: input.content,
      topK: 5
    });

    let best: SimilarHit | null = null;
    for (const memory of hits) {
      if (exclude.has(memory.id)) continue;
      const score = memory.score ?? 0;
      if (score < threshold) continue;
      const d1Row = await getMemoryById(env.DB, { namespace: input.namespace, id: memory.id });
      if (!d1Row || d1Row.status !== "active" || d1Row.version_status === "superseded") continue;
      if (!best || score > best.score) {
        best = { memory, score };
      }
    }
    return best;
  } catch (error) {
    console.warn("dedup_gate: search failed (fail-open)", {
      reason: error instanceof Error ? error.message : String(error)
    });
    return null;
  }
}