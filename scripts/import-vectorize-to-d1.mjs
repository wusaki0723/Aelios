#!/usr/bin/env node

/**
 * One-time migration: import Vectorize-only memories into D1.
 *
 * This script reads all vectors from the Vectorize index, extracts memory
 * fields from metadata, and creates canonical D1 rows so that D1 becomes
 * the single source of truth.
 *
 * Usage:
 *   # Dry-run (default) — outputs plan file, does not write D1
 *   node scripts/import-vectorize-to-d1.mjs
 *
 *   # Apply — actually writes D1 rows (--apply first runs d1 export backup)
 *   node scripts/import-vectorize-to-d1.mjs --apply
 *
 * Required env vars:
 *   CLOUDFLARE_ACCOUNT_ID  (or CF_ACCOUNT_ID)
 *   CLOUDFLARE_API_TOKEN   (or CF_API_TOKEN)
 *
 * Optional:
 *   VECTORIZE_INDEX_NAME   (default: memo-kb)
 *   D1_DATABASE_NAME       (default: companion_memory_proxy)
 *   NAMESPACE              (default: default)
 *   BATCH_SIZE             (default: 20)
 */

import { mkdir, writeFile, readFile } from "node:fs/promises";
import { execSync } from "node:child_process";

const accountId = process.env.CLOUDFLARE_ACCOUNT_ID || process.env.CF_ACCOUNT_ID;
const token = process.env.CLOUDFLARE_API_TOKEN || process.env.CF_API_TOKEN;
const vectorizeIndex = process.env.VECTORIZE_INDEX_NAME || "memo-kb";
const d1Database = process.env.D1_DATABASE_NAME || "companion_memory_proxy";
const namespace = process.env.NAMESPACE || "default";
const batchSize = Number(process.env.BATCH_SIZE || 20);
const apply = process.argv.includes("--apply");
const outputDir = process.env.OUTPUT_DIR || "backups";

if (!accountId || !token) {
  console.error("Missing CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN.");
  process.exit(1);
}

const cfHeaders = {
  authorization: `Bearer ${token}`,
  "content-type": "application/json",
};
const vectorizeBase = `https://api.cloudflare.com/client/v4/accounts/${accountId}/vectorize/v2/indexes/${vectorizeIndex}`;
const d1Base = `https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database`;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function cfGet(url, tries = 4) {
  let lastError = "";
  for (let i = 0; i < tries; i++) {
    const res = await fetch(url, { headers: cfHeaders });
    const text = await res.text();
    let json;
    try { json = JSON.parse(text); } catch { json = {}; }
    if (res.ok && json.success !== false) return json.result;
    lastError = `GET ${url} → ${res.status}: ${JSON.stringify(json.errors || json).slice(0, 500)}`;
    await sleep(500 * (i + 1));
  }
  throw new Error(lastError);
}

async function cfPost(url, body, tries = 4) {
  let lastError = "";
  for (let i = 0; i < tries; i++) {
    const res = await fetch(url, {
      method: "POST",
      headers: cfHeaders,
      body: JSON.stringify(body),
    });
    const text = await res.text();
    let json;
    try { json = JSON.parse(text); } catch { json = {}; }
    if (res.ok && json.success !== false) return json.result;
    lastError = `POST ${url} → ${res.status}: ${JSON.stringify(json.errors || json).slice(0, 500)}`;
    await sleep(500 * (i + 1));
  }
  throw new Error(lastError);
}

// ---------- Vectorize: list all vectors ----------

async function listAllVectorIds() {
  let cursor = null;
  const ids = [];
  let totalCount = null;

  for (;;) {
    const params = new URLSearchParams({ count: "100" });
    if (cursor) params.set("cursor", cursor);
    const result = await cfGet(`${vectorizeBase}/list?${params}`);
    totalCount = result.totalCount ?? result.total_count ?? totalCount;
    ids.push(...(result.vectors || []).map((v) => v.id).filter(Boolean));

    cursor = result.nextCursor || result.next_cursor || result.cursor || null;
    if (!result.isTruncated || !cursor) break;
  }

  return { ids, totalCount };
}

async function getVectorsWithMetadata(ids) {
  const vectors = [];
  for (let i = 0; i < ids.length; i += 20) {
    const batch = ids.slice(i, i + 20);
    const result = await cfGet(`${vectorizeBase}/get_by_ids`, {
      method: "POST",
      body: JSON.stringify({ ids: batch }),
    });
    // get_by_ids returns via cfPost
    for (const v of result || []) {
      vectors.push({
        id: v.id,
        namespace: v.namespace ?? null,
        metadata: v.metadata ?? {},
      });
    }
    if (i + 20 < ids.length) await sleep(100);
  }
  return vectors;
}

