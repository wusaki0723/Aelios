import type { Env, QueueMessage } from "../types";
import { newId } from "../utils/ids";
import { handleQueueMessage } from "./consumer";

/**
 * Send a queue message. Uses real Cloudflare Queue when MEMORY_QUEUE binding
 * is available; falls back to direct handleQueueMessage for local dev / no-queue.
 */
async function sendQueueMessage(env: Env, message: QueueMessage): Promise<void> {
  if (env.MEMORY_QUEUE) {
    await env.MEMORY_QUEUE.send(message);
  } else {
    await handleQueueMessage(message, env);
  }
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
