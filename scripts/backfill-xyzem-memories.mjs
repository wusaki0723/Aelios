import { mkdir, readFile, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";

const workerBase = (process.env.AELIOS_BASE_URL || process.env.WORKER_BASE_URL || "").replace(/\/+$/, "");
const aeliosApiKey = process.env.AELIOS_API_KEY || process.env.CHATBOX_API_KEY || process.env.MEMORY_MCP_API_KEY;
const deepseekBase = (process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com/v1").replace(/\/+$/, "");
const deepseekApiKey = process.env.DEEPSEEK_API_KEY || process.env.OPENAI_API_KEY;
const model = process.env.XYZEM_BACKFILL_MODEL || "deepseek-chat";
const namespace = readArgValue("--namespace") || process.env.XYZEM_NAMESPACE || "default";
const outputDir = process.env.XYZEM_OUTPUT_DIR || "backups";
const batchSize = readArgNumber("--batch-size", Number(process.env.XYZEM_BATCH_SIZE || 20));
const limitBatches = readArgNumber("--limit-batches", Infinity);
const apply = process.argv.includes("--apply");
const resumePath = readArgValue("--resume");
const databaseName = process.env.D1_DATABASE_NAME || "companion_memory_proxy";
const maxRelationCandidates = readArgNumber("--max-relations", Number(process.env.XYZEM_MAX_RELATIONS || 250));

const SAFE_RELATIONS = new Set([
  "same_issue",
  "same_project",
  "same_tool",
  "same_event",
  "same_topic",
  "temporal_sequence",
  "emotional_link",
  "in_thread",
  "same_person",
  "in_episode",
  "instance_of",
  "derived_from"
]);
const REVIEW_RELATIONS = new Set(["contradicts", "cause_effect", "supports"]);

if (!workerBase || !aeliosApiKey) {
  console.error("Missing AELIOS_BASE_URL and AELIOS_API_KEY.");
  process.exit(1);
}
if (!deepseekApiKey && !resumePath) {
  console.error("Missing DEEPSEEK_API_KEY.");
  process.exit(1);
}

function readArgValue(name) {
  const index = process.argv.indexOf(name);
  if (index === -1) return "";
  const value = process.argv[index + 1];
  return value && !value.startsWith("--") ? value : "";
}

function readArgNumber(name, fallback) {
  const index = process.argv.indexOf(name);
  if (index === -1) return fallback;
  const value = Number(process.argv[index + 1]);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchJson(url, init = {}, tries = 4) {
  let last = "";
  for (let attempt = 0; attempt < tries; attempt += 1) {
    const response = await fetch(url, init);
    const text = await response.text();
    if (response.ok) return text ? JSON.parse(text) : {};
    last = `${response.status}: ${text.slice(0, 800)}`;
    await sleep(800 * (attempt + 1));
  }
  throw new Error(last);
}

async function aelios(path, init = {}) {
  return fetchJson(`${workerBase}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${aeliosApiKey}`,
      "content-type": "application/json",
      ...(init.headers || {})
    }
  });
}

async function listMemories() {
  const memories = [];
  let cursor = null;
  for (;;) {
    const params = new URLSearchParams({ limit: "1000", namespace, status: "active" });
    if (cursor) params.set("cursor", cursor);
    const page = await aelios(`/v1/memory?${params}`);
    memories.push(...(page.data || []));
    cursor = page.paging?.cursor || null;
    if (!page.paging?.has_more || !cursor) break;
  }
  return memories;
}

function compactMemory(memory) {
  return {
    id: memory.id,
    type: memory.type,
    tags: memory.tags || [],
    created_at: memory.created_at,
    content: String(memory.content || "").slice(0, 900)
  };
}

function normalizeLevel(value, allowed) {
  const text = String(value || "").trim().toLowerCase();
  return allowed.includes(text) ? text : null;
}

function normalizeText(value, max = 120) {
  const text = typeof value === "string" ? value.trim() : "";
  return text ? text.slice(0, max) : null;
}

function normalizeCoordinate(item) {
  return {
    id: normalizeText(item.id),
    fact_key: normalizeText(item.fact_key)?.toLowerCase().replace(/\s+/g, "_") || null,
    thread: normalizeText(item.thread, 80),
    risk_level: normalizeLevel(item.risk_level, ["normal", "medium", "high"]),
    urgency_level: normalizeLevel(item.urgency_level, ["low", "normal", "high"]),
    tension_score:
      typeof item.tension_score === "number" && Number.isFinite(item.tension_score)
        ? Math.min(Math.max(item.tension_score, 0), 1)
        : null,
    response_posture: normalizeText(item.response_posture, 120)
  };
}

function normalizeRelation(item) {
  const relationType = String(item.relation_type || "").trim();
  const strength = typeof item.strength === "number" && Number.isFinite(item.strength)
    ? Math.min(Math.max(item.strength, 0), 1)
    : 0.5;
  return {
    source_id: normalizeText(item.source_id),
    target_id: normalizeText(item.target_id),
    relation_type: relationType === "contradiction" ? "contradicts" : relationType,
    strength,
    reason: normalizeText(item.reason, 200)
  };
}

async function callDeepSeek(batch) {
  const prompt = [
    "你是 Aelios 记忆库的 LMC-5 XYZEM 坐标回填器。只输出 JSON。",
    "给每条记忆补坐标：fact_key/thread/risk_level/urgency_level/tension_score/response_posture。",
    "fact_key 只用于稳定事实槽；不确定就 null，不要硬编。",
    "risk_level 只能 normal/medium/high；urgency_level 只能 low/normal/high；tension_score 是 0-1。",
    "候选可能包含成年人自愿亲密偏好；只按事实记忆中性分类，不续写、不安全审查删除。",
    "可以输出关系候选。same_topic/temporal_sequence/in_thread 等安全关系可作为 apply；contradicts/cause_effect/supports 只能作为 review。",
    "JSON 结构：",
    JSON.stringify({
      memories: [{ id: "mem_x", fact_key: "project:aelios", thread: "aelios", risk_level: "normal", urgency_level: "normal", tension_score: 0.2, response_posture: "直接给技术判断" }],
      relations: [{ source_id: "mem_x", target_id: "mem_y", relation_type: "same_topic", strength: 0.7, reason: "同主题" }]
    }),
    "输入记忆：",
    JSON.stringify(batch.map(compactMemory))
  ].join("\n");

  const response = await fetchJson(`${deepseekBase}/chat/completions`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${deepseekApiKey}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: "你是严格 JSON 生成器。只输出 JSON。" },
        { role: "user", content: prompt }
      ],
      temperature: 0,
      max_tokens: 5000,
      response_format: { type: "json_object" },
      stream: false
    })
  });
  const content = response.choices?.[0]?.message?.content || response.choices?.[0]?.message?.reasoning_content || "";
  return JSON.parse(content);
}

