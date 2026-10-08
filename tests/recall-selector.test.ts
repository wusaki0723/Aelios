import { strict as assert } from "node:assert";
import { test } from "node:test";
import { prepareSelectorCandidates, selectRecall, type SelectorInput } from "../src/memory/recallSelector";
import { assembleRecallSurface } from "../src/memory/surface";
import { buildDreamExtractPrompt } from "../src/memory/dreamExtract";
import { buildDigestPrompt } from "../src/memory/dream/extractPhase";
import { formatTranscript } from "../src/memory/dream/helpers";
import { lexicalOverlapScore, shapeRecallQuery } from "../src/memory/queryShape";

const rankedEnv = { AI: { async run(_model: string, data: any) {
  return { response: data.contexts.map((c: any, id: number) => ({ id,
    score: lexicalOverlapScore(c.text, shapeRecallQuery({ query: data.query }).lexicalTokens) > 0 ? 0.9 : 0.01 })) };
} } } as any;

const input = (query: string, content: string[], extra: Partial<SelectorInput> = {}): SelectorInput => ({
  query, recent: [], maxItems: 2,
  entries: content.map((text, i) => ({ kind: "note", id: `m${i}`, namespace: "a", content: text, recordedDate: "2026-09-07" })),
  ...extra
});

function scoreEnv(scores: number[], extra = {}) {
  return { AI: { async run(_model: string, data: any) {
    assert.equal(data.contexts.length, scores.length);
    return { response: scores.map((score, id) => ({ id, score })).reverse() };
  } }, ...extra } as any;
}

test("short follow-ups retain context during reranking", async () => {
  const result = await selectRecall(rankedEnv, input("那个呢？", ["你在做 Cloudflare 记忆网关。"], { recent: ["Cloudflare 网关最近怎样了"] }));
  assert.equal(result.entries.length, 1);
});

test("a new topic does not inherit lexical tokens from the old relationship topic", async () => {
  const result = await selectRecall(rankedEnv, input("调试暗号是什么？", ["你喜欢旦九陪伴。"], { recent: ["旦九陪伴"] }));
  assert.equal(result.entries.length, 0);
});

test("all sources share one association slot and a lower-ranked newer note does not win by date", async () => {
  const i = input("Cloudflare 网关", ["你用 Cloudflare 网关做记忆。", "Cloudflare 真不错。"]);
  i.entries[1].kind = "precious";
  i.entries[1].recordedDate = "2026-09-08";
  const result = await selectRecall(rankedEnv, i);
  assert.equal(result.entries.length, 1);
  assert.equal(result.entries[0].id, "m0");
});

test("metadata envelopes are cleaned before window selection", () => {
  const { candidates } = prepareSelectorCandidates(input("迁企微", ['<message from="deadbeef" msg_id="123456">宁皎迁企微了。</message>']));
  assert.deepEqual(candidates[0].windows, ["宁皎迁企微了。"]);
});

test("all sources drop evidence already present in visible history", () => {
  const i = input("暗号是什么", ["调试暗号是月亮邮局。"], { visible: "用户：请记住调试暗号是月亮邮局。" });
  for (const kind of ["precious", "note", "quote", "glossary"]) {
    i.entries[0].kind = kind;
    assert.equal(prepareSelectorCandidates(i).candidates.length, 0);
  }
});

test("same local id in separate namespaces receives distinct selector references", () => {
  const i = input("食物", ["你喜欢豆浆。", "你喜欢红茶。"]);
  i.entries[1].id = "m0";
  i.entries[1].namespace = "b";
  assert.deepEqual(prepareSelectorCandidates(i).candidates.map(c => c.id), ["c0", "c1"]);
});

test("duplicates across spaces are removed, but negation and state changes stay distinct", () => {
  const i = input("搬家", ["宁皎搬好了。", "宁皎搬好了。", "宁皎没有搬好。", "宁皎计划搬家。"]);
  i.entries[1].namespace = "b";
  const result = prepareSelectorCandidates(i);
  assert.equal(result.candidates.length, 3);
  assert.equal(result.decisions[0].reason, "duplicate_content");
});

