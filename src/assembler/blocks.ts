/**
 * 9 block implementations for the v4 Prompt Assembler.
 *
 * Each block's content_fn must be deterministic: same ctx → same string.
 * No timestamps, no request ids, no Map iteration order.
 *
 * Passthrough blocks (recent_history, current_user) route to
 * AssembledPrompt.messages with original content preserved, NOT to system_blocks.
 *
 * This module is self-contained; it does NOT import from memory/inject.ts
 * or the adapters.
 */

import type { MemoryApiRecord, OpenAIChatMessage } from "../types";
import { preprocessHistory } from "../preset/historyPreprocess";
import type {
  AssembledPrompt,
  AssemblerContext,
  Block,
  CacheBreakpoint,
  SystemBlock,
} from "./types";
import { BLOCK_ORDER, countMessageBlocks, formatBootStable } from "./types";

// ---------------------------------------------------------------------------
// Local helpers (no external imports — keeps assembler self-contained)
// ---------------------------------------------------------------------------

function contentToText(content: OpenAIChatMessage["content"]): string {
  if (typeof content === "string") return content;
  if (content == null) return "";
  return (content as unknown[])
    .flatMap((part: unknown) => {
      if (!part || typeof part !== "object" || Array.isArray(part)) return [];
      const value = part as { type?: unknown; text?: unknown };
      return value.type === "text" && typeof value.text === "string"
        ? [value.text]
        : [];
    })
    .join("\n");
}

