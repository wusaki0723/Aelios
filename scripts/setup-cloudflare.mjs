import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const wranglerTomlPath = resolve(root, "wrangler.toml");
const dbName = process.env.CMP_D1_NAME || "companion_memory_proxy";
const dbBinding = process.env.CMP_D1_BINDING || "DB";
const wranglerToml = readFileSync(wranglerTomlPath, "utf8");
function readVectorizeValue(name) {
  const match = wranglerToml.match(/\[\[vectorize\]\]([\s\S]*?)(?=\n\[|$)/);
  return match?.[1]?.match(new RegExp(`${name}\\\\s*=\\\\s*"([^"]+)"`))?.[1];
}
const vectorizeName =
  process.env.CMP_VECTORIZE_NAME || readVectorizeValue("index_name") || "memo-kb";
const vectorizeBinding =
  process.env.CMP_VECTORIZE_BINDING || readVectorizeValue("binding") || "VECTORIZE";
const vectorizeDimensions = process.env.CMP_VECTORIZE_DIMENSIONS || "768";
const vectorizeMetric = process.env.CMP_VECTORIZE_METRIC || "cosine";
const queueName = process.env.CMP_QUEUE_NAME || "companion-memory";
const visibleVarNames = [
  "AI_GATEWAY_BASE_URL",
  "CHATBOX_API_KEY",
  "CF_AIG_TOKEN",
  "CHAT_MODEL",
  "MEMORY_FILTER_MODEL",
  "MEMORY_MODEL",
  "VISION_MODEL",
  "GUIDE_DOG_MODEL",
  "ANTHROPIC_THINKING_ENABLED",
  "ANTHROPIC_THINKING_BUDGET"
];

function run(args, options = {}) {
  const result = spawnSync("npx", ["wrangler", ...args], {
    cwd: root,
    encoding: "utf8",
    env: {
      ...process.env,
      CI: "1"
    },
    stdio: options.capture ? ["ignore", "pipe", "pipe"] : "inherit"
  });

  if (options.allowFailure) return result;

  if (result.status !== 0) {
    throw new Error(`wrangler ${args.join(" ")} failed`);
  }

  return result;
}

function runJson(args) {
  const result = run(args, { capture: true });
  return JSON.parse(result.stdout);
}

function findDatabase(databases) {
  if (!Array.isArray(databases)) return null;

  return databases.find((database) => {
    if (!database || typeof database !== "object") return false;
    return database.name === dbName || database.database_name === dbName;
  });
}

function getDatabaseId(database) {
  if (!database || typeof database !== "object") return null;
  return database.uuid || database.id || database.database_id || null;
}

function removeTomlArrayBlocks(toml, blockName) {
  const lines = toml.split("\n");
  const output = [];
  let skipping = false;

  for (const line of lines) {
    if (line.trim() === `[[${blockName}]]`) {
      skipping = true;
      continue;
    }

    if (skipping && line.startsWith("[") && line.trim() !== `[[${blockName}]]`) {
      skipping = false;
    }

    if (!skipping) output.push(line);
  }

  return output.join("\n").replace(/\n{3,}/g, "\n\n");
}

function upsertD1Binding(databaseId) {
  const block = [
    "[[d1_databases]]",
    `binding = "${dbBinding}"`,
    `database_name = "${dbName}"`,
    `database_id = "${databaseId}"`,
    ""
  ].join("\n");

  let toml = readFileSync(wranglerTomlPath, "utf8");
  toml = removeTomlArrayBlocks(toml, "d1_databases").trimEnd();
  writeFileSync(wranglerTomlPath, `${toml}\n\n${block}`);
}

function ensureVectorizeBinding() {
  let toml = readFileSync(wranglerTomlPath, "utf8");
  if (toml.includes(`binding = "${vectorizeBinding}"`) && toml.includes(`index_name = "${vectorizeName}"`)) {
    return;
  }

  const block = [
    "",
    "[[vectorize]]",
    `binding = "${vectorizeBinding}"`,
    `index_name = "${vectorizeName}"`,
    ""
  ].join("\n");

  toml = removeTomlArrayBlocks(toml, "vectorize").trimEnd();
  writeFileSync(wranglerTomlPath, `${toml}${block}`);
}

function ensureD1() {
  console.log(`\nChecking D1 database: ${dbName}`);
  let databases = runJson(["d1", "list", "--json"]);
  let database = findDatabase(databases);

  if (!database) {
    console.log(`Creating D1 database: ${dbName}`);
    run(["d1", "create", dbName, "--binding", dbBinding, "--update-config", "--use-remote"], {
      allowFailure: true
    });
    databases = runJson(["d1", "list", "--json"]);
    database = findDatabase(databases);
  }

  const databaseId = getDatabaseId(database);
  if (!databaseId) {
    throw new Error(`Could not find D1 database id for ${dbName}`);
  }

  upsertD1Binding(databaseId);
  console.log(`D1 binding ready: ${dbBinding} -> ${dbName}`);

  console.log("Applying D1 migrations");
  run(["d1", "migrations", "apply", dbName, "--remote"]);
}

function ensureVectorize() {
  console.log(`\nEnsuring Vectorize index: ${vectorizeName}`);
  run(
    [
      "vectorize",
      "create",
      vectorizeName,
      `--dimensions=${vectorizeDimensions}`,
      `--metric=${vectorizeMetric}`,
      "--binding",
      vectorizeBinding,
      "--update-config",
      "--use-remote"
    ],
    { allowFailure: true }
  );

  ensureVectorizeBinding();

  const indexes = [
    ["namespace", "string"],
    ["status", "string"],
    ["type", "string"],
    ["pinned", "boolean"]
  ];

  for (const [propertyName, type] of indexes) {
    run(
      [
        "vectorize",
        "create-metadata-index",
        vectorizeName,
        `--propertyName=${propertyName}`,
        `--type=${type}`
      ],
      { allowFailure: true }
    );
  }
}

function ensureQueue() {
  console.log(`\nEnsuring Queue: ${queueName}`);
  run(["queues", "create", queueName], { allowFailure: true });
}

function escapeTomlString(value) {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function ensureVarsHeader(toml) {
  if (toml.includes("[vars]")) return toml;
  return `${toml.trimEnd()}\n\n[vars]\n`;
}

function upsertVarFromEnvironment(name, value) {
  let toml = readFileSync(wranglerTomlPath, "utf8");
  const escaped = escapeTomlString(value);

  if (new RegExp(`^${name}\\s*=`, "m").test(toml)) {
    toml = toml.replace(new RegExp(`^${name}\\s*=\\s*"[^"]*"`, "m"), `${name} = "${escaped}"`);
  } else {
    toml = ensureVarsHeader(toml).replace("[vars]\n", `[vars]\n${name} = "${escaped}"\n`);
  }

  writeFileSync(wranglerTomlPath, toml);
}

function ensureVisibleVars() {
  let changed = 0;

  for (const name of visibleVarNames) {
    const value = process.env[name] || (name === "AI_GATEWAY_BASE_URL" ? process.env.CMP_AI_GATEWAY_BASE_URL : "");
    if (!value) continue;
    upsertVarFromEnvironment(name, value);
    changed += 1;
  }

  if (changed > 0) {
    console.log(`\nVisible Worker variables synced from Cloudflare build env: ${changed}`);
  } else {
    console.log("\nNo visible Worker variables found in build env; leaving wrangler.toml values unchanged.");
  }
}

ensureVisibleVars();
ensureD1();
ensureVectorize();
ensureQueue();

console.log("\nCloudflare resources are ready.");
