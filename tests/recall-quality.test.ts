import { strict as assert } from "node:assert";
import { test } from "node:test";
import { DatabaseSync } from "node:sqlite";
import {
  hasLexicalSupport,
  isThinQuery,
  keepGroundedHits,
  lexicalHitScore,
  lexicalOverlapScore,
  mergeHybridRanks,
  selectRelevantPrecious,
  shapeRecallQuery,
  tokenizeQuery
} from "../src/memory/queryShape";
import { assembleRecallSurface, formatRecallSurface } from "../src/memory/surface";
import { filterAndCompressMemoriesWithMeta } from "../src/memory/filter";
import { formatDreamCursor, readDailyCursor } from "../src/memory/dreamDates";
import { listMessagesByNamespaceInRange } from "../src/db/messages";
import {
  classifyRememberUtterance,
  parseRememberNow
} from "../src/memory/rememberNow";
import { excerptAroundMatch, formatQuote, keepUncoveredQuotes, quoteOverlaps, searchQuotes } from "../src/memory/quotes";
import { isEvidenceQuery, isTemporalQuery, tokenizeForIndex } from "../src/memory/queryShape";
import { searchMemoriesByText } from "../src/db/memories";
import { backfillFts, rebuildFts, toFtsBody } from "../src/memory/fts";
import {
  decideJudge,
  parseJudgeBoolean,
  parseJudgeModelResult,
  judgeKindFor,
  buildJudgePrompt
} from "../src/memory/candidateJudge";
import { classifyTurn, recentHumanTexts } from "../src/gateway/protocol";
import type { MemoryCandidateRow } from "../src/db/v2/candidates";
import { cleanMessageText } from "../src/utils/sanitize";

test("topical questions do not mix the previous turn into lexical tokens", () => {
  const shaped = shapeRecallQuery({
    query: "调试暗号是什么？",
    recent: ["Claude 的陪伴让我觉得被接住"]
  });
  assert.equal(shaped.thin, false);
  assert.equal(shaped.embeddingQuery, "调试暗号是什么？");
  assert.ok(!shaped.lexicalTokens.some((token) => /claude|陪伴/.test(token)));
  assert.ok(shaped.lexicalTokens.some((token) => token.includes("暗号") || token.includes("调试")));
});

test("thin continuations expand with recent turns; topical questions stay as-is", () => {
  assert.equal(isThinQuery("那个呢？"), true);
  assert.equal(isThinQuery("继续"), true);
  assert.equal(isThinQuery("我们喜欢什么？"), false);
  assert.ok(tokenizeQuery("我们喜欢什么？").includes("喜欢"));

  const shaped = shapeRecallQuery({
    query: "那个呢？",
    recent: ["我们在做 Cloudflare 记忆网关", "先别动 Dream"]
  });
  assert.equal(shaped.thin, true);
  assert.match(shaped.embeddingQuery, /Cloudflare/);
  assert.ok(shaped.lexicalTokens.includes("cloudflare") || shaped.lexicalTokens.includes("网关"));
});

test("precious selection keeps lexical overlap and drops stale notes", () => {
  const rows = [
    { content: "喜欢 Cloudflare" },
    { content: "昨天吃了番茄炒蛋" },
    { content: "网关只给主模型召回记忆" }
  ];
  const tokens = tokenizeQuery("我们喜欢 Cloudflare 网关什么？");
  const selected = selectRelevantPrecious(rows, tokens);
  assert.ok(selected.some((row) => row.content.includes("Cloudflare")));
  assert.ok(selected.some((row) => row.content.includes("网关")));
  assert.ok(!selected.some((row) => row.content.includes("番茄炒蛋")));
  assert.ok(lexicalOverlapScore("喜欢 Cloudflare", tokens) > lexicalOverlapScore("昨天吃了番茄炒蛋", tokens));
});

