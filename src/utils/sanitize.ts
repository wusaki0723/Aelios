import type { OpenAIChatMessage } from "../types";

/**
 * Extract plain text from OpenAI-style message content (string or text parts array).
 * inject.ts and blocks.ts implementations are equivalent; blocks.ts uses explicit casts
 * for the array branch — behavior is identical for valid OpenAIChatMessage content.
 */
export function contentToText(content: OpenAIChatMessage["content"]): string {
  if (typeof content === "string") return content;
  if (content == null) return "";
  return content
    .flatMap((part) => {
      if (!part || typeof part !== "object" || Array.isArray(part)) return [];
      const value = part as { type?: unknown; text?: unknown };
      return value.type === "text" && typeof value.text === "string" ? [value.text] : [];
    })
    .join("\n");
}

export function sanitizeMemoryContent(text: string): string {
  return text
    .replace(/debug-test/gi, "")
    .replace(/记忆系统/g, "")
    .replace(/自动记忆测试口令/g, "口令")
    .replace(/测试口令/g, "口令")
    .replace(/标签为?[^，。；\s]+/g, "")
    .replace(/标签[:：]?[^，。；\s]+/g, "")
    .replace(/[，,；;：:]\s*([。.!！?？])/g, "$1")
    .replace(/\s{2,}/g, " ")
    .replace(/^[，,；;：:\s]+|[，,；;：:\s]+$/g, "")
    .trim();
}

/** filter.ts superset: four summary-specific rules, then base sanitize. */
export function sanitizeSummaryContent(text: string): string {
  return sanitizeMemoryContent(
    text
      .replace(/<time_reminder>[^|。\n]*/gi, "")
      .replace(/对话摘要（\d+ 条消息）：?/g, "")
      .replace(/用户话题[:：]/g, "")
      .replace(/助手要点[:：]/g, "")
  );
}