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

/**
 * Convert AssembledPrompt.messages to OpenAI message format.
 *
 * Content is passed through as-is: string stays string, structured content
 * (image_url etc.) stays as the original array. This preserves image_url
 * for multimodal requests.
 */
export function assembledToOpenAIMessages(
  messages: AssembledPrompt["messages"]
): OpenAIChatMessage[] {
  return messages.map((msg) => ({
    role: msg.role,
    content: msg.content as string | Array<unknown> | null,
  }));
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
