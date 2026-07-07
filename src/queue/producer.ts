import type { Env, QueueMessage } from "../types";
import { newId } from "../utils/ids";
import { handleQueueMessage } from "./consumer";
import { isV2Enabled } from "../memory/v2/recall";

/**
 * Send a queue message. Uses real Cloudflare Queue when MEMORY_QUEUE binding
 * is available; falls back to direct handleQueueMessage for local dev / no-queue.
 */
async function sendQueueMessage(
  env: Env,
  message: QueueMessage,
  options?: { delaySeconds?: number }
): Promise<void> {
  if (env.MEMORY_QUEUE) {
    await env.MEMORY_QUEUE.send(message, options);
  } else {
    await handleQueueMessage(message, env);
  }
}

/**
 * Enqueue a Telegram processing task. delaySeconds is the debounce window:
 * rapid consecutive messages each enqueue a task, and the first task to fire
 * claims the whole buffered batch (later ones claim an empty set and no-op).
 * Without a queue binding the message is handled inline (no debounce).
 */
export async function enqueueTgProcess(env: Env, chatId: string, delaySeconds: number): Promise<void> {
  await sendQueueMessage(env, { type: "tg_process", chatId }, { delaySeconds });
}

export async function enqueueMemoryMaintenanceIfNeeded(
  env: Env,
  input: {
    namespace: string;
    conversationId: string;
    fromMessageId?: string;
    toMessageId: string;
    source: string;
  }
): Promise<void> {
  if (env.ENABLE_AUTO_MEMORY === "false") return;
  if (isV2Enabled(env)) return;
  if ((env.MEMORY_MODE || "external") === "none") return;
  if (!input.fromMessageId) return;

  const message: QueueMessage = {
    type: "memory_maintenance",
    namespace: input.namespace,
    conversationId: input.conversationId,
    fromMessageId: input.fromMessageId,
    toMessageId: input.toMessageId,
    source: input.source,
    idempotencyKey: newId("idem")
  };

  await sendQueueMessage(env, message);
}

export async function enqueueRetentionIfNeeded(
  env: Env,
  namespace: string
): Promise<void> {
  const message: QueueMessage = {
    type: "retention",
    namespace,
  };

  await sendQueueMessage(env, message);
}
