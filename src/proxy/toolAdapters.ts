/**
 * Tool-call translation layer: OpenAI ↔ Anthropic schema conversion.
 *
 * Aelios is a passthrough gateway, NOT a tool executor.
 * This module translates tool definitions, tool_choice, and tool-related
 * messages between OpenAI and Anthropic wire formats so that the model
 * receives proper tool protocol (instead of cosplaying <memo_touch> in text).
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AnthropicTool {
  name: string;
  description: string;
  input_schema: { type: "object"; [key: string]: unknown };
}

export type AnthropicToolChoice =
  | { type: "auto" }
  | { type: "any" }
  | { type: "tool"; name: string }
  | { type: "none" };

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

// ---------------------------------------------------------------------------
// OpenAI tools → Anthropic tools
// ---------------------------------------------------------------------------

export function openAIToolsToAnthropic(
  tools: unknown
): AnthropicTool[] | undefined {
  if (!Array.isArray(tools) || tools.length === 0) return undefined;

  return tools.map((tool) => {
    const t = tool as {
      type?: string;
      function?: { name: string; description?: string; parameters?: unknown };
    };
    const fn = t.function ?? (tool as { name: string; description?: string; parameters?: unknown });
    return {
      name: fn.name,
      description: fn.description ?? "",
      input_schema: (fn.parameters as { type: "object"; [key: string]: unknown }) ?? {
        type: "object" as const,
        properties: {},
      },
    };
  });
}

// ---------------------------------------------------------------------------
// OpenAI tool_choice → Anthropic tool_choice
// ---------------------------------------------------------------------------

export function openAIToolChoiceToAnthropic(
  toolChoice: unknown
): AnthropicToolChoice | undefined {
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

// ---------------------------------------------------------------------------
// Detect forced tool_choice (not auto/none — requires specific tool or "required")
// ---------------------------------------------------------------------------

export function isForcedToolChoice(toolChoice: unknown): boolean {
  if (toolChoice === "required") return true;
  if (typeof toolChoice === "object" && toolChoice !== null) {
    const tc = toolChoice as { type?: string; function?: { name?: string } };
    return tc.type === "function" && Boolean(tc.function?.name);
  }
  return false;
}

// ---------------------------------------------------------------------------
// Safe JSON parse for tool arguments
// ---------------------------------------------------------------------------

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

export function anthropicToolUseBlocksToOpenAI(
  blocks: AnthropicToolUseBlock[]
): OpenAIToolCall[] {
  return blocks.map((block) => ({
    id: block.id,
    type: "function" as const,
    function: {
      name: block.name,
      arguments: typeof block.input === "string" ? block.input : JSON.stringify(block.input ?? {}),
    },
  }));
}