function sanitizeMemoryContent(text: string): string {
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

function isNonEmptyContent(content: OpenAIChatMessage["content"]): boolean {
  if (typeof content === "string") return content.trim().length > 0;
  if (content == null) return false;
  return Array.isArray(content) && content.length > 0;
}

function messageToOutput(
  msg: OpenAIChatMessage
): { role: "user" | "assistant"; content: string | unknown[] | null } | null {
  if (msg.role !== "user" && msg.role !== "assistant") return null;
  if (!isNonEmptyContent(msg.content)) return null;
  return { role: msg.role, content: msg.content };
}

// ---------------------------------------------------------------------------
// Block 1: proxy_static_rules (stable)
// ---------------------------------------------------------------------------

const PROXY_STATIC_RULES_TEXT = [
  "遵循前端提供的角色、关系和上下文，自然对话即可。",
  "不要暴露记忆系统、数据库、RAG、代理层或任何后端实现。",
  "不要机械复述设定原文，用自己的话自然表达。",
  "如果记忆与当前对话无关，不要强行提起。",
].join("\n");

const proxyStaticRulesBlock: Block = {
  id: "proxy_static_rules",
  kind: "stable",
  role: "system",
  cache_anchor: false,
  content_fn: () => PROXY_STATIC_RULES_TEXT,
};

// ---------------------------------------------------------------------------
// Block 2: persona_pinned (stable)
// Pinned memories where type ∈ {persona, identity}.
// Sort: type asc, importance desc, id asc (deterministic).
// ---------------------------------------------------------------------------

function formatPersonaPinned(memories: MemoryApiRecord[]): string {
  return memories
    .map((m) => ({ ...m, content: sanitizeMemoryContent(m.content) }))
    .filter((m) => m.content)
    .map((m) => `- [${m.type}][importance=${m.importance.toFixed(2)}] ${m.content}`)
    .join("\n");
}

const personaPinnedBlock: Block = {
  id: "persona_pinned",
  kind: "stable",
  role: "system",
  cache_anchor: false,
  content_fn: (ctx: AssemblerContext): string | null => {
    const personaMemories = ctx.pinnedPersonaMemories ?? [];
    const preciousMemories = ctx.boot?.precious.map((p) => ({
      id: p.id,
      namespace: "",
      type: "precious",
      content: p.content,
      summary: null,
      importance: 1,
      confidence: 1,
      status: "active",
      pinned: true,
      tags: [],
      source: "precious",
      source_message_ids: [],
      vector_id: null,
      last_recalled_at: null,
      recall_count: 0,
      created_at: p.created_at,
      updated_at: p.created_at,
      expires_at: null,
      fact_key: null,
      supersedes_id: null,
      superseded_by_id: null,
      review_reason: null,
      valid_as_of: null,
      last_seen_at: null,
      seen_count: 0,
      last_injected_at: null,
      score: undefined,
    })) ?? [];
    const all = [...personaMemories, ...preciousMemories];
    if (all.length === 0) return null;

    const sorted = [...all].sort((a, b) => {
      const typeCmp = a.type.localeCompare(b.type);
      if (typeCmp !== 0) return typeCmp;
      if (b.importance !== a.importance) return b.importance - a.importance;
      return a.id.localeCompare(b.id);
    });

    const text = formatPersonaPinned(sorted);
    return text || null;
  },
};

// ---------------------------------------------------------------------------
// Block 3: preset_lite (stable)
// Fixed string from plan §5.1, ≤300 chars, hardcoded constant.
// ---------------------------------------------------------------------------

const PRESET_LITE_TEXT = [
  "<output_style_lite>",
  "- 自然中文，避免翻译腔和过度名词化",
  "- 多用具体动作和对白承载情绪，少用作者式分析",
  "- 对白可独立成段，不机械复述设定",
  "- 全角标点，不用破折号，用逗号或句号替代",
  "</output_style_lite>",
].join("\n");

const presetLiteBlock: Block = {
  id: "preset_lite",
  kind: "stable",
  role: "system",
  cache_anchor: false,
  content_fn: () => PRESET_LITE_TEXT,
};

// ---------------------------------------------------------------------------
// Block 3.5: boot_stable (stable)
// v2 boot package: digest + yesterday_log + glossary.
// Sits before cache anchor — stable content that rarely changes.
// ---------------------------------------------------------------------------

const bootStableBlock: Block = {
  id: "boot_stable",
  kind: "stable",
  role: "system",
  cache_anchor: false,
  content_fn: (ctx: AssemblerContext): string | null => {
    if (!ctx.boot) return null;
    const text = formatBootStable(ctx.boot);
    return text || null;
  },
};

// ---------------------------------------------------------------------------
// Block 4: client_system (stable, cache_anchor = true)
// Frontend system messages concatenated.
// ---------------------------------------------------------------------------

function extractSystemTexts(messages: OpenAIChatMessage[]): string[] {
  return messages
    .filter((m) => m.role === "system")
    .map((m) => contentToText(m.content).trim())
    .filter(Boolean);
}

function isVolatileTimeLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed) return false;
  const normalized = trimmed.replace(/^[>*\-\d.)\s]+/, "").trim();
  const lower = normalized.toLowerCase();

  const hasTimeLabel =
    /^the\s+current\s+(?:date|time|datetime|timestamp|timezone)\b/.test(lower) ||
    /^(?:current|today'?s?|now|local|system|request)\s+(?:date|time|datetime|timestamp|timezone)\b/.test(lower) ||
    /^(?:date|time|datetime|timestamp|timezone)\s*[:：=]/.test(lower) ||
    /^(?:当前|现在|今日|今天|本日|系统|请求|本地)?(?:日期|时间|日期时间|时间戳|时区)\s*[:：=是为]/.test(normalized) ||
    /^(?:今天|今日|现在)\s*(?:是|为)/.test(normalized);

  const hasDateLikeValue =
    /\b\d{4}[-/]\d{1,2}[-/]\d{1,2}\b/.test(normalized) ||
    /\b\d{4}年\d{1,2}月\d{1,2}日/.test(normalized) ||
    /\b(?:19|20)\d{2}\b/.test(normalized) ||
    /\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+\d{1,2},?\s+\d{4}\b/i.test(normalized) ||
    /\b\d{1,2}:\d{2}(?::\d{2})?\b/.test(normalized);

  return hasTimeLabel && (hasDateLikeValue || /\btimezone\b/i.test(normalized) || /时区/.test(normalized));
}

