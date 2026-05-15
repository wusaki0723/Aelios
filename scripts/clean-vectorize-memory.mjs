import { mkdir, writeFile } from "node:fs/promises";

const accountId = process.env.CLOUDFLARE_ACCOUNT_ID || process.env.CF_ACCOUNT_ID;
const token = process.env.CLOUDFLARE_API_TOKEN || process.env.CF_API_TOKEN;
const index = process.env.VECTORIZE_INDEX_NAME || "memo-kb";
const apply = process.argv.includes("--apply");
const backupDir = process.env.VECTORIZE_BACKUP_DIR || "backups";

if (!accountId || !token) {
  console.error("Missing CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN.");
  process.exit(1);
}

const headers = {
  authorization: `Bearer ${token}`,
  "content-type": "application/json",
};
const base = `https://api.cloudflare.com/client/v4/accounts/${accountId}/vectorize/v2/indexes/${index}`;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function cf(path, init = {}, tries = 4) {
  let lastError = "";

  for (let index = 0; index < tries; index += 1) {
    const response = await fetch(`${base}${path}`, { headers, ...init });
    const text = await response.text();
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      json = {};
    }

    if (response.ok && json.success !== false) return json.result;

    lastError = `${path} failed ${response.status}: ${JSON.stringify(json.errors || json).slice(0, 500)}`;
    await sleep(500 * (index + 1));
  }

  throw new Error(lastError);
}

async function listIds() {
  let cursor = null;
  let totalCount = null;
  const ids = [];

  for (;;) {
    const params = new URLSearchParams({ count: "100" });
    if (cursor) params.set("cursor", cursor);
    const result = await cf(`/list?${params}`);
    totalCount = result.totalCount ?? result.total_count ?? totalCount;
    ids.push(...(result.vectors || []).map((vector) => vector.id).filter(Boolean));

    cursor = result.nextCursor || result.next_cursor || result.cursor || null;
    if (!result.isTruncated || !cursor) break;
  }

  return { ids, totalCount };
}

async function getVectors(ids) {
  const vectors = [];

  for (let index = 0; index < ids.length; index += 20) {
    const batch = ids.slice(index, index + 20);
    const result = await cf("/get_by_ids", {
      method: "POST",
      body: JSON.stringify({ ids: batch }),
    });
    vectors.push(
      ...result.map((vector) => ({
        id: vector.id,
        namespace: vector.namespace ?? null,
        metadata: vector.metadata ?? {},
        values_dim: Array.isArray(vector.values) ? vector.values.length : null,
      }))
    );
  }

  return vectors;
}

function contentOf(vector) {
  return String(vector.metadata?.content || vector.metadata?.text || vector.metadata?.memory || "").trim();
}

function normalizedContent(content) {
  return content.toLowerCase().replace(/\s+/g, "");
}

function buildCleanupPlan(vectors) {
  const deleteMap = new Map();
  const groups = new Map();

  for (const vector of vectors) {
    const content = contentOf(vector);
    if (!content) {
      deleteMap.set(vector.id, { id: vector.id, reason: "empty_content" });
      continue;
    }

    const normalized = normalizedContent(content);
    if (!groups.has(normalized)) groups.set(normalized, []);
    groups.get(normalized).push(vector);
  }

  const duplicateGroups = [];
  for (const vectors of groups.values()) {
    if (vectors.length <= 1) continue;

    const sorted = [...vectors].sort(
      (a, b) =>
        String(a.metadata?.created_at || "").localeCompare(String(b.metadata?.created_at || "")) ||
        a.id.localeCompare(b.id)
    );
    const keep = sorted[0];
    const duplicates = sorted.slice(1);
    duplicateGroups.push({
      keep: keep.id,
      delete: duplicates.map((vector) => vector.id),
      sample: contentOf(keep).slice(0, 200),
    });

    for (const vector of duplicates) {
      deleteMap.set(vector.id, { id: vector.id, reason: "duplicate_exact", keep: keep.id });
    }
  }

  return {
    deleteItems: [...deleteMap.values()],
    duplicateGroups,
  };
}

async function deleteIds(ids) {
  let deleted = 0;

  for (let index = 0; index < ids.length; index += 100) {
    const batch = ids.slice(index, index + 100);
    await cf("/delete_by_ids", {
      method: "POST",
      body: JSON.stringify({ ids: batch }),
    });
    deleted += batch.length;
    console.log(`deleted ${deleted}/${ids.length}`);
  }
}

await mkdir(backupDir, { recursive: true });

const { ids, totalCount } = await listIds();
const vectors = await getVectors(ids);
const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
const backupPath = `${backupDir}/vectorize-${index}-${timestamp}.json`;
await writeFile(
  backupPath,
  JSON.stringify(
    {
      exported_at: new Date().toISOString(),
      index,
      totalCount,
      ids_count: ids.length,
      vectors,
    },
    null,
    2
  )
);

const { deleteItems, duplicateGroups } = buildCleanupPlan(vectors);
const planPath = `${backupDir}/vectorize-${index}-cleanup-plan-${timestamp}.json`;
await writeFile(
  planPath,
  JSON.stringify(
    {
      created_at: new Date().toISOString(),
      backup: backupPath,
      apply,
      delete_count: deleteItems.length,
      duplicate_groups: duplicateGroups.length,
      deleteItems,
    },
    null,
    2
  )
);

const contents = vectors.map(contentOf);
const summary = {
  backupPath,
  planPath,
  apply,
  totalCount,
  listed: ids.length,
  fetched: vectors.length,
  emptyContent: contents.filter((content) => !content).length,
  duplicateDeletes: deleteItems.filter((item) => item.reason === "duplicate_exact").length,
  deleteCandidates: deleteItems.length,
};

console.log(JSON.stringify(summary, null, 2));

if (apply && deleteItems.length > 0) {
  await deleteIds(deleteItems.map((item) => item.id));
}
