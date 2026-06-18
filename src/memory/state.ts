import {
  createMemory,
  getMemoryById,
  softDeleteMemory,
  updateMemory,
  type CreateMemoryInput,
  type UpdateMemoryInput,
} from "../db/memories";
import { createMemoryEvent } from "../db/memoryEvents";
import { deleteMemoryEmbedding, upsertMemoryEmbedding } from "./embedding";
import type { Env, MemoryRecord } from "../types";

export type VectorSyncStatus = "synced" | "failed" | "deleted" | "pending";

async function syncVector(env: Env, memory: MemoryRecord): Promise<VectorSyncStatus> {
  if (memory.status !== "active") return "deleted";
  try {
    const ok = await upsertMemoryEmbedding(env, memory);
    return ok ? "synced" : "failed";
  } catch (error) {
    console.error("syncVector failed", { id: memory.id, error: error instanceof Error ? error.message : String(error) });
    return "failed";
  }
}

async function removeVector(env: Env, memory: MemoryRecord): Promise<VectorSyncStatus> {
  try {
    await deleteMemoryEmbedding(env, memory);
    return "deleted";
  } catch (error) {
    console.error("removeVector failed", { id: memory.id, error: error instanceof Error ? error.message : String(error) });
    return "failed";
  }
}

async function updateSyncStatus(
  env: Env,
  namespace: string,
  id: string,
  status: VectorSyncStatus
): Promise<void> {
  try {
    await updateMemory(env.DB, {
      namespace,
      id,
      patch: { vectorSyncStatus: status },
    });
  } catch (error) {
    console.error("updateSyncStatus failed", { id, status, error: error instanceof Error ? error.message : String(error) });
  }
}

export async function createSyncedMemory(
  env: Env,
  input: CreateMemoryInput
): Promise<MemoryRecord> {
  const record = await createMemory(env.DB, {
    ...input,
    vectorSyncStatus: "pending",
  });

  const syncStatus = await syncVector(env, record);
  await updateSyncStatus(env, record.namespace, record.id, syncStatus);

  return (await getMemoryById(env.DB, { namespace: record.namespace, id: record.id })) ?? record;
}

export async function patchSyncedMemory(
  env: Env,
  namespace: string,
  id: string,
  patch: UpdateMemoryInput
): Promise<MemoryRecord | null> {
  const updated = await updateMemory(env.DB, { namespace, id, patch });
  if (!updated) return null;

  if (updated.status === "active") {
    const syncStatus = await syncVector(env, updated);
    await updateSyncStatus(env, namespace, id, syncStatus);
  } else {
    const syncStatus = await removeVector(env, updated);
    await updateSyncStatus(env, namespace, id, syncStatus);
  }

  return getMemoryById(env.DB, { namespace, id });
}

export async function deleteSyncedMemory(
  env: Env,
  namespace: string,
  id: string
): Promise<MemoryRecord | null> {
  const existing = await getMemoryById(env.DB, { namespace, id });
  if (!existing) return null;
  if (existing.pinned) return existing;

  const deleted = await softDeleteMemory(env.DB, { namespace, id });
  if (!deleted) return null;

  const syncStatus = await removeVector(env, deleted);
  await updateSyncStatus(env, namespace, id, syncStatus);

  return getMemoryById(env.DB, { namespace, id });
}

export async function markMemoryReviewSynced(
  env: Env,
  namespace: string,
  id: string,
  auditState?: string
): Promise<MemoryRecord | null> {
  const existing = await getMemoryById(env.DB, { namespace, id });
  if (!existing) return null;
  if (existing.pinned) return existing;

  const patch: UpdateMemoryInput = { status: "review" };
  if (auditState) patch.auditState = auditState;

  const updated = await updateMemory(env.DB, { namespace, id, patch });
  if (!updated) return null;

  const syncStatus = await removeVector(env, updated);
  await updateSyncStatus(env, namespace, id, syncStatus);

  return getMemoryById(env.DB, { namespace, id });
}

export async function supersedeSyncedMemory(
  env: Env,
  namespace: string,
  oldId: string,
  newMemoryInput: CreateMemoryInput,
  eventPayload?: Record<string, unknown>
): Promise<{ old: MemoryRecord | null; created: MemoryRecord }> {
  const oldExisting = await getMemoryById(env.DB, { namespace, id: oldId });

  if (oldExisting && !oldExisting.pinned) {
    const superseded = await updateMemory(env.DB, {
      namespace,
      id: oldId,
      patch: { status: "superseded" },
    });
    if (superseded) {
      const syncStatus = await removeVector(env, superseded);
      await updateSyncStatus(env, namespace, oldId, syncStatus);
    }

    if (eventPayload) {
      await createMemoryEvent(env.DB, {
        namespace,
        eventType: "z_conflict",
        memoryId: oldId,
        payload: eventPayload,
      });
    }
  }

  const created = await createSyncedMemory(env, newMemoryInput);
  return { old: oldExisting?.pinned ? oldExisting : (await getMemoryById(env.DB, { namespace, id: oldId })), created };
}

export async function syncMemoryVector(
  env: Env,
  memory: MemoryRecord
): Promise<VectorSyncStatus> {
  if (memory.status !== "active") {
    const status = await removeVector(env, memory);
    await updateSyncStatus(env, memory.namespace, memory.id, status);
    return status;
  }
  const status = await syncVector(env, memory);
  await updateSyncStatus(env, memory.namespace, memory.id, status);
  return status;
}

export async function removeMemoryVector(
  env: Env,
  memory: MemoryRecord
): Promise<VectorSyncStatus> {
  const status = await removeVector(env, memory);
  await updateSyncStatus(env, memory.namespace, memory.id, status);
  return status;
}

export async function retryStaleVectorSyncs(
  env: Env,
  namespace: string,
  limit = 50
): Promise<{ scanned: number; retried: number; fixed: number }> {
  const rows = await env.DB
    .prepare(
      `SELECT * FROM memories
       WHERE namespace = ?
         AND status = 'active'
         AND (vector_sync_status = 'failed' OR vector_sync_status = 'pending' OR vector_sync_status IS NULL)
       ORDER BY updated_at DESC
       LIMIT ?`
    )
    .bind(namespace, Math.min(Math.max(limit, 1), 200))
    .all<MemoryRecord>();

  const memories = rows.results ?? [];
  let fixed = 0;

  for (const memory of memories) {
    const status = await syncVector(env, memory);
    await updateSyncStatus(env, namespace, memory.id, status);
    if (status === "synced") fixed += 1;
  }

  return { scanned: memories.length, retried: memories.length, fixed };
}
