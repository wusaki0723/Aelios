import { runMemoryRetention } from "../memory/retention";
import type { Env, QueueMessage } from "../types";

export async function handleQueueMessage(message: QueueMessage, env: Env): Promise<void> {
  switch (message.type) {
    case "retention":
      await runMemoryRetention(env, message.namespace);
      return;
    default:
      console.warn("queue: unknown message type", (message as { type?: string }).type);
  }
}