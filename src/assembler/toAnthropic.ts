/**
 * Pure conversion: AssembledPrompt → Anthropic wire format types.
 *
 * These helpers do NOT call any adapter, DB, or external service.
 * The anthropicAdapter consumes them via buildAnthropicRequestFromAssembled.
 *
 * Determinism: given the same AssembledPrompt, output is bit-for-bit identical.
 */

import type { AssembledPrompt, CacheBreakpoint, SystemBlock } from "./types";

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

export interface AnthropicToolUseBlock {
  type: "tool_use";
  id: string;
  name: string;
  input: unknown;
}

export interface AnthropicToolResultBlock {
  type: "tool_result";
  tool_use_id: string;
  content: string | Array<{ type: "text"; text: string }>;
}

export type AnthropicContentBlock =
  | AnthropicTextBlock
  | AnthropicToolUseBlock
  | AnthropicToolResultBlock;

export interface AnthropicWireMessage {
  role: "user" | "assistant";
  content: AnthropicContentBlock[];
}

export interface AnthropicTool {
  name: string;
  description: string;
  input_schema: { type: "object"; [key: string]: unknown };
  cache_control?: { type: "ephemeral"; ttl?: "5m" | "1h" };
}

export type AnthropicToolChoice =
  | { type: "auto" }
  | { type: "any" }
  | { type: "tool"; name: string }
  | { type: "none" };

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
/**
 * Convert assembled messages to Anthropic wire format, merging consecutive
 * same-role messages. Returns both the wire messages and a mapping from
 * original (assembled) message indices to wire message indices, so that
 * cache breakpoints can be applied to the correct wire message even after
 * merging.
 */
export function assembledToAnthropicMessages(
  messages: AssembledPrompt["messages"]
): { wire: AnthropicWireMessage[]; indexMap: Map<number, number> } {
  const wire: AnthropicWireMessage[] = [];
  const indexMap = new Map<number, number>();

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    const role = msg.role;
    const text = contentToPlainText(msg.content);

    const prev = wire[wire.length - 1];
    if (prev?.role === role) {
      prev.content.push({ type: "text", text });
      // This original message merges into the same wire message as the previous
      indexMap.set(i, wire.length - 1);
      continue;
    }

    wire.push({ role, content: [{ type: "text", text }] });
    indexMap.set(i, wire.length - 1);
  }

  if (wire.length === 0) {
    wire.push({ role: "user", content: [{ type: "text", text: "" }] });
  }

  return { wire, indexMap };
}

// ---------------------------------------------------------------------------
// Cache breakpoints → apply cache_control to the wire messages
// ---------------------------------------------------------------------------

/**
 * Apply cache_control breakpoints to Anthropic wire messages.
 *
 * "system" targets are handled by assembledToAnthropicSystem (already in
 * SystemBlock.cache_control). This function handles "message" targets:
 * it stamps cache_control on the specified content block within the wire
 * message corresponding to the assembled message at breakpoint.message_index,
 * using the index mapping produced by assembledToAnthropicMessages.
 *
 * block_index defaults to the last content block if not specified.
 */
export function applyMessageCacheBreakpoints(
  wireMessages: AnthropicWireMessage[],
  breakpoints: CacheBreakpoint[],
  indexMap: Map<number, number>,
  cacheControl: { type: "ephemeral"; ttl?: "5m" | "1h" }
): void {
  for (const bp of breakpoints) {
    if (bp.target !== "message") continue;
    if (bp.message_index == null) continue;
    const wireIdx = indexMap.get(bp.message_index);
    if (wireIdx == null) continue;
    const msg = wireMessages[wireIdx];
    if (!msg || msg.content.length === 0) continue;

    const blockIdx = bp.block_index ?? msg.content.length - 1;
    const block = msg.content[blockIdx];
    if (block && block.type === "text") {
      block.cache_control = cacheControl;
    }
  }
}

// ---------------------------------------------------------------------------
// OpenAI tools → Anthropic tools (stable serialization)
// ---------------------------------------------------------------------------