test("surface is markdown, not a JSON blob", () => {
  const text = formatRecallSurface([
    { kind: "precious", content: "喜欢 Cloudflare" },
    { kind: "project", content: "你正在做记忆网关" }
  ]);
  assert.match(text, /\[Aelios 记忆/);
  assert.match(text, /- 喜欢 Cloudflare/);
  assert.match(text, /- 你正在做记忆网关/);
  assert.doesNotMatch(text, /\[(?:precious|project)\]/);
  assert.doesNotMatch(text, /\[\{"kind"/);
});

test("transport envelopes are removed without eating ordinary prose", () => {
  const hash = "9fc3ec3b7f584cdfbfe84f72300e8f08";
  const id = "7812076508172213971";
  assert.equal(
    cleanMessageText(`<message from="${hash}" msg_id="${id}">迁企微、宁皎搬好了</message>`),
    "迁企微、宁皎搬好了"
  );
  assert.equal(
    cleanMessageText(`<message from="${hash}" msg_id="1">迁企微</message>\n<message from="${hash}" msg_id="2">宁皎搬好了</message>`),
    "迁企微\n宁皎搬好了"
  );
  assert.equal(cleanMessageText(`from=${hash} msg_id=${id}\n迁企微、宁皎搬好了`), "迁企微、宁皎搬好了");
  assert.equal(cleanMessageText("文档里可以写 <message>正文</message>"), "文档里可以写 <message>正文</message>");
  assert.equal(
    cleanMessageText(`<wecom-message from="${hash}" msg_id="${id}">今晚吃什么</wecom-message>`),
    "今晚吃什么"
  );
  assert.equal(
    cleanMessageText(`<wecom-message from="${hash}" msg_id="${id}">未闭合的企微`),
    "未闭合的企微"
  );
  assert.equal(
    cleanMessageText(`请看 <wecom-message from="${hash}" msg_id="${id}">迁企微</wecom-message> 然后呢`),
    "请看 迁企微 然后呢"
  );
});

test("client recap and system-reminder are not treated as user speech", () => {
  assert.equal(cleanMessageText("<recap>\nUser stepped away; returning. Recap: <40 words.</recap>"), "");
  assert.equal(cleanMessageText("<recap>\nUser stepped away; returning. Recap: <40 words."), "");
  assert.equal(
    cleanMessageText("<system-reminder>\nToday: 2026-09-07; current working directory: '/home/box/home'</system-reminder>"),
    ""
  );
  assert.equal(
    cleanMessageText("今晚吃什么\n<system-reminder>\nToday: 2026-09-07; current working directory: '/tmp'</system-reminder>"),
    "今晚吃什么"
  );
  assert.equal(
    cleanMessageText("User stepped away; returning. Recap: <40 words."),
    ""
  );
  assert.equal(cleanMessageText("帮我写个 recap：今天做了什么"), "帮我写个 recap：今天做了什么");
  assert.equal(cleanMessageText("已回她。"), "");
  assert.equal(cleanMessageText("已回他"), "");
  assert.equal(cleanMessageText("今晚吃什么\n已回她。"), "今晚吃什么");
  assert.equal(cleanMessageText("我跟她说已回她了"), "我跟她说已回她了");
});

test("recent history skips recap turns so thin queries do not inherit them", () => {
  const texts = recentHumanTexts({
    messages: [
      { role: "user", content: "<recap>\nUser stepped away; returning. Recap: <40 words." },
      { role: "assistant", content: "ok" },
      { role: "user", content: "那个呢？" }
    ]
  }, "chat");
  assert.deepEqual(texts, ["那个呢？"]);
});

test("classifyTurn treats machine-only user payloads as auxiliary", () => {
  const recap = classifyTurn({
    messages: [{ role: "user", content: "<recap>\nUser stepped away; returning. Recap: <40 words." }]
  }, "chat");
  assert.equal(recap.kind, "auxiliary");
  assert.equal(recap.text, "");
  const wecom = classifyTurn({
    messages: [{ role: "user", content: '<wecom-message from="abc" msg_id="1">今晚吃什么</wecom-message>' }]
  }, "chat");
  assert.equal(wecom.kind, "human");
  assert.equal(wecom.text, "今晚吃什么");
});

test("automatic surfaces hide ids and message envelopes", () => {
  const surface = assembleRecallSurface([
    {
      kind: "quote",
      id: "msg_7812076508172213971",
      sourceIds: ["msg_1", "msg_2"],
      content: '<message from="9fc3ec3b" msg_id="7812076508172213971">迁企微、宁皎搬好了</message>'
    }
  ]);
  assert.equal(surface.entries[0].id, "msg_7812076508172213971");
  assert.deepEqual(surface.entries[0].sourceIds, ["msg_1", "msg_2"]);
  assert.match(surface.text, /- 迁企微、宁皎搬好了/);
  assert.doesNotMatch(surface.text, /9fc3ec3b|7812076508172213971|msg_1|\[quote\]/);
});

test("quotes already covered by a memory are dropped", () => {
  const quotes = [
    { id: "q1", content: "请记住调试暗号是芝麻开门", excerpt: "请记住调试暗号是芝麻开门" },
    { id: "q2", content: "昨天吃了番茄炒蛋", excerpt: "昨天吃了番茄炒蛋" }
  ];
  const { kept, dropped } = keepUncoveredQuotes(quotes, ["调试暗号是芝麻开门"]);
  assert.deepEqual(dropped.map((quote) => quote.id), ["q1"]);
  assert.deepEqual(kept.map((quote) => quote.id), ["q2"]);
});

test("lexical hit score does not pad a one-token scrape to 0.4125", () => {
  const tokens = ["脚本", "路径", "残留", "清理", "文件", "仓库", "提交", "测试"];
  assert.equal(lexicalHitScore("Aelios 是七月的定位裁定", "清理那个脚本", tokens), 0);
  const oneOfEight = lexicalHitScore("仓库里还有旧文档", "清理那个脚本", tokens);
  assert.ok(oneOfEight < 0.15);
  assert.notEqual(Number(oneOfEight.toFixed(4)), 0.4125);
  const grounded = lexicalHitScore("请清理那个脚本再提交测试文件", "清理那个脚本", tokens);
  assert.ok(grounded >= 0.5);
  assert.ok(grounded > oneOfEight);
  assert.equal(lexicalHitScore("完全无关", "清理那个脚本", []), 0);
});

test("grounded hits refuse centroid padding and keep a short real list", () => {
  const tokens = tokenizeQuery("那个脚本还在仓库里吗");
  const centroid = Array.from({ length: 10 }, (_, i) => ({
    id: `old-${i}`,
    content: "Aelios 定位：分层长期记忆内核，七月七日裁定。",
    score: 0.4125
  }));
  assert.deepEqual(keepGroundedHits(centroid, tokens, 10), []);

  const mixed = [
    { id: "script", content: "清理脚本已经从仓库删掉了，只留过 system prompt 残留路径。", score: 0.78 },
    ...centroid
  ];
  const queryTokens = tokenizeQuery("清理脚本还在仓库里吗");
  assert.deepEqual(keepGroundedHits(mixed, queryTokens, 10).map((row) => row.id), ["script"]);
  assert.ok(hasLexicalSupport(mixed[0].content, queryTokens));
});

test("RRF keeps a lexical hit that the vector channel missed", () => {
  const vector = [
    { id: "noise", score: 0.41 },
    { id: "maybe", score: 0.22 }
  ];
  const lexical = [
    { id: "hit", score: 0.8 },
    { id: "maybe", score: 0.6 }
  ];
  const merged = mergeHybridRanks(vector, lexical, 3);
  assert.equal(merged[0].id, "maybe");
  assert.ok(merged.some((row) => row.id === "hit"));
  assert.equal(merged.find((row) => row.id === "hit")?.score, 0.8);
});

test("token lexical search matches a phrase the full query would miss", async () => {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(`CREATE TABLE memories (
    id TEXT PRIMARY KEY, namespace TEXT, type TEXT, content TEXT, summary TEXT,
    importance REAL, confidence REAL, status TEXT, pinned INTEGER, tags TEXT,
    source TEXT, source_message_ids TEXT, vector_id TEXT, last_recalled_at TEXT,
    recall_count INTEGER DEFAULT 0, created_at TEXT, updated_at TEXT, expires_at TEXT,
    version_status TEXT, fact_key TEXT, superseded_by TEXT, authored_by TEXT, response_tendency TEXT
  )`);
  sqlite.prepare(`INSERT INTO memories (
    id, namespace, type, content, summary, importance, confidence, status, pinned, tags,
    source, source_message_ids, vector_id, created_at, updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    "mem_cf", "partner-a", "project", "你正在做 Cloudflare Worker 记忆网关。", null,
    0.9, 0.9, "active", 0, "[]", "extract", "[]", "mem_mem_cf", "2026-09-01", "2026-09-01"
  );
  sqlite.prepare(`INSERT INTO memories (
    id, namespace, type, content, summary, importance, confidence, status, pinned, tags,
    source, source_message_ids, vector_id, created_at, updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    "mem_food", "partner-a", "note", "昨天吃了番茄炒蛋。", null,
    0.4, 0.8, "active", 0, "[]", "extract", "[]", "mem_mem_food", "2026-09-02", "2026-09-02"
  );

  const db = {
    prepare(sql: string) {
      const statement = sqlite.prepare(sql);
      let args: any[] = [];
      const api = {
        bind(...values: any[]) { args = values; return api; },
        async all() { return { results: statement.all(...args) }; }
      };
      return api;
    }
  };

  const missed = await searchMemoriesByText(db as any, {
    namespace: "partner-a",
    query: "我们喜欢什么？",
    limit: 10
  });
  assert.equal(missed.length, 0);

  const hits = await searchMemoriesByText(db as any, {
    namespace: "partner-a",
    query: "我们喜欢什么？",
    tokens: tokenizeQuery("我们喜欢 Cloudflare 网关什么？"),
    limit: 10
  });
  assert.ok(hits.some((row) => row.id === "mem_cf"));
  assert.ok(!hits.some((row) => row.id === "mem_food"));
  sqlite.close();
});

test("precious selection allows zero hits and ignores a leftover previous-topic note", () => {
  const rows = [
    { content: "Claude 的陪伴让我觉得被接住，这是一段很长的关系记忆。" },
    { content: "调试暗号是芝麻开门" }
  ];
  const tokens = shapeRecallQuery({
    query: "调试暗号是什么？",
    recent: ["Claude 的陪伴让我觉得被接住"]
  }).lexicalTokens;
  const selected = selectRelevantPrecious(rows, tokens);
  assert.ok(selected.some((row) => row.content.includes("芝麻开门")));
  assert.ok(!selected.some((row) => row.content.includes("陪伴")));
  assert.deepEqual(selectRelevantPrecious(rows, []), []);
});

test("surface applies a shared item and char budget", () => {
  const assembled = assembleRecallSurface([
    { kind: "precious", content: "很长的关系记忆".repeat(20) },
    { kind: "note", content: "普通记忆一" },
    { kind: "week", content: "不该超过条数的周记" }
  ], { budget: 6000, maxItems: 2, maxChars: 20 });
  assert.equal(assembled.entries.length, 2);
  assert.ok(assembled.entries[0].content.length <= 20);
  assert.ok(!assembled.text.includes("不该超过条数的周记"));
  assert.equal(formatRecallSurface([], { maxItems: 0 }), "");
});

test("reranker errors fail closed unless MEMORY_FILTER_FAIL_OPEN is true", async () => {
  const memories = [
    { id: "noise", namespace: "n", type: "note", content: "完全无关的旧话题", summary: null, importance: 0.2, confidence: 0.2, status: "active", pinned: false, tags: [], source: null, source_message_ids: [], vector_id: null, last_recalled_at: null, recall_count: 0, created_at: "2026-09-01", updated_at: "2026-09-01", expires_at: null, score: 0.9 }
  ];
  const env = {
    ENABLE_MEMORY_FILTER: "true",
    ENABLE_MEMORY_RERANKER: "true",
    MEMORY_FILTER_FAIL_OPEN: "false",
    MEMORY_RERANKER_MODEL: "workers-ai/@cf/baai/bge-reranker-base",
    AI: { run: async () => { throw new Error("reranker down"); } }
  } as any;
  const closed = await filterAndCompressMemoriesWithMeta(env, { query: "调试暗号", memories: memories as any });
  assert.equal(closed.data.length, 0);
  assert.equal(closed.meta.status, "error");
  assert.equal(closed.meta.fallback_used, undefined);

  const opened = await filterAndCompressMemoriesWithMeta({
    ...env,
    MEMORY_FILTER_FAIL_OPEN: "true"
  }, { query: "调试暗号", memories: memories as any });
  assert.equal(opened.data.length, 1);
  assert.equal(opened.meta.fallback_used, true);
});

test("active recall can keep more than the auto-injection two-item budget", async () => {
  const memories = [0, 1, 2, 3, 4].map((index) => ({
    id: `mem_${index}`,
    namespace: "n",
    type: "note",
    content: `调试暗号相关事实 ${index} 还有足够长的正文方便核对`,
    summary: null,
    importance: 0.8,
    confidence: 0.8,
    status: "active",
    pinned: false,
    tags: [],
    source: "dream",
    source_message_ids: [],
    vector_id: null,
    last_recalled_at: null,
    recall_count: 0,
    created_at: "2026-09-01",
    updated_at: "2026-09-01",
    expires_at: null,
    score: 0.9
  }));
  const env = {
    ENABLE_MEMORY_FILTER: "true",
    ENABLE_MEMORY_RERANKER: "false",
    MEMORY_FILTER_MAX_OUTPUT: "2"
  } as any;
  const auto = await filterAndCompressMemoriesWithMeta(env, { query: "调试暗号", memories: memories as any });
  assert.equal(auto.data.length, 2);
  const active = await filterAndCompressMemoriesWithMeta(env, {
    query: "调试暗号",
    memories: memories as any,
    maxOutput: 5
  });
  assert.equal(active.data.length, 5);
  assert.ok(active.data.every((row) => row.id && row.content.includes("调试暗号相关事实")));
});

test("same-timestamp messages are not skipped after a mid-batch cut", async () => {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(`CREATE TABLE messages (
    id TEXT PRIMARY KEY, conversation_id TEXT, namespace TEXT, role TEXT, content TEXT,
    source TEXT, created_at TEXT, seq INTEGER NOT NULL DEFAULT 0
  )`);
  const ts = "2026-09-06T12:00:00.000Z";
  sqlite.prepare("INSERT INTO messages VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run("msg_a", "c", "ns", "user", "先说", "gw", ts, 0);
  sqlite.prepare("INSERT INTO messages VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run("msg_b", "c", "ns", "assistant", "后说", "gw", ts, 1);
  const db = {
    prepare(sql: string) {
      const statement = sqlite.prepare(sql);
      let args: any[] = [];
      const api = {
        bind(...values: any[]) { args = values; return api; },
        async all() { return { results: statement.all(...args) }; }
      };
      return api;
    }
  };
  const first = await listMessagesByNamespaceInRange(db as any, {
    namespace: "ns",
    startCreatedAt: "2026-09-06T00:00:00.000Z",
    endCreatedAt: "2026-09-07T00:00:00.000Z",
    limit: 1
  });
  assert.equal(first[0].id, "msg_a");
  const skipped = await listMessagesByNamespaceInRange(db as any, {
    namespace: "ns",
    startCreatedAt: "2026-09-06T00:00:00.000Z",
    endCreatedAt: "2026-09-07T00:00:00.000Z",
    afterCreatedAt: first[0].created_at,
    limit: 10
  });
  assert.equal(skipped.length, 0);
  const next = await listMessagesByNamespaceInRange(db as any, {
    namespace: "ns",
    startCreatedAt: "2026-09-06T00:00:00.000Z",
    endCreatedAt: "2026-09-07T00:00:00.000Z",
    afterCreatedAt: first[0].created_at,
    afterId: first[0].id,
    limit: 10
  });
  assert.equal(next[0].id, "msg_b");
  const cursor = formatDreamCursor({ done: false, createdAt: first[0].created_at, id: first[0].id });
  assert.deepEqual(
    readDailyCursor(cursor, "2026-09-06T00:00:00.000Z", "2026-09-07T00:00:00.000Z"),
    { done: false, after: ts, afterId: "msg_a" }
  );
  sqlite.close();
});

test("project names and codes stay in the index tokenizer", () => {
  const tokens = tokenizeForIndex("月亮邮局-0906 的暗号");
  assert.ok(tokens.some((token) => token.includes("月亮") || token.includes("邮局")));
  assert.ok(tokens.includes("0906"));
  assert.equal(isEvidenceQuery("调试暗号是什么？"), true);
  assert.equal(isEvidenceQuery("帮我写一段配置"), false);
  assert.equal(isTemporalQuery("上周日记写了什么"), true);
});

test("raw utterances are searchable before they become facts", async () => {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(`CREATE TABLE messages (
    id TEXT PRIMARY KEY, conversation_id TEXT, namespace TEXT, role TEXT, content TEXT,
    source TEXT, created_at TEXT, seq INTEGER NOT NULL DEFAULT 0
  )`);
  sqlite.prepare("INSERT INTO messages VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(
    "msg_1", "c", "ns", "user", "请记住调试暗号是芝麻开门", "gw", "2026-09-06T12:00:00.000Z", 0
  );
  const db = {
    prepare(sql: string) {
      const statement = sqlite.prepare(sql);
      let args: any[] = [];
      const api = {
        bind(...values: any[]) { args = values; return api; },
        async all() { return { results: statement.all(...args) }; },
        async first() { return statement.get(...args) || null; },
        async run() { return { meta: { changes: statement.run(...args).changes } }; }
      };
      return api;
    }
  };
  const hits = await searchQuotes(db as any, { namespace: "ns", query: "调试暗号是什么？" });
  assert.ok(hits.some((hit) => hit.content.includes("芝麻开门")));
  assert.match(formatQuote(hits[0]), /2026-09-06 用户: 「请记住调试暗号是芝麻开门」/);
  sqlite.close();
});

test("adjacent quote hits from one conversation consume one recall slot", async () => {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(`CREATE TABLE messages (
    id TEXT PRIMARY KEY, conversation_id TEXT, namespace TEXT, role TEXT, content TEXT,
    source TEXT, created_at TEXT, seq INTEGER NOT NULL DEFAULT 0
  )`);
  sqlite.prepare("INSERT INTO messages VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(
    "msg_move", "conversation_one", "ns", "user",
    '<message from="9fc3ec3b" msg_id="7812076508172213971">我准备迁企微</message>',
    "gw", "2026-09-06T12:00:00.000Z", 0
  );
  sqlite.prepare("INSERT INTO messages VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(
    "msg_done", "conversation_one", "ns", "assistant",
    "宁皎已经搬好了", "gw", "2026-09-06T12:00:20.000Z", 1
  );
  const hits = await searchQuotes(wrapSqlite(sqlite) as any, {
    namespace: "ns",
    query: "迁企微 宁皎搬好",
    limit: 2
  });
  assert.equal(hits.length, 1);
  assert.deepEqual(hits[0].source_ids, ["msg_move", "msg_done"]);
  assert.match(formatQuote(hits[0], { compact: true }), /迁企微.*宁皎.*搬好/);
  assert.doesNotMatch(hits[0].content, /from=|msg_id=|7812076508172213971/);
  sqlite.close();
});

test("gateway role-local seq does not collapse a multi-minute conversation", async () => {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(`CREATE TABLE messages (
    id TEXT PRIMARY KEY, conversation_id TEXT, namespace TEXT, role TEXT, content TEXT,
    source TEXT, created_at TEXT, seq INTEGER NOT NULL DEFAULT 0
  )`);
  const insert = sqlite.prepare("INSERT INTO messages VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
  // Gateway persist writes user=0 / assistant=1 on every turn.
  insert.run("u1", "gw_session", "ns", "user", "我准备迁企微", "gw", "2026-09-06T12:00:00.000Z", 0);
  insert.run("a1", "gw_session", "ns", "assistant", "好，宁皎那边我来搬", "gw", "2026-09-06T12:00:20.000Z", 1);
  insert.run("u2", "gw_session", "ns", "user", "登录账号怎么办", "gw", "2026-09-06T12:01:10.000Z", 0);
  insert.run("a2", "gw_session", "ns", "assistant", "用宁皎原来的企微账号", "gw", "2026-09-06T12:01:40.000Z", 1);
  insert.run("u3", "gw_session", "ns", "user", "那客户资料也迁过去吗", "gw", "2026-09-06T12:02:20.000Z", 0);
  insert.run("a3", "gw_session", "ns", "assistant", "客户资料跟宁皎一起迁", "gw", "2026-09-06T12:03:00.000Z", 1);
  const hits = await searchQuotes(wrapSqlite(sqlite) as any, {
    namespace: "ns",
    query: "迁企微 宁皎 账号 客户资料",
    limit: 4
  });
  assert.ok(hits.length >= 2, `expected multiple events, got ${hits.length}`);
  assert.ok(
    hits.every((hit) => (hit.source_ids ?? [hit.id]).length <= 3),
    JSON.stringify(hits.map((hit) => hit.source_ids))
  );
  assert.ok(!hits.some((hit) => (hit.source_ids ?? []).length === 6));
  sqlite.close();
});

test("quotes already visible in the request history are not recalled", async () => {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(`CREATE TABLE messages (
    id TEXT PRIMARY KEY, conversation_id TEXT, namespace TEXT, role TEXT, content TEXT,
    source TEXT, created_at TEXT, seq INTEGER NOT NULL DEFAULT 0
  )`);
  sqlite.prepare("INSERT INTO messages VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(
    "msg_1", "c", "ns", "user", "请记住调试暗号是芝麻开门", "gw", "2026-09-06T12:00:00.000Z", 0
  );
  const db = {
    prepare(sql: string) {
      const statement = sqlite.prepare(sql);
      let args: any[] = [];
      const api = {
        bind(...values: any[]) { args = values; return api; },
        async all() { return { results: statement.all(...args) }; },
        async first() { return statement.get(...args) || null; },
        async run() { return { meta: { changes: statement.run(...args).changes } }; }
      };
      return api;
    }
  };
  const visible = await searchQuotes(db as any, { namespace: "ns", query: "调试暗号是什么？",
    excludeVisibleIn: "前面的话\n请记住调试暗号是芝麻开门\n后面的话" });
  assert.equal(visible.length, 0);
  const enveloped = await searchQuotes(db as any, { namespace: "ns", query: "调试暗号是什么？",
    excludeVisibleIn: '<message from="9fc3ec3b" msg_id="7812076508172213971">请记住调试暗号是芝麻开门</message>' });
  assert.equal(enveloped.length, 0);
  const forgotten = await searchQuotes(db as any, { namespace: "ns", query: "调试暗号是什么？",
    excludeVisibleIn: "上下文压缩后只剩完全不相关的内容" });
  assert.ok(forgotten.some((hit) => hit.content.includes("芝麻开门")));
  sqlite.close();
});

test("remember-now extracts the original words after the trigger", () => {
  assert.equal(parseRememberNow("请记住调试暗号是芝麻开门"), "调试暗号是芝麻开门");
  assert.equal(parseRememberNow("帮我记一下：喜欢 Cloudflare"), "喜欢 Cloudflare");
  assert.equal(parseRememberNow("remember that the passphrase is sesame"), "the passphrase is sesame");
  assert.equal(parseRememberNow("我们喜欢什么？"), null);
  assert.equal(parseRememberNow("记住了吗？"), null);
  assert.equal(parseRememberNow("remember when we talked about the project?"), null);
  assert.equal(
    parseRememberNow("请记住：暗号是芝麻开门。只回复三个字：记住了"),
    "暗号是芝麻开门"
  );
  assert.equal(classifyRememberUtterance("记住了吗？")?.kind, "probe");
  assert.equal(classifyRememberUtterance("remember when we talked about the project?")?.kind, "recollect");
  assert.equal(classifyRememberUtterance("请记住调试暗号是芝麻开门")?.kind, "save");
});

test("recentHumanTexts walks user turns in chronological order", () => {
  const texts = recentHumanTexts({
    messages: [
      { role: "system", content: "ignore" },
      { role: "user", content: "先做网关" },
      { role: "assistant", content: "好" },
      { role: "user", content: "那个呢？" }
    ]
  }, "chat");
  assert.deepEqual(texts, ["先做网关", "那个呢？"]);
});

function wrapSqlite(sqlite: DatabaseSync) {
  return {
    prepare(sql: string) {
      const statement = sqlite.prepare(sql);
      let args: any[] = [];
      const api = {
        bind(...values: any[]) { args = values; return api; },
        async all() { return { results: statement.all(...args) }; },
        async first() { return statement.get(...args) || null; },
        async run() { return { meta: { changes: statement.run(...args).changes } }; }
      };
      return api;
    }
  };
}

function memoriesSchema(sqlite: DatabaseSync): void {
  sqlite.exec(`CREATE TABLE memories (
    id TEXT PRIMARY KEY, namespace TEXT, type TEXT, content TEXT, summary TEXT,
    importance REAL, confidence REAL, status TEXT, pinned INTEGER, tags TEXT,
    source TEXT, source_message_ids TEXT, vector_id TEXT, last_recalled_at TEXT,
    recall_count INTEGER DEFAULT 0, created_at TEXT, updated_at TEXT, expires_at TEXT,
    version_status TEXT, fact_key TEXT, superseded_by TEXT, authored_by TEXT, response_tendency TEXT
  )`);
}

test("judge does not archive a still-valid fact and rejects string booleans", () => {
  const thresholds = { approveMin: 0.8, discardMax: 0.3 };
  assert.equal(judgeKindFor("dream_delete"), "delete");
  assert.equal(judgeKindFor("dream_update"), "update");
  assert.equal(judgeKindFor("dream_add"), "add");
  assert.equal(parseJudgeBoolean("false"), false);
  assert.equal(parseJudgeBoolean("true"), true);
  assert.equal(parseJudgeBoolean(false), false);
  assert.equal(parseJudgeBoolean("maybe"), null);
  assert.equal(parseJudgeModelResult({
    score: 0.95,
    grounded: "false",
    durable: true,
    reason: "string false must not coerce to true"
  })?.grounded, false);
  assert.equal(parseJudgeModelResult({ score: 0.9, grounded: "nope", durable: true }), null);

  const goodFact = {
    score: 0.94,
    grounded: true,
    durable: true,
    shouldDelete: null,
    reason: "对话里用户明确说过这件事，且是长期稳定的事实。"
  };
  assert.equal(decideJudge("delete", goodFact, thresholds), "discard");
  assert.equal(decideJudge("add", goodFact, thresholds), "approve");

  // 会过期但有据的事实交给人工，不再直接扔掉。
  const datedFact = { ...goodFact, durable: false, reason: "对话里说了，但这是一次性的安排。" };
  assert.equal(decideJudge("add", datedFact, thresholds), "keep");
  assert.equal(decideJudge("update", datedFact, thresholds), "keep");
  // 没有依据、或者分数本来就低的，照旧 discard。
  assert.equal(decideJudge("add", { ...datedFact, grounded: false }, thresholds), "discard");
  assert.equal(decideJudge("add", { ...datedFact, score: 0.2 }, thresholds), "discard");
  // delete 侧不受影响：durable 在那边是"这条还好好的，别归档"的证据。
  assert.equal(decideJudge("delete", { ...datedFact, shouldDelete: null }, thresholds), "keep");

  assert.equal(decideJudge("delete", { ...goodFact, shouldDelete: false, score: 0.99 }, thresholds), "discard");
  assert.equal(decideJudge("delete", {
    score: 0.91,
    grounded: false,
    durable: false,
    shouldDelete: true,
    reason: "已被用户否定，应该归档。"
  }, thresholds), "approve");

  const deletePrompt = buildJudgePrompt({
    id: "cand_1",
    namespace: "ns",
    type: "fact",
    content: "调试暗号是芝麻开门",
    fact_key: "fact:pass",
    confidence: 0.9,
    importance: 0.9,
    tags: "[]",
    source_message_ids: "[]",
    source: "dream_delete",
    status: "pending",
    target_memory_id: "mem_1",
    decision_note: null,
    created_at: "2026-09-06",
    updated_at: "2026-09-06"
  } as MemoryCandidateRow, []);
  assert.match(deletePrompt, /归档提案|应不应该删/);
  assert.doesNotMatch(deletePrompt, /score 高 = 值得新增/);

  const named = buildJudgePrompt({
    id: "cand_2",
    namespace: "ns",
    type: "fact",
    content: "调试暗号是芝麻开门",
    fact_key: "fact:pass",
    confidence: 0.9,
    importance: 0.9,
    tags: "[]",
    source_message_ids: "[]",
    source: "dream_update",
    status: "pending",
    target_memory_id: "mem_1",
    decision_note: null,
    created_at: "2026-09-06",
    updated_at: "2026-09-06"
  } as MemoryCandidateRow, [{
    id: "msg_1", conversation_id: "c", namespace: "ns", role: "user",
    content: "改成这样", source: "test", created_at: "2026-09-06T00:00:00.000Z"
  }], { userName: "小南", assistantName: "小北" });
  assert.match(named, /用户是小南，助手是小北/);
  assert.match(named, /\[msg_1\].*\[小南\]/);
  assert.match(named, /小南用新内容明确修正了旧事实/);
});

test("FTS id hits keep SQL binds aligned and still find the rows", async () => {
  const sqlite = new DatabaseSync(":memory:");
  memoriesSchema(sqlite);
  sqlite.prepare(`INSERT INTO memories (
    id, namespace, type, content, summary, importance, confidence, status, pinned, tags,
    source, source_message_ids, vector_id, created_at, updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    "mem_a", "ns", "note", "调试暗号是芝麻开门", null, 0.8, 0.8, "active", 0, "[]",
    "extract", "[]", "v", "2026-09-01", "2026-09-01"
  );
  sqlite.prepare(`INSERT INTO memories (
    id, namespace, type, content, summary, importance, confidence, status, pinned, tags,
    source, source_message_ids, vector_id, created_at, updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    "mem_b", "ns", "note", "备用暗号是芝麻开门", null, 0.8, 0.8, "active", 0, "[]",
    "extract", "[]", "v", "2026-09-01", "2026-09-01"
  );

  const real = wrapSqlite(sqlite);
  const db = {
    prepare(sql: string) {
      if (sql.includes("memory_fts") && sql.includes("MATCH")) {
        const api = {
          bind() { return api; },
          async all() { return { results: [{ id: "mem_a" }, { id: "mem_b" }] }; }
        };
        return api;
      }
      return real.prepare(sql);
    }
  };

  const hits = await searchMemoriesByText(db as any, {
    namespace: "ns",
    query: "我们喜欢什么？",
    tokens: ["暗号", "芝麻"],
    limit: 10
  });
  assert.equal(hits.length, 2);
  assert.ok(hits.some((row) => row.id === "mem_a"));
  assert.ok(hits.some((row) => row.id === "mem_b"));
  sqlite.close();
});

test("same-timestamp gateway hashes keep ask-then-answer order", async () => {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(`CREATE TABLE messages (
    id TEXT PRIMARY KEY, conversation_id TEXT, namespace TEXT, role TEXT, content TEXT,
    source TEXT, created_at TEXT, seq INTEGER NOT NULL DEFAULT 0
  )`);
  const ts = "2026-09-06T12:00:00.000Z";
  sqlite.prepare("INSERT INTO messages VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(
    "gw_req_ffff", "c", "ns", "assistant", "芝麻开门", "gw", ts, 1
  );
  sqlite.prepare("INSERT INTO messages VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(
    "gw_user_aaaa", "c", "ns", "user", "调试暗号是什么？", "gw", ts, 0
  );
  const rows = await listMessagesByNamespaceInRange(wrapSqlite(sqlite) as any, {
    namespace: "ns",
    startCreatedAt: "2026-09-06T00:00:00.000Z",
    endCreatedAt: "2026-09-07T00:00:00.000Z",
    limit: 10
  });
  assert.deepEqual(rows.map((row) => row.role), ["user", "assistant"]);
  assert.deepEqual(rows.map((row) => row.id), ["gw_user_aaaa", "gw_req_ffff"]);
  sqlite.close();
});

test("quote excerpts keep the matched span and final-snippet dedup uses the excerpt", () => {
  const prefix = "前言".repeat(80);
  const content = `${prefix} 调试暗号是芝麻开门 ${"结尾".repeat(20)}`;
  const excerpt = excerptAroundMatch(content, ["芝麻开门", "暗号"]);
  assert.match(excerpt, /芝麻开门/);
  assert.ok(excerpt.length <= 282);
  const formatted = formatQuote({
    id: "msg_long",
    role: "user",
    content,
    excerpt,
    created_at: "2026-09-06T12:00:00.000Z",
    conversation_id: "c",
    score: 1
  });
  assert.match(formatted, /芝麻开门/);
  assert.ok(quoteOverlaps("调试暗号是芝麻开门", excerpt));
  assert.equal(quoteOverlaps("完全无关的普通记忆", excerpt.slice(0, 12)), false);
});

test("FTS backfill indexes missing rows and can rebuild from source text", async () => {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(`CREATE TABLE messages (
    id TEXT PRIMARY KEY, conversation_id TEXT, namespace TEXT, role TEXT, content TEXT,
    source TEXT, created_at TEXT, seq INTEGER NOT NULL DEFAULT 0
  )`);
  memoriesSchema(sqlite);
  sqlite.exec("CREATE TABLE message_fts (fts_body TEXT, namespace TEXT, message_id TEXT)");
  sqlite.exec("CREATE TABLE memory_fts (fts_body TEXT, namespace TEXT, memory_id TEXT)");
  const long = `${"前面铺垫。".repeat(40)}最后才出现月亮邮局暗号。`;
  sqlite.prepare("INSERT INTO messages VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(
    "msg_tail", "c", "ns", "user", long, "gw", "2026-09-06T12:00:00.000Z", 0
  );
  sqlite.prepare(`INSERT INTO memories (
    id, namespace, type, content, summary, importance, confidence, status, pinned, tags,
    source, source_message_ids, vector_id, created_at, updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    "mem_tail", "ns", "note", long, null, 0.8, 0.8, "active", 0, "[]",
    "extract", "[]", "v", "2026-09-01", "2026-09-01"
  );

  const db = wrapSqlite(sqlite);
  const filled = await backfillFts(db as any, { namespace: "ns", limit: 50 });
  assert.equal(filled.messagesIndexed, 1);
  assert.equal(filled.memoriesIndexed, 1);
  const messageBody = sqlite.prepare("SELECT fts_body FROM message_fts WHERE message_id = ?").get("msg_tail") as { fts_body: string };
  const memoryBody = sqlite.prepare("SELECT fts_body FROM memory_fts WHERE memory_id = ?").get("mem_tail") as { fts_body: string };
  assert.match(messageBody.fts_body, /暗号|邮局|月亮/);
  assert.match(memoryBody.fts_body, /暗号|邮局|月亮/);
  assert.match(toFtsBody(long), /暗号|邮局|月亮/);

  sqlite.exec("DELETE FROM message_fts");
  sqlite.exec("DELETE FROM memory_fts");
  const rebuilt = await rebuildFts(db as any, { namespace: "ns", limit: 50 });
  assert.equal(rebuilt.messagesIndexed, 1);
  assert.equal(rebuilt.memoriesIndexed, 1);
  assert.equal((sqlite.prepare("SELECT count(*) AS n FROM message_fts").get() as any).n, 1);
  sqlite.close();
});
