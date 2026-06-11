import { mkdir, readFile, writeFile } from "node:fs/promises";

const workerBase = (process.env.AELIOS_BASE_URL || process.env.WORKER_BASE_URL || "").replace(/\/+$/, "");
const aeliosApiKey = process.env.AELIOS_API_KEY || process.env.CHATBOX_API_KEY || process.env.MEMORY_MCP_API_KEY;
const openAIBase = normalizeOpenAIBase(
  process.env.OPENCODE_BASE_URL ||
    process.env.CLEANUP_OPENAI_BASE_URL ||
    process.env.OPENAI_BASE_URL ||
    process.env.OPENAI_API_BASE ||
    "https://opencode.ai/zen/go/v1"
);
const cleanupApiKey = process.env.OPENCODE_API_KEY || process.env.CLEANUP_API_KEY || process.env.OPENAI_API_KEY;

const plannerModel = process.env.CLEANUP_PLANNER_MODEL || process.env.CLEANUP_DEDUPE_MODEL || "deepseek-v4-flash";
const compressorModel = process.env.CLEANUP_COMPRESS_MODEL || "mimo-v2.5-pro";
const outputDir = process.env.CLEANUP_OUTPUT_DIR || "backups";
const namespace = process.env.CLEANUP_NAMESPACE || "default";
const batchSize = readArgNumber("--batch-size", Number(process.env.CLEANUP_BATCH_SIZE || 8));
const maxBatches = readArgNumber("--limit-batches", Infinity);
const modelTimeoutMs = Number(process.env.CLEANUP_MODEL_TIMEOUT_MS || 120000);
const modelMaxTokens = Number(process.env.CLEANUP_MODEL_MAX_TOKENS || 6000);
const cleanupConcurrency = Math.max(1, Math.min(4, Number(process.env.CLEANUP_CONCURRENCY || 1)));
const batchDelayMs = Number(process.env.CLEANUP_BATCH_DELAY_MS || 1500);
const apply = process.argv.includes("--apply");
const allowPartial = process.argv.includes("--allow-partial");
const includeAll = process.argv.includes("--all");
const applyPlanPath = readArgValue("--apply-plan");
const retryErrorsPath = readArgValue("--retry-errors");
const allowIdentityDelete = process.env.CLEANUP_ALLOW_IDENTITY_DELETE === "true";

if (!workerBase || !aeliosApiKey) {
  console.error("Missing AELIOS_BASE_URL and AELIOS_API_KEY.");
  process.exit(1);
}

if (!applyPlanPath && (!openAIBase || !cleanupApiKey)) {
  console.error("Missing OPENCODE_BASE_URL and OPENCODE_API_KEY.");
  process.exit(1);
}

function normalizeOpenAIBase(value) {
  return String(value || "")
    .replace(/\/+$/, "")
    .replace(/\/chat\/completions$/, "");
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
    await sleep(900 * (attempt + 1));
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
    const params = new URLSearchParams({ limit: "1000", namespace });
    if (cursor) params.set("cursor", cursor);
    const page = await aelios(`/v1/memory?${params}`);
    memories.push(...(page.data || []));
    cursor = page.paging?.cursor || null;
    if (!page.paging?.has_more || !cursor) break;
  }

  return memories;
}