/**
 * Deterministic sort for tool input_schema properties.
 * Deep-sort all object keys so JSON.stringify output is stable
 * regardless of insertion order.
 */
export function stableStringify(obj: unknown): string {
  if (obj === null || typeof obj !== "object") return JSON.stringify(obj);
  if (Array.isArray(obj)) return "[" + obj.map(stableStringify).join(",") + "]";
  const keys = Object.keys(obj as Record<string, unknown>).sort();
  const pairs = keys.map(
    (k) => JSON.stringify(k) + ":" + stableStringify((obj as Record<string, unknown>)[k])
  );
  return "{" + pairs.join(",") + "}";
}

/**
 * Convert OpenAI tools array to Anthropic tools.
 * Sorts tools by name for deterministic ordering.
 * Sorts input_schema keys recursively for stable serialization.
 */
export function openAIToolsToAnthropic(tools: unknown): AnthropicTool[] | undefined {
  if (!Array.isArray(tools) || tools.length === 0) return undefined;

  const converted = tools.map((tool) => {
    const t = tool as {
      type?: string;
      function?: { name: string; description?: string; parameters?: unknown };
    };
    const fn = t.function ?? (tool as { name: string; description?: string; parameters?: unknown });
    return {
      name: fn.name,
      description: fn.description ?? "",
      input_schema: stableSortSchema(
        (fn.parameters as { type: "object"; [key: string]: unknown }) ?? {
          type: "object" as const,
          properties: {},
        }
      ) as { type: "object"; [key: string]: unknown },
    };
  });

  // Sort tools by name for deterministic order
  converted.sort((a, b) => a.name.localeCompare(b.name));
  return converted;
}

/**
 * Deep-sort an object's keys recursively so that JSON serialization is deterministic.
 */
function stableSortSchema(obj: unknown): unknown {
  if (obj === null || typeof obj !== "object") return obj;
  if (Array.isArray(obj)) return obj.map(stableSortSchema);
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(obj as Record<string, unknown>).sort()) {
    sorted[key] = stableSortSchema((obj as Record<string, unknown>)[key]);
  }
  return sorted;
}

/**
 * Convert OpenAI tool_choice to Anthropic tool_choice.
 */
export function openAIToolChoiceToAnthropic(toolChoice: unknown): AnthropicToolChoice | undefined {
  if (toolChoice == null) return undefined;

  if (toolChoice === "auto") return { type: "auto" };
  if (toolChoice === "none") return { type: "none" };
  if (toolChoice === "required") return { type: "any" };

  if (typeof toolChoice === "object") {
    const tc = toolChoice as { type?: string; function?: { name?: string } };
    if (tc.type === "function" && tc.function?.name) {
      return { type: "tool", name: tc.function.name };
    }
    if (tc.type === "auto" || tc.type === "none" || tc.type === "any") {
      return { type: tc.type };
    }
  }

  return undefined;
}

/**
 * Detect forced tool_choice (not auto/none — requires specific tool or "required").
 */
export function isForcedToolChoice(toolChoice: unknown): boolean {
  if (toolChoice === "required") return true;
  if (typeof toolChoice === "object" && toolChoice !== null) {
    const tc = toolChoice as { type?: string; function?: { name?: string } };
    return tc.type === "function" && Boolean(tc.function?.name);
  }
  return false;
}

/**
 * Safe JSON parse for tool arguments.
 */
export function safeParseJSON(value: unknown): unknown {
  if (value == null) return {};
  if (typeof value === "object") return value;
  if (typeof value !== "string") return {};
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

// ---------------------------------------------------------------------------
// Anthropic tool_use blocks → OpenAI tool_calls
// ---------------------------------------------------------------------------

export interface OpenAIToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
}

export function anthropicToolUseBlocksToOpenAI(blocks: AnthropicToolUseBlock[]): OpenAIToolCall[] {
  return blocks.map((block) => ({
    id: block.id,
    type: "function" as const,
    function: {
      name: block.name,
      arguments: typeof block.input === "string" ? block.input : JSON.stringify(block.input ?? {}),
    },
  }));
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
