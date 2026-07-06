import type { Env, MemoryMaintenanceQueueMessage } from "../types";

export async function runMemoryMaintenance(
  _env: Env,
  _message: MemoryMaintenanceQueueMessage
): Promise<{ processed: boolean }> {
  return { processed: false };
}