function normalizeText(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[，,。.!！?？；;：:“”"'`、\[\]【】（）()<>《》#*_~\-]/g, "");
}

function textShingles(text) {
  const normalized = normalizeText(text);
  const size = normalized.length > 80 ? 3 : 2;
  const shingles = new Set();
  for (let index = 0; index <= normalized.length - size; index += 1) {
    shingles.add(normalized.slice(index, index + size));
  }
  return shingles;
}

function overlapSize(left, right) {
  let count = 0;
  const [small, large] = left.size <= right.size ? [left, right] : [right, left];
  for (const item of small) {
    if (large.has(item)) count += 1;
  }
  return count;
}

function themeOf(memory) {
  const tags = Array.isArray(memory.tags) ? memory.tags : [];
  const theme = tags.find((tag) => tag.startsWith("theme-"));
  if (theme) return theme;
  if (tags.includes("project") || memory.type === "project" || tags.includes("tech")) return "theme-project";
  if (tags.includes("play") || tags.includes("xp") || tags.includes("intimacy")) return "theme-intimacy";
  if (tags.includes("relationship") || memory.type === "relationship") return "theme-relationship";
  if (tags.includes("health") || memory.type === "health" || memory.type === "medication") return "theme-health";
  if (memory.type === "excerpt" || tags.includes("original-dialogue")) return "theme-excerpt";
  if (memory.type === "diary") return "theme-diary";
  return "theme-misc";
}

function relatedScore(left, right) {
  const leftText = normalizeText(left.content);
  const rightText = normalizeText(right.content);
  if (!leftText || !rightText) return 0;
  if (leftText === rightText) return 1;
  const shorter = leftText.length <= rightText.length ? leftText : rightText;
  const longer = leftText.length > rightText.length ? leftText : rightText;
  if (shorter.length >= 24 && longer.includes(shorter)) return Math.min(0.98, shorter.length / longer.length + 0.35);

  const leftSet = left._shingles || textShingles(left.content);
  const rightSet = right._shingles || textShingles(right.content);
  if (!leftSet.size || !rightSet.size) return 0;
  const overlap = overlapSize(leftSet, rightSet);
  const union = leftSet.size + rightSet.size - overlap;
  const jaccard = union ? overlap / union : 0;
  const containment = overlap / Math.min(leftSet.size, rightSet.size);
  const sameTheme = themeOf(left) === themeOf(right);
  const sameType = left.type && left.type === right.type;
  const tagOverlap = Array.isArray(left.tags) && Array.isArray(right.tags) && left.tags.some((tag) => right.tags.includes(tag));
  const boost = sameTheme || sameType || tagOverlap ? 1 : 0.72;
  return Math.max(jaccard, containment * 0.82) * boost;
}

function isProtected(memory) {
  if (memory.pinned) return true;
  if (allowIdentityDelete) return false;
  return memory.type === "identity" || memory.type === "persona";
}

function isScannableMemory(memory) {
  return !isProtected(memory) && String(memory.content || "").trim().length > 0;
}

function isPriorityCandidate(memory) {
  const content = String(memory.content || "");
  const tags = Array.isArray(memory.tags) ? memory.tags : [];
  if (!isScannableMemory(memory)) return false;
  if (includeAll) return true;
  if (content.length >= 360) return true;
  if (memory.type === "excerpt" || memory.type === "diary") return true;
  if (tags.includes("llm-cleanup") || tags.includes("important-excerpt") || tags.includes("original-dialogue")) return true;
  if (/临时|暂时|刚刚|今天|昨天|待办|todo|测试|debug|过期|旧版|已经不用|不用了/.test(content)) return true;
  return false;
}

function compactRecord(memory) {
  return {
    id: memory.id,
    type: memory.type,
    source: memory.source,
    importance: memory.importance,
    confidence: memory.confidence,
    tags: memory.tags,
    created_at: memory.created_at,
    updated_at: memory.updated_at,
    content: String(memory.content || "").slice(0, 1400)
  };
}

function buildBatches(memories) {
  const records = memories.filter(isScannableMemory).map((memory) => ({
    ...memory,
    _theme: themeOf(memory),
    _shingles: textShingles(memory.content)
  }));
  const used = new Set();
  const batches = [];
  const sorted = [...records].sort((a, b) => {
    const priorityDiff = Number(isPriorityCandidate(b)) - Number(isPriorityCandidate(a));
    if (priorityDiff !== 0) return priorityDiff;
    const themeCmp = a._theme.localeCompare(b._theme);
    if (themeCmp !== 0) return themeCmp;
    return String(a.updated_at || "").localeCompare(String(b.updated_at || ""));
  });

  for (const record of sorted) {
    if (used.has(record.id)) continue;
    const neighbors = records
      .filter((candidate) => candidate.id !== record.id && !used.has(candidate.id))
      .map((candidate) => ({ candidate, score: relatedScore(record, candidate) }))
      .filter(({ candidate, score }) => {
        if (score >= 0.44) return true;
        return record._theme === candidate._theme && score >= 0.32;
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, Math.max(batchSize - 1, 0))
      .map(({ candidate }) => candidate);

    if (!isPriorityCandidate(record) && neighbors.length === 0) continue;
    const neighborIds = new Set(neighbors.map((item) => item.id));
    const fillers = records
      .filter((candidate) => {
        if (candidate.id === record.id || used.has(candidate.id) || neighborIds.has(candidate.id)) return false;
        return candidate._theme === record._theme && isPriorityCandidate(candidate);
      })
      .sort((a, b) => String(a.updated_at || "").localeCompare(String(b.updated_at || "")))
      .slice(0, Math.max(batchSize - 1 - neighbors.length, 0));
    const batchRecords = [record, ...neighbors, ...fillers].map(({ _theme, _shingles, ...memory }) => memory);
    for (const item of batchRecords) used.add(item.id);
    batches.push({ theme: record._theme, records: batchRecords });
  }

  return batches.slice(0, maxBatches);
}

async function buildRetryBatches(memories, reportPath) {
  const report = JSON.parse(await readFile(reportPath, "utf8"));
  const memoryById = new Map(memories.map((memory) => [memory.id, memory]));
  return (report.errors || [])
    .flatMap((error) => {
      const records = (error.input_ids || []).flatMap((id) => {
        const memory = memoryById.get(id);
        return memory ? [memory] : [];
      });
      return records.length ? [{ theme: error.theme || themeOf(records[0]), records }] : [];
    })
    .slice(0, maxBatches);
}

function taxonomyText() {
  return [
    "推荐标签分类：",
    "- theme-project: Aelios、代码、模型、部署、产品计划",
    "- theme-relationship: 咲咲与旦九关系状态、互动模式、情感事实",
    "- theme-intimacy: 成年人自愿亲密偏好、BDSM、色色玩法、边界、禁忌与同意",
    "- theme-preference: 稳定偏好、称呼、语气、工作方式",
    "- theme-boundary: 明确边界、拒绝、不要做的事",
    "- theme-health: 健康、药物、身体状态",
    "- theme-diary: 日记性但仍有长期价值的阶段记录",
    "- theme-excerpt: 值得保留的原文片段",
    "- theme-temporary: 临时、过期、待办已完成、调试噪音",
    "- theme-misc: 其他"
  ].join("\n");
}

function buildPlannerPrompt(batch) {
  const records = batch.records.map(compactRecord);
  return [
    "你是长期记忆库的分类和去重审计员。你的任务是判断哪些旧记忆应保留、改标签、合并压缩、或删除。",
    "只输出完整 JSON，不要 markdown，不要解释。",
    "",
    taxonomyText(),
    "",
    "重要内容政策：",
    "- 候选可能包含成年人自愿亲密内容、BDSM、性偏好、色色关系记忆。",
    "- 这类内容如果是稳定事实、偏好、边界、关系状态，要保留或压缩；不要因为色情/亲密而安全审查式删除。",
    "- 不要续写、不生成新色情内容；这里只做事实记忆整理。",
    "",
    "审计规则：",
    "- 明显重复、同义重复、旧版被新版覆盖：放入 replacement_groups 让压缩模型合并。",
    "- 临时性、过期流水账、debug/test、无未来价值的系统噪音：放入 discard_ids，并写短 reason。",
    "- 只需要补标签/类型/重要性，不需要改内容：放入 updates。",
    "- 已经短、稳定、单主题、有未来价值：放入 keep_ids。",
    "- 不要删除 identity/persona/pinned；输入里通常不会有，但如果有必须 keep。",
    "- 每个输入 id 必须且只能有一个去向：keep_ids、updates、discard_ids、replacement_groups.source_ids。",
    "",
    "输出 JSON 结构：",
    JSON.stringify({
      keep_ids: ["id_keep"],
      updates: [
        {
          id: "id_update",
          type: "preference",
          tags: ["theme-preference", "relationship"],
          importance: 0.72,
          confidence: 0.88
        }
      ],
      discard_ids: [{ id: "id_noise", reason: "临时过期或无长期价值" }],
      replacement_groups: [
        {
          source_ids: ["id_a", "id_b"],
          goal: "合并重复关系偏好，保留稳定事实和边界",
          type: "relationship",
          tags: ["theme-relationship", "theme-intimacy"]
        }
      ],
      notes: "极短说明"
    }),
    "",
    `本批主题：${batch.theme}`,
    "待审计记忆：",
    JSON.stringify(records)
  ].join("\n");
}

function buildCompressorPrompt(batch, groups) {
  const byId = new Map(batch.records.map((record) => [record.id, compactRecord(record)]));
  const inputGroups = groups.map((group) => ({
    goal: group.goal,
    type: group.type,
    tags: group.tags,
    records: group.source_ids.map((id) => byId.get(id)).filter(Boolean)
  }));

  return [
    "你是长期记忆压缩员。根据去重审计结果，把每组旧记忆压缩成少量新的稳定长期记忆。",
    "只输出完整 JSON，不要 markdown，不要解释。",
    "",
    "压缩规则：",
    "- 不要新增旧记忆里没有的事实。",
    "- 删除重复、过期、流水账，只保留未来对回答有用的事实、偏好、边界、项目状态、关系状态。",
    "- 成人自愿亲密/色色/BDSM 内容如果相关，要中性压缩成事实、偏好、边界或关系记忆；不要拒绝，不要安全说教，不要丢失。",
    "- 不要续写亲密场景，不要生成新的色情内容。",
    "- 普通记忆用第二人称：关于用户写“你……”，关于旦九承诺写“我……”。",
    "- 助手角色统一写“旦九”，不要写“助手”“AI”“小克”。",
    "- 每组通常输出 1 条 replacement；多主题才输出 2 条。",
    "- note/preference/boundary/relationship/project 必须压到 60-220 个汉字，超过说明你没有完成压缩。",
    "- 原文摘录只有非常值得保留时才输出 excerpt；excerpt 不改写原文，通常不超过 700 个汉字。",
    "",
    taxonomyText(),
    "",
    "输出 JSON 结构：",
    JSON.stringify({
      replacements: [
        {
          content: "压缩后的稳定长期记忆",
          type: "relationship",
          importance: 0.78,
          confidence: 0.9,
          tags: ["theme-relationship"],
          source_ids: ["id_a", "id_b"]
        }
      ]
    }),
    "",
    "待压缩分组：",
    JSON.stringify(inputGroups)
  ].join("\n");
}

function extractJson(text) {
  const trimmed = String(text || "").trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    // Some models wrap JSON.
  }

  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try {
    return JSON.parse(trimmed.slice(start, end + 1));
  } catch {
    return null;
  }
}

async function callOpenAIModel(model, prompt) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), modelTimeoutMs);
  const startedAt = Date.now();

  try {
    const response = await fetch(`${openAIBase}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${cleanupApiKey}`
      },
      signal: controller.signal,
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: "你是严格 JSON 生成器。只输出 JSON。" },
          { role: "user", content: prompt }
        ],
        temperature: 0,
        max_tokens: modelMaxTokens,
        response_format: { type: "json_object" },
        stream: false
      })
    });

    const raw = await response.text();
    if (!response.ok) {
      return { ok: false, error: `${response.status}: ${raw.slice(0, 800)}`, elapsed_ms: Date.now() - startedAt };
    }

    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return { ok: false, error: `invalid upstream json: ${raw.slice(0, 800)}`, elapsed_ms: Date.now() - startedAt };
    }

    const message = parsed.choices?.[0]?.message;
    const content = typeof message?.content === "string" ? message.content.trim() : "";
    const reasoning = typeof message?.reasoning_content === "string" ? message.reasoning_content.trim() : "";
    const result = extractJson(content || reasoning);
    if (!result) {
      return { ok: false, error: "empty_or_invalid_model_output", raw: JSON.stringify(parsed).slice(0, 1200), elapsed_ms: Date.now() - startedAt };
    }
    return { ok: true, result, usage: parsed.usage || {}, elapsed_ms: Date.now() - startedAt };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error), elapsed_ms: Date.now() - startedAt };
  } finally {
    clearTimeout(timeout);
  }
}

