/**
 * Pure conversion: AssembledPrompt → Anthropic wire format types.
 *
 * These helpers do NOT call any adapter, DB, or external service.
 * The anthropicAdapter consumes them via buildAnthropicRequestFromAssembled.
 *
 * Determinism: given the same AssembledPrompt, output is bit-for-bit identical.
 */

import type { AssembledPrompt, SystemBlock } from "./types";

// ---------------------------------------------------------------------------
// Anthropic wire types (subset needed for system + messages)
// ---------------------------------------------------------------------------

export interface AnthropicTextBlock {
  type: "text";
  text: string;
  cache_control?: {
    type: "ephemeral";
    ttl?: "5m" | "1h";
  };
}

export interface AnthropicWireMessage {
  role: "user" | "assistant";
  content: AnthropicTextBlock[];
}

// ---------------------------------------------------------------------------
// System blocks → AnthropicTextBlock[]
// ---------------------------------------------------------------------------

/**
 * Convert AssembledPrompt.system_blocks to Anthropic system format.
 * Preserves cache_control exactly as set by the assembler.
 */
export function assembledToAnthropicSystem(
  systemBlocks: SystemBlock[]
): AnthropicTextBlock[] {
  return systemBlocks.map((block) => {
    const out: AnthropicTextBlock = { type: "text", text: block.text };
    if (block.cache_control) {
      out.cache_control = {
        type: "ephemeral",
        ...(block.cache_control.ttl ? { ttl: block.cache_control.ttl } : {}),
      };
    }
    return out;
  });
}

// ---------------------------------------------------------------------------
// Messages → AnthropicMessage[]
// ---------------------------------------------------------------------------

/**
 * Convert AssembledPrompt.messages to Anthropic message format.
 *
 * Anthropic expects content as AnthropicTextBlock[].
 * For string content: direct text block.
 * For structured content (image_url etc.): stringify as fallback,
 * since Anthropic text blocks cannot represent image_url natively.
 * For null content: empty text block.
 */
export function assembledToAnthropicMessages(
  messages: AssembledPrompt["messages"]
): AnthropicWireMessage[] {
  const result: AnthropicWireMessage[] = [];

  for (const msg of messages) {
    const role = msg.role;
    const text = contentToPlainText(msg.content);

    const prev = result[result.length - 1];
    if (prev?.role === role) {
      prev.content.push({ type: "text", text });
      continue;
    }

    result.push({ role, content: [{ type: "text", text }] });
  }

  if (result.length === 0) {
    result.push({ role: "user", content: [{ type: "text", text: "" }] });
  }

  return result;
}

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

function contentToPlainText(content: string | unknown[] | null): string {
  if (typeof content === "string") return content;
  if (content == null) return "";
  // Structured content (image_url etc.) — stringify as fallback for Anthropic
  return JSON.stringify(content);
}
