import { runMemoryRetention } from "../memory/retention";
import { processTgChat } from "../tg/process";
import type { Env, QueueMessage } from "../types";
import { runMemoryMaintenance } from "../memory/maintenance";

export async function handleQueueMessage(message: QueueMessage, env: Env, ctx?: ExecutionContext): Promise<void> {
  switch (message.type) {
    case "memory_maintenance":
      await runMemoryMaintenance(env, message);
      return;
    case "retention":
      await runMemoryRetention(env, message.namespace);
      return;
    case "tg_process":
      await processTgChat(env, message.chatId, ctx);
      return;
  }
}
