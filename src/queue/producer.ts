import type { Env, QueueMessage } from "../types";
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