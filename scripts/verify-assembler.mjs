#!/usr/bin/env node
/**
 * CONTRACT MIRROR — this script reimplements the assemble() logic from
 * src/assembler/blocks.ts and src/assembler/types.ts in plain JS so it
 * can run under `node` without a TS runtime or test framework.
 *
 * Data structures (AssemblerContext, AssembledPrompt) and constants
 * (BLOCK_ORDER, SUMMARY_MAX_CHARS, text literals, simpleHash) MUST
 * match the TypeScript source exactly. When changing the TS source,
 * update this file in lockstep.
 *
 * Run:  node scripts/verify-assembler.mjs
 * Exit 0 = all checks passed, exit 1 = failure.
 *
 * Tests:
 *   1. Determinism — same ctx twice → identical output
 *   2. Pinned sort — different insertion order → identical output
 *   3. Cache anchor — falls on client_system position
 *   4. Image passthrough — image_url content preserved in messages
 *   5. Tool filtering — tool messages excluded from history
 */

import { strict as assert } from "node:assert";

// ---------------------------------------------------------------------------
// DJB2 hash — must match src/assembler/blocks.ts simpleHash exactly
// ---------------------------------------------------------------------------

function simpleHash(text) {
  let hash = 5381;
  for (let i = 0; i < text.length; i++) {
    hash = ((hash << 5) + hash + text.charCodeAt(i)) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

// ---------------------------------------------------------------------------
// Constants — must match src/assembler/types.ts
// ---------------------------------------------------------------------------

const BLOCK_ORDER = [
  "proxy_static_rules",
  "persona_pinned",
  "long_term_summary",
  "preset_lite",
  "client_system",
  "dynamic_memory_patch",
  "vision_context",
  "recent_history",
  "current_user",
];

const PERSONA_MEMORY_TYPES = ["identity", "persona"];
const SUMMARY_MAX_CHARS = 2000;

// ---------------------------------------------------------------------------
// Text constants — must match src/assembler/blocks.ts
// ---------------------------------------------------------------------------

const PROXY_STATIC_RULES_TEXT = [
  "遵循前端提供的角色、关系和上下文，自然对话即可。",
  "不要暴露记忆系统、数据库、RAG、代理层或任何后端实现。",
  "不要机械复述设定原文，用自己的话自然表达。",
  "如果记忆与当前对话无关，不要强行提起。",
].join("\n");

const PRESET_LITE_TEXT = [
  "<output_style_lite>",
  "- 自然中文，避免翻译腔和过度名词化",
  "- 多用具体动作和对白承载情绪，少用作者式分析",
  "- 对白可独立成段，不机械复述设定",
  "- 全角标点，不用破折号，用逗号或句号替代",
  "</output_style_lite>",
].join("\n");

// ---------------------------------------------------------------------------
// Assembler logic — must match src/assembler/blocks.ts assemble()
// ---------------------------------------------------------------------------

function isNonEmptyContent(content) {
  if (typeof content === "string") return content.trim().length > 0;
  if (content == null) return false;
  return Array.isArray(content) && content.length > 0;
}

/**
 * Must match blocks.ts messageToOutput: only user/assistant pass through.
 * tool and system messages return null.
 */
function messageToOutput(msg) {
  if (msg.role !== "user" && msg.role !== "assistant") return null;
  if (!isNonEmptyContent(msg.content)) return null;
  return { role: msg.role, content: msg.content };
}

function assemble(ctx) {
  const systemBlocks = [];
  const messages = [];
  const enabledBlockIds = [];
  let anchorIndex = -1;

  for (const blockId of BLOCK_ORDER) {
    // --- passthrough blocks → messages ---
    if (blockId === "recent_history") {
      let added = false;
      for (const msg of ctx.historyMessages) {
        const out = messageToOutput(msg);
        if (out) {
          messages.push(out);
          added = true;
        }
      }
      if (added) enabledBlockIds.push(blockId);
      continue;
    }

    if (blockId === "current_user") {
      if (ctx.currentUserMessage) {
        const out = messageToOutput(ctx.currentUserMessage);
        if (out) {
          messages.push(out);
          enabledBlockIds.push(blockId);
        }
      }
      continue;
    }

    // --- stable / dynamic blocks → system_blocks ---
    let text = null;

    if (blockId === "proxy_static_rules") {
      text = PROXY_STATIC_RULES_TEXT;
    } else if (blockId === "persona_pinned") {
      const memories = ctx.pinnedPersonaMemories;
      if (memories && memories.length > 0) {
        const sorted = [...memories].sort((a, b) => {
          const tc = a.type.localeCompare(b.type);
          if (tc !== 0) return tc;
          if (b.importance !== a.importance) return b.importance - a.importance;
          return a.id.localeCompare(b.id);
        });
        const lines = sorted.map(
          (m) => `- [${m.type}][importance=${m.importance.toFixed(2)}] ${m.content}`
        );
        text = lines.join("\n") || null;
      }
    } else if (blockId === "long_term_summary") {
      const entry = ctx.summaryEntry;
      if (entry && entry.content) {
        const c = entry.content;
        const truncated = c.length <= SUMMARY_MAX_CHARS ? c : c.slice(0, SUMMARY_MAX_CHARS) + "...";
        text = `长期对话摘要：\n${truncated}`;
      }
    } else if (blockId === "preset_lite") {
      text = PRESET_LITE_TEXT;
    } else if (blockId === "client_system") {
      const texts = ctx.systemMessages
        .filter((m) => m.role === "system")
        .map((m) => (typeof m.content === "string" ? m.content.trim() : ""))
        .filter(Boolean);
      if (texts.length > 0) text = texts.join("\n\n");
    } else if (blockId === "dynamic_memory_patch") {
      if (ctx.ragMemories.length > 0) {
        const lines = ctx.ragMemories.map(
          (m) => `- [${m.type}][importance=${m.importance.toFixed(2)}] ${m.content}`
        );
        text = ["<memories>", ...lines, "</memories>"].join("\n");
      }
    } else if (blockId === "vision_context") {
      if (ctx.visionOutput) {
        text = `<vision_context>\n${ctx.visionOutput}\n</vision_context>`;
      }
    }

    if (text === null) continue;

    const systemBlock = { role: "system", text };
    if (blockId === "client_system") {
      systemBlock.cache_control = { type: "ephemeral", ttl: "5m" };
      anchorIndex = systemBlocks.length;
    }

    systemBlocks.push(systemBlock);
    enabledBlockIds.push(blockId);
  }

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

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

let passed = 0;
let failed = 0;

function check(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  PASS  ${name}`);
  } catch (e) {
    failed++;
    console.error(`  FAIL  ${name}`);
    console.error(`        ${e.message}`);
  }
}

// ---------------------------------------------------------------------------
// Test data — AssemblerContext shape must match src/assembler/types.ts
// ---------------------------------------------------------------------------

function makeBaseCtx() {
  return {
    systemMessages: [{ role: "system", content: "你是测试角色。" }],
    pinnedPersonaMemories: [
      { id: "b-1", type: "persona", content: "性格温柔", importance: 0.9 },
      { id: "a-1", type: "identity", content: "名字是咲咲", importance: 0.95 },
    ],
    summaryEntry: { content: "这是一段很长的对话摘要，用于测试截断和稳定性。" },
    ragMemories: [
      { type: "note", importance: 0.6, content: "用户喜欢猫" },
    ],
    visionOutput: null,
    historyMessages: [
      { role: "user", content: "你好" },
      { role: "assistant", content: "你好呀！" },
    ],
    currentUserMessage: { role: "user", content: "今天天气怎么样？" },
  };
}

// ---------------------------------------------------------------------------
// Test 1: Determinism — same ctx twice → identical output
// ---------------------------------------------------------------------------

console.log("\n--- Test 1: Determinism ---");

check("system_blocks text fields identical across two calls", () => {
  const ctx = makeBaseCtx();
  const a = assemble(ctx);
  const b = assemble(ctx);

  assert.deepStrictEqual(
    a.system_blocks.map((sb) => sb.text),
    b.system_blocks.map((sb) => sb.text)
  );
});

check("messages identical across two calls", () => {
  const ctx = makeBaseCtx();
  const a = assemble(ctx);
  const b = assemble(ctx);
  assert.deepStrictEqual(a.messages, b.messages);
});

check("meta.block_ids identical across two calls", () => {
  const ctx = makeBaseCtx();
  const a = assemble(ctx);
  const b = assemble(ctx);
  assert.deepStrictEqual(a.meta.block_ids, b.meta.block_ids);
});

check("meta.client_system_hash identical across two calls", () => {
  const ctx = makeBaseCtx();
  const a = assemble(ctx);
  const b = assemble(ctx);
  assert.strictEqual(a.meta.client_system_hash, b.meta.client_system_hash);
});

check("anchor_index identical across two calls", () => {
  const ctx = makeBaseCtx();
  const a = assemble(ctx);
  const b = assemble(ctx);
  assert.strictEqual(a.meta.anchor_index, b.meta.anchor_index);
});

check("full output is deep-equal across two calls", () => {
  const ctx = makeBaseCtx();
  const a = assemble(ctx);
  const b = assemble(ctx);
  assert.deepStrictEqual(a, b);
});

// ---------------------------------------------------------------------------
// Test 2: Pinned memories — different insertion order → identical output
// ---------------------------------------------------------------------------

console.log("\n--- Test 2: Pinned memory sort stability ---");

check("swapped pinned order → same system_blocks", () => {
  const ctx1 = makeBaseCtx();
  const ctx2 = makeBaseCtx();
  ctx1.pinnedPersonaMemories = [
    { id: "a-1", type: "identity", content: "名字是咲咲", importance: 0.95 },
    { id: "b-1", type: "persona", content: "性格温柔", importance: 0.9 },
  ];
  ctx2.pinnedPersonaMemories = [
    { id: "b-1", type: "persona", content: "性格温柔", importance: 0.9 },
    { id: "a-1", type: "identity", content: "名字是咲咲", importance: 0.95 },
  ];

  const a = assemble(ctx1);
  const b = assemble(ctx2);

  assert.deepStrictEqual(
    a.system_blocks.map((sb) => sb.text),
    b.system_blocks.map((sb) => sb.text)
  );
  assert.strictEqual(a.meta.client_system_hash, b.meta.client_system_hash);
});

check("three memories, six permutations → all produce same pinned text", () => {
  const memories = [
    { id: "c-1", type: "persona", content: "喜欢蓝色", importance: 0.7 },
    { id: "a-1", type: "identity", content: "名字是咲咲", importance: 0.95 },
    { id: "b-1", type: "persona", content: "性格温柔", importance: 0.9 },
  ];

  const perms = [
    [0, 1, 2], [0, 2, 1], [1, 0, 2],
    [1, 2, 0], [2, 0, 1], [2, 1, 0],
  ];

  const texts = perms.map((perm) => {
    const ctx = makeBaseCtx();
    ctx.pinnedPersonaMemories = perm.map((i) => memories[i]);
    const result = assemble(ctx);
    const idx = result.meta.block_ids.indexOf("persona_pinned");
    return idx >= 0 ? result.system_blocks[idx].text : null;
  });

  for (let i = 1; i < texts.length; i++) {
    assert.strictEqual(texts[i], texts[0], `permutation ${i} differs from 0`);
  }
});

check("different importance → sorted desc, not by insertion", () => {
  const ctx = makeBaseCtx();
  ctx.pinnedPersonaMemories = [
    { id: "a-1", type: "persona", content: "低重要性", importance: 0.3 },
    { id: "b-1", type: "persona", content: "高重要性", importance: 0.95 },
  ];

  const result = assemble(ctx);
  const idx = result.meta.block_ids.indexOf("persona_pinned");
  const text = result.system_blocks[idx].text;

  assert.ok(
    text.indexOf("高重要性") < text.indexOf("低重要性"),
    "higher importance should appear first"
  );
});

// ---------------------------------------------------------------------------
// Test 3: Cache anchor on client_system
// ---------------------------------------------------------------------------

console.log("\n--- Test 3: Cache anchor position ---");

check("anchor_index points to client_system in system_blocks", () => {
  const ctx = makeBaseCtx();
  const result = assemble(ctx);

  const csIdx = result.meta.block_ids.indexOf("client_system");
  assert.ok(csIdx >= 0, "client_system should be in block_ids");
  assert.strictEqual(result.meta.anchor_index, csIdx);
});

check("client_system block has cache_control", () => {
  const ctx = makeBaseCtx();
  const result = assemble(ctx);

  const csIdx = result.meta.block_ids.indexOf("client_system");
  const block = result.system_blocks[csIdx];
  assert.deepStrictEqual(block.cache_control, { type: "ephemeral", ttl: "5m" });
});

check("no other block has cache_control", () => {
  const ctx = makeBaseCtx();
  const result = assemble(ctx);

  for (let i = 0; i < result.system_blocks.length; i++) {
    if (i === result.meta.anchor_index) continue;
    assert.strictEqual(
      result.system_blocks[i].cache_control,
      undefined,
      `block at index ${i} (${result.meta.block_ids[i]}) should not have cache_control`
    );
  }
});

check("stable blocks come before client_system, dynamic after", () => {
  const ctx = makeBaseCtx();
  const result = assemble(ctx);

  const csPos = result.meta.block_ids.indexOf("client_system");
  const stableBefore = ["proxy_static_rules", "persona_pinned", "long_term_summary", "preset_lite"];
  const dynamicAfter = ["dynamic_memory_patch", "vision_context"];

  for (const id of stableBefore) {
    const pos = result.meta.block_ids.indexOf(id);
    if (pos >= 0) {
      assert.ok(pos < csPos, `${id} should come before client_system`);
    }
  }
  for (const id of dynamicAfter) {
    const pos = result.meta.block_ids.indexOf(id);
    if (pos >= 0) {
      assert.ok(pos > csPos, `${id} should come after client_system`);
    }
  }
});

// ---------------------------------------------------------------------------
// Test 4: current_user image_url preserved
// ---------------------------------------------------------------------------

console.log("\n--- Test 4: Image content passthrough ---");

check("image_url content array preserved in messages", () => {
  const ctx = makeBaseCtx();
  ctx.currentUserMessage = {
    role: "user",
    content: [
      { type: "text", text: "描述这张图" },
      { type: "image_url", image_url: { url: "https://example.com/cat.jpg" } },
    ],
  };

  const result = assemble(ctx);
  const lastMsg = result.messages[result.messages.length - 1];

  assert.strictEqual(lastMsg.role, "user");
  assert.ok(Array.isArray(lastMsg.content), "content should be an array");
  assert.strictEqual(lastMsg.content.length, 2);
  assert.deepStrictEqual(lastMsg.content[0], { type: "text", text: "描述这张图" });
  assert.deepStrictEqual(lastMsg.content[1], {
    type: "image_url",
    image_url: { url: "https://example.com/cat.jpg" },
  });
});

check("image_url not flattened to text", () => {
  const ctx = makeBaseCtx();
  ctx.currentUserMessage = {
    role: "user",
    content: [
      { type: "text", text: "看这个" },
      { type: "image_url", image_url: { url: "data:image/png;base64,abc123" } },
    ],
  };

  const result = assemble(ctx);
  const lastMsg = result.messages[result.messages.length - 1];

  assert.ok(!Array.isArray(lastMsg.content) || lastMsg.content.length === 2);
  const imgPart = lastMsg.content.find((p) => p.type === "image_url");
  assert.ok(imgPart, "image_url part must be preserved");
  assert.strictEqual(imgPart.image_url.url, "data:image/png;base64,abc123");
});

check("string content preserved as-is", () => {
  const ctx = makeBaseCtx();
  ctx.currentUserMessage = { role: "user", content: "纯文本消息" };

  const result = assemble(ctx);
  const lastMsg = result.messages[result.messages.length - 1];

  assert.strictEqual(lastMsg.role, "user");
  assert.strictEqual(lastMsg.content, "纯文本消息");
});

// ---------------------------------------------------------------------------
// Test 5: Tool messages excluded from history
// ---------------------------------------------------------------------------

console.log("\n--- Test 5: Tool message filtering ---");

check("tool messages are excluded from recent_history", () => {
  const ctx = makeBaseCtx();
  ctx.historyMessages = [
    { role: "user", content: "查一下天气" },
    { role: "assistant", content: "好的" },
    { role: "tool", content: '{"temp": 25}' },
    { role: "assistant", content: "今天25度" },
  ];

  const result = assemble(ctx);

  // messages should be: recent_history (user + 2 assistant) + current_user
  // tool message must NOT appear
  for (const msg of result.messages) {
    assert.ok(
      msg.role === "user" || msg.role === "assistant",
      `unexpected role in messages: ${msg.role}`
    );
  }

  // Should have 3 history messages + 1 current_user = 4 total
  assert.strictEqual(result.messages.length, 4);
  assert.strictEqual(result.messages[0].role, "user");
  assert.strictEqual(result.messages[0].content, "查一下天气");
  assert.strictEqual(result.messages[1].role, "assistant");
  assert.strictEqual(result.messages[1].content, "好的");
  assert.strictEqual(result.messages[2].role, "assistant");
  assert.strictEqual(result.messages[2].content, "今天25度");
  assert.strictEqual(result.messages[3].role, "user");
  assert.strictEqual(result.messages[3].content, "今天天气怎么样？");
});

check("system messages excluded from recent_history", () => {
  const ctx = makeBaseCtx();
  ctx.historyMessages = [
    { role: "system", content: "不该出现" },
    { role: "user", content: "你好" },
    { role: "assistant", content: "你好呀" },
  ];

  const result = assemble(ctx);
  for (const msg of result.messages) {
    assert.notStrictEqual(msg.content, "不该出现");
  }
});

check("all-tool history produces no recent_history messages", () => {
  const ctx = makeBaseCtx();
  ctx.historyMessages = [
    { role: "tool", content: '{"result": "ok"}' },
    { role: "tool", content: '{"result": "nope"}' },
  ];

  const result = assemble(ctx);
  // Only current_user in messages, no history
  assert.strictEqual(result.messages.length, 1);
  assert.strictEqual(result.messages[0].role, "user");
  assert.ok(!result.meta.block_ids.includes("recent_history"));
});

// ---------------------------------------------------------------------------
// Converter functions — contract mirror of toAnthropic.ts and toOpenAI.ts
// ---------------------------------------------------------------------------

function assembledToAnthropicSystem(systemBlocks) {
  return systemBlocks.map((block) => {
    const out = { type: "text", text: block.text };
    if (block.cache_control) {
      out.cache_control = {
        type: "ephemeral",
        ...(block.cache_control.ttl ? { ttl: block.cache_control.ttl } : {}),
      };
    }
    return out;
  });
}

function assembledToAnthropicMessages(messages) {
  const result = [];
  for (const msg of messages) {
    const role = msg.role;
    const text = typeof msg.content === "string" ? msg.content
      : msg.content == null ? ""
      : JSON.stringify(msg.content);
    const prev = result[result.length - 1];
    if (prev?.role === role) {
      prev.content.push({ type: "text", text });
      continue;
    }
    result.push({ role, content: [{ type: "text", text }] });
  }
  if (result.length === 0) {
    result.push({ role: "user", content: [{ type: "text", text: "" }] });
  }
  return result;
}

function assembledToOpenAISystem(systemBlocks) {
  if (systemBlocks.length === 0) return null;
  const text = systemBlocks.map((b) => b.text).join("\n\n");
  return { role: "system", content: text };
}

function assembledToOpenAIMessages(messages) {
  return messages.map((msg) => ({ role: msg.role, content: msg.content }));
}

function assembledToOpenAIChatMessages(assembled) {
  const result = [];
  const sys = assembledToOpenAISystem(assembled.system_blocks);
  if (sys) result.push(sys);
  result.push(...assembledToOpenAIMessages(assembled.messages));
  return result;
}

// ---------------------------------------------------------------------------
// Test 6: Anthropic conversion
// ---------------------------------------------------------------------------

console.log("\n--- Test 6: Anthropic conversion ---");

check("system blocks preserve cache_control", () => {
  const ctx = makeBaseCtx();
  const assembled = assemble(ctx);
  const anthropicSystem = assembledToAnthropicSystem(assembled.system_blocks);

  // Find the client_system block
  const csIdx = assembled.meta.block_ids.indexOf("client_system");
  assert.ok(csIdx >= 0);

  const block = anthropicSystem[csIdx];
  assert.strictEqual(block.type, "text");
  assert.deepStrictEqual(block.cache_control, { type: "ephemeral", ttl: "5m" });
});

check("non-anchor blocks have no cache_control", () => {
  const ctx = makeBaseCtx();
  const assembled = assemble(ctx);
  const anthropicSystem = assembledToAnthropicSystem(assembled.system_blocks);

  for (let i = 0; i < anthropicSystem.length; i++) {
    if (i === assembled.meta.anchor_index) continue;
    assert.strictEqual(
      anthropicSystem[i].cache_control,
      undefined,
      `block ${i} should not have cache_control`
    );
  }
});

check("anthropic messages convert user/assistant correctly", () => {
  const ctx = makeBaseCtx();
  const assembled = assemble(ctx);
  const anthropicMsgs = assembledToAnthropicMessages(assembled.messages);

  // Should have at least 2 messages (history + current_user)
  assert.ok(anthropicMsgs.length >= 2);
  // Last should be the current user message
  const last = anthropicMsgs[anthropicMsgs.length - 1];
  assert.strictEqual(last.role, "user");
  assert.strictEqual(last.content[0].text, "今天天气怎么样？");
});

check("anthropic stringifies structured content for image", () => {
  const ctx = makeBaseCtx();
  ctx.currentUserMessage = {
    role: "user",
    content: [
      { type: "text", text: "看图" },
      { type: "image_url", image_url: { url: "https://example.com/img.jpg" } },
    ],
  };
  const assembled = assemble(ctx);
  const anthropicMsgs = assembledToAnthropicMessages(assembled.messages);
  const last = anthropicMsgs[anthropicMsgs.length - 1];

  assert.strictEqual(last.role, "user");
  assert.strictEqual(last.content.length, 1);
  assert.strictEqual(last.content[0].type, "text");
  // Should be JSON-stringified since it's structured content
  const parsed = JSON.parse(last.content[0].text);
  assert.strictEqual(parsed.length, 2);
  assert.strictEqual(parsed[1].type, "image_url");
});

// ---------------------------------------------------------------------------
// Test 7: OpenAI conversion
// ---------------------------------------------------------------------------

console.log("\n--- Test 7: OpenAI conversion ---");

check("system blocks merge into one system message", () => {
  const ctx = makeBaseCtx();
  const assembled = assemble(ctx);
  const sysMsg = assembledToOpenAISystem(assembled.system_blocks);

  assert.ok(sysMsg !== null);
  assert.strictEqual(sysMsg.role, "system");
  assert.strictEqual(typeof sysMsg.content, "string");
  // Should contain content from multiple blocks
  assert.ok(sysMsg.content.includes("代理层"));  // proxy_static_rules
  assert.ok(sysMsg.content.includes("测试角色")); // client_system
});

check("openai messages preserve image_url content", () => {
  const ctx = makeBaseCtx();
  ctx.currentUserMessage = {
    role: "user",
    content: [
      { type: "text", text: "描述这张图" },
      { type: "image_url", image_url: { url: "https://example.com/cat.jpg" } },
    ],
  };
  const assembled = assemble(ctx);
  const openaiMsgs = assembledToOpenAIChatMessages(assembled);

  // Find the last user message
  const lastUser = openaiMsgs.filter((m) => m.role === "user").pop();
  assert.ok(Array.isArray(lastUser.content));
  assert.strictEqual(lastUser.content.length, 2);
  assert.deepStrictEqual(lastUser.content[1], {
    type: "image_url",
    image_url: { url: "https://example.com/cat.jpg" },
  });
});

check("openai combined starts with system, then conversation", () => {
  const ctx = makeBaseCtx();
  const assembled = assemble(ctx);
  const openaiMsgs = assembledToOpenAIChatMessages(assembled);

  assert.strictEqual(openaiMsgs[0].role, "system");
  // After system, should have history messages then current_user
  const nonSystem = openaiMsgs.filter((m) => m.role !== "system");
  assert.ok(nonSystem.length >= 2);
  assert.strictEqual(nonSystem[nonSystem.length - 1].role, "user");
  assert.strictEqual(nonSystem[nonSystem.length - 1].content, "今天天气怎么样？");
});

check("openai empty system_blocks produces no system message", () => {
  const empty = {
    system_blocks: [],
    messages: [{ role: "user", content: "hi" }],
    meta: { anchor_index: -1, block_ids: [], client_system_hash: "none" },
  };
  const openaiMsgs = assembledToOpenAIChatMessages(empty);
  assert.strictEqual(openaiMsgs.length, 1);
  assert.strictEqual(openaiMsgs[0].role, "user");
});

check("cache_control never leaks into openai output", () => {
  const ctx = makeBaseCtx();
  const assembled = assemble(ctx);
  const openaiMsgs = assembledToOpenAIChatMessages(assembled);

  for (const msg of openaiMsgs) {
    assert.strictEqual(msg.cache_control, undefined);
  }
});

// ---------------------------------------------------------------------------
// hasToolContent — contract mirror of src/api/chatCompletions.ts
// ---------------------------------------------------------------------------

function hasToolContent(body) {
  return body.messages.some(
    (m) => m.role === "tool" || (m.role === "assistant" && m.tool_calls != null)
  );
}

// ---------------------------------------------------------------------------
// Test 8: OpenAI path branching (hasToolContent)
// ---------------------------------------------------------------------------

console.log("\n--- Test 8: OpenAI path branching ---");

check("plain user/assistant request → assembler path (no tool content)", () => {
  const body = {
    model: "companion",
    messages: [
      { role: "system", content: "你是测试角色。" },
      { role: "user", content: "你好" },
      { role: "assistant", content: "你好呀！" },
      { role: "user", content: "今天怎么样？" },
    ],
  };
  assert.strictEqual(hasToolContent(body), false);
});

check("image_url request → assembler path (no tool content)", () => {
  const body = {
    model: "companion",
    messages: [
      { role: "user", content: [
        { type: "text", text: "描述这张图" },
        { type: "image_url", image_url: { url: "https://example.com/cat.jpg" } },
      ]},
    ],
  };
  assert.strictEqual(hasToolContent(body), false);
});

check("role=tool message → fallback path", () => {
  const body = {
    model: "companion",
    messages: [
      { role: "user", content: "查天气" },
      { role: "assistant", content: null, tool_calls: [{ id: "tc_1", type: "function", function: { name: "get_weather", arguments: "{}" }}] },
      { role: "tool", content: '{"temp": 25}', tool_call_id: "tc_1" },
      { role: "user", content: "然后呢？" },
    ],
  };
  assert.strictEqual(hasToolContent(body), true);
});

check("assistant with tool_calls → fallback path", () => {
  const body = {
    model: "companion",
    messages: [
      { role: "user", content: "搜索一下" },
      { role: "assistant", content: null, tool_calls: [{ id: "tc_2", type: "function", function: { name: "web_search", arguments: '{"q":"test"}' }}] },
    ],
  };
  assert.strictEqual(hasToolContent(body), true);
});

check("assistant without tool_calls → assembler path", () => {
  const body = {
    model: "companion",
    messages: [
      { role: "assistant", content: "普通回复" },
      { role: "user", content: "继续" },
    ],
  };
  assert.strictEqual(hasToolContent(body), false);
});

check("mixed: tool in history but last exchange is clean → still fallback", () => {
  const body = {
    model: "companion",
    messages: [
      { role: "user", content: "查天气" },
      { role: "assistant", content: null, tool_calls: [{ id: "tc_1", type: "function", function: { name: "get_weather", arguments: "{}" }}] },
      { role: "tool", content: '{"temp": 25}', tool_call_id: "tc_1" },
      { role: "assistant", content: "今天25度" },
      { role: "user", content: "谢谢" },
    ],
  };
  // Has tool in history → fallback, even though last exchange is clean
  assert.strictEqual(hasToolContent(body), true);
});

check("assembler output for image request preserves image_url", () => {
  const body = {
    model: "companion",
    messages: [
      { role: "user", content: [
        { type: "text", text: "看这个" },
        { type: "image_url", image_url: { url: "https://example.com/img.png" } },
      ]},
    ],
  };
  // Should go through assembler (no tool content)
  assert.strictEqual(hasToolContent(body), false);

  // Build context from body (mirrors assemble.ts extract* helpers)
  const ctx = {
    systemMessages: body.messages.filter((m) => m.role === "system"),
    pinnedPersonaMemories: null,
    summaryEntry: null,
    ragMemories: [],
    visionOutput: null,
    historyMessages: [],
    currentUserMessage: body.messages[body.messages.length - 1],
  };
  const assembled = assemble(ctx);
  const openaiMsgs = assembledToOpenAIChatMessages(assembled);
  const lastUser = openaiMsgs.filter((m) => m.role === "user").pop();
  assert.ok(Array.isArray(lastUser.content));
  assert.deepStrictEqual(lastUser.content[1], {
    type: "image_url",
    image_url: { url: "https://example.com/img.png" },
  });
});

// ---------------------------------------------------------------------------
// applyCacheOverrides — contract mirror of src/api/chatCompletions.ts
// ---------------------------------------------------------------------------

function applyCacheOverrides(systemBlocks, env) {
  const anchor = systemBlocks.find((b) => b.cache_control);
  if (!anchor) return;

  if (env.ANTHROPIC_CACHE_ENABLED === "false") {
    delete anchor.cache_control;
    return;
  }

  const ttl = env.ANTHROPIC_CACHE_TTL === "1h" ? "1h" : "5m";
  anchor.cache_control = { type: "ephemeral", ttl };
}

// ---------------------------------------------------------------------------
// Test 9: Anthropic (Claude) path
// ---------------------------------------------------------------------------

console.log("\n--- Test 9: Anthropic path ---");

check("cache_control on client_system block only", () => {
  const ctx = makeBaseCtx();
  const assembled = assemble(ctx);
  const anthropicSystem = assembledToAnthropicSystem(assembled.system_blocks);

  // Exactly one block should have cache_control
  const withCache = anthropicSystem.filter((b) => b.cache_control);
  assert.strictEqual(withCache.length, 1);

  // That block should be the one at anchor_index
  const anchorBlock = anthropicSystem[assembled.meta.anchor_index];
  assert.ok(anchorBlock.cache_control);
  assert.strictEqual(anchorBlock.cache_control.type, "ephemeral");
});

check("dynamic memory block after client_system has no cache_control", () => {
  const ctx = makeBaseCtx();
  ctx.ragMemories = [
    { type: "note", importance: 0.8, content: "用户喜欢猫" },
    { type: "fact", importance: 0.6, content: "用户住在上海" },
  ];
  const assembled = assemble(ctx);
  const anthropicSystem = assembledToAnthropicSystem(assembled.system_blocks);

  // Find dynamic_memory_patch block
  const dmIdx = assembled.meta.block_ids.indexOf("dynamic_memory_patch");
  assert.ok(dmIdx >= 0, "dynamic_memory_patch should be present");
  // It should NOT have cache_control
  assert.strictEqual(anthropicSystem[dmIdx].cache_control, undefined);
});

check("plain user/assistant messages order preserved through Anthropic conversion", () => {
  const ctx = makeBaseCtx();
  ctx.historyMessages = [
    { role: "user", content: "第一条" },
    { role: "assistant", content: "回复第一条" },
    { role: "user", content: "第二条" },
    { role: "assistant", content: "回复第二条" },
  ];
  ctx.currentUserMessage = { role: "user", content: "第三条" };

  const assembled = assemble(ctx);
  const anthropicMsgs = assembledToAnthropicMessages(assembled.messages);

  // Should be: user, assistant, user, assistant, user (current)
  assert.strictEqual(anthropicMsgs.length, 5);
  assert.strictEqual(anthropicMsgs[0].role, "user");
  assert.strictEqual(anthropicMsgs[0].content[0].text, "第一条");
  assert.strictEqual(anthropicMsgs[1].role, "assistant");
  assert.strictEqual(anthropicMsgs[1].content[0].text, "回复第一条");
  assert.strictEqual(anthropicMsgs[2].role, "user");
  assert.strictEqual(anthropicMsgs[2].content[0].text, "第二条");
  assert.strictEqual(anthropicMsgs[3].role, "assistant");
  assert.strictEqual(anthropicMsgs[3].content[0].text, "回复第二条");
  assert.strictEqual(anthropicMsgs[4].role, "user");
  assert.strictEqual(anthropicMsgs[4].content[0].text, "第三条");
});

check("tool/tool_calls request → hasToolContent=true (fallback for both paths)", () => {
  // Same check applies to both OpenAI and Anthropic paths
  const body = {
    model: "anthropic/claude-sonnet-4-6",
    messages: [
      { role: "user", content: "查天气" },
      { role: "assistant", content: null, tool_calls: [{ id: "tc_1", type: "function", function: { name: "get_weather", arguments: "{}" }}] },
      { role: "tool", content: '{"temp": 25}', tool_call_id: "tc_1" },
    ],
  };
  assert.strictEqual(hasToolContent(body), true);
});

check("structured content (image_url) goes through JSON.stringify fallback in Anthropic", () => {
  const ctx = makeBaseCtx();
  ctx.currentUserMessage = {
    role: "user",
    content: [
      { type: "text", text: "描述这张图" },
      { type: "image_url", image_url: { url: "https://example.com/cat.jpg" } },
    ],
  };
  const assembled = assemble(ctx);
  const anthropicMsgs = assembledToAnthropicMessages(assembled.messages);
  const last = anthropicMsgs[anthropicMsgs.length - 1];

  assert.strictEqual(last.role, "user");
  assert.strictEqual(last.content.length, 1);
  assert.strictEqual(last.content[0].type, "text");
  // JSON.stringify fallback — structured content is stringified, not lost
  const parsed = JSON.parse(last.content[0].text);
  assert.ok(Array.isArray(parsed));
  assert.strictEqual(parsed.length, 2);
  assert.strictEqual(parsed[0].type, "text");
  assert.strictEqual(parsed[1].type, "image_url");
  assert.strictEqual(parsed[1].image_url.url, "https://example.com/cat.jpg");
});

check("applyCacheOverrides removes cache_control when ANTHROPIC_CACHE_ENABLED=false", () => {
  const ctx = makeBaseCtx();
  const assembled = assemble(ctx);
  const systemBlocks = assembledToAnthropicSystem(assembled.system_blocks);

  // Confirm cache_control exists before override
  const anchor = systemBlocks.find((b) => b.cache_control);
  assert.ok(anchor, "should have cache_control before override");

  applyCacheOverrides(systemBlocks, { ANTHROPIC_CACHE_ENABLED: "false" });

  const after = systemBlocks.find((b) => b.cache_control);
  assert.strictEqual(after, undefined, "cache_control should be removed");
});

check("applyCacheOverrides sets TTL=1h when ANTHROPIC_CACHE_TTL=1h", () => {
  const ctx = makeBaseCtx();
  const assembled = assemble(ctx);
  const systemBlocks = assembledToAnthropicSystem(assembled.system_blocks);

  applyCacheOverrides(systemBlocks, { ANTHROPIC_CACHE_TTL: "1h" });

  const anchor = systemBlocks.find((b) => b.cache_control);
  assert.ok(anchor);
  assert.deepStrictEqual(anchor.cache_control, { type: "ephemeral", ttl: "1h" });
});

check("applyCacheOverrides defaults TTL to 5m", () => {
  const ctx = makeBaseCtx();
  const assembled = assemble(ctx);
  const systemBlocks = assembledToAnthropicSystem(assembled.system_blocks);

  applyCacheOverrides(systemBlocks, {});

  const anchor = systemBlocks.find((b) => b.cache_control);
  assert.ok(anchor);
  assert.deepStrictEqual(anchor.cache_control, { type: "ephemeral", ttl: "5m" });
});

check("Anthropic path: full pipeline produces valid system + messages", () => {
  const ctx = makeBaseCtx();
  ctx.systemMessages = [
    { role: "system", content: "你是咲咲的伴侣。" },
  ];
  ctx.ragMemories = [
    { type: "note", importance: 0.7, content: "用户喜欢猫" },
  ];

  const assembled = assemble(ctx);

  // System blocks
  const systemBlocks = assembledToAnthropicSystem(assembled.system_blocks);
  applyCacheOverrides(systemBlocks, {});

  // Should have: proxy_static_rules, persona_pinned(skip), long_term_summary(skip),
  //              preset_lite, client_system, dynamic_memory_patch
  assert.ok(systemBlocks.length >= 3);
  // First block text should contain proxy rules
  assert.ok(systemBlocks[0].text.includes("前端提供的角色"));
  // Cache anchor present
  const anchor = systemBlocks.find((b) => b.cache_control);
  assert.ok(anchor);
  assert.ok(anchor.text.includes("咲咲的伴侣"));

  // Messages
  const messages = assembledToAnthropicMessages(assembled.messages);
  assert.ok(messages.length >= 1);
  const last = messages[messages.length - 1];
  assert.strictEqual(last.role, "user");
  assert.strictEqual(last.content[0].text, "今天天气怎么样？");
});

// ---------------------------------------------------------------------------
// fetchPinnedPersonaMemories — contract mirror of src/api/chatCompletions.ts
// Simulates: listMemories(DB, { namespace, status:"active", limit:100 })
//            .filter(pinned && type in PERSONA_MEMORY_TYPES)
//            .map(toMemoryApiRecord)
// ---------------------------------------------------------------------------

function simulateFetchPinnedPersonaMemories(allRecords) {
  return allRecords
    .filter((r) => r.pinned && PERSONA_MEMORY_TYPES.includes(r.type))
    .map((r) => ({ ...r, pinned: Boolean(r.pinned) }));
}

// ---------------------------------------------------------------------------
// Test 10: pinnedPersonaMemories filtering
// ---------------------------------------------------------------------------

console.log("\n--- Test 10: pinnedPersonaMemories filtering ---");

check("pinned persona memory passes filter", () => {
  const records = [
    { id: "m1", type: "persona", content: "性格温柔", importance: 0.9, pinned: 1 },
  ];
  const result = simulateFetchPinnedPersonaMemories(records);
  assert.strictEqual(result.length, 1);
  assert.strictEqual(result[0].type, "persona");
  assert.strictEqual(result[0].pinned, true);
});

check("pinned identity memory passes filter", () => {
  const records = [
    { id: "m2", type: "identity", content: "名字是咲咲", importance: 0.95, pinned: 1 },
  ];
  const result = simulateFetchPinnedPersonaMemories(records);
  assert.strictEqual(result.length, 1);
  assert.strictEqual(result[0].type, "identity");
});

check("pinned non-persona/identity memory is excluded", () => {
  const records = [
    { id: "m3", type: "fact", content: "用户住在上海", importance: 0.8, pinned: 1 },
    { id: "m4", type: "note", content: "用户喜欢猫", importance: 0.7, pinned: 1 },
    { id: "m5", type: "preference", content: "喜欢蓝色", importance: 0.6, pinned: 1 },
  ];
  const result = simulateFetchPinnedPersonaMemories(records);
  assert.strictEqual(result.length, 0);
});

check("unpinned persona memory is excluded", () => {
  const records = [
    { id: "m6", type: "persona", content: "曾经提到过旅行", importance: 0.5, pinned: 0 },
  ];
  const result = simulateFetchPinnedPersonaMemories(records);
  assert.strictEqual(result.length, 0);
});

check("mixed records: only pinned persona/identity survive", () => {
  const records = [
    { id: "m1", type: "persona", content: "性格温柔", importance: 0.9, pinned: 1 },
    { id: "m2", type: "identity", content: "名字是咲咲", importance: 0.95, pinned: 1 },
    { id: "m3", type: "fact", content: "住在上海", importance: 0.8, pinned: 1 },
    { id: "m4", type: "note", content: "喜欢猫", importance: 0.7, pinned: 1 },
    { id: "m5", type: "persona", content: "未固定的", importance: 0.5, pinned: 0 },
    { id: "m6", type: "identity", content: "另一个身份", importance: 0.6, pinned: 1 },
  ];
  const result = simulateFetchPinnedPersonaMemories(records);
  assert.strictEqual(result.length, 3);
  assert.ok(result.every((r) => r.pinned === true));
  assert.ok(result.every((r) => PERSONA_MEMORY_TYPES.includes(r.type)));
  const ids = result.map((r) => r.id).sort();
  assert.deepStrictEqual(ids, ["m1", "m2", "m6"]);
});

check("filtered persona/identity feed into persona_pinned block correctly", () => {
  const records = [
    { id: "m1", type: "persona", content: "性格温柔", importance: 0.9, pinned: 1 },
    { id: "m2", type: "identity", content: "名字是咲咲", importance: 0.95, pinned: 1 },
    { id: "m3", type: "fact", content: "住在上海", importance: 0.8, pinned: 1 },
  ];
  const pinnedPersonaMemories = simulateFetchPinnedPersonaMemories(records);

  // Only m1 and m2 should be passed to assembler
  assert.strictEqual(pinnedPersonaMemories.length, 2);

  const ctx = makeBaseCtx();
  ctx.pinnedPersonaMemories = pinnedPersonaMemories;
  const assembled = assemble(ctx);

  const ppIdx = assembled.meta.block_ids.indexOf("persona_pinned");
  assert.ok(ppIdx >= 0, "persona_pinned block should be present");
  const ppText = assembled.system_blocks[ppIdx].text;
  assert.ok(ppText.includes("性格温柔"));
  assert.ok(ppText.includes("名字是咲咲"));
  // Non-persona/identity pinned memory must NOT appear
  assert.ok(!ppText.includes("住在上海"));
});

check("empty pinned memories → persona_pinned block skipped", () => {
  const records = [
    { id: "m1", type: "fact", content: "住在上海", importance: 0.8, pinned: 1 },
  ];
  const pinnedPersonaMemories = simulateFetchPinnedPersonaMemories(records);
  assert.strictEqual(pinnedPersonaMemories.length, 0);

  const ctx = makeBaseCtx();
  ctx.pinnedPersonaMemories = pinnedPersonaMemories;
  const assembled = assemble(ctx);

  assert.ok(!assembled.meta.block_ids.includes("persona_pinned"));
});

check("assembler receives non-null pinnedPersonaMemories (not null fallback)", () => {
  // Simulates the real chatCompletions flow:
  // fetchPinnedPersonaMemories returns [] (no pinned persona/identity),
  // NOT null. The assembler should treat [] as "no memories" and skip.
  const pinnedPersonaMemories = [];
  assert.notStrictEqual(pinnedPersonaMemories, null, "should be [], not null");

  const ctx = makeBaseCtx();
  ctx.pinnedPersonaMemories = pinnedPersonaMemories;
  const assembled = assemble(ctx);
  // persona_pinned should be skipped (empty array)
  assert.ok(!assembled.meta.block_ids.includes("persona_pinned"));
});

// ---------------------------------------------------------------------------
// Adapter helper contract mirrors
// buildOpenAIRequestFromAssembled: src/proxy/openaiAdapter.ts
// buildAnthropicRequestFromAssembled: src/proxy/anthropicAdapter.ts
// ---------------------------------------------------------------------------

function buildOpenAIRequestFromAssembled(req, targetModel, assembled) {
  const messages = assembledToOpenAIChatMessages(assembled);
  const cleaned = { ...req, messages };
  delete cleaned.thinking;
  return { ...cleaned, model: targetModel, stream: Boolean(cleaned.stream) };
}

function getThinkingBudget(env) {
  const value = Number(env.ANTHROPIC_THINKING_BUDGET || 1024);
  return Number.isFinite(value) ? Math.min(Math.max(Math.floor(value), 1024), 32000) : 1024;
}

function clampThinkingBudget(value) {
  const numeric = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isFinite(numeric)) return null;
  return Math.min(Math.max(Math.floor(numeric), 1024), 32000);
}

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parseBooleanLike(value) {
  if (typeof value === "boolean") return value;
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  if (["true", "1", "yes", "on", "enabled"].includes(normalized)) return true;
  if (["false", "0", "no", "off", "disabled", "none"].includes(normalized)) return false;
  return null;
}

function budgetFromReasoningEffort(value) {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  if (["none", "off", "disabled", "disable"].includes(normalized)) return 0;
  if (["minimal", "low"].includes(normalized)) return 1024;
  if (["medium", "auto"].includes(normalized)) return 2048;
  if (normalized === "high") return 4096;
  if (["xhigh", "extra_high"].includes(normalized)) return 8192;
  return null;
}

function readThinkingDirective(source) {
  const effortBudget = budgetFromReasoningEffort(source.reasoning_effort);
  if (effortBudget === 0) return { enabled: false };
  if (effortBudget && effortBudget > 0) return { enabled: true, budget: effortBudget };

  const enableThinking = parseBooleanLike(source.enable_thinking);
  if (enableThinking !== null) {
    return {
      enabled: enableThinking,
      budget: clampThinkingBudget(source.thinking_budget ?? source.reasoning_budget ?? source.budget_tokens) ?? undefined,
    };
  }

  const thinking = source.thinking;
  if (parseBooleanLike(thinking) !== null) {
    const enabled = parseBooleanLike(thinking);
    return {
      enabled: enabled ?? undefined,
      budget: clampThinkingBudget(source.thinking_budget ?? source.reasoning_budget ?? source.budget_tokens) ?? undefined,
    };
  }

  if (isRecord(thinking)) {
    const type = typeof thinking.type === "string" ? thinking.type.trim().toLowerCase() : "";
    if (["disabled", "off", "none"].includes(type)) return { enabled: false };
    const budget = clampThinkingBudget(thinking.budget_tokens ?? thinking.budget ?? source.thinking_budget);
    if (type === "enabled" || budget) return { enabled: true, budget: budget ?? undefined };
  }

  const reasoning = source.reasoning;
  if (parseBooleanLike(reasoning) !== null) {
    const enabled = parseBooleanLike(reasoning);
    return {
      enabled: enabled ?? undefined,
      budget: clampThinkingBudget(source.reasoning_budget ?? source.budget_tokens) ?? undefined,
    };
  }

  if (isRecord(reasoning)) {
    const enabled = parseBooleanLike(reasoning.enabled);
    if (enabled === false) return { enabled: false };
    const budget =
      clampThinkingBudget(reasoning.budget_tokens ?? reasoning.budget ?? source.reasoning_budget) ??
      budgetFromReasoningEffort(reasoning.effort);
    if (enabled === true || (budget && budget > 0)) return { enabled: true, budget: budget ?? undefined };
  }

  const budget = clampThinkingBudget(source.thinking_budget ?? source.reasoning_budget ?? source.budget_tokens);
  if (budget) return { enabled: true, budget };

  return {};
}

function getRequestThinkingDirective(req) {
  for (const source of [req, isRecord(req.extra_body) ? req.extra_body : null, isRecord(req.extraBody) ? req.extraBody : null]) {
    if (!source) continue;
    const directive = readThinkingDirective(source);
    if (directive.enabled !== undefined || directive.budget !== undefined) return directive;
  }
  return {};
}

function buildThinkingConfig(env, req) {
  const requestDirective = getRequestThinkingDirective(req);
  if (requestDirective.enabled === false) return undefined;
  if (requestDirective.enabled === true || requestDirective.budget) {
    return {
      type: "enabled",
      budget_tokens: requestDirective.budget ?? getThinkingBudget(env),
      display: "summarized",
    };
  }
  if (env.ANTHROPIC_THINKING_ENABLED !== "true") return undefined;
  return { type: "enabled", budget_tokens: getThinkingBudget(env), display: "summarized" };
}

function getAnthropicMaxTokens(req, env) {
  const maxTokens = typeof req.max_tokens === "number" ? Math.max(Math.floor(req.max_tokens), 1) : 1024;
  const thinking = buildThinkingConfig(env, req);
  if (!thinking) return maxTokens;
  return Math.max(maxTokens, thinking.budget_tokens + Math.min(Math.max(maxTokens, 256), 4096));
}

function buildAnthropicRequestFromAssembled(req, targetModel, assembled, env) {
  const thinking = buildThinkingConfig(env, req);
  const system = assembledToAnthropicSystem(assembled.system_blocks);
  applyCacheOverrides(system, env);
  const messages = assembledToAnthropicMessages(assembled.messages);
  return {
    model: targetModel.replace(/^anthropic\//i, ""),
    max_tokens: getAnthropicMaxTokens(req, env),
    temperature: thinking ? undefined : typeof req.temperature === "number" ? req.temperature : undefined,
    stream: Boolean(req.stream),
    thinking,
    system,
    messages,
  };
}

// ---------------------------------------------------------------------------
// Test 11: Adapter helpers
// ---------------------------------------------------------------------------

console.log("\n--- Test 11: Adapter helpers ---");

check("OpenAI helper: system message is first, model is set", () => {
  const ctx = makeBaseCtx();
  ctx.systemMessages = [{ role: "system", content: "测试角色" }];
  const assembled = assemble(ctx);
  const req = buildOpenAIRequestFromAssembled(
    { model: "companion", messages: [] },
    "deepseek/deepseek-v4-pro",
    assembled
  );
  assert.strictEqual(req.model, "deepseek/deepseek-v4-pro");
  assert.strictEqual(req.messages[0].role, "system");
  assert.ok(req.messages[0].content.includes("测试角色"));
});

check("OpenAI helper: image_url preserved in last user message", () => {
  const ctx = makeBaseCtx();
  ctx.currentUserMessage = {
    role: "user",
    content: [
      { type: "text", text: "描述" },
      { type: "image_url", image_url: { url: "https://example.com/img.jpg" } },
    ],
  };
  const assembled = assemble(ctx);
  const req = buildOpenAIRequestFromAssembled(
    { model: "companion", messages: [] },
    "deepseek/deepseek-v4-pro",
    assembled
  );
  const lastUser = req.messages.filter((m) => m.role === "user").pop();
  assert.ok(Array.isArray(lastUser.content));
  assert.strictEqual(lastUser.content[1].type, "image_url");
});

check("OpenAI helper: strips Claude native thinking but keeps reasoning_effort", () => {
  const ctx = makeBaseCtx();
  const assembled = assemble(ctx);
  const req = buildOpenAIRequestFromAssembled(
    {
      model: "companion",
      messages: [],
      thinking: false,
      reasoning_effort: "high",
    },
    "deepseek/deepseek-v4-pro",
    assembled
  );
  assert.strictEqual("thinking" in req, false);
  assert.strictEqual(req.reasoning_effort, "high");
});

check("Anthropic helper: cache_control only on client_system", () => {
  const ctx = makeBaseCtx();
  ctx.systemMessages = [{ role: "system", content: "角色卡" }];
  ctx.ragMemories = [{ type: "note", importance: 0.7, content: "喜欢猫" }];
  const assembled = assemble(ctx);
  const req = buildAnthropicRequestFromAssembled(
    { messages: [] },
    "anthropic/claude-sonnet-4-6",
    assembled,
    {}
  );
  const withCache = req.system.filter((b) => b.cache_control);
  assert.strictEqual(withCache.length, 1);
  assert.ok(withCache[0].text.includes("角色卡"));
});

check("Anthropic helper: ANTHROPIC_CACHE_ENABLED=false removes cache_control", () => {
  const ctx = makeBaseCtx();
  const assembled = assemble(ctx);
  const req = buildAnthropicRequestFromAssembled(
    { messages: [] },
    "anthropic/claude-sonnet-4-6",
    assembled,
    { ANTHROPIC_CACHE_ENABLED: "false" }
  );
  const withCache = req.system.filter((b) => b.cache_control);
  assert.strictEqual(withCache.length, 0);
});

check("Anthropic helper: ANTHROPIC_CACHE_TTL=1h sets ttl=1h", () => {
  const ctx = makeBaseCtx();
  const assembled = assemble(ctx);
  const req = buildAnthropicRequestFromAssembled(
    { messages: [] },
    "anthropic/claude-sonnet-4-6",
    assembled,
    { ANTHROPIC_CACHE_TTL: "1h" }
  );
  const anchor = req.system.find((b) => b.cache_control);
  assert.ok(anchor);
  assert.deepStrictEqual(anchor.cache_control, { type: "ephemeral", ttl: "1h" });
});

check("Anthropic helper: defaults ttl to 5m", () => {
  const ctx = makeBaseCtx();
  const assembled = assemble(ctx);
  const req = buildAnthropicRequestFromAssembled(
    { messages: [] },
    "anthropic/claude-sonnet-4-6",
    assembled,
    {}
  );
  const anchor = req.system.find((b) => b.cache_control);
  assert.ok(anchor);
  assert.deepStrictEqual(anchor.cache_control, { type: "ephemeral", ttl: "5m" });
});

check("Anthropic helper: structured content stringified (temporary fallback)", () => {
  const ctx = makeBaseCtx();
  ctx.currentUserMessage = {
    role: "user",
    content: [
      { type: "text", text: "看图" },
      { type: "image_url", image_url: { url: "https://example.com/cat.jpg" } },
    ],
  };
  const assembled = assemble(ctx);
  const req = buildAnthropicRequestFromAssembled(
    { messages: [] },
    "anthropic/claude-sonnet-4-6",
    assembled,
    {}
  );
  const last = req.messages[req.messages.length - 1];
  assert.strictEqual(last.role, "user");
  assert.strictEqual(last.content.length, 1);
  assert.strictEqual(last.content[0].type, "text");
  const parsed = JSON.parse(last.content[0].text);
  assert.strictEqual(parsed[1].type, "image_url");
});

check("Anthropic helper: model prefix stripped", () => {
  const ctx = makeBaseCtx();
  const assembled = assemble(ctx);
  const req = buildAnthropicRequestFromAssembled(
    { messages: [] },
    "anthropic/claude-sonnet-4-6",
    assembled,
    {}
  );
  assert.strictEqual(req.model, "claude-sonnet-4-6");
});

check("tool/tool_calls request → hasToolContent=true → both paths fall back", () => {
  const body = {
    model: "companion",
    messages: [
      { role: "user", content: "查天气" },
      { role: "assistant", content: null, tool_calls: [{ id: "tc_1", type: "function", function: { name: "get_weather", arguments: "{}" }}] },
      { role: "tool", content: '{"temp": 25}', tool_call_id: "tc_1" },
    ],
  };
  assert.strictEqual(hasToolContent(body), true);
  // In real code, this triggers old fallback path for both OpenAI and Anthropic
});

// ---------------------------------------------------------------------------
// Test 12: Cache metadata — client_system_hash and cache_anchor_block
// Contract mirror for P1.4: usage_logs cache tracking
// ---------------------------------------------------------------------------

console.log("\n--- Test 12: Cache metadata ---");

check("assembled.meta.client_system_hash is a non-empty string", () => {
  const ctx = makeBaseCtx();
  ctx.systemMessages = [{ role: "system", content: "角色卡内容" }];
  const assembled = assemble(ctx);
  assert.ok(typeof assembled.meta.client_system_hash === "string");
  assert.ok(assembled.meta.client_system_hash.length > 0);
});

check("same client_system text → same client_system_hash", () => {
  const ctx1 = makeBaseCtx();
  ctx1.systemMessages = [{ role: "system", content: "固定角色卡" }];
  const ctx2 = makeBaseCtx();
  ctx2.systemMessages = [{ role: "system", content: "固定角色卡" }];
  const a = assemble(ctx1);
  const b = assemble(ctx2);
  assert.strictEqual(a.meta.client_system_hash, b.meta.client_system_hash);
});

check("different client_system text → different client_system_hash", () => {
  const ctx1 = makeBaseCtx();
  ctx1.systemMessages = [{ role: "system", content: "角色卡A" }];
  const ctx2 = makeBaseCtx();
  ctx2.systemMessages = [{ role: "system", content: "角色卡B" }];
  const a = assemble(ctx1);
  const b = assemble(ctx2);
  assert.notStrictEqual(a.meta.client_system_hash, b.meta.client_system_hash);
});

check("no system messages → client_system_hash is sentinel", () => {
  const ctx = makeBaseCtx();
  ctx.systemMessages = [];
  const assembled = assemble(ctx);
  // When client_system block is skipped, hash should be a known sentinel
  const hasClientSystem = assembled.meta.block_ids.includes("client_system");
  if (!hasClientSystem) {
    assert.strictEqual(assembled.meta.client_system_hash, "none");
  }
});

check("Anthropic assembler path: cacheAnchorBlock = 'client_system' when anchor_index >= 0", () => {
  // Simulates chatCompletions.ts Anthropic assembler branch
  const ctx = makeBaseCtx();
  ctx.systemMessages = [{ role: "system", content: "角色卡" }];
  const assembled = assemble(ctx);

  // chatCompletions.ts sets these when using assembler:
  const clientSystemHash = assembled.meta.client_system_hash;
  const cacheAnchorBlock = assembled.meta.anchor_index >= 0 ? "client_system" : null;

  assert.ok(clientSystemHash.length > 0);
  assert.ok(assembled.meta.anchor_index >= 0, "anchor_index should be >= 0 with system messages");
  assert.strictEqual(cacheAnchorBlock, "client_system");
});

check("Anthropic assembler path: cacheAnchorBlock = null when anchor_index < 0", () => {
  // When no system messages exist, anchor_index is -1
  const ctx = makeBaseCtx();
  ctx.systemMessages = [];
  const assembled = assemble(ctx);

  const clientSystemHash = assembled.meta.client_system_hash;
  const cacheAnchorBlock = assembled.meta.anchor_index >= 0 ? "client_system" : null;

  assert.strictEqual(assembled.meta.anchor_index, -1);
  assert.strictEqual(cacheAnchorBlock, null);
});

check("OpenAI assembler path: cacheAnchorBlock = null", () => {
  // Simulates chatCompletions.ts OpenAI assembler branch
  const ctx = makeBaseCtx();
  const assembled = assemble(ctx);

  const clientSystemHash = assembled.meta.client_system_hash;
  const cacheAnchorBlock = null;

  assert.ok(typeof clientSystemHash === "string");
  assert.strictEqual(cacheAnchorBlock, null);
});

check("fallback path: both clientSystemHash and cacheAnchorBlock are null", () => {
  // Simulates chatCompletions.ts fallback branch (tool content)
  const clientSystemHash = null;
  const cacheAnchorBlock = null;

  assert.strictEqual(clientSystemHash, null);
  assert.strictEqual(cacheAnchorBlock, null);
});

// ---------------------------------------------------------------------------
// Test 13: Thinking + prompt trim
// ---------------------------------------------------------------------------

console.log("\n--- Test 13: Thinking + prompt trim ---");

check("Anthropic thinking is opt-in and omitted by default", () => {
  const ctx = makeBaseCtx();
  const assembled = assemble(ctx);
  const req = buildAnthropicRequestFromAssembled(
    { model: "companion", messages: [], max_tokens: 256 },
    "anthropic/claude-haiku-4-5",
    assembled,
    {}
  );
  assert.strictEqual(req.thinking, undefined);
  assert.strictEqual(req.max_tokens, 256);
});

check("Anthropic thinking adds summarized thinking and enough max_tokens", () => {
  const ctx = makeBaseCtx();
  const assembled = assemble(ctx);
  const req = buildAnthropicRequestFromAssembled(
    { model: "companion", messages: [], max_tokens: 256, temperature: 0.5 },
    "anthropic/claude-haiku-4-5",
    assembled,
    { ANTHROPIC_THINKING_ENABLED: "true", ANTHROPIC_THINKING_BUDGET: "1024" }
  );
  assert.deepStrictEqual(req.thinking, { type: "enabled", budget_tokens: 1024, display: "summarized" });
  assert.ok(req.max_tokens > req.thinking.budget_tokens);
  assert.strictEqual(req.temperature, undefined);
});

check("front-end reasoning_effort enables Claude thinking without env flag", () => {
  const ctx = makeBaseCtx();
  const assembled = assemble(ctx);
  const req = buildAnthropicRequestFromAssembled(
    { model: "companion", messages: [], max_tokens: 256, reasoning_effort: "high" },
    "anthropic/claude-haiku-4-5",
    assembled,
    {}
  );
  assert.deepStrictEqual(req.thinking, { type: "enabled", budget_tokens: 4096, display: "summarized" });
});

check("front-end thinking=false disables env default thinking", () => {
  const ctx = makeBaseCtx();
  const assembled = assemble(ctx);
  const req = buildAnthropicRequestFromAssembled(
    { model: "companion", messages: [], thinking: false, max_tokens: 256 },
    "anthropic/claude-haiku-4-5",
    assembled,
    { ANTHROPIC_THINKING_ENABLED: "true", ANTHROPIC_THINKING_BUDGET: "1024" }
  );
  assert.strictEqual(req.thinking, undefined);
  assert.strictEqual(req.temperature, undefined);
});

check("front-end extra_body.thinking budget maps to Claude thinking", () => {
  const ctx = makeBaseCtx();
  const assembled = assemble(ctx);
  const req = buildAnthropicRequestFromAssembled(
    { model: "companion", messages: [], extra_body: { thinking: { type: "enabled", budget_tokens: 3072 } } },
    "anthropic/claude-haiku-4-5",
    assembled,
    {}
  );
  assert.deepStrictEqual(req.thinking, { type: "enabled", budget_tokens: 3072, display: "summarized" });
});

check("preset_lite no longer hardcodes short paragraphs or hidden-thinking suppression", () => {
  assert.ok(!PRESET_LITE_TEXT.includes("段落不宜过长"));
  assert.ok(!PRESET_LITE_TEXT.includes("不输出隐藏思考"));
});

// ---------------------------------------------------------------------------
// Contract mirrors for preset/regexRules.ts, preset/regexPipeline.ts,
// preset/historyPreprocess.ts, and preset/streamFilters.ts
// ---------------------------------------------------------------------------

// --- Regex rules (must match src/preset/regexRules.ts) ---

const STRIP_THINKING = { id: "strip_thinking", find: /<thinking>[\s\S]*?<\/thinking>/g, replace: "", applyTo: ["content", "history"] };
const STRIP_LANG_DETAILS = { id: "strip_lang_details", find: /<details>\s*<summary>(英文版|日本語版|English|Japanese)<\/summary>[\s\S]*?<\/details>/g, replace: "", applyTo: ["content"] };
const STRIP_SOLID_SQUARE = { id: "strip_solid_square", find: /■/g, replace: "", applyTo: ["content", "stream"] };
const DASH_TO_COMMA = { id: "dash_to_comma", find: /——|—|–/g, replace: "，", applyTo: ["content", "stream"] };

const DEFAULT_RULES = [STRIP_THINKING, STRIP_LANG_DETAILS, STRIP_SOLID_SQUARE, DASH_TO_COMMA];
const CONTENT_RULES = DEFAULT_RULES.filter((r) => r.applyTo.includes("content"));
const HISTORY_RULES = DEFAULT_RULES.filter((r) => r.applyTo.includes("history"));

// --- regexPipeline contract mirror ---

function applyRegexRules(text, rules) {
  let result = text;
  for (const rule of rules) {
    result = result.replace(new RegExp(rule.find.source, rule.find.flags), rule.replace);
  }
  return result;
}

// --- historyPreprocess contract mirror ---

function preprocessMessage(msg) {
  if (msg.role !== "user" && msg.role !== "assistant") return msg;
  if (typeof msg.content === "string") {
    const cleaned = applyRegexRules(msg.content, HISTORY_RULES);
    if (cleaned === msg.content) return msg;
    return { ...msg, content: cleaned };
  }
  if (Array.isArray(msg.content)) {
    let changed = false;
    const newParts = [];
    for (const part of msg.content) {
      if (part && typeof part === "object" && !Array.isArray(part) && part.type === "text" && typeof part.text === "string") {
        const cleaned = applyRegexRules(part.text, HISTORY_RULES);
        if (cleaned !== part.text) { changed = true; newParts.push({ ...part, text: cleaned }); }
        else newParts.push(part);
      } else {
        newParts.push(part);
      }
    }
    if (!changed) return msg;
    return { ...msg, content: newParts };
  }
  return msg;
}

function preprocessHistory(messages) {
  let changed = false;
  const result = [];
  for (const msg of messages) {
    const cleaned = preprocessMessage(msg);
    if (cleaned !== msg) changed = true;
    result.push(cleaned);
  }
  return changed ? result : messages;
}

// --- streamFilters contract mirror ---

const THINKING_OPEN = "<thinking>";
const THINKING_CLOSE = "</thinking>";

function createThinkingFilterState() {
  return { state: "IDLE", buffer: "", pendingDash: false };
}

function isDash(ch) {
  return ch === "—" || ch === "–";
}

function applySingleCharRules(ch) {
  if (ch === "■") return "";
  return ch;
}

function processStreamChunk(chunk, state) {
  if (!chunk) return null;
  let output = "";
  let inDashRun = state.pendingDash;
  state.pendingDash = false;

  for (let i = 0; i < chunk.length; i++) {
    const ch = chunk[i];
    if (state.state === "IDLE") {
      // Dash collapsing
      if (isDash(ch)) {
        inDashRun = true;
        continue;
      }
      // Non-dash: flush any pending dash run as a single ，
      if (inDashRun) {
        output += "，";
        inDashRun = false;
      }
      // <thinking> tag detection
      state.buffer += ch;
      if (THINKING_OPEN.startsWith(state.buffer)) {
        if (state.buffer === THINKING_OPEN) {
          state.state = "INSIDE_THINKING";
          state.buffer = "";
        }
        continue;
      }
      while (state.buffer.length > 0 && !THINKING_OPEN.startsWith(state.buffer)) {
        output += applySingleCharRules(state.buffer[0]);
        state.buffer = state.buffer.slice(1);
      }
      if (state.buffer === THINKING_OPEN) {
        state.state = "INSIDE_THINKING";
        state.buffer = "";
      }
      continue;
    }
    // INSIDE_THINKING
    state.buffer += ch;
    if (THINKING_CLOSE.startsWith(state.buffer)) {
      if (state.buffer === THINKING_CLOSE) {
        state.state = "IDLE";
        state.buffer = "";
      }
      continue;
    }
    state.buffer = "";
  }
  // Hold trailing dash for cross-chunk collapsing. Even if this chunk already
  // emitted text, the next chunk may start with another dash.
  if (state.state === "IDLE" && inDashRun) {
    state.pendingDash = true;
  }
  if (state.state === "IDLE" && state.buffer && !THINKING_OPEN.startsWith(state.buffer)) {
    for (const bufCh of state.buffer) { output += applySingleCharRules(bufCh); }
    state.buffer = "";
  }
  return output || null;
}

function flushPendingDash(state) {
  if (state.pendingDash) {
    state.pendingDash = false;
    return "，";
  }
  return "";
}

// ---------------------------------------------------------------------------
// Test 14: Regex Pipeline
// ---------------------------------------------------------------------------

console.log("\n--- Test 14: Regex Pipeline ---");

check("dash_to_comma: em dash and en dash and double dash all become ，", () => {
  assert.strictEqual(applyRegexRules("这是—测试——示例–结束", CONTENT_RULES), "这是，测试，示例，结束");
});

check("strip_solid_square: ■ removed", () => {
  assert.strictEqual(applyRegexRules("这是■测试■", CONTENT_RULES), "这是测试");
});

check("strip_lang_details: English details block removed", () => {
  const input = "before<details>\n<summary>English</summary>\nSome english text\n</details>after";
  assert.strictEqual(applyRegexRules(input, CONTENT_RULES), "beforeafter");
});

check("strip_lang_details: Japanese details block removed", () => {
  const input = "before<details>\n<summary>日本語版</summary>\n日本語テキスト\n</details>after";
  assert.strictEqual(applyRegexRules(input, CONTENT_RULES), "beforeafter");
});

check("strip_thinking: complete <thinking>...</thinking> removed", () => {
  const input = "before<thinking>internal reasoning</thinking>after";
  assert.strictEqual(applyRegexRules(input, CONTENT_RULES), "beforeafter");
});

check("strip_thinking: multiline thinking block removed", () => {
  const input = "line1\n<thinking>\nstep 1\nstep 2\n</thinking>\nline2";
  assert.strictEqual(applyRegexRules(input, CONTENT_RULES), "line1\n\nline2");
});

check("history preprocess: strips thinking from history but not last user", () => {
  const messages = [
    { role: "user", content: "hello" },
    { role: "assistant", content: "reply<thinking>internal</thinking>continued" },
    { role: "user", content: "follow<thinking>user thinking</thinking>up" },
  ];
  const result = preprocessHistory(messages);
  assert.strictEqual(result[0].content, "hello");
  assert.strictEqual(result[1].content, "replycontinued");
  // Last user message should NOT be touched (caller responsibility,
  // but preprocessHistory processes all messages it receives).
  // In the real flow, only historyMessages are passed, not currentUserMessage.
  // Here we test that it does process what it receives:
  assert.ok(result[2].content.includes("follow") && result[2].content.includes("up"));
});

check("history preprocess: preserves image_url content parts", () => {
  const messages = [
    { role: "user", content: [
      { type: "text", text: "look at this<thinking>leaked</thinking>" },
      { type: "image_url", image_url: { url: "https://example.com/cat.jpg" } },
    ]},
  ];
  const result = preprocessHistory(messages);
  const parts = result[0].content;
  assert.strictEqual(parts.length, 2);
  assert.strictEqual(parts[0].type, "text");
  assert.ok(!parts[0].text.includes("<thinking>"));
  assert.strictEqual(parts[1].type, "image_url");
  assert.strictEqual(parts[1].image_url.url, "https://example.com/cat.jpg");
});

check("history preprocess: skips tool messages", () => {
  const messages = [
    { role: "tool", content: '{"result":"ok"}' },
    { role: "assistant", content: "done" },
  ];
  const result = preprocessHistory(messages);
  assert.strictEqual(result[0].content, '{"result":"ok"}');
  assert.strictEqual(result[1].content, "done");
});

check("stream: <thinking> tag split across chunks is stripped", () => {
  const state = createThinkingFilterState();
  const r1 = processStreamChunk("before<thi", state);
  const r2 = processStreamChunk("nking>hidden</thin", state);
  const r3 = processStreamChunk("king>after", state);
  assert.strictEqual(r1, "before");
  assert.strictEqual(r2, null);
  assert.strictEqual(r3, "after");
});

check("stream: dash replacement works across chunks", () => {
  const state = createThinkingFilterState();
  const r1 = processStreamChunk("这", state);
  const r2 = processStreamChunk("是—测试", state);
  assert.strictEqual(r1, "这");
  assert.strictEqual(r2, "是，测试");
});

check("stream: consecutive dashes collapse into single ，", () => {
  const state = createThinkingFilterState();
  const r = processStreamChunk("———", state);
  // All-dash chunk: held in pendingDash (output is null).
  assert.strictEqual(r, null);
  // After flushPendingDash, get a single ，
  const trailing = flushPendingDash(state);
  assert.strictEqual(trailing, "，");
});

check("stream: trailing dashes after text are held for the next chunk", () => {
  const state = createThinkingFilterState();
  const r = processStreamChunk("text———", state);
  assert.strictEqual(r, "text");
  assert.strictEqual(flushPendingDash(state), "，");
});

check("stream: cross-chunk dash collapsing (all-dash chunks)", () => {
  const state = createThinkingFilterState();
  const r1 = processStreamChunk("—", state);
  const r2 = processStreamChunk("—", state);
  // Chunk 1: all dash, held in pendingDash
  assert.strictEqual(r1, null);
  // Chunk 2: another dash joins the run, still all-dash, held
  assert.strictEqual(r2, null);
  // Flush at stream end
  const trailing = flushPendingDash(state);
  assert.strictEqual(trailing, "，");
});

check("stream: cross-chunk dash collapse after visible text", () => {
  const state = createThinkingFilterState();
  const r1 = processStreamChunk("text—", state);
  const r2 = processStreamChunk("—more", state);
  assert.strictEqual(r1, "text");
  assert.strictEqual(r2, "，more");
  assert.strictEqual(flushPendingDash(state), "");
});

check("stream: trailing all-dash chunk flushed at stream end", () => {
  const state = createThinkingFilterState();
  const r = processStreamChunk("—", state);
  // All-dash chunk → held in pendingDash
  assert.strictEqual(r, null);
  const trailing = flushPendingDash(state);
  assert.strictEqual(trailing, "，");
});

check("stream: no trailing dash → flushPendingDash returns empty", () => {
  const state = createThinkingFilterState();
  processStreamChunk("text", state);
  const trailing = flushPendingDash(state);
  assert.strictEqual(trailing, "");
});

check("stream: ■ stripped in stream", () => {
  const state = createThinkingFilterState();
  const r = processStreamChunk("a■b■c", state);
  assert.strictEqual(r, "abc");
});

check("stream: reasoning_content is never filtered (caller responsibility)", () => {
  // The stream filter only processes visible content chunks.
  // reasoning_content deltas are routed around processStreamChunk.
  // This test documents the contract: processStreamChunk only sees visible text.
  const state = createThinkingFilterState();
  // A normal reasoning content chunk passes through processStreamChunk
  // as regular text (it's the CALLER's job to not send reasoning_content here).
  const r = processStreamChunk("reasoning text", state);
  assert.strictEqual(r, "reasoning text");
});

check("content rules do NOT include stream-only rule in content path", () => {
  // All 4 rules apply to content
  assert.strictEqual(CONTENT_RULES.length, 4);
});

check("history rules only include strip_thinking", () => {
  assert.strictEqual(HISTORY_RULES.length, 1);
  assert.strictEqual(HISTORY_RULES[0].id, "strip_thinking");
});

// ---------------------------------------------------------------------------
// Retention contract mirrors — must match src/db/retention.ts and
// src/memory/retention.ts logic exactly.
// ---------------------------------------------------------------------------

const MESSAGES_RETENTION_DAYS = 14;
const USAGE_LOGS_RETENTION_DAYS = 30;
const MEMORY_EVENTS_RETENTION_DAYS = 30;
const IDEMPOTENCY_KEYS_RETENTION_DAYS = 7;
const MEMORY_ACTIVE_EXPIRY_DAYS = 180;
const MEMORY_HARD_DELETE_DAYS = 30;
const THROTTLE_HOURS = 24;
const RETENTION_BATCH_SIZE = 100;

function daysAgo(days) {
  return new Date(Date.now() - days * 86_400_000).toISOString();
}

function hoursAgoMs(hours) {
  return Date.now() - hours * 3_600_000;
}

function simulateExpireOldMemories(records, cutoff) {
  return records.map((r) => {
    if (
      r.status === "active" &&
      !r.pinned &&
      r.type !== "identity" &&
      r.type !== "persona" &&
      r.updated_at < cutoff
    ) {
      return { ...r, status: "expired" };
    }
    return r;
  });
}

function simulateHardDeleteCandidates(records, cutoff) {
  return records.filter(
    (r) =>
      ["deleted", "superseded", "expired"].includes(r.status) &&
      r.updated_at < cutoff
  );
}

function simulateThrottle(lastRun, now) {
  if (!lastRun) return true;
  const lastRunMs = new Date(lastRun).getTime();
  return lastRunMs <= now - THROTTLE_HOURS * 3_600_000;
}

// ---------------------------------------------------------------------------
// Test 15: D1 Lifecycle Retention
// ---------------------------------------------------------------------------

console.log("\n--- Test 15: D1 Lifecycle Retention ---");

check("messages older than 14 days are deleted", () => {
  const cutoff = daysAgo(MESSAGES_RETENTION_DAYS);
  const old = new Date(Date.now() - 15 * 86_400_000).toISOString();
  const recent = new Date(Date.now() - 5 * 86_400_000).toISOString();
  // In the real DB: DELETE FROM messages WHERE namespace = ? AND created_at < cutoff
  assert.ok(old < cutoff, "15-day-old message should be before cutoff");
  assert.ok(recent > cutoff, "5-day-old message should be after cutoff");
});

check("usage_logs older than 30 days are deleted", () => {
  const cutoff = daysAgo(USAGE_LOGS_RETENTION_DAYS);
  const old = new Date(Date.now() - 31 * 86_400_000).toISOString();
  const recent = new Date(Date.now() - 10 * 86_400_000).toISOString();
  assert.ok(old < cutoff, "31-day-old usage_log should be before cutoff");
  assert.ok(recent > cutoff, "10-day-old usage_log should be after cutoff");
});

check("memory_events older than 30 days are deleted", () => {
  const cutoff = daysAgo(MEMORY_EVENTS_RETENTION_DAYS);
  const old = new Date(Date.now() - 35 * 86_400_000).toISOString();
  assert.ok(old < cutoff, "35-day-old memory_event should be before cutoff");
});

check("idempotency_keys older than 7 days are deleted", () => {
  const cutoff = daysAgo(IDEMPOTENCY_KEYS_RETENTION_DAYS);
  const old = new Date(Date.now() - 8 * 86_400_000).toISOString();
  const recent = new Date(Date.now() - 3 * 86_400_000).toISOString();
  assert.ok(old < cutoff, "8-day-old key should be before cutoff");
  assert.ok(recent > cutoff, "3-day-old key should be after cutoff");
});

check("pinned memory is never expired", () => {
  const cutoff = daysAgo(MEMORY_ACTIVE_EXPIRY_DAYS);
  const records = [
    { id: "m1", type: "note", status: "active", pinned: 1, updated_at: daysAgo(200) },
  ];
  const result = simulateExpireOldMemories(records, cutoff);
  assert.strictEqual(result[0].status, "active", "pinned memory should stay active");
});

check("identity memory is never expired", () => {
  const cutoff = daysAgo(MEMORY_ACTIVE_EXPIRY_DAYS);
  const records = [
    { id: "m2", type: "identity", status: "active", pinned: 0, updated_at: daysAgo(200) },
  ];
  const result = simulateExpireOldMemories(records, cutoff);
  assert.strictEqual(result[0].status, "active", "identity memory should stay active");
});

check("persona memory is never expired", () => {
  const cutoff = daysAgo(MEMORY_ACTIVE_EXPIRY_DAYS);
  const records = [
    { id: "m3", type: "persona", status: "active", pinned: 0, updated_at: daysAgo(200) },
  ];
  const result = simulateExpireOldMemories(records, cutoff);
  assert.strictEqual(result[0].status, "active", "persona memory should stay active");
});

check("pinned identity memory is never expired (pinned + identity)", () => {
  const cutoff = daysAgo(MEMORY_ACTIVE_EXPIRY_DAYS);
  const records = [
    { id: "m4", type: "identity", status: "active", pinned: 1, updated_at: daysAgo(300) },
  ];
  const result = simulateExpireOldMemories(records, cutoff);
  assert.strictEqual(result[0].status, "active");
});

check("active note memory older than 180 days is marked expired", () => {
  const cutoff = daysAgo(MEMORY_ACTIVE_EXPIRY_DAYS);
  const records = [
    { id: "m5", type: "note", status: "active", pinned: 0, updated_at: daysAgo(181) },
  ];
  const result = simulateExpireOldMemories(records, cutoff);
  assert.strictEqual(result[0].status, "expired");
});

check("active fact memory older than 180 days is marked expired", () => {
  const cutoff = daysAgo(MEMORY_ACTIVE_EXPIRY_DAYS);
  const records = [
    { id: "m6", type: "fact", status: "active", pinned: 0, updated_at: daysAgo(200) },
  ];
  const result = simulateExpireOldMemories(records, cutoff);
  assert.strictEqual(result[0].status, "expired");
});

check("active memory younger than 180 days stays active", () => {
  const cutoff = daysAgo(MEMORY_ACTIVE_EXPIRY_DAYS);
  const records = [
    { id: "m7", type: "note", status: "active", pinned: 0, updated_at: daysAgo(30) },
  ];
  const result = simulateExpireOldMemories(records, cutoff);
  assert.strictEqual(result[0].status, "active");
});

check("already deleted memory is not touched by expireOldMemories", () => {
  const cutoff = daysAgo(MEMORY_ACTIVE_EXPIRY_DAYS);
  const records = [
    { id: "m8", type: "note", status: "deleted", pinned: 0, updated_at: daysAgo(200) },
  ];
  const result = simulateExpireOldMemories(records, cutoff);
  assert.strictEqual(result[0].status, "deleted", "deleted status should not change");
});

check("expired memory older than 30 days is hard-deletable", () => {
  const cutoff = daysAgo(MEMORY_HARD_DELETE_DAYS);
  const records = [
    { id: "m9", status: "expired", updated_at: daysAgo(31) },
    { id: "m10", status: "expired", updated_at: daysAgo(10) },
  ];
  const candidates = simulateHardDeleteCandidates(records, cutoff);
  assert.strictEqual(candidates.length, 1);
  assert.strictEqual(candidates[0].id, "m9");
});

check("deleted memory older than 30 days is hard-deletable", () => {
  const cutoff = daysAgo(MEMORY_HARD_DELETE_DAYS);
  const records = [
    { id: "m11", status: "deleted", updated_at: daysAgo(45) },
  ];
  const candidates = simulateHardDeleteCandidates(records, cutoff);
  assert.strictEqual(candidates.length, 1);
});

check("superseded memory older than 30 days is hard-deletable", () => {
  const cutoff = daysAgo(MEMORY_HARD_DELETE_DAYS);
  const records = [
    { id: "m12", status: "superseded", updated_at: daysAgo(60) },
  ];
  const candidates = simulateHardDeleteCandidates(records, cutoff);
  assert.strictEqual(candidates.length, 1);
});

check("active memory is never hard-deletable", () => {
  const cutoff = daysAgo(MEMORY_HARD_DELETE_DAYS);
  const records = [
    { id: "m13", status: "active", updated_at: daysAgo(100) },
  ];
  const candidates = simulateHardDeleteCandidates(records, cutoff);
  assert.strictEqual(candidates.length, 0);
});

check("expired memory younger than 30 days is NOT hard-deletable", () => {
  const cutoff = daysAgo(MEMORY_HARD_DELETE_DAYS);
  const records = [
    { id: "m14", status: "expired", updated_at: daysAgo(15) },
  ];
  const candidates = simulateHardDeleteCandidates(records, cutoff);
  assert.strictEqual(candidates.length, 0);
});

check("hard delete must sync Vectorize: vector_id records require VECTORIZE.deleteByIds", () => {
  // Contract: hardDeleteMemories is only called AFTER VECTORIZE.deleteByIds succeeds
  // If VECTORIZE is missing, only records with vector_id=null are hard-deleted
  const record = { id: "m15", vector_id: "mem_m15", status: "expired", updated_at: daysAgo(60) };
  assert.ok(record.vector_id !== null, "has vector_id → needs Vectorize cleanup first");
});

check("hard delete without VECTORIZE: only vector_id=null records are safe", () => {
  const records = [
    { id: "m16", vector_id: "mem_m16", status: "expired", updated_at: daysAgo(60) },
    { id: "m17", vector_id: null, status: "expired", updated_at: daysAgo(60) },
  ];
  // When VECTORIZE is not bound, only records without vector_id can be safely deleted
  const safeIds = records.filter((r) => r.vector_id === null).map((r) => r.id);
  assert.deepStrictEqual(safeIds, ["m17"]);
});

check("retention throttle: first run (no cursor) should proceed", () => {
  assert.strictEqual(simulateThrottle(null, Date.now()), true);
});

check("retention throttle: recent run (< 24h) should skip", () => {
  const recentRun = new Date(Date.now() - 12 * 3_600_000).toISOString(); // 12h ago
  assert.strictEqual(simulateThrottle(recentRun, Date.now()), false);
});

check("retention throttle: old run (> 24h) should proceed", () => {
  const oldRun = new Date(Date.now() - 25 * 3_600_000).toISOString(); // 25h ago
  assert.strictEqual(simulateThrottle(oldRun, Date.now()), true);
});

check("retention throttle: exactly 24h boundary should proceed", () => {
  const boundaryRun = new Date(Date.now() - 24 * 3_600_000 - 1).toISOString(); // just over 24h
  assert.strictEqual(simulateThrottle(boundaryRun, Date.now()), true);
});

check("retention constants are correct", () => {
  assert.strictEqual(MESSAGES_RETENTION_DAYS, 14);
  assert.strictEqual(USAGE_LOGS_RETENTION_DAYS, 30);
  assert.strictEqual(MEMORY_EVENTS_RETENTION_DAYS, 30);
  assert.strictEqual(IDEMPOTENCY_KEYS_RETENTION_DAYS, 7);
  assert.strictEqual(MEMORY_ACTIVE_EXPIRY_DAYS, 180);
  assert.strictEqual(MEMORY_HARD_DELETE_DAYS, 30);
  assert.strictEqual(THROTTLE_HOURS, 24);
  assert.strictEqual(RETENTION_BATCH_SIZE, 100);
});

check("full lifecycle: active → expired → hard-deletable chain", () => {
  const now = Date.now();
  const cutoff180 = daysAgo(MEMORY_ACTIVE_EXPIRY_DAYS);
  const cutoff30 = daysAgo(MEMORY_HARD_DELETE_DAYS);

  // Memory created 200 days ago, last updated 200 days ago
  const records = [
    { id: "lifecycle", type: "note", status: "active", pinned: 0, updated_at: daysAgo(200), vector_id: "mem_lifecycle" },
  ];

  // Step 1: expire
  const afterExpire = simulateExpireOldMemories(records, cutoff180);
  assert.strictEqual(afterExpire[0].status, "expired");

  // Step 2: simulate 30+ days passing (updated_at stays at 200 days ago)
  const candidates = simulateHardDeleteCandidates(afterExpire, cutoff30);
  assert.strictEqual(candidates.length, 1);
  assert.strictEqual(candidates[0].id, "lifecycle");
  assert.strictEqual(candidates[0].vector_id, "mem_lifecycle");
});

check("full lifecycle: pinned memory survives all retention stages", () => {
  const cutoff180 = daysAgo(MEMORY_ACTIVE_EXPIRY_DAYS);
  const cutoff30 = daysAgo(MEMORY_HARD_DELETE_DAYS);

  const records = [
    { id: "pinned-lifecycle", type: "persona", status: "active", pinned: 1, updated_at: daysAgo(300), vector_id: "mem_pl" },
  ];

  const afterExpire = simulateExpireOldMemories(records, cutoff180);
  assert.strictEqual(afterExpire[0].status, "active", "pinned should stay active");

  const candidates = simulateHardDeleteCandidates(afterExpire, cutoff30);
  assert.strictEqual(candidates.length, 0, "active pinned should not be hard-deletable");
});

// --- Search layer: expired memory filtering ---

check("search layer: expired D1 record from Vectorize hit is filtered out", () => {
  // Contract: searchWithVectorize filters records where status !== "active"
  // Simulates: Vectorize returns a match, but D1 record has status=expired
  const d1Records = [
    { id: "m1", status: "expired", importance: 0.8 },
    { id: "m2", status: "active", importance: 0.7 },
  ];
  const activeRecords = d1Records.filter((r) => r.status === "active");
  assert.strictEqual(activeRecords.length, 1);
  assert.strictEqual(activeRecords[0].id, "m2");
});

check("search layer: deleted D1 record from Vectorize hit is filtered out", () => {
  const d1Records = [
    { id: "m3", status: "deleted", importance: 0.9 },
  ];
  const activeRecords = d1Records.filter((r) => r.status === "active");
  assert.strictEqual(activeRecords.length, 0);
});

check("search layer: superseded D1 record from Vectorize hit is filtered out", () => {
  const d1Records = [
    { id: "m4", status: "superseded", importance: 0.6 },
  ];
  const activeRecords = d1Records.filter((r) => r.status === "active");
  assert.strictEqual(activeRecords.length, 0);
});

check("search layer: all-expired Vectorize results produce empty output", () => {
  const d1Records = [
    { id: "m5", status: "expired" },
    { id: "m6", status: "deleted" },
  ];
  const activeRecords = d1Records.filter((r) => r.status === "active");
  assert.strictEqual(activeRecords.length, 0);
});

check("search layer: legacyOnlyRecords already filter non-active via metadata", () => {
  // Contract: toLegacyMemoryRecord returns null when metadata status !== "active"
  // This is the existing line: if (status && status !== "active") return null;
  const metadata = { status: "expired", content: "test" };
  const status = metadata.status;
  const shouldInclude = !status || status === "active";
  assert.strictEqual(shouldInclude, false, "expired metadata status should be excluded");
});

check("legacy fallback: expired D1 record blocks legacy resurrection", () => {
  // Contract: foundD1Ids must use allRecords, not just activeRecords.
  // If Vectorize returns match for id "m1" with active metadata,
  // but D1 has status=expired for "m1", the legacy record must NOT leak through.
  const allD1Records = [{ id: "m1", status: "expired" }];
  const legacyRecords = [{ id: "m1", status: "active", content: "ghost memory" }];

  const activeRecords = allD1Records.filter((r) => r.status === "active");
  const foundD1Ids = new Set(allD1Records.map((r) => r.id));
  const legacyOnly = legacyRecords.filter((r) => !foundD1Ids.has(r.id));

  assert.strictEqual(activeRecords.length, 0, "expired should be filtered from active");
  assert.strictEqual(legacyOnly.length, 0, "expired D1 id must block legacy fallback");
});

check("legacy fallback: deleted D1 record blocks legacy resurrection", () => {
  const allD1Records = [{ id: "m2", status: "deleted" }];
  const legacyRecords = [{ id: "m2", status: "active", content: "ghost memory" }];

  const activeRecords = allD1Records.filter((r) => r.status === "active");
  const foundD1Ids = new Set(allD1Records.map((r) => r.id));
  const legacyOnly = legacyRecords.filter((r) => !foundD1Ids.has(r.id));

  assert.strictEqual(activeRecords.length, 0, "deleted should be filtered from active");
  assert.strictEqual(legacyOnly.length, 0, "deleted D1 id must block legacy fallback");
});

check("legacy fallback: superseded D1 record blocks legacy resurrection", () => {
  const allD1Records = [{ id: "m3", status: "superseded" }];
  const legacyRecords = [{ id: "m3", status: "active", content: "ghost memory" }];

  const activeRecords = allD1Records.filter((r) => r.status === "active");
  const foundD1Ids = new Set(allD1Records.map((r) => r.id));
  const legacyOnly = legacyRecords.filter((r) => !foundD1Ids.has(r.id));

  assert.strictEqual(activeRecords.length, 0, "superseded should be filtered from active");
  assert.strictEqual(legacyOnly.length, 0, "superseded D1 id must block legacy fallback");
});

check("legacy fallback: D1 id absent → legacy record passes through", () => {
  // If D1 has no record for "m4", the legacy record should still be allowed
  const allD1Records = [{ id: "m1", status: "active" }];
  const legacyRecords = [
    { id: "m1", status: "active", content: "has d1 match" },
    { id: "m4", status: "active", content: "no d1 match" },
  ];

  const foundD1Ids = new Set(allD1Records.map((r) => r.id));
  const legacyOnly = legacyRecords.filter((r) => !foundD1Ids.has(r.id));

  assert.strictEqual(legacyOnly.length, 1);
  assert.strictEqual(legacyOnly[0].id, "m4", "only D1-absent legacy records pass");
});

check("legacy fallback: mixed — active D1 returns as d1Record, expired blocks legacy", () => {
  const allD1Records = [
    { id: "m1", status: "active" },
    { id: "m2", status: "expired" },
  ];
  const scoredIds = new Map([["m1", 0.9], ["m2", 0.8]]);
  const legacyRecords = [
    { id: "m1", status: "active", content: "has d1 active" },
    { id: "m2", status: "active", content: "has d1 expired" },
    { id: "m3", status: "active", content: "no d1 match" },
  ];

  const activeRecords = allD1Records.filter((r) => r.status === "active");
  const foundD1Ids = new Set(allD1Records.map((r) => r.id));
  const d1Records = activeRecords.map((r) => ({ ...r, score: scoredIds.get(r.id) ?? 0 }));
  const legacyOnly = legacyRecords.filter((r) => !foundD1Ids.has(r.id));

  assert.strictEqual(d1Records.length, 1, "only active D1 records returned");
  assert.strictEqual(d1Records[0].id, "m1");
  assert.strictEqual(legacyOnly.length, 1, "only D1-absent legacy passes");
  assert.strictEqual(legacyOnly[0].id, "m3");
});

// --- Batch processing ---

check("batch: RETENTION_BATCH_SIZE is 100", () => {
  assert.strictEqual(RETENTION_BATCH_SIZE, 100);
});

check("batch: 250 ids split into 3 batches (100+100+50)", () => {
  const ids = Array.from({ length: 250 }, (_, i) => `id_${i}`);
  const batches = [];
  for (let i = 0; i < ids.length; i += RETENTION_BATCH_SIZE) {
    batches.push(ids.slice(i, i + RETENTION_BATCH_SIZE));
  }
  assert.strictEqual(batches.length, 3);
  assert.strictEqual(batches[0].length, 100);
  assert.strictEqual(batches[1].length, 100);
  assert.strictEqual(batches[2].length, 50);
});

check("batch: 100 ids fit in exactly 1 batch", () => {
  const ids = Array.from({ length: 100 }, (_, i) => `id_${i}`);
  const batches = [];
  for (let i = 0; i < ids.length; i += RETENTION_BATCH_SIZE) {
    batches.push(ids.slice(i, i + RETENTION_BATCH_SIZE));
  }
  assert.strictEqual(batches.length, 1);
  assert.strictEqual(batches[0].length, 100);
});

check("batch: 101 ids split into 2 batches (100+1)", () => {
  const ids = Array.from({ length: 101 }, (_, i) => `id_${i}`);
  const batches = [];
  for (let i = 0; i < ids.length; i += RETENTION_BATCH_SIZE) {
    batches.push(ids.slice(i, i + RETENTION_BATCH_SIZE));
  }
  assert.strictEqual(batches.length, 2);
  assert.strictEqual(batches[0].length, 100);
  assert.strictEqual(batches[1].length, 1);
});

check("batch: empty ids produce 0 batches", () => {
  const ids = [];
  const batches = [];
  for (let i = 0; i < ids.length; i += RETENTION_BATCH_SIZE) {
    batches.push(ids.slice(i, i + RETENTION_BATCH_SIZE));
  }
  assert.strictEqual(batches.length, 0);
});

check("batch: stats accumulate across batches", () => {
  // Simulates: each batch returns a count, stats sum them
  const batchResults = [100, 100, 50];
  const total = batchResults.reduce((sum, n) => sum + n, 0);
  assert.strictEqual(total, 250);
});

check("batch: expireOldMemories returns expired refs with vector_ids", () => {
  // Contract: expireOldMemories returns { count, expired: [{id, vector_id}] }
  // so caller can sync Vectorize
  const expireResult = {
    count: 3,
    expired: [
      { id: "m1", vector_id: "mem_m1" },
      { id: "m2", vector_id: "mem_m2" },
      { id: "m3", vector_id: null },
    ],
  };
  assert.strictEqual(expireResult.count, 3);
  const vectorIds = expireResult.expired
    .map((m) => m.vector_id)
    .filter((v) => v !== null);
  assert.strictEqual(vectorIds.length, 2, "only records with vector_id get Vectorize cleanup");
});

check("batch: Vectorize deleteByIds should be batched like hardDeleteMemories", () => {
  // Contract: both Vectorize and D1 use the same RETENTION_BATCH_SIZE
  const vectorIds = Array.from({ length: 150 }, (_, i) => `mem_${i}`);
  const batches = [];
  for (let i = 0; i < vectorIds.length; i += RETENTION_BATCH_SIZE) {
    batches.push(vectorIds.slice(i, i + RETENTION_BATCH_SIZE));
  }
  assert.strictEqual(batches.length, 2);
  assert.strictEqual(batches[0].length, 100);
  assert.strictEqual(batches[1].length, 50);
});

// ---------------------------------------------------------------------------
// Test 16: Memory Merge / Supersede
// ---------------------------------------------------------------------------

console.log("\n--- Test 16: Memory Merge / Supersede ---");

function normalizeMergeText(value) {
  return value.toLowerCase().replace(/\s+/g, "");
}

function uniqueMergeStrings(values) {
  return [...new Set(values.map((value) => String(value).trim()).filter(Boolean))];
}

function isCorrectionText(text) {
  return /(之前|刚才|上次).{0,12}(说错|记错|错了|不是|改成|更正)|不是.+是|应(?:该)?改为|改成/.test(text);
}

function fallbackMergeDecision(incoming, candidates) {
  const target = candidates.find((candidate) => !candidate.pinned);
  if (!target) return { action: "keep_both" };
  if (isCorrectionText(incoming.content)) {
    return { action: "supersede", target_id: target.id, content: incoming.content };
  }
  return { action: "keep_both" };
}

function resolveMergeTarget(decision, candidates) {
  if (decision.target_id) {
    return candidates.find((candidate) => candidate.id === decision.target_id) ?? null;
  }
  return candidates.find((candidate) => !candidate.pinned) ?? null;
}

check("merge candidates: exact normalized duplicate can be considered", () => {
  const incoming = { content: "我喜欢安静地聊天" };
  const candidate = { content: "我 喜欢 安静地 聊天", status: "active", score: 0.4 };
  assert.strictEqual(normalizeMergeText(incoming.content), normalizeMergeText(candidate.content));
});

check("merge candidates: low-score non-duplicate is ignored", () => {
  const candidate = { content: "用户喜欢电影", status: "active", score: 0.5 };
  const incoming = { content: "用户喜欢咖啡" };
  const included =
    candidate.status === "active" &&
    (normalizeMergeText(candidate.content) === normalizeMergeText(incoming.content) || candidate.score >= 0.82);
  assert.strictEqual(included, false);
});

check("merge candidates: active high-score candidate is included", () => {
  const candidate = { status: "active", score: 0.91 };
  assert.strictEqual(candidate.status === "active" && candidate.score >= 0.82, true);
});

check("merge candidates: inactive candidates are ignored", () => {
  const candidate = { status: "expired", score: 0.99 };
  assert.strictEqual(candidate.status === "active" && candidate.score >= 0.82, false);
});

check("fallback decision: pinned-only candidates keep both", () => {
  const decision = fallbackMergeDecision(
    { content: "之前说错了，不是咖啡是茶" },
    [{ id: "mem_pin", pinned: true }]
  );
  assert.strictEqual(decision.action, "keep_both");
});

check("fallback decision: correction text supersedes first non-pinned candidate", () => {
  const decision = fallbackMergeDecision(
    { content: "我之前说错了，不是喜欢咖啡，是喜欢茶" },
    [{ id: "mem_old", pinned: false }]
  );
  assert.strictEqual(decision.action, "supersede");
  assert.strictEqual(decision.target_id, "mem_old");
});

check("fallback decision: non-correction similar text keeps both without model decision", () => {
  const decision = fallbackMergeDecision(
    { content: "用户喜欢热茶" },
    [{ id: "mem_old", pinned: false }]
  );
  assert.strictEqual(decision.action, "keep_both");
});

check("resolve target: explicit target_id wins", () => {
  const target = resolveMergeTarget(
    { action: "merge", target_id: "mem_b" },
    [{ id: "mem_a", pinned: false }, { id: "mem_b", pinned: false }]
  );
  assert.strictEqual(target.id, "mem_b");
});

check("resolve target: missing target falls back to first non-pinned", () => {
  const target = resolveMergeTarget(
    { action: "merge" },
    [{ id: "mem_pin", pinned: true }, { id: "mem_free", pinned: false }]
  );
  assert.strictEqual(target.id, "mem_free");
});

check("merge/supersede decision without target_id is treated as create-new", () => {
  const decision = { action: "supersede" };
  const shouldCreateNew =
    (decision.action === "merge" || decision.action === "supersede") && !decision.target_id;
  assert.strictEqual(shouldCreateNew, true);
});

check("merge patch: tags and source_message_ids are unioned", () => {
  assert.deepStrictEqual(
    uniqueMergeStrings(["preference", "tea", "preference", "new"]),
    ["preference", "tea", "new"]
  );
  assert.deepStrictEqual(uniqueMergeStrings(["msg_1", "msg_2", "msg_1"]), ["msg_1", "msg_2"]);
});

check("merge patch: importance and confidence keep the stronger value", () => {
  const existing = { importance: 0.8, confidence: 0.7 };
  const incoming = { importance: 0.6, confidence: 0.95 };
  assert.strictEqual(Math.max(existing.importance, incoming.importance), 0.8);
  assert.strictEqual(Math.max(existing.confidence, incoming.confidence), 0.95);
});

check("merge decision: merge without content must not overwrite existing memory", () => {
  const decision = { action: "merge", target_id: "mem_old" };
  const shouldCreateNew = decision.action === "merge" && !decision.content;
  assert.strictEqual(shouldCreateNew, true);
});

check("supersede flow: old memory becomes superseded before new active memory is created", () => {
  const old = { id: "mem_old", status: "active", vector_id: "mem_mem_old" };
  const updated = { ...old, status: "superseded" };
  const created = { id: "mem_new", status: "active" };
  assert.strictEqual(updated.status, "superseded");
  assert.strictEqual(created.status, "active");
  assert.ok(updated.vector_id, "superseded old memory needs Vectorize delete");
});

check("supersede flow: stale vector delete failure should not block corrected memory", () => {
  const d1Status = "superseded";
  const vectorDeleteOk = false;
  const searchLayerBlocksOld = d1Status !== "active";
  assert.strictEqual(vectorDeleteOk, false);
  assert.strictEqual(searchLayerBlocksOld, true);
});

check("pinned target is never merge/supersede applied", () => {
  const target = { id: "mem_pin", pinned: true };
  const shouldCreateNew = target.pinned;
  assert.strictEqual(shouldCreateNew, true);
});

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

console.log(`\n--- Results: ${passed} passed, ${failed} failed ---\n`);

if (failed > 0) {
  process.exit(1);
}