function splitClientSystemTexts(texts: string[]): { stable: string[]; volatile: string[] } {
  const stable: string[] = [];
  const volatile: string[] = [];

  for (const text of texts) {
    const stableLines: string[] = [];
    const volatileLines: string[] = [];

    for (const line of text.split(/\r?\n/)) {
      if (isVolatileTimeLine(line)) volatileLines.push(line.trim());
      else stableLines.push(line);
    }

    const stableText = stableLines.join("\n").trim();
    const volatileText = volatileLines.join("\n").trim();
    if (stableText) stable.push(stableText);
    if (volatileText) volatile.push(volatileText);
  }

  return { stable, volatile };
}

const clientSystemBlock: Block = {
  id: "client_system",
  kind: "stable",
  role: "system",
  cache_anchor: true,
  content_fn: (ctx: AssemblerContext): string | null => {
    const { stable } = splitClientSystemTexts(extractSystemTexts(ctx.systemMessages));
    if (stable.length === 0) return null;
    return stable.join("\n\n");
  },
};

// ---------------------------------------------------------------------------
// Block 4.5: client_volatile_context (dynamic)
// Frontend time/date lines split out of client_system so they do not poison
// the stable Claude prompt-cache anchor.
// ---------------------------------------------------------------------------

const clientVolatileContextBlock: Block = {
  id: "client_volatile_context",
  kind: "dynamic",
  role: "system",
  cache_anchor: false,
  content_fn: (ctx: AssemblerContext): string | null => {
    const { volatile } = splitClientSystemTexts(extractSystemTexts(ctx.systemMessages));
    if (volatile.length === 0) return null;
    return [
      "<volatile_context>",
      "以下是客户端提供的当前时间/日期等本轮上下文，只用于当前回复，不要当作长期设定。",
      ...volatile,
      "</volatile_context>",
    ].join("\n");
  },
};

// ---------------------------------------------------------------------------
// Block 5: dynamic_memory_patch (dynamic)
// Current RAG hits, tagged <memories>...</memories>.
// ---------------------------------------------------------------------------

function formatRagMemories(memories: MemoryApiRecord[]): string {
  const lines = memories
    .map((m) => ({ ...m, content: sanitizeMemoryContent(m.content) }))
    .filter((m) => m.content)
    .map((m) => `- [${m.type}][importance=${m.importance.toFixed(2)}] ${m.content}`);
  if (lines.length === 0) return "";

  return [
    "<memories>",
    ...lines,
    "</memories>",
  ].join("\n");
}

const dynamicMemoryPatchBlock: Block = {
  id: "dynamic_memory_patch",
  kind: "dynamic",
  role: "system",
  cache_anchor: false,
  content_fn: (ctx: AssemblerContext): string | null => {
    if (ctx.ragMemories.length === 0) return null;
    return formatRagMemories(ctx.ragMemories) || null;
  },
};

// ---------------------------------------------------------------------------
// Block 6: vision_context (dynamic)
// Vision assistant output; only when image present + main model non-multimodal.
// ---------------------------------------------------------------------------

const visionContextBlock: Block = {
  id: "vision_context",
  kind: "dynamic",
  role: "system",
  cache_anchor: false,
  content_fn: (ctx: AssemblerContext): string | null => {
    if (!ctx.visionOutput) return null;
    return `<vision_context>\n${ctx.visionOutput}\n</vision_context>`;
  },
};

// ---------------------------------------------------------------------------
// Block 7: recent_history (passthrough)
// Frontend messages excluding system and the final user message.
// Routes to AssembledPrompt.messages with original content preserved.
// History strip (§5.2 regex) will be applied in P2.
// ---------------------------------------------------------------------------

const recentHistoryBlock: Block = {
  id: "recent_history",
  kind: "passthrough",
  role: "system",
  cache_anchor: false,
  // content_fn returns null for passthrough; assemble() reads ctx directly
  content_fn: () => null,
};

// ---------------------------------------------------------------------------
// Block 8: current_user (passthrough)
// The last user message, untouched — original content preserved.
// Routes to AssembledPrompt.messages.
// ---------------------------------------------------------------------------

const currentUserBlock: Block = {
  id: "current_user",
  kind: "passthrough",
  role: "system",
  cache_anchor: false,
  // content_fn returns null for passthrough; assemble() reads ctx directly
  content_fn: () => null,
};

