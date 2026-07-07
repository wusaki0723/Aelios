#!/usr/bin/env node
/**
 * Smoke test for parseDailyMarkdown and runGithubDailyPull skip paths.
 * Uses Node's experimental TypeScript stripping to import src/memory/githubDaily.ts.
 *
 * Run: npx tsx scripts/smoke-github-daily.mjs
 */

import { strict as assert } from "node:assert";
import { parseDailyMarkdown, runGithubDailyPull } from "../src/memory/githubDaily.ts";

const SAMPLE = `# Daily 2026-07-07

## checkpoint 2026-07-07 15:48 (session 3783b6f7, trigger=manual)
### 最近对话尾部
- [user] 为啥glm审查经常失败呢？
- [assistant] settings.json 挂载。先读完整文件。
### 本段使用过的工具
Bash×16 Edit×8 Read×5
### writer 摘要
下午完成 cmh-lite 施工与合入。
### 未收尾
- phase 2 Aelios 拉取适配器

- 15:48 [turn] u: 为啥glm审查经常失败呢？ ⇢ a: composer 修噪声的同时，登记 memory-index 和 changelog。
`;

const entries = parseDailyMarkdown(SAMPLE);
assert.equal(entries.length, 2, `expected 2 entries, got ${entries.length}`);

const summary = entries.find((entry) => entry.kind === "summary");
assert.ok(summary, "missing summary entry");
assert.match(summary.content, /cmh-lite 施工与合入/);
assert.match(summary.content, /未收尾/);
assert.match(summary.content, /phase 2 Aelios 拉取适配器/);

const turn = entries.find((entry) => entry.kind === "turn");
assert.ok(turn, "missing turn entry");
assert.equal(turn.time, "15:48");
assert.match(turn.user, /为啥glm审查经常失败/);
assert.match(turn.assistant, /composer 修噪声/);

const garbage = parseDailyMarkdown(`# title\n\nrandom junk line\n\n- broken turn\n`);
assert.equal(garbage.length, 0, "garbage lines should be tolerated");

const noWriter = parseDailyMarkdown(`## checkpoint 2026-07-07\n### 最近对话尾部\n- [user] hi\n`);
assert.equal(noWriter.length, 0, "checkpoint without writer section should be skipped");

const notConfigured = await runGithubDailyPull({ DB: {} });
assert.equal(notConfigured.skipped, "not_configured");

const missingToken = await runGithubDailyPull({ DB: {}, GITHUB_DAILY_REPO: "owner/repo" });
assert.equal(missingToken.skipped, "not_configured");

console.log("smoke-github-daily: all checks passed");