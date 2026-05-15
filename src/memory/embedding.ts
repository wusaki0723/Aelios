import type { Env, MemoryRecord } from "../types";
import { callOpenAICompatEmbeddings } from "../proxy/openaiAdapter";

const DEFAULT_EMBEDDING_MODEL = "workers-ai/@cf/google/embeddinggemma-300m";

function workersAiModelName(model: string): string {
  return model.replace(/^workers-ai\//, "");
}

function readEmbedding(result: unknown): number[] | null {
  if (!result || typeof result !== "object") return null;
  const value = result as {
    data?: unknown;
    embedding?: unknown;
    embeddings?: unknown;
  };

  if (Array.isArray(value.embedding) && typeof value.embedding[0] === "number") {
    return value.embedding as number[];
  }

  if (Array.isArray(value.embeddings) && Array.isArray(value.embeddings[0])) {
    return value.embeddings[0] as number[];
  }

  if (Array.isArray(value.data)) {
    const first = value.data[0] as { embedding?: unknown } | number[] | undefined;
    if (first && typeof first === "object" && !Array.isArray(first) && Array.isArray(first.embedding)) {
      return first.embedding as number[];
    }
    if (Array.isArray(first)) return first as number[];
    if (typeof value.data[0] === "number") return value.data as number[];
  }

  return null;
}

export async function createEmbedding(env: Env, text: string): Promise<number[] | null> {
  const model = env.EMBEDDING_MODEL || DEFAULT_EMBEDDING_MODEL;
  try {
    const response = await callOpenAICompatEmbeddings(env, {
      model,
      input: text
    });

    if (response.ok) {
      const vector = readEmbedding(await response.json());
      if (vector) return vector;
    }
  } catch {
    // Fall back to the native Workers AI binding below.
  }

  if (!env.AI || !model.startsWith("workers-ai/")) return null;

  try {
    return readEmbedding(await env.AI.run(workersAiModelName(model), { text: [text] }));
  } catch {
    return null;
  }
}

export async function upsertMemoryEmbedding(env: Env, memory: MemoryRecord): Promise<boolean> {
  if (!env.VECTORIZE || memory.status !== "active") return false;

  const vector = await createEmbedding(env, memory.content);
  if (!vector || !memory.vector_id) return false;

  await env.VECTORIZE.upsert([
    {
      id: memory.vector_id,
      values: vector,
      namespace: memory.namespace,
      metadata: {
        namespace: memory.namespace,
        kind: "memory",
        ref_id: memory.id,
        type: memory.type,
        content: memory.content,
        importance: memory.importance,
        status: memory.status,
        pinned: Boolean(memory.pinned),
        tags: memory.tags || "[]",
        created_at: memory.created_at,
      }
    }
  ]);

  return true;
}

export async function deleteMemoryEmbedding(env: Env, memory: MemoryRecord): Promise<boolean> {
  if (!env.VECTORIZE || !memory.vector_id) return false;
  await env.VECTORIZE.deleteByIds([memory.vector_id]);
  return true;
}