test("identical first-person quotes from different speakers are not merged", async () => {
  const i = input("草莓", ["我喜欢草莓。", "我喜欢草莓。"]);
  i.entries[0].speaker = "user";
  i.entries[1].speaker = "assistant";
  assert.equal(prepareSelectorCandidates(i).candidates.length, 2);
  const result = await selectRecall(scoreEnv([0.2, 0.9]), i);
  assert.match(result.entries[0].content, /助手原话/);
});

test("a long exact quote that does not fit does not consume the next item's slot", () => {
  const result = assembleRecallSurface(
    [{ kind: "note", content: "长".repeat(400), exact: true }, { kind: "note", content: "短句", exact: true }],
    { budget: 120, maxItems: 1 }
  );
  assert.equal(result.entries.length, 1);
  assert.equal(result.entries[0].content, "短句");
});

test("extraction still asks for sources and forbids treating tool calls as success", () => {
  const prompt = buildDreamExtractPrompt([]);
  assert.match(prompt, /source_message_ids 保留全部依据/);
  assert.match(prompt, /不能把工具调用当作已执行成功/);
  assert.match(prompt, /关于用户的记忆，优先写成“你……”/);
});

test("named speakers replace user/assistant labels in the dream extract prompt", () => {
  const prompt = buildDreamExtractPrompt(
    [{ id: "msg_1", conversation_id: "c", namespace: "default", role: "user", content: "卖掉那台车", source: "test", created_at: "2026-09-08T00:00:00.000Z" }],
    [],
    { userName: "小南", assistantName: "小北" }
  );
  assert.match(prompt, /用户是小南，助手是小北/);
  assert.match(prompt, /禁止出现 user、用户、assistant、助手/);
  assert.match(prompt, /\[msg_1\].*\[小南\]/);
  assert.match(prompt, /小南确定了九月按原计划卖掉那台车/);
  assert.doesNotMatch(prompt, /关于用户的记忆，优先写成“你……”/);
  assert.doesNotMatch(prompt, /\[用户\]/);
  assert.doesNotMatch(prompt, /我\(助手\)/);
});

test("dream digest uses speaker names in transcript and writing rules", () => {
  const unnamed = buildDigestPrompt({
    dateLabel: "2026-09-08",
    startIso: "2026-09-08T00:00:00.000Z",
    endIso: "2026-09-09T00:00:00.000Z",
    messages: [{ id: "msg_1", conversation_id: "c", namespace: "default", role: "assistant", content: "好", source: "test", created_at: "2026-09-08T00:00:00.000Z" }],
    existingMemories: [],
    hasMore: false
  });
  assert.match(unnamed, /站在“我=助手”的视角写/);
  assert.match(unnamed, /我\(助手\)/);

  const named = buildDigestPrompt({
    dateLabel: "2026-09-08",
    startIso: "2026-09-08T00:00:00.000Z",
    endIso: "2026-09-09T00:00:00.000Z",
    messages: [{ id: "msg_1", conversation_id: "c", namespace: "default", role: "assistant", content: "好", source: "test", created_at: "2026-09-08T00:00:00.000Z" }],
    existingMemories: [],
    hasMore: false,
    speakers: { userName: "小南", assistantName: "小北" }
  });
  assert.match(named, /关于用户用「小南……」/);
  assert.match(named, /禁止出现 user、用户、assistant、助手/);
  assert.match(named, /\[msg_1\].*\[小北\]/);
  assert.doesNotMatch(named, /我=助手/);
  assert.equal(formatTranscript([{ id: "m", conversation_id: "c", namespace: "default", role: "user", content: "hi", source: null, created_at: "t" }], { userName: "小南", assistantName: "小北" }), "<chat>\n[m][t][小南] hi\n</chat>");
});

test("default ranks exact contextual snippets once and keeps speaker and conditions", async () => {
  const i = input("我们搬家了吗", ["假如有一天搬好了。我们就去吃蛋糕。", "宁皎还没搬好。"]);
  i.entries[0].speaker = "assistant";
  let calls = 0;
  const env = { AI: { async run(model: string, data: any) {
    calls++;
    assert.equal(model, "@cf/baai/bge-reranker-base");
    assert.deepEqual(data.contexts, [
      { text: "assistant: 假如有一天搬好了。我们就去吃蛋糕。" },
      { text: "宁皎还没搬好。" }
    ]);
    return { response: [{ id: 1, score: 0.1 }, { id: 0, score: 0.8 }] };
  } } } as any;
  const result = await selectRecall(env, i);
  assert.equal(calls, 1);
  assert.equal(result.status, "reranked");
  assert.match(result.entries[0].content, /助手原话.*假如有一天搬好了。我们就去吃蛋糕。/);
  assert.equal(result.decisions.find(d => d.id === "m0")?.score, 0.8);
  assert.equal(result.threshold, 0.25);
});