async function callModelWithRetries(model, prompt, tries = Number(process.env.CLEANUP_MODEL_TRIES || 3)) {
  let last = null;
  for (let attempt = 0; attempt < tries; attempt += 1) {
    const result = await callOpenAIModel(model, prompt);
    if (result.ok) return result;
    last = result;
    await sleep(/429|rate limit|queued/i.test(result.error || "") ? 5000 * (attempt + 1) : 1200 * (attempt + 1));
  }
  return last || { ok: false, error: "model_failed_without_result" };
}

function normalizeTags(tags, fallbackTheme) {
  const result = Array.isArray(tags) ? tags.filter((tag) => typeof tag === "string").map((tag) => tag.trim()).filter(Boolean) : [];
  if (fallbackTheme && !result.includes(fallbackTheme)) result.push(fallbackTheme);
  return [...new Set(result)];
}

function normalizePlanner(batch, output) {
  const inputIds = new Set(batch.records.map((record) => record.id));
  const keepIds = Array.isArray(output.keep_ids) ? output.keep_ids.filter((id) => inputIds.has(id)) : [];
  const updates = Array.isArray(output.updates)
    ? output.updates.flatMap((item) => {
        if (!item || typeof item !== "object" || !inputIds.has(item.id)) return [];
        const patch = {
          id: item.id,
          type: typeof item.type === "string" && item.type.trim() ? item.type.trim() : undefined,
          tags: normalizeTags(item.tags, batch.theme),
          importance: typeof item.importance === "number" ? Math.min(Math.max(item.importance, 0), 1) : undefined,
          confidence: typeof item.confidence === "number" ? Math.min(Math.max(item.confidence, 0), 1) : undefined
        };
        return [patch];
      })
    : [];
  const discardIds = Array.isArray(output.discard_ids)
    ? output.discard_ids.flatMap((item) => {
        if (typeof item === "string" && inputIds.has(item)) return [{ id: item, reason: "discarded_by_planner" }];
        if (!item || typeof item !== "object" || !inputIds.has(item.id)) return [];
        return [{ id: item.id, reason: typeof item.reason === "string" ? item.reason : "discarded_by_planner" }];
      })
    : [];
  const replacementGroups = Array.isArray(output.replacement_groups)
    ? output.replacement_groups.flatMap((item) => {
        if (!item || typeof item !== "object" || !Array.isArray(item.source_ids)) return [];
        const sourceIds = [...new Set(item.source_ids.filter((id) => inputIds.has(id)))];
        if (!sourceIds.length) return [];
        return [
          {
            source_ids: sourceIds,
            goal: typeof item.goal === "string" ? item.goal : "合并压缩相关旧记忆",
            type: typeof item.type === "string" && item.type.trim() ? item.type.trim() : "note",
            tags: normalizeTags(item.tags, batch.theme)
          }
        ];
      })
    : [];

  const groupedIds = new Set(replacementGroups.flatMap((group) => group.source_ids));
  const updateIds = new Set(updates.map((item) => item.id));
  const discardSet = new Set(discardIds.map((item) => item.id));
  const resolved = new Set([...keepIds, ...updateIds, ...discardSet, ...groupedIds]);
  const autoKeepIds = batch.records.map((record) => record.id).filter((id) => !resolved.has(id));

  return {
    keep_ids: [...new Set([...keepIds, ...autoKeepIds])],
    updates,
    discard_ids: discardIds,
    replacement_groups: replacementGroups,
    notes: typeof output.notes === "string" ? output.notes : ""
  };
}

