/**
 * Shared parsing / normalization helpers used across the Worker.
 *
 * This module is the single source of truth for small utilities that were
 * previously duplicated in memory/*, api/* and utils/request.ts.
 */

/** Read a non-empty trimmed string, returning `null` for missing/blank values. */
export function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/** Variant of `readString` that returns `undefined` instead of `null`. */
export function readStringOrUndefined(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

/** Normalize an array of values to a list of non-empty trimmed strings. */
export function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean);
}

/**
 * Parse a string array from a variety of input shapes:
 * - an array of strings (trimmed, blanks removed)
 * - a JSON-encoded string array
 * - a plain string (treated as a single-element array)
 *
 * Differs from `readStringArray` which only accepts an actual array.
 */
export function parseStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean);
  if (typeof value !== "string" || !value.trim()) return [];

  try {
    const parsed = JSON.parse(value) as unknown;
    if (Array.isArray(parsed)) return parseStringArray(parsed);
  } catch {
    // Plain metadata strings are also valid single tags.
  }

  return [value.trim()];
}

/** Clamp a numeric value to the unit interval [0, 1]. */
export function clampScore(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.min(Math.max(value, 0), 1) : fallback;
}

/**
 * Extract the outermost JSON object from a string.
 * First tries a direct parse; if that fails, scans for the first `{` and last `}`.
 */
export function extractJsonObject(text: string): unknown | null {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    // Some providers wrap JSON in prose; pull out the outermost object.
  }

  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;

  try {
    return JSON.parse(text.slice(start, end + 1)) as unknown;
  } catch {
    return null;
  }
}
