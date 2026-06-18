import type { MemoryApiRecord } from "../types";

type MetadataMap = Record<string, unknown>;

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readBoolean(value: unknown): boolean {
  return value === true || value === "true" || value === 1;
}

function readNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.min(Math.max(value, 0), 1) : fallback;
}

export function extractRefIdFromVector(match: Pick<VectorizeVector, "id" | "metadata">): string | null {
  const metadata = (match.metadata || {}) as MetadataMap;
  const refId = readString(metadata.ref_id);
  if (refId) return refId;
  if (match.id.startsWith("mem_")) return match.id.slice("mem_".length);
  return null;
}

export function extractStatusFromVector(match: Pick<VectorizeVector, "id" | "metadata">): string {
  const metadata = (match.metadata || {}) as MetadataMap;
  return readString(metadata.status) || "active";
}
