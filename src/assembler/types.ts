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

export type BlockKind = "stable" | "turn_context" | "passthrough";

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

  /** v2 boot package (impressions ladder + precious + glossary). null = v1 path. */
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
 * Anthropic supports up to 4 cache_control breakpoints per request.
 * Each breakpoint marks a prefix: everything up to and including that
 * point is cached. Breakpoints are applied in request order
 * (tools → system → messages), and each looks back up to 20 content
 * blocks for a previous cache entry.
 *
 * target:
 *   - "system"  → system_blocks[system_block_index]
 *   - "message" → messages[message_index].content[block_index]
 *       block_index is the 0-based position within the message's
 *       content array. For text content (string), block_index=0.
 *       For array content (time_reminder + text + memories),
 *       block_index points to the specific content part.
 *
 * reason: human-readable tag (tools / system / bridge / tail)
 */
export interface CacheBreakpoint {
  target: "system" | "message";
  system_block_index?: number;
  message_index?: number;
  block_index?: number;
  reason: string;
}

/**
 * Count the number of content blocks in a message.
 * String content = 1 block. Array content = array.length blocks.
 * Used for computing 20-block lookback spacing.
 */
export function countMessageBlocks(
  content: string | unknown[] | null
): number {
  if (content == null) return 0;
  if (typeof content === "string") return 1;
  if (!Array.isArray(content)) return 0;
  return content.length;
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
  "preset_lite",
  "client_system",
  "persona_pinned",
  "boot_stable",
  "client_volatile_context",
  "dynamic_memory_patch",
  "vision_context",
  "recent_history",
  "current_user",
] as const;

/**
 * The cache anchor falls after persona_pinned (index 3).
 * Cache prefix = proxy_static_rules + preset_lite + client_system + persona_pinned.
 * Same four blocks as before, ordered by volatility (pure constants → deploy-level
 * → slow-changing memory) so OpenAI/DeepSeek implicit prefix cache survives
 * persona/memory edits without invalidating the stable head.
 *
 * boot_stable (impressions ladder, glossary) is AFTER the anchor.
 * It changes daily but does NOT invalidate the cached system prefix.
 * client_volatile_context (time), dynamic_memory_patch (RAG), vision_context
 * are turn_context blocks — injected into the message stream before current_user,
 * after all cache breakpoints, never cached.
 */
export const CACHE_ANCHOR_AFTER_ID = "persona_pinned";

/** Per-turn dynamic blocks routed into the message stream, not system_blocks. */
export const TURN_CONTEXT_BLOCK_IDS: readonly string[] = [
  "client_volatile_context",
  "dynamic_memory_patch",
  "vision_context",
] as const;

// ---------------------------------------------------------------------------
// Allowed memory types for persona_pinned
// ---------------------------------------------------------------------------

export const PERSONA_MEMORY_TYPES: readonly string[] = ["identity", "persona"] as const;

function formatImpressionLine(entry: { label: string; title: string; summary: string }): string {
  return `【${entry.label}·${entry.title}】${entry.summary}`;
}

function buildImpressionsLadder(boot: BootPackage): string[] {
  const ladder = boot.impressions;
  if (!ladder) return [];

  const lines: string[] = [];
  if (ladder.daily) lines.push(formatImpressionLine(ladder.daily));
  if (ladder.weekly) lines.push(formatImpressionLine(ladder.weekly));
  if (ladder.monthly) lines.push(formatImpressionLine(ladder.monthly));
  if (lines.length === 0) return [];

  const maxChars = ladder.max_chars > 0 ? ladder.max_chars : 1000;
  const selected = [...lines];
  while (selected.length > 1) {
    if (selected.join("\n").length <= maxChars) return selected;
    selected.pop();
  }
  const dailyLine = selected[0];
  if (!dailyLine) return [];
  if (dailyLine.length <= maxChars) return selected;
  if (!ladder.daily) return selected;
  const prefix = `【${ladder.daily.label}·${ladder.daily.title}】`;
  const summaryBudget = Math.max(0, maxChars - prefix.length);
  return [`${prefix}${ladder.daily.summary.slice(0, summaryBudget)}`];
}

export function formatBootStable(boot: BootPackage): string {
  const parts: string[] = [];
  const impressions = buildImpressionsLadder(boot);
  if (impressions.length > 0) {
    parts.push("<impressions>", ...impressions, "</impressions>");
  }
  if (boot.glossary.length > 0) {
    const entries = boot.glossary.map((g) => `${g.term}: ${g.definition}`);
    parts.push("<glossary>", ...entries, "</glossary>");
  }
  // LMC-5 spontaneous: 自发浮现，不是检索结果。最多 2 条；没有则整节省略。
  const spontaneous = boot.spontaneous ?? [];
  if (spontaneous.length > 0) {
    parts.push(
      "<spontaneous>",
      "以下是你上线前自发想起的事（不是检索结果）：",
      ...spontaneous.slice(0, 2).map((item) => `- ${item.content}`),
      "</spontaneous>"
    );
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