async function getVectorsBatch(ids) {
  const vectors = [];
  for (let i = 0; i < ids.length; i += 20) {
    const batch = ids.slice(i, i + 20);
    const result = await cfPost(`${vectorizeBase}/get_by_ids`, { ids: batch });
    if (Array.isArray(result)) {
      for (const v of result) {
        vectors.push({
          id: v.id,
          namespace: v.namespace ?? null,
          metadata: v.metadata ?? {},
        });
      }
    }
    if (i + 20 < ids.length) await sleep(100);
  }
  return vectors;
}

// ---------- D1: query existing ids ----------

async function d1Query(sql, params = []) {
  const result = await cfPost(`${d1Base}/${d1Database}/query`, { sql, params });
  if (Array.isArray(result)) {
    const allRows = [];
    for (const r of result) {
      if (Array.isArray(r.results)) allRows.push(...r.results);
    }
    return allRows;
  }
  return [];
}

async function getExistingD1Ids(ids) {
  const existing = new Set();
  for (let i = 0; i < ids.length; i += 90) {
    const batch = ids.slice(i, i + 90);
    const placeholders = batch.map(() => "?").join(",");
    const rows = await d1Query(
      `SELECT id FROM memories WHERE id IN (${placeholders})`,
      batch
    );
    for (const row of rows) existing.add(row.id);
    if (i + 90 < ids.length) await sleep(100);
  }
  return existing;
}

// ---------- Extract memory fields from vector metadata ----------

