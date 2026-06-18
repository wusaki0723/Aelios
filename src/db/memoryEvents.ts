import { newId } from "../utils/ids";
import { nowIso } from "../utils/time";

export async function createMemoryEvent(
  db: D1Database,
  input: { namespace: string; eventType: string; memoryId?: string | null; payload: unknown }
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO memory_events (id, namespace, event_type, memory_id, payload_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .bind(
      newId("evt"),
      input.namespace,
      input.eventType,
      input.memoryId ?? null,
      JSON.stringify(input.payload ?? {}),
      nowIso()
    )
    .run();
}