function buildDeterministicRelations(memories, coordinates) {
  const byId = new Map(coordinates.map((item) => [item.id, item]));
  const relations = [];
  for (let index = 1; index < memories.length; index += 1) {
    relations.push({
      source_id: memories[index - 1].id,
      target_id: memories[index].id,
      relation_type: "temporal_sequence",
      strength: 0.45,
      reason: "created_at order in backfill batch"
    });
  }
  const groups = new Map();
  for (const memory of memories) {
    const coord = byId.get(memory.id);
    const key = coord?.thread || coord?.fact_key;
    if (!key) continue;
    const group = groups.get(key) || [];
    group.push(memory.id);
    groups.set(key, group);
  }
  for (const ids of groups.values()) {
    for (let index = 1; index < ids.length; index += 1) {
      relations.push({
        source_id: ids[0],
        target_id: ids[index],
        relation_type: "same_topic",
        strength: 0.62,
        reason: "shared thread/fact_key from backfill"
      });
    }
  }
  return relations;
}

function sqlString(value) {
  if (value === null || value === undefined) return "NULL";
  return `'${String(value).replace(/'/g, "''")}'`;
}

async function runCommand(command, args) {
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: "inherit" });
    child.on("exit", (code) => code === 0 ? resolve() : reject(new Error(`${command} ${args.join(" ")} exited ${code}`)));
    child.on("error", reject);
  });
}

async function exportD1Backup() {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const output = `${outputDir}/d1-${databaseName}-before-xyzem-backfill-${timestamp}.sql`;
  await mkdir(outputDir, { recursive: true });
  await runCommand("npx", ["wrangler", "d1", "export", databaseName, "--remote", "--output", output]);
  return output;
}