// ---------------------------------------------------------------------------
// All blocks in fixed order, derived from BLOCK_ORDER for consistency.
// ---------------------------------------------------------------------------

const BLOCK_MAP = new Map<string, Block>([
  [proxyStaticRulesBlock.id, proxyStaticRulesBlock],
  [personaPinnedBlock.id, personaPinnedBlock],
  [presetLiteBlock.id, presetLiteBlock],
  [bootStableBlock.id, bootStableBlock],
  [clientSystemBlock.id, clientSystemBlock],
  [clientVolatileContextBlock.id, clientVolatileContextBlock],
  [dynamicMemoryPatchBlock.id, dynamicMemoryPatchBlock],
  [visionContextBlock.id, visionContextBlock],
  [recentHistoryBlock.id, recentHistoryBlock],
  [currentUserBlock.id, currentUserBlock],
]);

// Derive ALL_BLOCKS from BLOCK_ORDER — single source of truth.
const ALL_BLOCKS: readonly Block[] = BLOCK_ORDER.map((id) => {
  const block = BLOCK_MAP.get(id);
  if (!block) throw new Error(`BLOCK_ORDER references unknown block id: ${id}`);
  return block;
});

// Validate at module load: BLOCK_MAP must cover every entry in BLOCK_ORDER.
if (ALL_BLOCKS.length !== BLOCK_MAP.size) {
  throw new Error(
    `BLOCK_ORDER (${BLOCK_ORDER.length} entries) and BLOCK_MAP (${BLOCK_MAP.size} entries) disagree`
  );
}

// ---------------------------------------------------------------------------
// assemble() — deterministic prompt assembly
// ---------------------------------------------------------------------------

/**
 * Assemble a prompt from blocks + context.
 *
 * - stable/dynamic blocks → system_blocks (with optional cache_control)
 * - passthrough blocks → messages (original content preserved)
 * - null content_fn → block skipped
 * - anchor_index points to the position of client_system in system_blocks
 * - client_system_hash is a deterministic hash of the client_system text
 *
 * Determinism: block order is fixed by BLOCK_ORDER array, never Map iteration.
 */