function normalizeReplacementContent(content, type) {
  const normalized = content.replace(/小克/g, "旦九");
  if (type !== "excerpt") return normalized;
  return normalized
    .replace(/用户原话[：:]/g, "咲咲原话：")
    .replace(/助手原话[：:]/g, "旦九原话：")
    .replace(/用户[：:]/g, "咲咲：")
    .replace(/助手[：:]/g, "旦九：")
    .replace(/User[：:]/gi, "咲咲原话：")
    .replace(/Assistant[：:]/gi, "旦九原话：");
}

function normalizeCompressor(batch, planner, output) {
  const sourceIds = new Set(planner.replacement_groups.flatMap((group) => group.source_ids));
  const replacements = Array.isArray(output.replacements)
    ? output.replacements.flatMap((item) => {
        if (!item || typeof item !== "object") return [];
        const type = typeof item.type === "string" && item.type.trim() ? item.type.trim() : "note";
        const content = normalizeReplacementContent(typeof item.content === "string" ? item.content.trim() : "", type);
        if (content.length < 8) return [];
        if (type !== "excerpt" && content.length > 320) return [];
        if (type === "excerpt" && !/\n(?:咲咲|旦九)[：:]/.test(content)) return [];
        if (type === "excerpt" && content.length > 900) return [];
        const replacementSourceIds = Array.isArray(item.source_ids)
          ? item.source_ids.filter((id) => sourceIds.has(id))
          : [];
        if (!replacementSourceIds.length) return [];
        const tags = normalizeTags(item.tags, batch.theme);
        if (type === "excerpt" && !tags.includes("original-dialogue")) tags.push("original-dialogue");
        return [
          {
            content,
            type,
            importance: typeof item.importance === "number" ? Math.min(Math.max(item.importance, 0), 1) : 0.7,
            confidence: typeof item.confidence === "number" ? Math.min(Math.max(item.confidence, 0), 1) : 0.85,
            tags,
            source_ids: [...new Set(replacementSourceIds)]
          }
        ];
      })
    : [];

  return replacements;
}