function readMeta(meta, key) {
  const v = meta[key];
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

function readMetaNum(meta, key, fallback) {
  const v = meta[key];
  if (typeof v === "number" && Number.isFinite(v)) return Math.min(Math.max(v, 0), 1);
  if (typeof v === "string") {
    const n = Number(v);
    if (Number.isFinite(n)) return Math.min(Math.max(n, 0), 1);
  }
  return fallback;
}

function readMetaBool(meta, key) {
  const v = meta[key];
  return v === true || v === "true" || v === 1;
}

function readMetaJsonArray(meta, key) {
  const v = meta[key];
  if (Array.isArray(v)) return JSON.stringify(v.filter((x) => typeof x === "string"));
  if (typeof v === "string" && v.trim()) {
    try {
      const parsed = JSON.parse(v);
      if (Array.isArray(parsed)) return JSON.stringify(parsed.filter((x) => typeof x === "string"));
    } catch {}
    return JSON.stringify([v.trim()]);
  }
  return "[]";
}

function extractMemoryId(vector) {
  const refId = readMeta(vector.metadata, "ref_id");
  if (refId) return refId;
  if (vector.id.startsWith("mem_")) return vector.id.slice(4);
  return null;
}

function extractMemoryContent(meta) {
  return readMeta(meta, "content") || readMeta(meta, "text") || readMeta(meta, "memory") || null;
}

function vectorToD1Row(vector) {
  const meta = vector.metadata;
  const id = extractMemoryId(vector);
  const content = extractMemoryContent(meta);
  if (!id || !content) return null;

  const now = new Date().toISOString();
  return {
    id,
    namespace: readMeta(meta, "namespace") || namespace,
    type: readMeta(meta, "type") || "note",
    content,
    summary: readMeta(meta, "summary"),
    importance: readMetaNum(meta, "importance", 0.5),
    confidence: readMetaNum(meta, "confidence", 0.8),
    status: readMeta(meta, "status") || "active",
    pinned: readMetaBool(meta, "pinned") ? 1 : 0,
    tags: readMetaJsonArray(meta, "tags"),
    source: readMeta(meta, "source_id") || readMeta(meta, "source") || "vectorize_import",
    source_message_ids: readMetaJsonArray(meta, "source_message_ids"),
    vector_id: vector.id,
    created_at: readMeta(meta, "created_at") || now,
    updated_at: readMeta(meta, "updated_at") || now,
    expires_at: readMeta(meta, "expires_at"),
    fact_key: readMeta(meta, "fact_key"),
    thread: readMeta(meta, "thread"),
    risk_level: readMeta(meta, "risk_level"),
    urgency_level: readMeta(meta, "urgency_level"),
    tension_score: typeof meta.tension_score === "number" ? meta.tension_score : null,
    response_posture: readMeta(meta, "response_posture"),
    audit_state: null,
    vector_sync_status: "synced",
  };
}

// ---------- D1 insert ----------

async function insertD1Row(row) {
  const sql = `INSERT OR IGNORE INTO memories (
    id, namespace, type, content, summary, importance, confidence, status,
    pinned, tags, source, source_message_ids, vector_id, created_at, updated_at, expires_at,
    fact_key, thread, risk_level, urgency_level, tension_score, response_posture,
    audit_state, vector_sync_status
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
  const params = [
    row.id, row.namespace, row.type, row.content, row.summary,
    row.importance, row.confidence, row.status, row.pinned, row.tags,
    row.source, row.source_message_ids, row.vector_id,
    row.created_at, row.updated_at, row.expires_at,
    row.fact_key, row.thread, row.risk_level, row.urgency_level,
    row.tension_score, row.response_posture,
    row.audit_state, row.vector_sync_status,
  ];
  await d1Query(sql, params);
}

// ---------- D1 backup ----------

function backupD1() {
  console.log("Backing up D1 before apply...");
  try {
    execSync(
      `npx wrangler d1 export ${d1Database} --output ${outputDir}/d1-pre-import-${Date.now()}.sql --yes`,
      { stdio: "inherit", timeout: 120_000 }
    );
    console.log("D1 backup complete.");
  } catch (err) {
    console.error("D1 backup failed:", err.message);
    console.error("Aborting. Fix backup or run manually before --apply.");
    process.exit(1);
  }
}

// ---------- Main ----------

async function main() {
  console.log("=== Vectorize → D1 Import ===");
  console.log(`Mode: ${apply ? "APPLY" : "DRY-RUN"}`);
  console.log(`Vectorize index: ${vectorizeIndex}`);
  console.log(`D1 database: ${d1Database}`);
  console.log(`Namespace: ${namespace}`);
  console.log();

  await mkdir(outputDir, { recursive: true });

  console.log("Listing all vector IDs...");
  const { ids, totalCount } = await listAllVectorIds();
  console.log(`Found ${ids.length} vectors (reported total: ${totalCount ?? "unknown"})`);

  if (ids.length === 0) {
    console.log("No vectors found. Nothing to import.");
    return;
  }

  console.log("Checking existing D1 rows...");
  const existingIds = await getExistingD1Ids(ids);
  const newIds = ids.filter((id) => !existingIds.has(extractMemoryId({ id, metadata: {} }) || id));
  console.log(`Already in D1: ${existingIds.size}, to import: ${newIds.length}`);

  if (newIds.length === 0) {
    console.log("All vectors already have D1 rows. Nothing to import.");
    return;
  }

  console.log("Fetching vector metadata...");
  const vectors = await getVectorsBatch(ids);
  console.log(`Fetched metadata for ${vectors.length} vectors`);

  const plan = [];
  let skipped = 0;

  for (const vector of vectors) {
    const memId = extractMemoryId(vector);
    if (!memId || existingIds.has(memId)) {
      skipped++;
      continue;
    }

    const row = vectorToD1Row(vector);
    if (!row) {
      skipped++;
      continue;
    }

    plan.push(row);
  }

  console.log(`Plan: ${plan.length} rows to insert, ${skipped} skipped (existing or empty)`);

  const planFile = `${outputDir}/import-plan-${Date.now()}.json`;
  await writeFile(
    planFile,
    JSON.stringify(
      {
        generated_at: new Date().toISOString(),
        mode: apply ? "apply" : "dry-run",
        vectorize_index: vectorizeIndex,
        d1_database: d1Database,
        namespace,
        total_vectors: ids.length,
        existing_in_d1: existingIds.size,
        to_import: plan.length,
        skipped,
        rows: plan.map((r) => ({
          id: r.id,
          vector_id: r.vector_id,
          type: r.type,
          content_preview: r.content.slice(0, 120),
          status: r.status,
          pinned: r.pinned,
          importance: r.importance,
        })),
      },
      null,
      2
    )
  );
  console.log(`Plan written to ${planFile}`);

  if (!apply) {
    console.log("\nDry-run complete. Review the plan file, then run with --apply.");
    return;
  }

  console.log("\nApplying import...");
  backupD1();

  let inserted = 0;
  let failed = 0;

  for (let i = 0; i < plan.length; i++) {
    const row = plan[i];
    try {
      await insertD1Row(row);
      inserted++;
    } catch (err) {
      console.error(`  FAILED: ${row.id} — ${err.message}`);
      failed++;
    }

    if ((i + 1) % batchSize === 0 || i === plan.length - 1) {
      console.log(`  Progress: ${i + 1}/${plan.length} (inserted: ${inserted}, failed: ${failed})`);
    }

    if ((i + 1) % 100 === 0) await sleep(200);
  }

  console.log(`\nImport complete: ${inserted} inserted, ${failed} failed, ${skipped} skipped.`);
  console.log(`Next steps:`);
  console.log(`  1. Run backfill-xyzem to fill XYZEM coordinates (dry-run first):`);
  console.log(`     npm run memory:backfill-xyzem`);
  console.log(`  2. Reindex Vectorize from D1:`);
  console.log(`     npm run vectorize:reindex -- --api-url <URL> --api-key <KEY>`);
}

main().catch((err) => {
  console.error("Import failed:", err.message);
  process.exit(1);
});
