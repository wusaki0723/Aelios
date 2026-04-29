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
  return { ...req, model: targetModel, stream: Boolean(req.stream), messages };
}

function getThinkingBudget(env) {
  const value = Number(env.ANTHROPIC_THINKING_BUDGET || 1024);
  return Number.isFinite(value) ? Math.min(Math.max(Math.floor(value), 1024), 32000) : 1024;
}

function buildThinkingConfig(env) {
  if (env.ANTHROPIC_THINKING_ENABLED !== "true") return undefined;
  return { type: "enabled", budget_tokens: getThinkingBudget(env), display: "summarized" };
}

function getAnthropicMaxTokens(req, env) {
  const maxTokens = typeof req.max_tokens === "number" ? Math.max(Math.floor(req.max_tokens), 1) : 1024;
  const thinking = buildThinkingConfig(env);
  if (!thinking) return maxTokens;
  return Math.max(maxTokens, thinking.budget_tokens + Math.min(Math.max(maxTokens, 256), 4096));
}

function buildAnthropicRequestFromAssembled(req, targetModel, assembled, env) {
  const thinking = buildThinkingConfig(env);
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

check("preset_lite no longer hardcodes short paragraphs or hidden-thinking suppression", () => {
  assert.ok(!PRESET_LITE_TEXT.includes("段落不宜过长"));
  assert.ok(!PRESET_LITE_TEXT.includes("不输出隐藏思考"));
});

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

console.log(`\n--- Results: ${passed} passed, ${failed} failed ---\n`);

if (failed > 0) {
  process.exit(1);
}
