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
 * or the adapters. The adapters will be rewired to consume AssembledPrompt
 * in a later phase (P1.3).
 */

import type { MemoryApiRecord, OpenAIChatMessage } from "../types";
import { preprocessHistory } from "../preset/historyPreprocess";
import type {
  AssembledPrompt,
  AssemblerContext,
  Block,
  SystemBlock,
} from "./types";
import {
  BLOCK_ORDER,
  SUMMARY_MAX_CHARS,
} from "./types";

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
    const memories = ctx.pinnedPersonaMemories;
    if (!memories || memories.length === 0) return null;

    // Deterministic sort: type asc → importance desc → id asc
    const sorted = [...memories].sort((a, b) => {
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
// Block 3: long_term_summary (stable)
// Latest summary entry, truncated to SUMMARY_MAX_CHARS.
// ---------------------------------------------------------------------------

function truncateSummary(content: string, maxChars: number): string {
  if (content.length <= maxChars) return content;
  return content.slice(0, maxChars - 3) + "...";
}

const longTermSummaryBlock: Block = {
  id: "long_term_summary",
  kind: "stable",
  role: "system",
  cache_anchor: false,
  content_fn: (ctx: AssemblerContext): string | null => {
    const entry = ctx.summaryEntry;
    if (!entry || !entry.content) return null;

    const truncated = truncateSummary(entry.content, SUMMARY_MAX_CHARS);
    return `长期对话摘要：\n${truncated}`;
  },
};

// ---------------------------------------------------------------------------
// Block 4: preset_lite (stable)
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
// Block 5: client_system (stable, cache_anchor = true)
// Frontend system messages concatenated.
// ---------------------------------------------------------------------------

function extractSystemTexts(messages: OpenAIChatMessage[]): string[] {
  return messages
    .filter((m) => m.role === "system")
    .map((m) => contentToText(m.content).trim())
    .filter(Boolean);
}

const clientSystemBlock: Block = {
  id: "client_system",
  kind: "stable",
  role: "system",
  cache_anchor: true,
  content_fn: (ctx: AssemblerContext): string | null => {
    const texts = extractSystemTexts(ctx.systemMessages);
    if (texts.length === 0) return null;
    return texts.join("\n\n");
  },
};

// ---------------------------------------------------------------------------
// Block 6: dynamic_memory_patch (dynamic)
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
// Block 7: vision_context (dynamic)
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
// Block 8: recent_history (passthrough)
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
// Block 9: current_user (passthrough)
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
  [longTermSummaryBlock.id, longTermSummaryBlock],
  [presetLiteBlock.id, presetLiteBlock],
  [clientSystemBlock.id, clientSystemBlock],
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

  return {
    system_blocks: systemBlocks,
    messages,
    meta: {
      anchor_index: anchorIndex,
      block_ids: enabledBlockIds,
      client_system_hash: clientSystemHash,
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