test("no lexical overlap is required after semantic scores; higher score beats source priority", async () => {
  const i = input("肚子咕咕叫", ["你答应会一直找到旦九。", "你偏爱热豆浆。"]);
  i.entries[0].kind = "precious";
  const result = await selectRecall(scoreEnv([0.1, 0.9]), i);
  assert.deepEqual(result.entries.map(e => e.id), ["m1"]);
});

test("low scores never force top one and threshold is configurable", async () => {
  const i = input("你好", ["你喜欢草莓。", "你喜欢热豆浆。"]);
  const result = await selectRecall(scoreEnv([0.20, 0.1]), i);
  assert.equal(result.entries.length, 0);
  assert.ok(result.decisions.every(d => d.reason === "below_rerank_threshold"));
  assert.equal((await selectRecall(scoreEnv([0.20, 0.1], { RECALL_RERANK_MIN_SCORE: "0.15" }), i)).entries.length, 1);
});

test("evidence shares two slots globally, with only one excerpt from a shared source", async () => {
  const i = input("搬家是哪天，暗号是什么", ["9月6日宁皎搬好了。", "宁皎已经搬到企微了。", "暗号是月亮邮局。"]);
  i.entries[0].sourceIds = ["msg1"];
  i.entries[1].sourceIds = ["msg1"];
  i.entries[2].namespace = "shared";
  const result = await selectRecall(scoreEnv([0.9, 0.85, 0.8]), i);
  assert.deepEqual(result.entries.map(e => e.id), ["m0", "m2"]);
  assert.equal(result.decisions.find(d => d.id === "m1")?.reason, "duplicate_source");
});

test("same source id in unrelated spaces is not evidence of duplication", async () => {
  const i = input("暗号原话", ["我的暗号是月亮。", "我的暗号是太阳。"]);
  for (const e of i.entries) e.sourceIds = ["local1"];
  i.entries[1].namespace = "b";
  assert.equal((await selectRecall(scoreEnv([0.9, 0.8]), i)).entries.length, 2);
});

test("same fact key keeps the higher score and still rejects diary impressions as evidence", async () => {
  const i = input("说过搬好了吗", ["宁皎计划搬家。", "宁皎已经搬家。", "感觉今天大家都搬好了。"]);
  i.entries[0].factKey = i.entries[1].factKey = "ningqiao-move";
  i.entries[2].kind = "impression";
  const result = await selectRecall(scoreEnv([0.99, 0.9, 0.8]), i);
  assert.deepEqual(result.entries.map(e => e.id), ["m0"]);
  assert.deepEqual(result.decisions.map(d => d.reason), ["rerank_selected", "duplicate_fact", "impression_not_evidence"]);
});

test("latest evidence questions skip ranking; casual latest talk still ranks", async () => {
  const env = { AI: { async run() { assert.fail("must not call AI"); } } } as any;
  const i = input("最近一次搬家是哪天", ["2026-09-06 宁皎搬到了企微。"]);
  i.entries[0].eventDate = "2026-09-06";
  assert.equal((await selectRecall(env, i)).reason, "latest_requires_evidence");
  assert.equal((await selectRecall(env, { ...i, query: "搬家", maxItems: 0 })).entries.length, 0);
  let called = 0;
  const ranked = { AI: { async run() { called++; return { response: [{ id: 0, score: 0.9 }] }; } } } as any;
  const casual = await selectRecall(ranked, input("最近又下雨了", ["下雨天喜欢喝热豆浆。"]));
  assert.equal(called, 1);
  assert.equal(casual.status, "reranked");
  assert.equal(casual.entries.length, 1);
});