export function assemble(ctx: AssemblerContext): AssembledPrompt {
  const systemBlocks: SystemBlock[] = [];
  const messages: Array<{ role: "user" | "assistant"; content: string | unknown[] | null }> = [];
  const enabledBlockIds: string[] = [];
  let anchorIndex = -1;

  for (const block of ALL_BLOCKS) {
    if (block.kind === "passthrough") {
      // Passthrough blocks route to messages with original content preserved.
      if (block.id === "recent_history") {
        // Strip <thinking> tags from historical messages before they enter
        // the assembled prompt. Current user message is NEVER touched.
        const cleanedHistory = preprocessHistory(ctx.historyMessages);
        let added = false;
        for (const msg of cleanedHistory) {
          const out = messageToOutput(msg);
          if (out) {
            messages.push(out);
            added = true;
          }
        }
        if (added) enabledBlockIds.push(block.id);
      } else if (block.id === "current_user") {
        if (ctx.currentUserMessage) {
          const out = messageToOutput(ctx.currentUserMessage);
          if (out) {
            messages.push(out);
            enabledBlockIds.push(block.id);
          }
        }
      }
      continue;
    }

    // Stable / dynamic blocks → system_blocks
    const text = block.content_fn(ctx);
    if (text === null) continue;

    const systemBlock: SystemBlock = { role: "system", text };

    if (block.cache_anchor) {
      systemBlock.cache_control = { type: "ephemeral", ttl: "5m" };
      anchorIndex = systemBlocks.length;
    }

    systemBlocks.push(systemBlock);
    enabledBlockIds.push(block.id);
  }

  // client_system_hash: deterministic hash of the client_system block text
  let clientSystemHash = "none";
  for (let i = 0; i < systemBlocks.length; i++) {
    if (enabledBlockIds[i] === "client_system") {
      clientSystemHash = simpleHash(systemBlocks[i].text);
      break;
    }
  }

  // --- Cache breakpoints (up to 4 for Anthropic) ---
  //
  // Anthropic prompt caching works on the full prefix: tools → system → messages.
  // Each breakpoint marks a position; everything before it is cached.
  // Each looks back up to 20 content blocks for a previous cache entry.
  //
  // Breakpoint 1 (tools): applied in adapter if tool definitions are stable.
  // Breakpoint 2 (system): persona_pinned — the most stable content.
  // Breakpoint 3 (bridge): mid-history for long conversations (>16 blocks),
  //   so the tail anchor's 20-block lookback doesn't lose older cached prefix.
  // Breakpoint 4 (tail): last stable block before dynamic content.
  //   Mode A (default): last block of the message before current_user.
  //   Mode B: first text block of current_user (opt-in).
  //
  // Dynamic content (memories, time reminders) is appended AFTER all
  // breakpoints and never gets cache_control.
  const LOOKBACK = 16; // Conservative margin (Anthropic allows 20)
  const breakpoints: CacheBreakpoint[] = [];

  // Breakpoint 2: system anchor on persona_pinned
  if (anchorIndex >= 0) {
    breakpoints.push({
      target: "system",
      system_block_index: anchorIndex,
      reason: "system",
    });
  }

  // Message-level breakpoints: bridge + tail
  // Count content blocks in each message for 20-block lookback spacing
  const msgBlockCounts = messages.map((m) => countMessageBlocks(m.content));

  // tailIdx: message to place the tail breakpoint on.
  // Default (mode A): second-to-last message (last history msg before current user).
  // If only 1 message and mode A: no tail (system anchor covers the prefix).
  let tailIdx = -1;
  let tailBlockIdx = -1;
  if (messages.length >= 2) {
    tailIdx = messages.length - 2;
    tailBlockIdx = Math.max(0, msgBlockCounts[tailIdx] - 1);
  }

  if (tailIdx >= 0) {
    breakpoints.push({
      target: "message",
      message_index: tailIdx,
      block_index: tailBlockIdx,
      reason: "tail",
    });

    // bridge: if total message blocks before the tail message is > LOOKBACK,
    // place a bridge anchor ~LOOKBACK blocks before the tail to keep the
    // cache chain connected across long conversations.
    let blocksBeforeTail = 0;
    for (let i = 0; i < tailIdx; i++) blocksBeforeTail += msgBlockCounts[i];

    if (blocksBeforeTail > LOOKBACK) {
      // Walk backward from tailIdx to find the message containing
      // the block at position (blocksBeforeTail - LOOKBACK)
      let target = blocksBeforeTail - LOOKBACK;
      let accumulated = 0;
      let bridgeMsgIdx = 0;
      let bridgeBlockIdx = 0;
      for (let i = 0; i < tailIdx; i++) {
        if (accumulated + msgBlockCounts[i] > target) {
          bridgeMsgIdx = i;
          bridgeBlockIdx = target - accumulated;
          break;
        }
        accumulated += msgBlockCounts[i];
      }
      // Don't add bridge if it would be the same as tail
      if (bridgeMsgIdx !== tailIdx || bridgeBlockIdx !== tailBlockIdx) {
        breakpoints.push({
          target: "message",
          message_index: bridgeMsgIdx,
          block_index: bridgeBlockIdx,
          reason: "bridge",
        });
      }
    }
  }

  return {
    system_blocks: systemBlocks,
    messages,
    meta: {
      anchor_index: anchorIndex,
      block_ids: enabledBlockIds,
      client_system_hash: clientSystemHash,
      cache_breakpoints: breakpoints,
    },
  };
}

/**
 * Deterministic hash for client_system_hash field.
 * Uses a simple DJB2 variant — not cryptographic, just stable.
 * For production, callers can replace with SHA-256 via crypto.subtle.
 */
function simpleHash(text: string): string {
  let hash = 5381;
  for (let i = 0; i < text.length; i++) {
    hash = ((hash << 5) + hash + text.charCodeAt(i)) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

// ---------------------------------------------------------------------------
// Exported for testing / adapter integration
// ---------------------------------------------------------------------------

export { ALL_BLOCKS, BLOCK_MAP };
