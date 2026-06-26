/**
 * Tool-call translation layer: OpenAI ↔ Anthropic schema conversion.
 *
 * Aelios is a passthrough gateway, NOT a tool executor.
 * This module translates tool definitions, tool_choice, and tool-related
 * messages between OpenAI and Anthropic wire formats so that the model
 * receives proper tool protocol (instead of cosplaying <memo_touch> in text).
 *
 * Canonical types and core functions live in assembler/toAnthropic.ts.
 * This module re-exports them for backward compatibility and adds
 * adapter-specific helpers.
 */

export {
  type AnthropicTool,
  type AnthropicToolChoice,
  type AnthropicToolUseBlock,
  type AnthropicToolResultBlock,
  type OpenAIToolCall,
  openAIToolsToAnthropic,
  openAIToolChoiceToAnthropic,
  isForcedToolChoice,
  safeParseJSON,
  anthropicToolUseBlocksToOpenAI,
  stableStringify,
} from "../assembler/toAnthropic";
