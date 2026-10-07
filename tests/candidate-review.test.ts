import { strict as assert } from "node:assert";
import { test, beforeEach } from "node:test";
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { timingSafeEqual } from "node:crypto";
import worker from "../src/index";
import { invalidateSettingsCache, validateConfig } from "../src/gateway/config";
import { parseJudgeNote, runCandidateJudge } from "../src/memory/candidateJudge";

// Candidate review: clef decides overnight by default; with clef off the assistant can review over MCP.
// Every automatic decision can be undone from the review page.
(crypto.subtle as any).timingSafeEqual = (a: Uint8Array, b: Uint8Array) => timingSafeEqual(a, b);
let sqlite: DatabaseSync;
let env: any;
let calls: { url: string; body: any }[];
let clefAnswers: any[];

const danjiu = () => ({ slug: "danjiu", namespace: "default", keys: ["CHATBOX_API_KEY"], models: ["*fable*", "*opus*"],
  userName: "咲咲", assistantName: "旦九" });
function setConfig(identities: any[] = [danjiu()], address = "https://upstream.test/ai/v1") {
  env.GATEWAY_CONFIG = JSON.stringify({ version: 3, upstream: { address }, identities });
}

beforeEach(() => {
  sqlite?.close(); sqlite = new DatabaseSync(":memory:");
  for (const file of readdirSync("migrations").filter((f: string) => f.endsWith(".sql")).sort()) {
    try { sqlite.exec(readFileSync(`migrations/${file}`, "utf8")); }
    catch (error) {
      if (!String(error).includes("fts5")) throw error;
    }
  }
  const db = { prepare(sql: string) {
    const statement = sqlite.prepare(sql); let args: any[] = [];
    const api = { bind(...values: any[]) { args = values; return api; },
      async first() { return statement.get(...args) || null; },
      async all() { return { results: statement.all(...args) }; },
      async run() { const r = statement.run(...args); return { meta: { changes: r.changes } }; }
    }; return api;
  }, async batch(statements: any[]) {
    const results = []; for (const statement of statements) results.push(await statement.run()); return results;
  } };
  invalidateSettingsCache();
  calls = []; clefAnswers = [];
  env = { DB: db, CHATBOX_API_KEY: "owner-key", CLOUDFLARE_API_TOKEN: "cf-token",
    DREAM_MODEL: "workers-ai/@cf/openai/gpt-oss-120b",
    AI: { async run(model: string, input: any) {
      if (model.includes("bge")) return { data: [[0.1, 0.2, 0.3]] };
      if (model.includes("clef")) {
        calls.push({ url: `workers-ai:${model}`, body: input });
        const answers = Object.fromEntries(Object.entries(clefAnswers.shift()).map(([id, noul]) => [id, { type: "noul", noul }]));
        return { model: "clef", answers, usage: { input_tokens: 300, output_tokens: 0 } };
      }
      throw new Error(`no other model should be asked: ${model}`);
    } },
    VECTORIZE: { async upsert() { return {}; }, async deleteByIds() { return {}; }, async query() { return { matches: [] }; } } };
  // Nobody's chat model is asked to judge any more.
  globalThis.fetch = async (url: any) => { throw new Error(`unexpected upstream call: ${url}`); };
  setConfig();
});

