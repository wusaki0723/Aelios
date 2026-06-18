#!/usr/bin/env node

/**
 * Rebuild all Vectorize embeddings from D1 canonical memory rows.
 *
 * Usage:
 *   node scripts/reindex-vectorize.mjs [--api-url URL] [--api-key KEY] [--namespace NS] [--dry-run]
 *
 * This script pages through all active memories in D1 and calls the
 * /v1/debug/vector_reindex endpoint to rebuild their Vectorize embeddings.
 */

const args = process.argv.slice(2);
function flag(name) {
  const idx = args.indexOf(`--${name}`);
  return idx !== -1 && idx + 1 < args.length ? args[idx + 1] : null;
}
function hasFlag(name) {
  return args.includes(`--${name}`);
}

const apiUrl = flag("api-url") || process.env.AELIOS_URL || "http://localhost:8787";
const apiKey = flag("api-key") || process.env.AELIOS_API_KEY || "";
const namespace = flag("namespace") || process.env.AELIOS_NAMESPACE || "default";
const dryRun = hasFlag("dry-run");
const force = hasFlag("force");
const pageSize = parseInt(flag("page-size") || "50", 10);

if (!apiKey) {
  console.error("Error: --api-key or AELIOS_API_KEY required");
  process.exit(1);
}

async function reindexPage(cursor) {
  const body = {
    namespace,
    limit: pageSize,
    dry_run: dryRun,
    force,
    ...(cursor ? { cursor } : {}),
  };

  const res = await fetch(`${apiUrl}/v1/debug/vector_reindex`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`HTTP ${res.status}: ${text}`);
  }

  return res.json();
}

async function main() {
  console.log(`Reindexing Vectorize for namespace="${namespace}" (dry_run=${dryRun})`);
  let cursor = null;
  let totalRewritten = 0;
  let totalFailed = 0;
  let page = 0;

  while (true) {
    page++;
    const result = await reindexPage(cursor);
    const data = result.data;

    console.log(
      `  Page ${page}: rewritten=${data.rewritten_count}, failed=${data.failed_count}, has_more=${data.has_more}`
    );

    totalRewritten += data.rewritten_count;
    totalFailed += data.failed_count;

    if (data.failed && data.failed.length > 0) {
      for (const f of data.failed) {
        console.error(`    FAILED: ${f.id} - ${f.error || "unknown"}`);
      }
    }

    if (!data.has_more || !data.cursor) break;
    cursor = data.cursor;
  }

  console.log(`\nDone. Total rewritten: ${totalRewritten}, failed: ${totalFailed}`);
}

main().catch((err) => {
  console.error("Reindex failed:", err.message);
  process.exit(1);
});
