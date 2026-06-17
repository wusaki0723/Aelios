import type { MemoryApiRecord } from "../types";

type MetadataMap = Record<string, unknown>;

function clampScore(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.min(Math.max(value, 0), 1) : fallback;
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readBoolean(value: unknown): boolean {
  return value === true || value === "true" || value === 1;
}

function parseStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean);
  }
  if (typeof value !== "string" || !value.trim()) return [];

  try {
    const parsed = JSON.parse(value) as unknown;
    if (Array.isArray(parsed)) return parseStringArray(parsed);
  } catch {
    // Plain metadata strings are also valid single tags.
  }

  return [value.trim()];
}

export function vectorMetadataToMemoryRecord(
  vector: Pick<VectorizeVector, "id" | "metadata">,
  score?: number
): MemoryApiRecord | null {
  const metadata = (vector.metadata || {}) as MetadataMap;
  const status = readString(metadata.status) || "active";
  if (status !== "active") return null;

  const content = readString(metadata.content) || readString(metadata.text) || readString(metadata.memory);
  if (!content) return null;

  const id = readString(metadata.ref_id) || (vector.id.startsWith("mem_") ? vector.id.slice("mem_".length) : vector.id);
  const now = new Date(0).toISOString();

  return {
    id,
    namespace: readString(metadata.namespace) || "default",
    type: readString(metadata.type) || "note",
    content,
    summary: readString(metadata.summary),
    importance: clampScore(metadata.importance, 0.5),
    confidence: clampScore(metadata.confidence, 0.8),
    status,
    pinned: readBoolean(metadata.pinned),
    tags: parseStringArray(metadata.tags),
    source: readString(metadata.source) || readString(metadata.source_id),
    source_message_ids: parseStringArray(metadata.source_message_ids),
    vector_id: vector.id,
    last_recalled_at: null,
    recall_count: 0,
    created_at: readString(metadata.created_at) || now,
    updated_at: readString(metadata.updated_at) || readString(metadata.created_at) || now,
    expires_at: readString(metadata.expires_at),
    fact_key: readString(metadata.fact_key),
    thread: readString(metadata.thread),
    risk_level: readString(metadata.risk_level),
    urgency_level: readString(metadata.urgency_level),
    tension_score:
      metadata.tension_score === undefined
        ? null
        : typeof metadata.tension_score === "number"
          ? metadata.tension_score
          : Number.isFinite(Number(metadata.tension_score))
            ? Number(metadata.tension_score)
            : null,
    response_posture: readString(metadata.response_posture),
    ...(score === undefined ? {} : { score })
  };
}
