#!/usr/bin/env node
/**
 * CONTRACT MIRROR — mirrors the pure window / system-prompt helpers from
 * src/tg/process.ts so they can run under `node` without a TS runtime.
 *
 * When changing planRecentFold / buildSystemPrompt / maybeFold failure
 * semantics in process.ts, update this file in lockstep.
 *
 * Run:  node scripts/verify-tg-window.mjs
 * Exit 0 = all checks passed, exit 1 = failure.
 */

import { strict as assert } from "node:assert";

// ---------------------------------------------------------------------------
// Defaults — must match src/tg/process.ts
// ---------------------------------------------------------------------------
const DEFAULT_FOLD_TRIGGER_TURNS = 50;
const DEFAULT_RECENT_KEEP_TURNS = 10;
const DEFAULT_SYSTEM_PROMPT = "You are a helpful assistant chatting over Telegram.";
const BUBBLE_FORMAT_RULE =
  "回复时，想拆成多条聊天气泡的内容之间用空行（连续两个换行）隔开；一个完整的意思放在同一个气泡里。";

/**
 * Pure window planner — must match src/tg/process.ts planRecentFold.
 */
function planRecentFold(recent, foldTrigger, keepTurns) {
  if (recent.length < foldTrigger) {
    return { shouldFold: false, evicted: [], kept: recent };
  }
  const keep = Math.min(Math.max(keepTurns, 1), recent.length);
  return {
    shouldFold: true,
    evicted: recent.slice(0, recent.length - keep),
    kept: recent.slice(recent.length - keep)
  };
}

/**
 * System prompt assembly — must match src/tg/process.ts buildSystemPrompt.
 * 顺序即缓存分层：persona → 固定规则 → 滚动摘要（末尾）。
 */
function buildSystemPrompt(env, summary) {
  const base = [env.TG_SYSTEM_PROMPT?.trim(), env.TG_SYSTEM_PROMPT_EXTRA?.trim()]
    .filter((part) => Boolean(part))
    .join("\n");
  const sections = [base || DEFAULT_SYSTEM_PROMPT, BUBBLE_FORMAT_RULE];
  if (summary) {
    sections.push(`[对话滚动摘要]\n以下是这段对话更早部分的摘要，当作你们已经聊过的内容：\n${summary}`);
  }
  return sections.join("\n\n");
}

/**
 * Apply fold with an injectable foldFn. Mirrors maybeFoldSummary failure
 * semantics: foldFn returning null keeps the original state.
 */
async function applyFold(state, foldTrigger, keepTurns, foldFn) {
  const plan = planRecentFold(state.recent, foldTrigger, keepTurns);
  if (!plan.shouldFold) return state;
  const folded = await foldFn(state.summary, plan.evicted);
  if (folded == null) return state;
  return { summary: folded, recent: plan.kept };
}

function makeTurns(n) {
  return Array.from({ length: n }, (_, i) => ({
    role: i % 2 === 0 ? "user" : "assistant",
    content: `t${i}`
  }));
}

let passed = 0;
function check(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`  ok  ${name}`);
  } catch (error) {
    console.error(`  FAIL  ${name}`);
    console.error(error);
    process.exitCode = 1;
  }
}

async function checkAsync(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`  ok  ${name}`);
  } catch (error) {
    console.error(`  FAIL  ${name}`);
    console.error(error);
    process.exitCode = 1;
  }
}

console.log("verify-tg-window");

check("49 turns: no fold", () => {
  const plan = planRecentFold(makeTurns(49), DEFAULT_FOLD_TRIGGER_TURNS, DEFAULT_RECENT_KEEP_TURNS);
  assert.equal(plan.shouldFold, false);
  assert.equal(plan.evicted.length, 0);
  assert.equal(plan.kept.length, 49);
});

check("50 turns: fold → recent=10, evicted=40", () => {
  const turns = makeTurns(50);
  const plan = planRecentFold(turns, DEFAULT_FOLD_TRIGGER_TURNS, DEFAULT_RECENT_KEEP_TURNS);
  assert.equal(plan.shouldFold, true);
  assert.equal(plan.evicted.length, 40);
  assert.equal(plan.kept.length, 10);
  assert.deepEqual(
    plan.kept.map((t) => t.content),
    turns.slice(40).map((t) => t.content)
  );
  assert.deepEqual(
    plan.evicted.map((t) => t.content),
    turns.slice(0, 40).map((t) => t.content)
  );
});

await checkAsync("fold failure (null): state unchanged", async () => {
  const state = { summary: "old-summary", recent: makeTurns(50) };
  const next = await applyFold(state, 50, 10, async () => null);
  assert.equal(next, state);
  assert.equal(next.summary, "old-summary");
  assert.equal(next.recent.length, 50);
});

await checkAsync("fold success: summary updated, recent kept", async () => {
  const state = { summary: "old-summary", recent: makeTurns(50) };
  const next = await applyFold(state, 50, 10, async () => "new-summary");
  assert.equal(next.summary, "new-summary");
  assert.equal(next.recent.length, 10);
});

check("buildSystemPrompt: summary is the last section", () => {
  const prompt = buildSystemPrompt(
    { TG_SYSTEM_PROMPT: "PERSONA_STABLE", TG_SYSTEM_PROMPT_EXTRA: "EXTRA_STABLE" },
    "SUMMARY_VOLATILE"
  );
  const sections = prompt.split("\n\n");
  assert.ok(sections.length >= 3, `expected ≥3 sections, got ${sections.length}`);
  assert.ok(sections[0].includes("PERSONA_STABLE"));
  assert.ok(sections[0].includes("EXTRA_STABLE"));
  assert.equal(sections[1], BUBBLE_FORMAT_RULE);
  assert.ok(sections[sections.length - 1].startsWith("[对话滚动摘要]"));
  assert.ok(sections[sections.length - 1].includes("SUMMARY_VOLATILE"));
  // Prefix before summary must not contain summary text (stability)
  const prefix = sections.slice(0, -1).join("\n\n");
  assert.ok(!prefix.includes("SUMMARY_VOLATILE"));
  assert.ok(!prefix.includes("[对话滚动摘要]"));
});

check("buildSystemPrompt: no summary → no trailing summary section", () => {
  const prompt = buildSystemPrompt({ TG_SYSTEM_PROMPT: "P" }, "");
  assert.ok(!prompt.includes("[对话滚动摘要]"));
  assert.ok(prompt.endsWith(BUBBLE_FORMAT_RULE));
});

if (process.exitCode) {
  console.error(`\nverify-tg-window: FAILED (${passed} passed before failure)`);
  process.exit(1);
}
console.log(`\nverify-tg-window: all ${passed} checks passed`);