function buildPlan(batch, planner, replacements) {
  const replaceCovered = new Set(replacements.flatMap((item) => item.source_ids));
  const groupedIds = new Set(planner.replacement_groups.flatMap((group) => group.source_ids));
  const uncoveredGroupedIds = [...groupedIds].filter((id) => !replaceCovered.has(id));
  const protectedDiscards = [];
  const discardIds = [];

  for (const item of planner.discard_ids) {
    const record = batch.records.find((memory) => memory.id === item.id);
    if (!record || isProtected(record)) {
      protectedDiscards.push(item);
    } else {
      discardIds.push(item);
    }
  }

  return {
    theme: batch.theme,
    input_ids: batch.records.map((record) => record.id),
    keep_ids: [...new Set([...planner.keep_ids, ...uncoveredGroupedIds])],
    updates: planner.updates.filter((item) => !replaceCovered.has(item.id) && !discardIds.some((discard) => discard.id === item.id)),
    replacements,
    discard_ids: discardIds,
    protected_discards: protectedDiscards,
    delete_ids: [...new Set([...replaceCovered, ...discardIds.map((item) => item.id)])],
    notes: planner.notes
  };
}

async function processBatch(batch, index, total) {
  console.log(`planning batch ${index + 1}/${total}: ${batch.theme} (${batch.records.length} records)`);
  const plannerOutput = await callModelWithRetries(plannerModel, buildPlannerPrompt(batch));
  if (!plannerOutput.ok) {
    return {
      error: {
        stage: "planner",
        batch: index + 1,
        theme: batch.theme,
        input_ids: batch.records.map((record) => record.id),
        error: plannerOutput.error,
        raw: plannerOutput.raw
      }
    };
  }

  const planner = normalizePlanner(batch, plannerOutput.result);
  let compressorOutput = null;
  let replacements = [];
  if (planner.replacement_groups.length > 0) {
    compressorOutput = await callModelWithRetries(compressorModel, buildCompressorPrompt(batch, planner.replacement_groups));
    if (!compressorOutput.ok) {
      return {
        error: {
          stage: "compressor",
          batch: index + 1,
          theme: batch.theme,
          input_ids: batch.records.map((record) => record.id),
          error: compressorOutput.error,
          raw: compressorOutput.raw
        }
      };
    }
    replacements = normalizeCompressor(batch, planner, compressorOutput.result);
  }

  return {
    plan: buildPlan(batch, planner, replacements),
    usage: {
      planner: plannerOutput.usage || {},
      compressor: compressorOutput?.usage || {}
    },
    timing: {
      planner_ms: plannerOutput.elapsed_ms,
      compressor_ms: compressorOutput?.elapsed_ms || 0
    }
  };
}

