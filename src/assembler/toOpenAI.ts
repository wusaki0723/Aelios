/**
 * Pure conversion: AssembledPrompt → OpenAI wire format types.
 *
 * These helpers do NOT call any adapter, DB, or external service.
 * The openaiAdapter consumes them via buildOpenAIRequestFromAssembled.
 *
 * Determinism: given the same AssembledPrompt, output is bit-for-bit identical.
 */

import type { OpenAIChatMessage } from "../types";
import type { AssembledPrompt, SystemBlock } from "./types";

// ---------------------------------------------------------------------------
// System blocks → single OpenAI system message
// ---------------------------------------------------------------------------

/**
 * Merge all system_blocks into one OpenAI system message.
 * Texts are joined with double newlines, preserving block boundaries.
 */
export function assembledToOpenAISystem(
  systemBlocks: SystemBlock[]
): OpenAIChatMessage | null {
  if (systemBlocks.length === 0) return null;

  const text = systemBlocks.map((b) => b.text).join("\n\n");
  return { role: "system", content: text };
}

// ---------------------------------------------------------------------------
// Messages → OpenAIChatMessage[]
// ---------------------------------------------------------------------------

function contentToText(content: string | unknown[] | null): string {
  if (typeof content === "string") return content;
  if (content == null) return "";
  if (!Array.isArray(content)) return "";
  return content
    .flatMap((part) => {
      if (!part || typeof part !== "object" || Array.isArray(part)) return [];
      const value = part as { type?: unknown; text?: unknown };
      return value.type === "text" && typeof value.text === "string" ? [value.text] : [];
    })
    .join("\n");
}

function mergeUserIntoPrevious(
  prev: OpenAIChatMessage,
  content: string | unknown[] | null
): void {
  const prevText = contentToText(prev.content);
  const curText = contentToText(content);
  const mergedText =
    prevText && curText ? `${prevText}\n\n${curText}` : prevText || curText;

  if (Array.isArray(content)) {
    const nonText = content.filter(
      (part) =>
        part &&
        typeof part === "object" &&
        !Array.isArray(part) &&
        (part as { type?: string }).type !== "text"
    );
    prev.content =
      nonText.length > 0
        ? [{ type: "text", text: mergedText }, ...nonText]
        : mergedText;
    return;
  }

  prev.content = mergedText;
}

/**
 * Convert AssembledPrompt.messages to OpenAI message format.
 *
 * Consecutive user messages are merged into one turn (turn_context first,
 * then current user text, separated by a blank line). Structured content
 * such as image_url is preserved on the merged message.
 */
export function assembledToOpenAIMessages(
  messages: AssembledPrompt["messages"]
): OpenAIChatMessage[] {
  const result: OpenAIChatMessage[] = [];

  for (const msg of messages) {
    const prev = result[result.length - 1];
    if (msg.role === "user" && prev?.role === "user") {
      mergeUserIntoPrevious(prev, msg.content);
      continue;
    }

    result.push({
      role: msg.role,
      content: msg.content as string | Array<unknown> | null,
    });
  }

  return result;
}

// ---------------------------------------------------------------------------
// Combined: full OpenAI messages array (system + conversation)
// ---------------------------------------------------------------------------

/**
 * Build a complete OpenAI messages array from an AssembledPrompt.
 *
 * 1. System blocks → single system message (first)
 * 2. Conversation messages → appended as-is
 *
 * Returns a ready-to-use messages array for /v1/chat/completions.
 */
export function assembledToOpenAIChatMessages(
  assembled: AssembledPrompt
): OpenAIChatMessage[] {
  const result: OpenAIChatMessage[] = [];

  const systemMsg = assembledToOpenAISystem(assembled.system_blocks);
  if (systemMsg) result.push(systemMsg);

  result.push(...assembledToOpenAIMessages(assembled.messages));

  return result;
}
