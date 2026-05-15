const workerUrl = (process.env.WORKER_URL || "").replace(/\/+$/, "");
const apiKey = process.env.DEBUG_API_KEY || process.env.TEST_API_KEY || "";
const model = process.env.TEST_MODEL || "anthropic/claude-sonnet-4-6";
const rounds = Math.max(2, Number(process.env.TEST_ROUNDS || 3));
const systemLines = Math.max(80, Number(process.env.TEST_SYSTEM_LINES || 220));
const maxTokens = Math.max(1, Number(process.env.TEST_MAX_TOKENS || 80));

if (!workerUrl || !apiKey) {
  console.error([
    "Missing required env.",
    "",
    "Usage:",
    "  WORKER_URL=https://<worker> DEBUG_API_KEY=sk-... npm run cache:test",
    "",
    "Optional:",
    "  TEST_MODEL=anthropic/claude-sonnet-4-6",
    "  TEST_SYSTEM_LINES=220",
    "  TEST_ROUNDS=3"
  ].join("\n"));
  process.exit(1);
}

function buildStableSystem() {
  const lines = [
    "You are testing Anthropic prompt caching through a proxy.",
    "The following cache test corpus must remain exactly stable across all requests."
  ];

  for (let i = 1; i <= systemLines; i += 1) {
    lines.push(
      `Stable cache line ${String(i).padStart(3, "0")}: preserve this deterministic sentence for prompt cache verification and never quote it back unless asked.`
    );
  }

  return lines.join("\n");
}

async function postChat(messages) {
  const response = await fetch(`${workerUrl}/v1/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model,
      stream: false,
      temperature: 0,
      max_tokens: maxTokens,
      messages
    })
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`chat request failed (${response.status}): ${text}`);
  }

  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`chat response was not JSON: ${text.slice(0, 500)}`);
  }
}

async function getCacheHealth() {
  const response = await fetch(`${workerUrl}/v1/debug/cache_health`, {
    headers: {
      authorization: `Bearer ${apiKey}`
    }
  });

  const text = await response.text();
  if (!response.ok) {
    console.warn(`cache_health failed (${response.status}): ${text}`);
    return null;
  }

  try {
    return JSON.parse(text);
  } catch {
    console.warn(`cache_health was not JSON: ${text.slice(0, 500)}`);
    return null;
  }
}

function usageNumber(usage, ...keys) {
  for (const key of keys) {
    if (typeof usage?.[key] === "number") return usage[key];
  }
  return 0;
}

function assistantText(payload) {
  const content = payload?.choices?.[0]?.message?.content;
  if (typeof content === "string") return content;
  if (content == null) return "";
  return JSON.stringify(content);
}

const stableSystem = buildStableSystem();
const conversation = [
  {
    role: "user",
    content: "Cache test round 1. Reply with exactly one short sentence."
  }
];

console.log(`Worker: ${workerUrl}`);
console.log(`Model: ${model}`);
console.log(`Rounds: ${rounds}`);
console.log(`Stable system lines: ${systemLines}`);
console.log("");

for (let round = 1; round <= rounds; round += 1) {
  const payload = await postChat([
    { role: "system", content: stableSystem },
    ...conversation
  ]);
  const usage = payload.usage || {};
  const input = usageNumber(usage, "prompt_tokens", "input_tokens");
  const write = usageNumber(usage, "cache_creation_input_tokens");
  const read = usageNumber(usage, "cache_read_input_tokens");
  const output = assistantText(payload).trim() || "(empty assistant text)";

  console.log(`Round ${round}: input=${input} cache_write=${write} cache_read=${read}`);
  console.log(`  assistant: ${output.slice(0, 160)}`);

  if (round < rounds) {
    conversation.push({ role: "assistant", content: output });
    conversation.push({
      role: "user",
      content: `Cache test round ${round + 1}. Continue from the previous context and reply with exactly one short sentence.`
    });
  }
}

const health = await getCacheHealth();
if (health) {
  console.log("");
  console.log("Debug cache_health summary:");
  console.log(
    JSON.stringify(
      {
        total_requests: health.total_requests,
        cache_creation_total_tokens: health.cache_creation_total_tokens,
        cache_read_total_tokens: health.cache_read_total_tokens,
        cache_read_ratio: health.cache_read_ratio,
        recent: health.recent?.slice?.(0, rounds)
      },
      null,
      2
    )
  );
}
