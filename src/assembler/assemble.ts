/**
 * assemble — main entry point for the v4 Prompt Assembler.
 *
 * Converts an OpenAIChatRequest into an AssembledPrompt.
 * The adapters (anthropic/openai) consume the output via the
 * buildAnthropicRequestFromAssembled / buildOpenAIRequestFromAssembled helpers.
 *
 * Determinism: given the same request + pre-fetched data, the output is
 * bit-for-bit identical across calls. No timestamps, no request ids.
 */

import type {
  MemoryApiRecord,
  OpenAIChatMessage,
  OpenAIChatRequest,
} from "../types";
import type { AssembledPrompt, AssemblerContext } from "./types";
import { assemble as assembleBlocks } from "./blocks";

// ---------------------------------------------------------------------------
// Input for assemble — pre-fetched data, no DB calls here
// ---------------------------------------------------------------------------

export interface AssembleInput {
  /** The incoming OpenAI-compatible chat request. */
  request: OpenAIChatRequest;

  /**
   * Pre-filtered pinned memories of type "persona" or "identity".
   * Caller is responsible for filtering and initial sort;
   * the assembler applies its own deterministic sort as a safety net.
   */
  pinnedPersonaMemories: MemoryApiRecord[] | null;

  /** RAG hits for the current round. */
  ragMemories: MemoryApiRecord[];

  /** Vision assistant output (image present + main model non-multimodal). */
  visionOutput: string | null;
}

// ---------------------------------------------------------------------------
// assemble() — main entry
// ---------------------------------------------------------------------------

/**
 * Build an AssembledPrompt from an OpenAI request + pre-fetched context data.
 *
 * The caller (adapter) is responsible for:
 * - Fetching pinnedPersonaMemories from D1
 * - Running RAG search for ragMemories
 * - Running vision model for visionOutput
 * - Converting AssembledPrompt to Anthropic/OpenAI wire format
 */
export function assemble(input: AssembleInput): AssembledPrompt {
  const { request } = input;

  const ctx: AssemblerContext = {
    systemMessages: extractSystemMessages(request.messages),
    pinnedPersonaMemories: input.pinnedPersonaMemories,
    ragMemories: input.ragMemories,
    visionOutput: input.visionOutput,
    historyMessages: extractHistoryMessages(request.messages),
    currentUserMessage: extractLastUserMessage(request.messages),
  };

  return assembleBlocks(ctx);
}

// ---------------------------------------------------------------------------
// Message extraction helpers
// ---------------------------------------------------------------------------

function extractSystemMessages(messages: OpenAIChatMessage[]): OpenAIChatMessage[] {
  return messages.filter((m) => m.role === "system");
}

/**
 * All user/assistant messages EXCEPT the last user message.
 * Skips system and tool messages.
 * Preserves original message objects (no content flattening).
 */
function extractHistoryMessages(messages: OpenAIChatMessage[]): OpenAIChatMessage[] {
  // Find the index of the last user message
  let lastUserIdx = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "user") {
      lastUserIdx = i;
      break;
    }
  }

  const result: OpenAIChatMessage[] = [];
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    if (msg.role !== "user" && msg.role !== "assistant") continue;
    if (i === lastUserIdx) continue;
    result.push(msg);
  }

  return result;
}

/**
 * The last user message, preserving original content (including image_url).
 * Returns null if no user message exists.
 */
function extractLastUserMessage(messages: OpenAIChatMessage[]): OpenAIChatMessage | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "user") return messages[i];
  }
  return null;
}

// Re-export for adapter convenience
export { assembleBlocks };
export type { AssembledPrompt, AssemblerContext };