async function executeD1Sql(sql) {
  await runCommand("npx", ["wrangler", "d1", "execute", databaseName, "--remote", "--command", sql]);
}

async function applyPlan(plan) {
  const backupPath = await exportD1Backup();
  let patched = 0;
  for (const item of plan.memories) {
    await aelios(`/v1/memory/${encodeURIComponent(item.id)}`, {
      method: "PATCH",
      body: JSON.stringify({
        namespace,
        fact_key: item.fact_key,
        thread: item.thread,
        risk_level: item.risk_level,
        urgency_level: item.urgency_level,
        tension_score: item.tension_score,
        response_posture: item.response_posture
      })
    });
    patched += 1;
    if (patched % 50 === 0) console.log(`patched ${patched}/${plan.memories.length}`);
  }

  let safeRelations = 0;
  let reviewRelations = 0;
  for (const relation of plan.relations.slice(0, maxRelationCandidates)) {
    if (SAFE_RELATIONS.has(relation.relation_type)) {
      const id = `rel_${randomUUID()}`;
      await executeD1Sql(
        `INSERT OR IGNORE INTO memory_relations (id, namespace, source_id, target_id, relation_type, strength, created_at) VALUES (${sqlString(id)}, ${sqlString(namespace)}, ${sqlString(relation.source_id)}, ${sqlString(relation.target_id)}, ${sqlString(relation.relation_type)}, ${Number(relation.strength || 0.5)}, ${sqlString(new Date().toISOString())});`
      );
      safeRelations += 1;
    } else if (REVIEW_RELATIONS.has(relation.relation_type)) {
      const id = `evt_${randomUUID()}`;
      await executeD1Sql(
        `INSERT INTO memory_events (id, namespace, event_type, memory_id, payload_json, created_at) VALUES (${sqlString(id)}, ${sqlString(namespace)}, 'y_relation_review', NULL, ${sqlString(JSON.stringify(relation))}, ${sqlString(new Date().toISOString())});`
      );
      reviewRelations += 1;
    }
  }
  return { backupPath, patched, safeRelations, reviewRelations };
}

await mkdir(outputDir, { recursive: true });

let plan;
if (resumePath) {
  plan = JSON.parse(await readFile(resumePath, "utf8"));
} else {
  const memories = await listMemories();
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const planPath = `${outputDir}/xyzem-backfill-plan-${timestamp}.json`;
  const batches = [];
  const allCoordinates = [];
  const allRelations = [];

  for (let start = 0, batchIndex = 0; start < memories.length && batchIndex < limitBatches; start += batchSize, batchIndex += 1) {
    const batch = memories.slice(start, start + batchSize);
    console.log(`backfill batch ${batchIndex + 1}: ${start + 1}-${start + batch.length}/${memories.length}`);
    const raw = await callDeepSeek(batch);
    const coordinates = (Array.isArray(raw.memories) ? raw.memories : []).map(normalizeCoordinate).filter((item) => item.id);
    const relations = [
      ...(Array.isArray(raw.relations) ? raw.relations : []).map(normalizeRelation),
      ...buildDeterministicRelations(batch, coordinates)
    ].filter((item) => item.source_id && item.target_id && item.source_id !== item.target_id);
    allCoordinates.push(...coordinates);
    allRelations.push(...relations);
    batches.push({ batchIndex, ids: batch.map((memory) => memory.id), coordinates: coordinates.length, relations: relations.length });
    await writeFile(planPath, JSON.stringify({ namespace, model, apply, batches, memories: allCoordinates, relations: allRelations }, null, 2));
  }
  plan = { namespace, model, apply, batches, memories: allCoordinates, relations: allRelations, planPath };
}

const safeCount = plan.relations.filter((item) => SAFE_RELATIONS.has(item.relation_type)).length;
const reviewCount = plan.relations.filter((item) => REVIEW_RELATIONS.has(item.relation_type)).length;
console.log(JSON.stringify({
  apply,
  namespace,
  memories: plan.memories.length,
  relations: plan.relations.length,
  safeRelations: safeCount,
  reviewRelations: reviewCount,
  planPath: plan.planPath || resumePath
}, null, 2));

if (apply) {
  const result = await applyPlan(plan);
  console.log(JSON.stringify({ applied: true, ...result }, null, 2));
}
