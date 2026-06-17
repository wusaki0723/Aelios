export const RISK_LEVELS = new Set(["normal", "medium", "high"]);
export const URGENCY_LEVELS = new Set(["low", "normal", "high"]);

function cleanString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function normalizeFactKey(value: unknown): string | null {
  const text = cleanString(value);
  if (!text) return null;
  return text
    .toLowerCase()
    .replace(/\s+/g, "_")
    .replace(/[^a-z0-9_\-:\u4e00-\u9fff]/g, "")
    .slice(0, 120) || null;
}

export function normalizeThread(value: unknown): string | null {
  const text = cleanString(value);
  return text ? text.slice(0, 80) : null;
}

export function normalizeRiskLevel(value: unknown): string | null {
  const text = cleanString(value)?.toLowerCase();
  return text && RISK_LEVELS.has(text) ? text : null;
}

export function normalizeUrgencyLevel(value: unknown): string | null {
  const text = cleanString(value)?.toLowerCase();
  return text && URGENCY_LEVELS.has(text) ? text : null;
}

export function normalizeTensionScore(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Math.min(Math.max(value, 0), 1);
}

export function normalizeResponsePosture(value: unknown): string | null {
  const text = cleanString(value);
  return text ? text.slice(0, 120) : null;
}