test("invalid score references fall back to a lexical hit", async () => {
  const i = input("草莓", ["你喜欢草莓。", "你喜欢芒果。"]);
  for (const response of [[], [{ id: 0, score: 0.9 }], [{ id: 0, score: 0.9 }, { id: 0, score: 0.8 }],
    [{ id: 0, score: 0.9 }, { id: 2, score: 0.8 }], [{ id: 0, score: Number.NaN }, { id: 1, score: 0.8 }]]) {
    const result = await selectRecall({ AI: { async run() { return { response }; } } } as any, i);
    assert.equal(result.status, "lexical");
    assert.equal(result.reason, "reranker_invalid_response");
    assert.equal(result.entries.length, 1);
    assert.match(result.entries[0].content, /草莓/);
  }
});

test("missing, disabled and failing Workers AI fall back to a lexical hit", async () => {
  for (const [env, reason] of [
    [{}, "reranker_missing_binding"],
    [{ ENABLE_MEMORY_RERANKER: "false" }, "reranker_disabled"],
    [{ AI: { async run() { throw new Error("private service detail"); } } }, "reranker_failed"]
  ] as const) {
    const result = await selectRecall(env as any, input("草莓", ["你喜欢草莓。"]));
    assert.equal(result.status, "lexical");
    assert.equal(result.reason, reason);
    assert.equal(result.entries.length, 1);
    assert.match(result.entries[0].content, /草莓/);
  }
});

test("ranking timeout discards late scores and falls back once", async () => {
  let finish: (v: unknown) => void = () => {};
  let calls = 0;
  const env = { RECALL_RERANK_TIMEOUT_MS: "100", AI: { run() {
    calls++;
    return new Promise(resolve => { finish = resolve; });
  } } } as any;
  const result = await selectRecall(env, input("草莓", ["你喜欢草莓。"]));
  assert.equal(result.status, "lexical");
  assert.equal(result.reason, "reranker_timeout");
  assert.equal(result.entries.length, 1);
  finish({ response: [{ id: 0, score: 1 }] });
  await Promise.resolve();
  assert.equal(result.entries.length, 1);
  assert.equal(calls, 1);
});

test("long-record tail is scored with preceding context, never just a truncated head", async () => {
  const content = `${"很久以前聊了一件无关的事情。".repeat(50)}假如调试通过。暗号会改成月亮邮局。`;
  const i = input("调试暗号", [content]);
  let scored: string[] = [];
  const env = { AI: { async run(_model: string, data: any) {
    scored = data.contexts.map((c: any) => c.text);
    return { response: scored.map((text, id) => ({ id, score: text.includes("月亮邮局") ? 0.9 : 0.1 })) };
  } } } as any;
  const result = await selectRecall(env, i);
  assert.match(result.entries[0].content, /假如调试通过。暗号会改成月亮邮局。/);
  const excerpt = result.decisions.find(d => d.reason === "rerank_selected")?.excerpt;
  assert.ok(excerpt && content.includes(excerpt) && scored.includes(excerpt));
  assert.ok(scored.length <= 4);
  assert.ok(scored.every(t => t.length <= 400));
});

test("score batch stays within 16 candidates and 64 complete snippets", async () => {
  const i = input("Cloudflare", Array.from({ length: 24 }, (_, n) =>
    `条目${n}。${Array.from({ length: 20 }, (_, j) => `Cloudflare 本条的第${j}句话用于测试窗口预算。`).join("")}`));
  let calls = 0;
  const env = { AI: { async run(_model: string, data: any) {
    calls++;
    assert.equal(data.contexts.length, 64);
    assert.ok(data.contexts.every((c: any) => c.text.length <= 400));
    return { response: data.contexts.map((_: any, id: number) => ({ id, score: 0.1 })) };
  } } } as any;
  const result = await selectRecall(env, i);
  assert.equal(calls, 1);
  assert.equal(result.entries.length, 0);
  assert.equal(result.decisions.filter(d => d.reason === "candidate_budget").length, 8);
});

test("archive labels never become evidence and long unbroken conditions are not cut", () => {
  const i = input("搬家", ["【对话归档 v1 2026-09-07】\n事实：\n宁皎搬好了。"]);
  assert.deepEqual(prepareSelectorCandidates(i).candidates[0].windows, ["宁皎搬好了。"]);
  const unsafe = input("搬家", [`假如${"条件".repeat(210)}成立才搬家。`]);
  const result = prepareSelectorCandidates(unsafe);
  assert.equal(result.candidates.length, 0);
  assert.equal(result.decisions[0].reason, "no_safe_window");
});