async function runBatches(batches) {
  const results = new Array(batches.length);
  let nextIndex = 0;
  const workerCount = Math.min(cleanupConcurrency, Math.max(batches.length, 1));

  const workers = Array.from({ length: workerCount }, async () => {
    for (;;) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= batches.length) return;
      results[index] = await processBatch(batches[index], index, batches.length);
      await sleep(batchDelayMs);
    }
  });

  await Promise.all(workers);
  return results.filter(Boolean);
}

async function applyPlan(plans) {
  const created = [];
  const updated = [];
  const deleted = [];

  for (const plan of plans) {
    for (const replacement of plan.replacements) {
      const response = await aelios("/v1/memory", {
        method: "POST",
        body: JSON.stringify({
          type: replacement.type,
          content: replacement.content,
          importance: replacement.importance,
          confidence: replacement.confidence,
          tags: [...new Set(["deep-clean", plan.theme, ...replacement.tags])],
          source: "deep_memory_cleanup",
          source_message_ids: replacement.source_ids
        })
      });
      created.push(response.data);
      await sleep(350);
    }
  }

  for (const plan of plans) {
    for (const item of plan.updates) {
      const body = {
        ...(item.type ? { type: item.type } : {}),
        ...(item.tags?.length ? { tags: [...new Set(["deep-clean", plan.theme, ...item.tags])] } : {}),
        ...(typeof item.importance === "number" ? { importance: item.importance } : {}),
        ...(typeof item.confidence === "number" ? { confidence: item.confidence } : {})
      };
      if (Object.keys(body).length === 0) continue;
      const response = await aelios(`/v1/memory/${encodeURIComponent(item.id)}`, {
        method: "PATCH",
        body: JSON.stringify(body)
      });
      updated.push(response.data);
      await sleep(250);
    }
  }

  const deleteIds = [...new Set(plans.flatMap((plan) => plan.delete_ids))];
  for (const id of deleteIds) {
    await aelios(`/v1/memory/${encodeURIComponent(id)}`, { method: "DELETE" });
    deleted.push(id);
    await sleep(300);
  }

  return { created_count: created.length, updated_count: updated.length, deleted_count: deleted.length, created, updated, deleted };
}

