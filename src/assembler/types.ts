/**
 * Assembler types for the v4 Prompt Assembler pipeline.
 *
 * BLOCK = { id, kind, role, content_fn, cache_anchor }
 * ORDER = single global order, no PACK branching.
 *
 * Determinism constraint: every content_fn must return the same string
 * for the same ctx. No timestamps, no request ids, no Map iteration order.
 */

import type { MemoryApiRecord, OpenAIChatMessage } from "../types";
import type { BootPackage } from "../memory/v2/recall";

// ---------------------------------------------------------------------------
// Block definition
// ---------------------------------------------------------------------------

export type BlockKind = "stable" | "dynamic" | "passthrough";

export interface Block {
  id: string;
  kind: BlockKind;
  role: "system";
  content_fn: (ctx: AssemblerContext) => string | null;
  cache_anchor: boolean;
}

// ---------------------------------------------------------------------------
// Assembler context — everything a block needs, nothing more
// ---------------------------------------------------------------------------

export interface AssemblerContext {
  /** Frontend system messages (role=system from the request). */
  systemMessages: OpenAIChatMessage[];

  /**
   * Pinned memories whose type is "persona" or "identity".
   * Caller pre-filters and pre-sorts; blocks trust this order.
   * If null, block 2 falls back to empty.
   */
  pinnedPersonaMemories: MemoryApiRecord[] | null;

  /** v2 boot package (digest + yesterday_log + precious + glossary). null = v1 path. */
  boot: BootPackage | null;

  /** RAG hits for the current round (v1) or recall hits (v2). */
  ragMemories: MemoryApiRecord[];

  /** Vision assistant output for the current round (image present, main model non-multimodal). */
  visionOutput: string | null;

  /** Frontend messages excluding the final user message. */
  historyMessages: OpenAIChatMessage[];

  /** The last user message from the frontend. */
  currentUserMessage: OpenAIChatMessage | null;
}

// ---------------------------------------------------------------------------
// Assembled output
// ---------------------------------------------------------------------------

export interface SystemBlock {
  role: "system";
  text: string;
  cache_control?: { type: "ephemeral"; ttl?: "5m" | "1h" };
}

/**
 * Explicit cache breakpoint for Anthropic prompt caching.
 *
 * target: where cache_control lands
 *   - "system" → system_blocks[system_block_index]
 *   - "message" → messages[message_index].content[last block]
 * reason: human-readable tag for debug/logging
 */
export interface CacheBreakpoint {
  target: "system" | "message";
  system_block_index?: number;
  message_index?: number;
  reason: string;
}

export interface AssembledPrompt {
  system_blocks: SystemBlock[];
  messages: Array<{ role: "user" | "assistant"; content: string | unknown[] | null }>;
  meta: {
    anchor_index: number;
    block_ids: string[];
    client_system_hash: string;
    cache_breakpoints: CacheBreakpoint[];
  };
}

// ---------------------------------------------------------------------------
// Global block order (9 blocks, single sequence, no PACK)
// ---------------------------------------------------------------------------

export const BLOCK_ORDER: readonly string[] = [
  "proxy_static_rules",
  "persona_pinned",
  "preset_lite",
  "boot_stable",
  "client_system",
  "client_volatile_context",
  "dynamic_memory_patch",
  "vision_context",
  "recent_history",
  "current_user",
] as const;

/**
 * The cache anchor always falls after client_system (index 4).
 * Stable blocks before it stay cached; dynamic/passthrough blocks after do not.
 * boot_stable (index 3) sits before the anchor — digest/yesterday_log/glossary are stable.
 */
export const CACHE_ANCHOR_AFTER_ID = "client_system";

// ---------------------------------------------------------------------------
// Allowed memory types for persona_pinned (block 2)
// ---------------------------------------------------------------------------

export const PERSONA_MEMORY_TYPES: readonly string[] = ["identity", "persona"] as const;

export function formatBootStable(boot: BootPackage): string {
  const parts: string[] = [];
  if (boot.digest) {
    parts.push("<digest>", boot.digest.content, "</digest>");
  }
  if (boot.yesterday_log) {
    parts.push(
      "<yesterday_log>",
      `【${boot.yesterday_log.title}】${boot.yesterday_log.summary}`,
      "</yesterday_log>"
    );
  }
  if (boot.glossary.length > 0) {
    const entries = boot.glossary.map((g) => `${g.term}: ${g.definition}`);
    parts.push("<glossary>", ...entries, "</glossary>");
  }
  return parts.join("\n");
}

export function formatRecallPatch(hits: Array<{ type: string; content: string; importance?: number }>): string {
  const lines = hits
    .map((h) => {
      const content = h.content.replace(/debug-test/gi, "").replace(/记忆系统/g, "").trim();
      if (!content) return null;
      return `- [${h.type}] ${content}`;
    })
    .filter(Boolean);
  if (lines.length === 0) return "";
  return ["<memories>", ...lines, "</memories>"].join("\n");
}
