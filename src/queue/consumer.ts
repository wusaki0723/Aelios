import { runMemoryRetention } from "../memory/retention";
import { maybeUpdateLongTermSummary } from "../memory/summary";
import type { Env, QueueMessage } from "../types";
import { runMemoryMaintenance } from "../memory/maintenance";

export async function handleQueueMessage(message: QueueMessage, env: Env): Promise<void> {
  switch (message.type) {
    case "memory_maintenance":
      const result = await runMemoryMaintenance(env, message);
      if (result.processed) {
        try {
          await maybeUpdateLongTermSummary(env, message.namespace);
        } catch (error) {
          console.error("summary update failed", error);
        }
      }
      return;
    case "retention":
      await runMemoryRetention(env, message.namespace);
      return;
  }
}