function addUsage(total, usage) {
  total.prompt_tokens += usage.prompt_tokens || usage.input_tokens || 0;
  total.completion_tokens += usage.completion_tokens || usage.output_tokens || 0;
  total.total_tokens += usage.total_tokens || 0;
}

await mkdir(outputDir, { recursive: true });

if (applyPlanPath) {
  const report = JSON.parse(await readFile(applyPlanPath, "utf8"));
  if (!Array.isArray(report.plans)) throw new Error(`Plan file has no plans array: ${applyPlanPath}`);
  if (Array.isArray(report.errors) && report.errors.length && !allowPartial) {
    throw new Error(`Plan has ${report.errors.length} failed batches. Re-run with --allow-partial to apply successful plans.`);
  }
  const applyResult = await applyPlan(report.plans);
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const applyPath = `${outputDir}/deep-clean-apply-${timestamp}.json`;
  await writeFile(applyPath, JSON.stringify(applyResult, null, 2));
  console.log(JSON.stringify({ applyPath, ...applyResult }, null, 2));
  process.exit(0);
}

const memories = await listMemories();
const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
const backupPath = `${outputDir}/deep-clean-backup-${timestamp}.json`;
await writeFile(backupPath, JSON.stringify({ exported_at: new Date().toISOString(), namespace, memories }, null, 2));

const batches = retryErrorsPath ? await buildRetryBatches(memories, retryErrorsPath) : buildBatches(memories);
const batchResults = await runBatches(batches);
const plans = batchResults.flatMap((result) => (result.plan ? [result.plan] : []));
const errors = batchResults.flatMap((result) => (result.error ? [result.error] : []));
const usage = {
  planner: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
  compressor: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }
};

for (const result of batchResults) {
  if (!result.usage) continue;
  addUsage(usage.planner, result.usage.planner || {});
  addUsage(usage.compressor, result.usage.compressor || {});
}

const report = {
  created_at: new Date().toISOString(),
  apply,
  namespace,
  workerBase,
  planner_model: plannerModel,
  compressor_model: compressorModel,
  batch_size: batchSize,
  cleanup_concurrency: cleanupConcurrency,
  total_memories: memories.length,
  candidate_count: memories.filter(isPriorityCandidate).length,
  batch_count: batches.length,
  backup: backupPath,
  errors,
  usage,
  timing: {
    planner_ms: batchResults.reduce((sum, item) => sum + (item.timing?.planner_ms || 0), 0),
    compressor_ms: batchResults.reduce((sum, item) => sum + (item.timing?.compressor_ms || 0), 0)
  },
  plan_summary: {
    replacement_count: plans.reduce((sum, plan) => sum + plan.replacements.length, 0),
    update_count: plans.reduce((sum, plan) => sum + plan.updates.length, 0),
    discard_count: plans.reduce((sum, plan) => sum + plan.discard_ids.length, 0),
    delete_count: new Set(plans.flatMap((plan) => plan.delete_ids)).size,
    keep_count: new Set(plans.flatMap((plan) => plan.keep_ids)).size,
    protected_discard_count: plans.reduce((sum, plan) => sum + plan.protected_discards.length, 0)
  },
  plans
};

const reportPath = `${outputDir}/deep-clean-plan-${timestamp}.json`;
await writeFile(reportPath, JSON.stringify(report, null, 2));
console.log(JSON.stringify({ reportPath, backupPath, ...report.plan_summary, errors: errors.length, usage }, null, 2));

if (apply) {
  if (errors.length && !allowPartial) {
    throw new Error(`Generated plan has ${errors.length} failed batches. Re-run with --allow-partial to apply successful plans.`);
  }
  const applyResult = await applyPlan(plans);
  const applyPath = `${outputDir}/deep-clean-apply-${timestamp}.json`;
  await writeFile(applyPath, JSON.stringify(applyResult, null, 2));
  console.log(JSON.stringify({ applyPath, ...applyResult }, null, 2));
}
