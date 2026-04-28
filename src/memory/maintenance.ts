import { finishIdempotentTask, tryStartIdempotentTask } from "../db/idempotency";
import { createMemory, searchMemoriesByText } from "../db/memories";
import { getMessagesByIds } from "../db/messages";
import { upsertMemoryEmbedding } from "./embedding";
import { extractMemoriesFromMessages, type ExtractedMemory } from "./extract";
import type { Env, MessageRecord, QueueMessage } from "../types";

function getMinImportance(env: Env): number {
  const value = Number(env.MEMORY_MIN_IMPORTANCE || 0.55);
  return Number.isFinite(value) ? value : 0.55;
}

function normalizeText(value: string): string {
  return value.toLowerCase().replace(/\s+/g, "");
}

async function isDuplicateMemory(
  env: Env,
  input: { namespace: string; memory: ExtractedMemory }
): Promise<boolean> {
  const existing = await searchMemoriesByText(env.DB, {
    namespace: input.namespace,
    query: input.memory.content,
    limit: 5
  });
  const content = normalizeText(input.memory.content);
  return existing.some((record) => normalizeText(record.content) === content);
}

function buildExplicitMemoryFallback(messages: MessageRecord[]): ExtractedMemory[] {
  const indicators = ["记住", "长期偏好", "稳定偏好", "稳定长期", "我的", "偏好是", "口令是"];

  return messages.flatMap((message): ExtractedMemory[] => {
    if (message.role !== "user") return [];
    const content = message.content.trim().replace(/^(稳定长期偏好|长期偏好|稳定偏好)\s*[：:]\s*/, "");
    if (content.length < 8 || content.length > 500) return [];
    if (!indicators.some((indicator) => content.includes(indicator))) return [];

    return [
      {
        type: "note",
        content,
        importance: 0.72,
        confidence: 0.78,
        tags: ["explicit-memory"],
        source_message_ids: [message.id]
      }
    ];
  });
}

export async function runMemoryMaintenance(env: Env, message: QueueMessage): Promise<void> {
  const started = await tryStartIdempotentTask(env.DB, {
    key: message.idempotencyKey,
    taskType: message.type
  });
  if (!started) return;

  try {
    const sourceMessages = await getMessagesByIds(env.DB, {
      namespace: message.namespace,
      ids: [message.fromMessageId, message.toMessageId]
    });

    const explicitMemories = buildExplicitMemoryFallback(sourceMessages);
    const extraction =
      explicitMemories.length > 0 ? { memories: [] } : await extractMemoriesFromMessages(env, sourceMessages);
    const memories = explicitMemories.length > 0 ? explicitMemories : extraction.memories;
    const minImportance = getMinImportance(env);

    for (const memory of memories) {
      if (memory.importance < minImportance) continue;
      if (memory.confidence < 0.6) continue;
      if (await isDuplicateMemory(env, { namespace: message.namespace, memory })) continue;

      const created = await createMemory(env.DB, {
        namespace: message.namespace,
        type: memory.type,
        content: memory.content,
        importance: memory.importance,
        confidence: memory.confidence,
        tags: memory.tags,
        source: message.source,
        sourceMessageIds: memory.source_message_ids.length > 0 ? memory.source_message_ids : sourceMessages.map((item) => item.id)
      });

      await upsertMemoryEmbedding(env, created);
    }

    await finishIdempotentTask(env.DB, {
      key: message.idempotencyKey,
      status: "done"
    });
  } catch (error) {
    await finishIdempotentTask(env.DB, {
      key: message.idempotencyKey,
      status: "failed"
    });
    throw error;
  }
}
