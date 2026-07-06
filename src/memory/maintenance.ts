import { finishIdempotentTask, tryStartIdempotentTask } from "../db/idempotency";
import { searchMemoriesByText } from "../db/memories";
import {
  getMessagesByIds,
  countMessagesAfterTimestamp,
  listMessagesByNamespace,
} from "../db/messages";
import {
  getProcessingCursor,
  setProcessingCursor,
} from "../db/conversations";
import { upsertMemoryByFactKey } from "../db/v2";
import { extractMemoriesFromMessages, type ExtractedMemory } from "./extract";
import { createVectorMemory } from "./vectorStore";
import { isV2Enabled } from "./v2/recall";
import type { Env, MemoryMaintenanceQueueMessage, MessageRecord } from "../types";

const EXTRACT_BATCH_SIZE = 50;

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

const EXPLICIT_INDICATORS = ["记住", "长期偏好", "稳定偏好", "稳定长期", "我的", "偏好是", "口令是"];

function buildExplicitMemoryFallback(messages: MessageRecord[]): ExtractedMemory[] {
  return messages.flatMap((message): ExtractedMemory[] => {
    if (message.role !== "user") return [];
    const content = message.content.trim().replace(/^(稳定长期偏好|长期偏好|稳定偏好)\s*[：:]\s*/, "");
    if (content.length < 8 || content.length > 500) return [];
    if (!EXPLICIT_INDICATORS.some((indicator) => content.includes(indicator))) return [];

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

export async function runMemoryMaintenance(
  env: Env,
  message: MemoryMaintenanceQueueMessage
): Promise<{ processed: boolean }> {
  if (env.ENABLE_INCREMENTAL_MEMORY !== "true") return { processed: false };

  const started = await tryStartIdempotentTask(env.DB, {
    key: message.idempotencyKey,
    taskType: message.type
  });
  if (!started) return { processed: false };

  try {
    const currentBatch = await getMessagesByIds(env.DB, {
      namespace: message.namespace,
      ids: [message.fromMessageId, message.toMessageId]
    });

    const explicitMemories = buildExplicitMemoryFallback(currentBatch);
    for (const memory of explicitMemories) {
      if (memory.importance < getMinImportance(env)) continue;
      if (memory.confidence < 0.6) continue;
      if (await isDuplicateMemory(env, { namespace: message.namespace, memory })) continue;

      await createVectorMemory(env, {
        namespace: message.namespace,
        type: memory.type,
        content: memory.content,
        importance: memory.importance,
        confidence: memory.confidence,
        tags: memory.tags,
        source: message.source,
        sourceMessageIds: memory.source_message_ids
      });
    }

    const cursor = await getProcessingCursor(env.DB, message.namespace);
    const pendingCount = await countMessagesAfterTimestamp(
      env.DB,
      message.namespace,
      cursor?.value ?? null
    );

    if (pendingCount < EXTRACT_BATCH_SIZE) {
      await finishIdempotentTask(env.DB, {
        key: message.idempotencyKey,
        status: "done"
      });
      return { processed: false };
    }

    const batch = await listMessagesByNamespace(env.DB, message.namespace, cursor?.value ?? null, EXTRACT_BATCH_SIZE);
    if (batch.length === 0) {
      await finishIdempotentTask(env.DB, {
        key: message.idempotencyKey,
        status: "done"
      });
      return { processed: false };
    }

    const extraction = await extractMemoriesFromMessages(env, batch);
    const writeMode = isV2Enabled(env) ? env.MEMORY_WRITE_MODE || "upsert" : "append";

    for (const memory of extraction.memories) {
      if (memory.importance < getMinImportance(env)) continue;
      if (memory.confidence < 0.6) continue;
      if (await isDuplicateMemory(env, { namespace: message.namespace, memory })) continue;

      if (writeMode === "upsert" && memory.fact_key) {
        await upsertMemoryByFactKey(env, {
          namespace: message.namespace,
          factKey: memory.fact_key,
          content: memory.content,
          type: memory.type,
          importance: memory.importance,
          confidence: memory.confidence,
          tags: memory.tags,
          source: message.source,
          sourceMessageIds: memory.source_message_ids
        });
      } else {
        await createVectorMemory(env, {
          namespace: message.namespace,
          type: memory.type,
          content: memory.content,
          importance: memory.importance,
          confidence: memory.confidence,
          tags: memory.tags,
          source: message.source,
          sourceMessageIds: memory.source_message_ids
        });
      }
    }

    const summaryContent = extraction.summary_patch || buildBatchSummary(batch);
    if (summaryContent) {
      const summaryMemory: ExtractedMemory = {
        type: "summary",
        content: summaryContent,
        importance: 0.6,
        confidence: 0.9,
        tags: ["batch-summary"],
        source_message_ids: batch.map((m) => m.id),
      };
      if (!(await isDuplicateMemory(env, { namespace: message.namespace, memory: summaryMemory }))) {
        await createVectorMemory(env, {
          namespace: message.namespace,
          type: summaryMemory.type,
          content: summaryMemory.content,
          importance: summaryMemory.importance,
          confidence: summaryMemory.confidence,
          tags: summaryMemory.tags,
          source: "batch_summary",
          sourceMessageIds: summaryMemory.source_message_ids
        });
      }
    }

    const lastMessage = batch[batch.length - 1];
    if (lastMessage?.created_at) {
      await setProcessingCursor(env.DB, message.namespace, lastMessage.created_at);
    }

    await finishIdempotentTask(env.DB, {
      key: message.idempotencyKey,
      status: "done"
    });
    return { processed: true };
  } catch (error) {
    await finishIdempotentTask(env.DB, {
      key: message.idempotencyKey,
      status: "failed"
    });
    throw error;
  }
}

function buildBatchSummary(messages: MessageRecord[]): string | null {
  const userMsgs: string[] = [];
  const assistantMsgs: string[] = [];

  for (const m of messages) {
    const text = m.content.trim();
    if (!text) continue;
    const truncated = text.length > 200 ? text.slice(0, 200) + "..." : text;
    if (m.role === "user") userMsgs.push(truncated);
    else if (m.role === "assistant") assistantMsgs.push(truncated);
  }

  if (userMsgs.length === 0 && assistantMsgs.length === 0) return null;

  const parts: string[] = [];
  parts.push(`对话摘要（${messages.length} 条消息）：`);
  if (userMsgs.length > 0) {
    parts.push("用户话题：" + userMsgs.slice(-5).join(" | "));
  }
  if (assistantMsgs.length > 0) {
    parts.push("助手要点：" + assistantMsgs.slice(-3).join(" | "));
  }
  return parts.join("\n");
}