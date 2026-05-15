import type { KeyProfile, OpenAIChatMessage } from "../types";

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export async function readJsonObject(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const body = (await request.json()) as unknown;
    return isRecord(body) ? body : null;
  } catch {
    return null;
  }
}

export function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function readOptionalString(value: unknown): string | null | undefined {
  if (value === null) return null;
  return readString(value);
}

export function readNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

export function readBoolean(value: unknown, fallback = false): boolean {
  return typeof value === "boolean" ? value : fallback;
}

export function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function readPositiveInt(value: unknown, fallback: number, max: number): number {
  const parsed = typeof value === "string" ? Number(value) : readNumber(value, fallback);
  const numeric = Number.isFinite(parsed) ? parsed : fallback;
  return Math.min(Math.max(Math.floor(numeric), 1), max);
}

export function readNonNegativeInt(value: unknown, fallback: number, max: number): number {
  const parsed = typeof value === "string" ? Number(value) : readNumber(value, fallback);
  const numeric = Number.isFinite(parsed) ? parsed : fallback;
  return Math.min(Math.max(Math.floor(numeric), 0), max);
}

export function resolveNamespace(profile: KeyProfile, requested: unknown): string {
  const namespace = readString(requested);
  return profile.debug && namespace ? namespace : profile.namespace;
}

export function readMessages(value: unknown): OpenAIChatMessage[] {
  if (!Array.isArray(value)) return [];

  return value.flatMap((item): OpenAIChatMessage[] => {
    if (!isRecord(item)) return [];

    const { role, content } = item;
    if (role !== "system" && role !== "user" && role !== "assistant" && role !== "tool") return [];
    if (typeof content !== "string" && content !== null && !Array.isArray(content)) return [];

    return [{ role, content }];
  });
}
