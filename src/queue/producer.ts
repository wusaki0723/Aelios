import type { Env, QueueMessage } from "../types";
import { newId } from "../utils/ids";
import { handleQueueMessage } from "./consumer";

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

  await handleQueueMessage(message, env);
}

export async function enqueueRetentionIfNeeded(
  env: Env,
  namespace: string
): Promise<void> {
  const message: QueueMessage = {
    type: "retention",
    namespace,
  };

  await handleQueueMessage(message, env);
}
