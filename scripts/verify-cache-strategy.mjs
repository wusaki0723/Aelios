#!/usr/bin/env node
/**
 * CONTRACT MIRROR — tests for the v4 prompt caching strategy.
 *
 * Validates:
 *   1. A resend hits cache (same inputs → same breakpoints + system bytes)
 *   2. A/B: change current user, history_read_anchor still present
 *   3. R1→R2: append a round, R2 has forward_write_anchor reading R1 prefix
 *   4. dynamic_memory_patch change does NOT invalidate system cache
 *   5. tools stable → stable hash; tools order/desc change → full invalidation
 *   6. tool_result in history → next round can read it via forward_write_anchor
 *
 * Run:  node scripts/verify-cache-strategy.mjs
 * Exit 0 = all passed, exit 1 = failure.
 */

import { strict as assert } from "node:assert";

// ---------------------------------------------------------------------------
// Inline minimal assemble + toAnthropic logic (contract mirror)
// Keeps tests runnable without TS compilation.
// ---------------------------------------------------------------------------

function simpleHash(text) {
  let hash = 5381;
  for (let i = 0; i < text.length; i++) {
    hash = ((hash << 5) + hash + text.charCodeAt(i)) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

// Stable stringify for tools (mirrors toAnthropic.ts)
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

// Minimal assembler: produces system_blocks + messages + meta.cache_breakpoints
const PROXY_STATIC_RULES = "proxy static rules text";
const PRESET_LITE = "preset lite text";

function assemble(ctx) {
  const systemBlocks = [];
  const messages = [];
  const blockIds = [];
  let anchorIndex = -1;

  // Block 1: proxy_static_rules (stable)
  systemBlocks.push({ role: "system", text: PROXY_STATIC_RULES });
  blockIds.push("proxy_static_rules");

  // Block 2: persona_pinned (stable)
  if (ctx.personaText) {
    systemBlocks.push({ role: "system", text: ctx.personaText });
    blockIds.push("persona_pinned");
  }

  // Block 3: preset_lite (stable)
  systemBlocks.push({ role: "system", text: PRESET_LITE });
  blockIds.push("preset_lite");

  // Block 4: client_system (stable, cache_anchor = true)
  if (ctx.clientSystem) {
    systemBlocks.push({
      role: "system",
      text: ctx.clientSystem,
      cache_control: { type: "ephemeral", ttl: "5m" },
    });
    anchorIndex = systemBlocks.length - 1;
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

  // Cache breakpoints
  const breakpoints = [];
  if (anchorIndex >= 0) {
    breakpoints.push({
      target: "system",
      system_block_index: anchorIndex,
      reason: "history_read_anchor",
    });
  }
  if (messages.length >= 2) {
    breakpoints.push({
      target: "message",
      message_index: messages.length - 2,
      reason: "forward_write_anchor",
    });
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

// Apply breakpoints (mirrors applyExplicitCacheBreakpoints + applyMessageCacheBreakpoints)
function applyBreakpoints(assembled, cacheEnabled = true) {
  const cc = cacheEnabled ? { type: "ephemeral", ttl: "5m" } : null;

  // System blocks
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
      const lastBlock = msg.content[msg.content.length - 1];
      if (lastBlock.type === "text") {
        lastBlock.cache_control = cc;
      }
    }
  }
}

// Helper: build message
function userMsg(text) {
  return { role: "user", content: [{ type: "text", text }] };
}
function assistantMsg(text) {
  return { role: "assistant", content: [{ type: "text", text }] };
}

// Helper: extract cache_control positions from assembled output
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
// Test fixtures
// ---------------------------------------------------------------------------

const STABLE_SYSTEM = "You are a helpful assistant. Follow these rules carefully. Rule 1: Be kind. Rule 2: Be accurate. Rule 3: Be concise.";

const BASE_CTX = {
  personaText: "You are Claude, an AI assistant.",
  clientSystem: STABLE_SYSTEM,
  memoryPatch: null,
  history: [],
  currentUser: null,
};

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

// T1: A resend hits cache — same inputs produce identical breakpoints and system bytes
test("T1: resend → identical breakpoints and system bytes", () => {
  const ctx = {
    ...BASE_CTX,
    history: [userMsg("hello"), assistantMsg("hi there")],
    currentUser: userMsg("how are you?"),
  };
  const a1 = assemble(ctx);
  const a2 = assemble(ctx);

  // Identical system blocks
  assert.deepStrictEqual(a1.system_blocks, a2.system_blocks);
  // Identical breakpoints
  assert.deepStrictEqual(a1.meta.cache_breakpoints, a2.meta.cache_breakpoints);
  // Identical client_system_hash
  assert.strictEqual(a1.meta.client_system_hash, a2.meta.client_system_hash);
});

// T2: A/B — change current user, history_read_anchor still present at same position
test("T2: change current user → history_read_anchor unchanged", () => {
  const history = [userMsg("hello"), assistantMsg("hi there")];

  const ctxA = { ...BASE_CTX, history, currentUser: userMsg("question A") };
  const ctxB = { ...BASE_CTX, history, currentUser: userMsg("question B completely different") };

  const a = assemble(ctxA);
  const b = assemble(ctxB);

  // history_read_anchor must be at same system block index
  const bpA = a.meta.cache_breakpoints.find((bp) => bp.reason === "history_read_anchor");
  const bpB = b.meta.cache_breakpoints.find((bp) => bp.reason === "history_read_anchor");
  assert.ok(bpA, "A has history_read_anchor");
  assert.ok(bpB, "B has history_read_anchor");
  assert.strictEqual(bpA.system_block_index, bpB.system_block_index);

  // System blocks up to and including anchor must be identical
  const anchorIdx = bpA.system_block_index;
  for (let i = 0; i <= anchorIdx; i++) {
    assert.strictEqual(a.system_blocks[i].text, b.system_blocks[i].text);
  }
});

// T3: R1→R2 append a round, R2 has forward_write_anchor reading R1's prefix
test("T3: R1→R2 forward_write_anchor reads R1 prefix", () => {
  const r1 = assemble({
    ...BASE_CTX,
    history: [],
    currentUser: userMsg("first message"),
  });
  applyBreakpoints(r1);

  // R2: append R1's exchange to history
  const r2 = assemble({
    ...BASE_CTX,
    history: [
      userMsg("first message"),
      assistantMsg("first response"),
    ],
    currentUser: userMsg("second message"),
  });
  applyBreakpoints(r2);

  // R2 must have forward_write_anchor
  const fwd = r2.meta.cache_breakpoints.find((bp) => bp.reason === "forward_write_anchor");
  assert.ok(fwd, "R2 has forward_write_anchor");

  // The message at forward_write_anchor index should be the last history message
  // (assistantMsg "first response"), and it should have cache_control
  const cachedMsg = r2.messages[fwd.message_index];
  assert.ok(cachedMsg, "forward_write_anchor points to a message");
  const lastBlock = cachedMsg.content[cachedMsg.content.length - 1];
  assert.ok(lastBlock.cache_control, "forward_write_anchor block has cache_control");
});

// T4: dynamic_memory_patch change does NOT invalidate system cache
test("T4: memory patch change → system cache stable", () => {
  const ctxA = { ...BASE_CTX, memoryPatch: null };
  const ctxB = { ...BASE_CTX, memoryPatch: "<memories>new recall hit</memories>" };

  const a = assemble(ctxA);
  const b = assemble(ctxB);

  // All blocks before dynamic_memory_patch must be identical
  const patchIdxA = a.meta.block_ids.indexOf("dynamic_memory_patch");
  const patchIdxB = b.meta.block_ids.indexOf("dynamic_memory_patch");

  // Find the minimum index of stable blocks
  const stableCount = Math.min(
    patchIdxA >= 0 ? patchIdxA : a.system_blocks.length,
    patchIdxB >= 0 ? patchIdxB : b.system_blocks.length
  );

  for (let i = 0; i < stableCount; i++) {
    assert.strictEqual(a.system_blocks[i].text, b.system_blocks[i].text);
  }

  // After applying breakpoints, the cache_control on the anchor block must be identical
  applyBreakpoints(a);
  applyBreakpoints(b);

  const anchorA = a.meta.cache_breakpoints.find((bp) => bp.reason === "history_read_anchor");
  const anchorB = b.meta.cache_breakpoints.find((bp) => bp.reason === "history_read_anchor");
  assert.ok(anchorA && anchorB);
  assert.deepStrictEqual(
    a.system_blocks[anchorA.system_block_index].cache_control,
    b.system_blocks[anchorB.system_block_index].cache_control
  );
});

// T5: tools stable → stable hash; tools order/desc change → full invalidation
test("T5: tools stable → identical wire bytes", () => {
  const toolsA = [
    { function: { name: "search", description: "Search the web", parameters: { type: "object", properties: { q: { type: "string" } } } } },
    { function: { name: "calc", description: "Calculate", parameters: { type: "object", properties: { expr: { type: "string" } } } } },
  ];
  // Same tools, different array order
  const toolsB = [toolsA[1], toolsA[0]];

  const anthA = openAIToolsToAnthropic(toolsA);
  const anthB = openAIToolsToAnthropic(toolsB);

  assert.deepStrictEqual(anthA, anthB, "different input order → same Anthropic tools");

  // Stable JSON must be identical
  const jsonA = stableStringify(anthA);
  const jsonB = stableStringify(anthB);
  assert.strictEqual(jsonA, jsonB, "stable JSON is identical");
});

test("T5b: tools description change → different wire bytes", () => {
  const toolsA = [
    { function: { name: "search", description: "Search the web", parameters: { type: "object", properties: { q: { type: "string" } } } } },
  ];
  const toolsB = [
    { function: { name: "search", description: "Search the internet", parameters: { type: "object", properties: { q: { type: "string" } } } } },
  ];

  const anthA = openAIToolsToAnthropic(toolsA);
  const anthB = openAIToolsToAnthropic(toolsB);

  const jsonA = stableStringify(anthA);
  const jsonB = stableStringify(anthB);
  assert.notStrictEqual(jsonA, jsonB, "description change → different bytes");
});

// T6: tool_result in history → next round can read it via forward_write_anchor
test("T6: tool_result in history → forward_write_anchor on last history msg", () => {
  const toolResultHistory = [
    userMsg("search for cats"),
    assistantMsg("I'll search for that"),
    {
      role: "user",
      content: [{ type: "tool_result", tool_use_id: "call_123", content: "cats are cute" }],
    },
    assistantMsg("Here are the cat results"),
  ];

  const ctx = {
    ...BASE_CTX,
    history: toolResultHistory,
    currentUser: userMsg("tell me more"),
  };

  const assembled = assemble(ctx);
  applyBreakpoints(assembled);

  const fwd = assembled.meta.cache_breakpoints.find((bp) => bp.reason === "forward_write_anchor");
  assert.ok(fwd, "has forward_write_anchor");

  // The forward anchor should be on the last history message (assistant "Here are the cat results")
  const lastHistoryIdx = fwd.message_index;
  const lastHistoryMsg = assembled.messages[lastHistoryIdx];
  assert.strictEqual(lastHistoryMsg.role, "assistant");
  const lastBlock = lastHistoryMsg.content[lastHistoryMsg.content.length - 1];
  assert.ok(lastBlock.cache_control, "last history block has cache_control");
});

// T7: empty history → no forward_write_anchor, only history_read_anchor
test("T7: no history → only history_read_anchor", () => {
  const ctx = {
    ...BASE_CTX,
    history: [],
    currentUser: userMsg("first message"),
  };
  const assembled = assemble(ctx);

  const histBP = assembled.meta.cache_breakpoints.filter((bp) => bp.reason === "history_read_anchor");
  const fwdBP = assembled.meta.cache_breakpoints.filter((bp) => bp.reason === "forward_write_anchor");

  assert.strictEqual(histBP.length, 1, "one history_read_anchor");
  assert.strictEqual(fwdBP.length, 0, "no forward_write_anchor when no history");
});

// T8: cache_control on system blocks is at exactly the client_system position
test("T8: cache_control lands on client_system block", () => {
  const ctx = {
    ...BASE_CTX,
    history: [userMsg("h1"), assistantMsg("a1")],
    currentUser: userMsg("current"),
  };
  const assembled = assemble(ctx);
  applyBreakpoints(assembled);

  const positions = getCachePositions(assembled);

  // Exactly one system block has cache_control
  assert.strictEqual(positions.system.length, 1, "exactly one system cache point");

  // It should be the client_system block
  const cacheIdx = positions.system[0];
  assert.strictEqual(assembled.meta.block_ids[cacheIdx], "client_system");
});

// T9: tools input_schema keys are deep-sorted
test("T9: tools input_schema deep-sorted", () => {
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

  // Top-level keys must be sorted
  assert.deepStrictEqual(keys, [...keys].sort(), "top-level keys sorted");

  // Nested properties must be sorted
  const propKeys = Object.keys(schema.properties);
  assert.deepStrictEqual(propKeys, ["alpha", "nested", "zebra"], "properties sorted");

  // Deep nested properties must be sorted
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
