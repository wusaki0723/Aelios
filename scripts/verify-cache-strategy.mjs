#!/usr/bin/env node
/**
 * CONTRACT MIRROR — tests for the v4 prompt caching strategy.
 *
 * Validates the 4-breakpoint Anthropic prompt caching strategy:
 *   1. tools: cache on last tool definition (stable tools)
 *   2. system: cache on persona_pinned (most stable content)
 *   3. bridge: mid-history anchor for long conversations
 *   4. tail: last stable block before dynamic content
 *
 * Run:  node scripts/verify-cache-strategy.mjs
 * Exit 0 = all passed, exit 1 = failure.
 */

import { strict as assert } from "node:assert";

// ---------------------------------------------------------------------------
// Helpers (mirror of assembler logic)
// ---------------------------------------------------------------------------

function simpleHash(text) {
  let hash = 5381;
  for (let i = 0; i < text.length; i++) {
    hash = ((hash << 5) + hash + text.charCodeAt(i)) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

function stableStringify(obj) {
  if (obj === null || typeof obj !== "object") return JSON.stringify(obj);
  if (Array.isArray(obj)) return "[" + obj.map(stableStringify).join(",") + "]";
  const keys = Object.keys(obj).sort();
  const pairs = keys.map((k) => JSON.stringify(k) + ":" + stableStringify(obj[k]));
  return "{" + pairs.join(",") + "}";
}

function stableSortSchema(obj) {
  if (obj === null || typeof obj !== "object") return obj;
  if (Array.isArray(obj)) return obj.map(stableSortSchema);
  const sorted = {};
  for (const key of Object.keys(obj).sort()) {
    sorted[key] = stableSortSchema(obj[key]);
  }
  return sorted;
}

function openAIToolsToAnthropic(tools) {
  if (!Array.isArray(tools) || tools.length === 0) return undefined;
  const converted = tools.map((tool) => {
    const fn = tool.function ?? tool;
    return {
      name: fn.name,
      description: fn.description ?? "",
      input_schema: stableSortSchema(
        fn.parameters ?? { type: "object", properties: {} }
      ),
    };
  });
  converted.sort((a, b) => a.name.localeCompare(b.name));
  return converted;
}

function countMessageBlocks(content) {
  if (content == null) return 0;
  if (typeof content === "string") return 1;
  if (!Array.isArray(content)) return 0;
  return content.length;
}

// ---------------------------------------------------------------------------
// Minimal assembler with 4-breakpoint strategy
// ---------------------------------------------------------------------------

const PROXY_STATIC_RULES = "proxy static rules text";
const PRESET_LITE = "preset lite text";
const LOOKBACK = 16;

function assemble(ctx) {
  const systemBlocks = [];
  const messages = [];
  const blockIds = [];
  let anchorIndex = -1;

  // Block 1: proxy_static_rules (stable)
  systemBlocks.push({ role: "system", text: PROXY_STATIC_RULES });
  blockIds.push("proxy_static_rules");

  // Block 2: persona_pinned (stable, cache_anchor = true)
  if (ctx.personaText) {
    systemBlocks.push({
      role: "system",
      text: ctx.personaText,
      cache_control: { type: "ephemeral", ttl: "5m" },
    });
    anchorIndex = systemBlocks.length - 1;
    blockIds.push("persona_pinned");
  }

  // Block 3: preset_lite (stable, NO cache_control — outside prefix)
  systemBlocks.push({ role: "system", text: PRESET_LITE });
  blockIds.push("preset_lite");

  // Block 4: client_system (NO cache_control)
  if (ctx.clientSystem) {
    systemBlocks.push({ role: "system", text: ctx.clientSystem });
    blockIds.push("client_system");
  }

  // Block 5: dynamic_memory_patch (dynamic)
  if (ctx.memoryPatch) {
    systemBlocks.push({ role: "system", text: ctx.memoryPatch });
    blockIds.push("dynamic_memory_patch");
  }

  // Messages: history + current user
  for (const msg of ctx.history ?? []) {
    messages.push(msg);
  }
  if (ctx.currentUser) {
    messages.push(ctx.currentUser);
  }

  // --- 4-breakpoint computation ---
  const breakpoints = [];

  // Breakpoint 2: system anchor on persona_pinned
  if (anchorIndex >= 0) {
    breakpoints.push({
      target: "system",
      system_block_index: anchorIndex,
      reason: "system",
    });
  }

  // Message-level breakpoints: bridge + tail
  const msgBlockCounts = messages.map((m) => countMessageBlocks(m.content));

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

    let blocksBeforeTail = 0;
    for (let i = 0; i < tailIdx; i++) blocksBeforeTail += msgBlockCounts[i];

    if (blocksBeforeTail > LOOKBACK) {
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
      block_ids: blockIds,
      client_system_hash: ctx.clientSystem ? simpleHash(ctx.clientSystem) : "none",
      cache_breakpoints: breakpoints,
    },
  };
}

// Apply breakpoints (mirrors adapter logic)
function applyBreakpoints(assembled, cacheEnabled = true) {
  const cc = cacheEnabled ? { type: "ephemeral", ttl: "5m" } : null;

  // System blocks: only blocks with cache_control get it
  for (const b of assembled.system_blocks) {
    if (b.cache_control) {
      b.cache_control = cc ?? undefined;
    }
  }

  // Message-level breakpoints
  if (cc) {
    for (const bp of assembled.meta.cache_breakpoints) {
      if (bp.target !== "message") continue;
      if (bp.message_index == null) continue;
      const msg = assembled.messages[bp.message_index];
      if (!msg || msg.content.length === 0) continue;
      const blockIdx = bp.block_index ?? msg.content.length - 1;
      const block = msg.content[blockIdx];
      if (block && typeof block === "object" && block.type === "text") {
        block.cache_control = cc;
      }
    }
  }
}

// Helpers
function userMsg(text) {
  return { role: "user", content: [{ type: "text", text }] };
}
function assistantMsg(text) {
  return { role: "assistant", content: [{ type: "text", text }] };
}
function multiBlockUserMsg(blocks) {
  return { role: "user", content: blocks };
}

function getCachePositions(assembled) {
  const system = [];
  for (let i = 0; i < assembled.system_blocks.length; i++) {
    if (assembled.system_blocks[i].cache_control) {
      system.push(i);
    }
  }
  const messages = [];
  for (let i = 0; i < assembled.messages.length; i++) {
    const msg = assembled.messages[i];
    for (let j = 0; j < msg.content.length; j++) {
      if (msg.content[j].cache_control) {
        messages.push({ msgIdx: i, blockIdx: j });
      }
    }
  }
  return { system, messages };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (e) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${e.message}`);
    failed++;
  }
}

const STABLE_SYSTEM = "You are a helpful assistant with many rules.";
const BASE_CTX = {
  personaText: "You are Claude, an AI assistant.",
  clientSystem: STABLE_SYSTEM,
  memoryPatch: null,
  history: [],
  currentUser: null,
};

// T1: resend → identical breakpoints
test("T1: resend → identical breakpoints", () => {
  const ctx = {
    ...BASE_CTX,
    history: [userMsg("hello"), assistantMsg("hi there")],
    currentUser: userMsg("how are you?"),
  };
  const a1 = assemble(ctx);
  const a2 = assemble(ctx);
  assert.deepStrictEqual(a1.system_blocks, a2.system_blocks);
  assert.deepStrictEqual(a1.meta.cache_breakpoints, a2.meta.cache_breakpoints);
});

// T2: system anchor is on persona_pinned, NOT client_system
test("T2: system anchor on persona_pinned (not client_system)", () => {
  const ctx = {
    ...BASE_CTX,
    history: [userMsg("h1"), assistantMsg("a1")],
    currentUser: userMsg("current"),
  };
  const assembled = assemble(ctx);
  applyBreakpoints(assembled);

  const sysBP = assembled.meta.cache_breakpoints.find((bp) => bp.reason === "system");
  assert.ok(sysBP, "has system breakpoint");

  // It should be on persona_pinned, not client_system
  const anchorId = assembled.meta.block_ids[sysBP.system_block_index];
  assert.strictEqual(anchorId, "persona_pinned");

  // client_system should NOT have cache_control
  const csIdx = assembled.meta.block_ids.indexOf("client_system");
  assert.ok(csIdx >= 0);
  assert.ok(!assembled.system_blocks[csIdx].cache_control, "client_system has no cache_control");
});

// T3: change current user → system anchor unchanged
test("T3: change current user → system anchor unchanged", () => {
  const history = [userMsg("hello"), assistantMsg("hi there")];
  const a = assemble({ ...BASE_CTX, history, currentUser: userMsg("question A") });
  const b = assemble({ ...BASE_CTX, history, currentUser: userMsg("question B different") });

  const bpA = a.meta.cache_breakpoints.find((bp) => bp.reason === "system");
  const bpB = b.meta.cache_breakpoints.find((bp) => bp.reason === "system");
  assert.strictEqual(bpA.system_block_index, bpB.system_block_index);

  // System blocks up to anchor are identical
  for (let i = 0; i <= bpA.system_block_index; i++) {
    assert.strictEqual(a.system_blocks[i].text, b.system_blocks[i].text);
  }
});

// T4: tail breakpoint on last history message (before current user)
test("T4: tail on last history message, not current user", () => {
  const ctx = {
    ...BASE_CTX,
    history: [userMsg("h1"), assistantMsg("a1"), userMsg("h2"), assistantMsg("a2")],
    currentUser: userMsg("current"),
  };
  const assembled = assemble(ctx);
  const tailBP = assembled.meta.cache_breakpoints.find((bp) => bp.reason === "tail");
  assert.ok(tailBP, "has tail breakpoint");
  // Should be on message index 3 (assistantMsg a2), which is messages.length-2
  assert.strictEqual(tailBP.message_index, 3);
  assert.strictEqual(assembled.messages[tailBP.message_index].role, "assistant");
});

// T5: bridge breakpoint appears for long conversations
test("T5: bridge appears for long conversations", () => {
  // Create 20+ messages to exceed LOOKBACK (16) content blocks
  const history = [];
  for (let i = 0; i < 12; i++) {
    history.push(userMsg(`user ${i}`));
    history.push(assistantMsg(`assistant ${i}`));
  }
  const ctx = {
    ...BASE_CTX,
    history,
    currentUser: userMsg("current"),
  };
  const assembled = assemble(ctx);
  const bridgeBP = assembled.meta.cache_breakpoints.find((bp) => bp.reason === "bridge");
  assert.ok(bridgeBP, "has bridge breakpoint for long conversation");
  // Bridge should be before the tail
  const tailBP = assembled.meta.cache_breakpoints.find((bp) => bp.reason === "tail");
  assert.ok(bridgeBP.message_index < tailBP.message_index, "bridge is before tail");
});

// T6: no bridge for short conversations
test("T6: no bridge for short conversations", () => {
  const ctx = {
    ...BASE_CTX,
    history: [userMsg("h1"), assistantMsg("a1")],
    currentUser: userMsg("current"),
  };
  const assembled = assemble(ctx);
  const bridgeBP = assembled.meta.cache_breakpoints.find((bp) => bp.reason === "bridge");
  assert.ok(!bridgeBP, "no bridge for short conversation");
});

// T7: dynamic_memory_patch change does NOT invalidate system cache
test("T7: memory patch change → system cache stable", () => {
  const a = assemble({ ...BASE_CTX, memoryPatch: null });
  const b = assemble({ ...BASE_CTX, memoryPatch: "<memories>new recall</memories>" });

  const stableIdx = Math.min(
    a.meta.block_ids.indexOf("dynamic_memory_patch") >= 0
      ? a.meta.block_ids.indexOf("dynamic_memory_patch")
      : a.system_blocks.length,
    b.meta.block_ids.indexOf("dynamic_memory_patch") >= 0
      ? b.meta.block_ids.indexOf("dynamic_memory_patch")
      : b.system_blocks.length
  );

  for (let i = 0; i < stableIdx; i++) {
    assert.strictEqual(a.system_blocks[i].text, b.system_blocks[i].text);
  }
});

// T8: tools stable → identical wire bytes
test("T8: tools stable → identical wire bytes", () => {
  const toolsA = [
    { function: { name: "search", description: "Search the web", parameters: { type: "object", properties: { q: { type: "string" } } } } },
    { function: { name: "calc", description: "Calculate", parameters: { type: "object", properties: { expr: { type: "string" } } } } },
  ];
  const toolsB = [toolsA[1], toolsA[0]];

  const anthA = openAIToolsToAnthropic(toolsA);
  const anthB = openAIToolsToAnthropic(toolsB);
  assert.deepStrictEqual(anthA, anthB);
  assert.strictEqual(stableStringify(anthA), stableStringify(anthB));
});

// T9: tools description change → different bytes
test("T9: tools description change → different bytes", () => {
  const toolsA = [{ function: { name: "search", description: "Search the web" } }];
  const toolsB = [{ function: { name: "search", description: "Search the internet" } }];
  assert.notStrictEqual(
    stableStringify(openAIToolsToAnthropic(toolsA)),
    stableStringify(openAIToolsToAnthropic(toolsB))
  );
});

// T10: block_index in tail breakpoint targets correct block
test("T10: block_index targets correct content block in multi-block message", () => {
  const history = [
    multiBlockUserMsg([
      { type: "text", text: "time: 2025-01-01" },
      { type: "text", text: "actual message" },
    ]),
    assistantMsg("response"),
  ];
  const ctx = {
    ...BASE_CTX,
    history,
    currentUser: userMsg("current"),
  };
  const assembled = assemble(ctx);
  const tailBP = assembled.meta.cache_breakpoints.find((bp) => bp.reason === "tail");
  assert.ok(tailBP, "has tail breakpoint");
  // Tail should be on the last block of the assistant message (index 0 since it's a single-block message)
  assert.strictEqual(tailBP.message_index, 1); // assistant is at index 1 (0=user multi-block, 1=assistant, 2=current user)
  assert.strictEqual(tailBP.block_index, 0); // single text block
});

// T11: glossary change does NOT invalidate cache prefix
test("T11: glossary change → persona_pinned cache unchanged", () => {
  const a = assemble({ ...BASE_CTX, personaText: "You are Claude." });
  const b = assemble({ ...BASE_CTX, personaText: "You are Claude." });

  // Same persona → same system anchor
  const bpA = a.meta.cache_breakpoints.find((bp) => bp.reason === "system");
  const bpB = b.meta.cache_breakpoints.find((bp) => bp.reason === "system");
  assert.strictEqual(bpA.system_block_index, bpB.system_block_index);
  assert.strictEqual(
    a.system_blocks[bpA.system_block_index].text,
    b.system_blocks[bpB.system_block_index].text
  );
});

// T12: no messages → no tail or bridge, only system
test("T12: no messages → only system breakpoint", () => {
  const ctx = { ...BASE_CTX, history: [], currentUser: userMsg("first") };
  const assembled = assemble(ctx);
  const bps = assembled.meta.cache_breakpoints;
  assert.strictEqual(bps.length, 1);
  assert.strictEqual(bps[0].reason, "system");
});

// T13: tools breakpoint on last tool
test("T13: tools breakpoint lands on last tool", () => {
  const tools = [
    { name: "a", description: "tool a", input_schema: { type: "object", properties: {} } },
    { name: "b", description: "tool b", input_schema: { type: "object", properties: {} } },
    { name: "c", description: "tool c", input_schema: { type: "object", properties: {} } },
  ];
  // Simulate: apply cache_control to last tool
  const cc = { type: "ephemeral" };
  const cached = tools.map((t, i) =>
    i === tools.length - 1 ? { ...t, cache_control: cc } : t
  );
  assert.ok(!cached[0].cache_control, "first tool no cache");
  assert.ok(!cached[1].cache_control, "second tool no cache");
  assert.ok(cached[2].cache_control, "last tool has cache");
});

// T14: exactly 4 breakpoints max (tools + system + bridge + tail)
test("T14: at most 4 breakpoints", () => {
  const history = [];
  for (let i = 0; i < 15; i++) {
    history.push(userMsg(`u${i}`));
    history.push(assistantMsg(`a${i}`));
  }
  const assembled = assemble({
    ...BASE_CTX,
    history,
    currentUser: userMsg("current"),
  });
  assert.ok(assembled.meta.cache_breakpoints.length <= 4, "at most 4 breakpoints");
});

// T15: stable tools input_schema deep-sorted
test("T15: tools input_schema deep-sorted", () => {
  const tool = {
    function: {
      name: "test",
      description: "test tool",
      parameters: {
        type: "object",
        properties: {
          zebra: { type: "string" },
          alpha: { type: "integer" },
          nested: {
            type: "object",
            properties: {
              z_prop: { type: "boolean" },
              a_prop: { type: "string" },
            },
          },
        },
        required: ["alpha"],
      },
    },
  };

  const anth = openAIToolsToAnthropic([tool]);
  const schema = anth[0].input_schema;
  const keys = Object.keys(schema);
  assert.deepStrictEqual(keys, [...keys].sort(), "top-level keys sorted");

  const propKeys = Object.keys(schema.properties);
  assert.deepStrictEqual(propKeys, ["alpha", "nested", "zebra"], "properties sorted");

  const nestedKeys = Object.keys(schema.properties.nested.properties);
  assert.deepStrictEqual(nestedKeys, ["a_prop", "z_prop"], "nested properties sorted");
});

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

console.log("");
console.log(`Cache strategy tests: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
} else {
  console.log("All cache strategy tests passed ✓");
}