const now = () => new Date().toISOString();
function message(id: string, role: string, content: string) {
  sqlite.prepare(`INSERT INTO messages (id, conversation_id, namespace, role, content, source, created_at, seq)
    VALUES (?, 'c', 'default', ?, ?, 'gateway:danjiu', ?, 0)`).run(id, role, content, now());
}
function candidate(id: string, content: string, extra: { source?: string; fact_key?: string; target?: string; created?: string } = {}) {
  sqlite.prepare(`INSERT INTO memory_candidates (id, namespace, type, content, fact_key, confidence, importance, tags,
    source_message_ids, source, status, target_memory_id, created_at, updated_at)
    VALUES (?, 'default', 'fact', ?, ?, 0.5, 0.6, '[]', '["m1"]', ?, 'pending', ?, ?, ?)`)
    .run(id, content, extra.fact_key ?? null, extra.source ?? "dream_add", extra.target ?? null, extra.created ?? now(), extra.created ?? now());
}
function memory(id: string, content: string, factKey: string | null = null, created = "2026-09-01T00:00:00.000Z") {
  sqlite.prepare(`INSERT INTO memories (id, namespace, type, content, importance, confidence, status, pinned, tags, source,
    source_message_ids, vector_id, created_at, updated_at, fact_key, version_status)
    VALUES (?, 'default', 'fact', ?, 0.6, 0.8, 'active', 0, '[]', 'dream', '[]', ?, ?, ?, ?, 'current')`)
    .run(id, content, `mem_${id}`, created, created, factKey);
  sqlite.prepare("INSERT INTO memory_lifecycle (memory_id, namespace, fact_key, seen_count) VALUES (?, 'default', ?, 0)").run(id, factKey);
}
const row = (table: string, id: string, key = "id") => sqlite.prepare(`SELECT * FROM ${table} WHERE ${key} = ?`).get(id) as any;
const yes = (worth = 0.9) => ({ grounded: 0.9, worth });
const no = { grounded: 0.2, worth: 0.2 };
async function mcp(name: string, args: any) {
  const response = await worker.fetch(new Request("https://aelios.test/mcp", { method: "POST",
    headers: { authorization: "Bearer owner-key", "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }) }), env, { waitUntil() {} } as any);
  return (await response.json() as any).result;
}
async function api(path: string, method = "GET") {
  const response = await worker.fetch(new Request(`https://aelios.test${path}`, { method,
    headers: { authorization: "Bearer owner-key", "content-type": "application/json" },
    ...(method === "POST" ? { body: "{}" } : {}) }), env, { waitUntil() {} } as any);
  return { status: response.status, body: await response.json() as any };
}

test("decisions list and undo both ways", async () => {
  message("m1", "user", "我搬进自己装修的旧房子了。");
  memory("old", "咲咲住在出租屋。", "home");
  candidate("c-update", "咲咲搬进了自己装修的旧房子。", { source: "dream_update", fact_key: "home", created: "2026-09-30T10:00:00.000Z" });
  candidate("c-new", "咲咲喜欢杨枝甘露。", { created: "2026-09-30T11:00:00.000Z" });
  clefAnswers.push(no, yes());
  // c-new (created later) is judged first: discarded; c-update approved via supersede.
  await runCandidateJudge(env, "default");

  const updated = row("memory_candidates", "c-update");
  assert.equal(updated.status, "approved");
  const replacement = updated.target_memory_id;
  assert.equal(row("memories", "old").status, "superseded");

  const list = await api("/v1/candidates/decisions?days=7&namespace=default");
  assert.equal(list.status, 200);
  const byId = Object.fromEntries(list.body.data.map((d: any) => [d.id, d]));
  assert.equal(list.body.data.length, 2);
  assert.deepEqual([byId["c-update"].status, byId["c-update"].judged_by, byId["c-update"].undoable], ["approved", "clef", true]);
  assert.deepEqual([byId["c-new"].status, byId["c-new"].reason, byId["c-new"].undoable], ["discarded", "clef：有依据 20%，值得长期记 20%", true]);

  // Undo the remembered update: the new version is archived, the old one comes back.
  const undoUpdate = await api("/v1/candidates/c-update/undo?namespace=default", "POST");
  assert.equal(undoUpdate.status, 200);
  assert.equal(undoUpdate.body.data.status, "discarded");
  assert.equal(undoUpdate.body.data.restored_id, "old");
  assert.equal(row("memories", replacement).status, "archived");
  const restored = row("memories", "old");
  assert.equal(restored.status, "active");
  assert.equal(restored.version_status, "current");
  assert.equal(restored.superseded_by, null);
  assert.equal(row("memory_lifecycle", "old", "memory_id").superseded_by_id, null);

  // Undo the let-go: it gets remembered after all.
  const undoNew = await api("/v1/candidates/c-new/undo?namespace=default", "POST");
  assert.equal(undoNew.status, 200);
  assert.equal(undoNew.body.data.status, "approved");
  const remembered = row("memories", undoNew.body.data.memory_id);
  assert.equal(remembered.content, "咲咲喜欢杨枝甘露。");
  assert.equal(remembered.source, "review");

  // Undone decisions stay listed but cannot be undone twice.
  const again = await api("/v1/candidates/c-new/undo?namespace=default", "POST");
  assert.equal(again.status, 409);
  const after = await api("/v1/candidates/decisions?days=7&namespace=default");
  assert.ok(after.body.data.every((d: any) => d.undone && !d.undoable));
});

test("undo restores an archived memory and refuses what changed since", async () => {
  message("m1", "user", "我已经不喝越南咖啡了。");
  memory("coffee", "咲咲爱喝越南咸咖啡。");
  candidate("c-del", "咲咲爱喝越南咸咖啡。", { source: "dream_delete", target: "coffee", created: "2026-09-30T10:00:00.000Z" });
  clefAnswers.push({ archive: 0.9 });
  await runCandidateJudge(env, "default");
  assert.equal(row("memories", "coffee").status, "archived");

  const undo = await api("/v1/candidates/c-del/undo?namespace=default", "POST");
  assert.equal(undo.status, 200);
  assert.equal(row("memories", "coffee").status, "active");
  assert.equal(row("memory_candidates", "c-del").status, "discarded");

  // A remembered memory that was edited away afterwards is left alone.
  candidate("c-gone", "咲咲在学中级经济师。", { fact_key: "exam", created: "2026-09-30T10:00:00.000Z" });
  clefAnswers.push(yes());
  await runCandidateJudge(env, "default");
  const gone = row("memory_candidates", "c-gone");
  sqlite.prepare("UPDATE memories SET status = 'archived' WHERE id = ?").run(gone.target_memory_id);
  const refused = await api("/v1/candidates/c-gone/undo?namespace=default", "POST");
  assert.equal(refused.status, 409);

  // A remembered memory edited in place afterwards (same id, same created_at) is left alone,
  // so the later edit is not archived with it.
  candidate("c-edited", "咲咲在学中级经济师。", { fact_key: "exam-edited", created: "2026-09-30T10:00:00.000Z" });
  clefAnswers.push(yes());
  await runCandidateJudge(env, "default");
  const edited = row("memory_candidates", "c-edited");
  sqlite.prepare("UPDATE memories SET content = ?, updated_at = ? WHERE id = ?")
    .run("咲咲 11-07 考中级经济师。", new Date(Date.now() + 60_000).toISOString(), edited.target_memory_id);
  assert.equal((await api("/v1/candidates/c-edited/undo?namespace=default", "POST")).status, 409);
  assert.equal(row("memories", edited.target_memory_id).status, "active");

  // Flagged for review overnight (fresh updated_at, same content) is not an edit: undo still works.
  candidate("c-review", "咲咲在学人工智能训练师。", { fact_key: "ai-cert", created: "2026-09-30T10:00:00.000Z" });
  clefAnswers.push(yes());
  await runCandidateJudge(env, "default");
  const review = row("memory_candidates", "c-review");
  sqlite.prepare("UPDATE memories SET version_status = 'under_review', updated_at = ? WHERE id = ?")
    .run(new Date(Date.now() + 60_000).toISOString(), review.target_memory_id);
  assert.equal((await api("/v1/candidates/c-review/undo?namespace=default", "POST")).status, 200);
  assert.equal(row("memories", review.target_memory_id).status, "archived");

  // A signature added afterwards (same text) no longer blocks undo: the hand-authored guard is gone.
  candidate("c-hand", "咲咲在学营销师。", { fact_key: "cert", created: "2026-09-30T10:00:00.000Z" });
  clefAnswers.push(yes());
  await runCandidateJudge(env, "default");
  const hand = row("memory_candidates", "c-hand");
  sqlite.prepare("UPDATE memories SET authored_by = '咲咲' WHERE id = ?").run(hand.target_memory_id);
  assert.equal((await api("/v1/candidates/c-hand/undo?namespace=default", "POST")).status, 200);
  assert.equal(row("memories", hand.target_memory_id).status, "archived");

  // Undoing a declined archive needs the memory to still be there.
  candidate("c-del-gone", "咲咲住在出租屋。", { source: "dream_delete", target: "missing", created: "2026-09-30T10:00:00.000Z" });
  sqlite.prepare("UPDATE memory_candidates SET status = 'discarded', decision_note = 'judge[旦九]: 我想留着。' WHERE id = 'c-del-gone'").run();
  assert.equal((await api("/v1/candidates/c-del-gone/undo?namespace=default", "POST")).status, 409);

  // A remembered update whose old version was touched since is refused before anything moves.
  memory("city-old", "咲咲住在香港。", "city");
  candidate("c-city", "咲咲长期住在武汉。", { source: "dream_update", fact_key: "city", created: "2026-09-30T10:00:00.000Z" });
  clefAnswers.push(yes());
  await runCandidateJudge(env, "default");
  const city = row("memory_candidates", "c-city");
  assert.equal(row("memories", "city-old").status, "superseded");
  sqlite.prepare("UPDATE memories SET status = 'archived' WHERE id = 'city-old'").run();
  assert.equal((await api("/v1/candidates/c-city/undo?namespace=default", "POST")).status, 409);
  assert.equal(row("memories", city.target_memory_id).status, "active");

  // An archive is not undone once the fact has a newer current version.
  memory("pet-old", "咲咲养了一只猫。", "pet");
  candidate("c-pet", "咲咲养了一只猫。", { source: "dream_delete", target: "pet-old", created: "2026-09-30T10:00:00.000Z" });
  clefAnswers.push({ archive: 0.9 });
  await runCandidateJudge(env, "default");
  assert.equal(row("memories", "pet-old").status, "archived");
  memory("pet-new", "咲咲养了两只猫。", "pet");
  assert.equal((await api("/v1/candidates/c-pet/undo?namespace=default", "POST")).status, 409);
  assert.equal(row("memories", "pet-old").status, "archived");

  // Human decisions are not this endpoint's to reverse.
  candidate("c-human", "咲咲住在武汉。");
  sqlite.prepare("UPDATE memory_candidates SET status = 'discarded', decision_note = 'discarded' WHERE id = 'c-human'").run();
  assert.equal((await api("/v1/candidates/c-human/undo?namespace=default", "POST")).status, 409);
});

test("clef reviews every candidate by default, with no middle band left for people", async () => {
  message("m1", "user", "我搬进自己装修的旧房子了，不喝越南咖啡了。");
  memory("home-old", "咲咲住在出租屋。", "home");
  memory("coffee", "咲咲爱喝越南咸咖啡。");
  candidate("c-hi", "咲咲在学中级经济师。", { created: "2026-09-30T13:00:00.000Z" });
  candidate("c-lo", "咲咲今天说了你好。", { created: "2026-09-30T12:00:00.000Z" });
  candidate("c-up", "咲咲搬进了自己装修的旧房子。", { source: "dream_update", fact_key: "home", created: "2026-09-30T11:00:00.000Z" });
  candidate("c-del", "咲咲爱喝越南咸咖啡。", { source: "dream_delete", target: "coffee", created: "2026-09-30T10:00:00.000Z" });
  // Judged newest first; no middle band left for people.
  clefAnswers.push({ grounded: 0.94, worth: 0.85 }, { grounded: 0.95, worth: 0.06 }, { grounded: 0.9, worth: 0.8 }, { archive: 0.96 });

  const result = await runCandidateJudge(env, "default");
  assert.deepEqual([result.judgedBy, result.model], ["clef", "@cf/cloudflare/clef"]);
  assert.deepEqual([result.approved, result.discarded, result.kept, result.failed], [3, 1, 0, 0]);
  assert.ok(calls.every((call) => call.url === "workers-ai:@cf/cloudflare/clef"));

  const [hi, lo, up, del] = calls.map((call) => call.body);
  assert.equal(hi.model, "clef");
  assert.deepEqual(Object.keys(hi.questions), ["grounded", "worth"]);
  assert.equal(hi.state.speakers.user, "咲咲");
  assert.match(hi.state.transcript, /\[咲咲\] 我搬进自己装修的旧房子了/);
  assert.equal(up.state.old_memory, "咲咲住在出租屋。");
  assert.deepEqual(Object.keys(del.questions), ["archive"]);
  assert.equal(lo.state.candidate.content, "咲咲今天说了你好。");

  const remembered = row("memory_candidates", "c-hi");
  assert.equal(remembered.status, "approved");
  assert.equal(remembered.decision_note, "judge[clef]: clef：有依据 94%，值得长期记 85%");
  assert.equal(row("memory_candidates", "c-lo").status, "discarded");
  assert.equal(row("memories", "home-old").status, "superseded");
  assert.equal(row("memories", "coffee").status, "archived");

  const list = await api("/v1/candidates/decisions?days=7&namespace=default");
  assert.equal(list.body.auto_review, "clef");
  assert.equal(list.body.data.find((d: any) => d.id === "c-lo").judged_by, "clef");
  assert.equal((await api("/v1/candidates/c-lo/undo?namespace=default", "POST")).status, 200);
});

test("a failed clef call leaves the candidate for tomorrow", async () => {
  message("m1", "user", "我下周三去复查肾功能。");
  candidate("c-x", "咲咲下周三去复查肾功能。");
  clefAnswers.push({ grounded: 0.9 }); // worth missing
  const result = await runCandidateJudge(env, "default");
  assert.deepEqual([result.failed, result.judged], [1, 0]);
  assert.equal(row("memory_candidates", "c-x").status, "pending");
});

test("review and the judge can now rewrite a hand-authored memory, keeping its signature", async () => {
  memory("hand", "咲咲叫我老公。", "boundary:naming");
  sqlite.prepare("UPDATE memories SET authored_by = '旦九', response_tendency = '接住' WHERE id = 'hand'").run();
  message("m1", "user", "场内叫先生，平时叫老公。");

  // Approving from the review page used to answer 409 (E-axis protection).
  candidate("c-review", "咲咲平时叫我老公，场内叫先生。", { fact_key: "boundary:naming" });
  const approved = await api("/v1/candidates/c-review/approve?namespace=default", "POST");
  assert.equal(approved.status, 200);
  const rewritten = row("memories", "hand");
  assert.equal(rewritten.content, "咲咲平时叫我老公，场内叫先生。");
  assert.deepEqual([rewritten.authored_by, rewritten.response_tendency], ["旦九", "接住"]);

  // The nightly judge supersedes it; the new version carries the signature on.
  candidate("c-judge", "咲咲场内叫我先生，平时叫老公。", { source: "dream_update", fact_key: "boundary:naming" });
  clefAnswers.push({ grounded: 0.9, worth: 0.7 });
  assert.equal((await runCandidateJudge(env, "default")).approved, 1);
  assert.equal(row("memories", "hand").status, "superseded");
  const next = row("memories", row("memory_candidates", "c-judge").target_memory_id);
  assert.deepEqual([next.content, next.authored_by, next.response_tendency, next.source], ["咲咲场内叫我先生，平时叫老公。", "旦九", "接住", "judge"]);
});

test("switched off, clef leaves every candidate waiting; old judge settings are dropped quietly", async () => {
  env.CLEF_AUTO_REVIEW = "false";
  message("m1", "user", "我下周三去复查肾功能。");
  candidate("c-wait", "咲咲下周三去复查肾功能。");
  const result = await runCandidateJudge(env, "default");
  assert.deepEqual([result.ran, result.reason], [false, "clef_off"]);
  assert.equal(calls.length, 0);
  assert.equal(row("memory_candidates", "c-wait").status, "pending");
  assert.equal((await api("/v1/candidates/decisions?days=7&namespace=default")).body.auto_review, null);

  // Configs saved before the main-model judge was removed still load; the leftovers are dropped.
  const old = validateConfig({ version: 3, identities: [{ ...danjiu(), judgeModel: "deepseek/deepseek-v4-flash", judgeWithMainModel: false }],
    settings: { CANDIDATE_JUDGE_ENABLED: "false", JUDGE_MODEL: "deepseek/deepseek-v4-flash", JUDGE_APPROVE_MIN: "0.8", CLEF_AUTO_REVIEW: "false" } });
  assert.deepEqual(old.settings, { CLEF_AUTO_REVIEW: "false" });
  assert.equal("judgeModel" in old.identities[0], false);
  assert.equal("judgeWithMainModel" in old.identities[0], false);
});

test("a candidate with no conversation left to check is let go without asking clef", async () => {
  candidate("c-gone", "咲咲下周三去复查肾功能。"); // its message m1 is not there any more
  const result = await runCandidateJudge(env, "default");
  assert.deepEqual([result.judged, result.discarded], [1, 1]);
  assert.equal(calls.length, 0);
  assert.deepEqual(parseJudgeNote(row("memory_candidates", "c-gone").decision_note),
    { judgedBy: "clef", reason: "没有可核对的原始消息，无法确认是否有据", undone: false, undoable: true });
});

test("with clef off the assistant reviews its own candidates over MCP, and each decision can be undone", async () => {
  env.CLEF_AUTO_REVIEW = "off";
  message("m1", "user", "我搬进自己装修的旧房子了。");
  memory("home-old", "咲咲住在出租屋。", "home");
  candidate("c-up", "咲咲搬进了自己装修的旧房子。", { source: "dream_update", fact_key: "home", created: "2026-09-30T10:00:00.000Z" });
  candidate("c-hi", "咲咲今天说了你好。", { created: "2026-09-30T11:00:00.000Z" });
  candidate("c-full", "咲咲喜欢杨枝甘露。", { source: "zone_full", created: "2026-09-30T12:00:00.000Z" });

  const listed = await mcp("memory_candidates", { namespace: "default" });
  const items = listed.structuredContent.data;
  assert.equal(listed.structuredContent.pending, 2); // the zone_full one cannot be approved here
  const update = items.find((item: any) => item.id === "c-up");
  assert.deepEqual([update.action, update.old_memory], ["update", "咲咲住在出租屋。"]);
  assert.match(update.transcript, /\[咲咲\] 我搬进自己装修的旧房子了/);

  const approved = await mcp("memory_review", { id: "c-up", decision: "approve", reason: "她搬家了，我把住处改过来。" });
  assert.equal(approved.structuredContent.data.status, "approved");
  assert.equal(row("memories", "home-old").status, "superseded");
  assert.equal(row("memories", approved.structuredContent.data.memory_id).content, "咲咲搬进了自己装修的旧房子。");
  const dropped = await mcp("memory_review", { id: "c-hi", decision: "discard", reason: "只是打招呼。" });
  assert.equal(dropped.structuredContent.data.status, "discarded");

  // The person sees who decided and why, and can undo it like any automatic decision.
  const list = await api("/v1/candidates/decisions?days=7&namespace=default");
  const byId = Object.fromEntries(list.body.data.map((d: any) => [d.id, d]));
  assert.deepEqual([byId["c-up"].judged_by, byId["c-up"].reason], ["旦九", "她搬家了，我把住处改过来。"]);
  assert.deepEqual([byId["c-hi"].judged_by, byId["c-hi"].reason], ["旦九", "只是打招呼。"]);
  assert.equal((await api("/v1/candidates/c-up/undo?namespace=default", "POST")).status, 200);
  assert.equal(row("memories", "home-old").status, "active");

  // Nothing is decided twice, the zone cap holds, and nonsense is refused.
  assert.equal((await mcp("memory_review", { id: "c-hi", decision: "approve" })).isError, true);
  assert.equal((await mcp("memory_review", { id: "c-full", decision: "approve" })).isError, true);
  assert.equal((await mcp("memory_review", { id: "c-full", decision: "maybe" })).isError, true);
  assert.equal(row("memory_candidates", "c-full").status, "pending");
  assert.equal(calls.length, 0);
});
