// 长期记忆只允许这 8 个固定类型。抽取器、dream、手工新增、候选审核、
// upsert/supersede 全部在写入边界收敛到这个枚举，不允许自由类型。
// 面板按这 8 个类型分 tab 展示；world_fact / precious 走各自独立页面，
// 不进这个枚举。
export const CANONICAL_MEMORY_TYPES = [
  "fact",
  "event",
  "preference",
  "relationship",
  "boundary",
  "habit",
  "decision",
  "note"
] as const;

export type CanonicalMemoryType = (typeof CANONICAL_MEMORY_TYPES)[number];

const CANONICAL_SET = new Set<string>(CANONICAL_MEMORY_TYPES);

/**
 * 把任意 type 收敛到固定枚举。非空但不在枚举里的 → fallback。
 * 大小写无关。写入层调用，保证库里不会出现自由类型。
 */
export function clampMemoryType(
  type: string | null | undefined,
  fallback: CanonicalMemoryType = "fact"
): CanonicalMemoryType {
  const trimmed = (type || "").trim().toLowerCase();
  if (trimmed && CANONICAL_SET.has(trimmed)) return trimmed as CanonicalMemoryType;
  return fallback;
}
