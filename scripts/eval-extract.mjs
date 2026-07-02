#!/usr/bin/env node
// eval-extract: 给记忆抽取 prompt 一个可测的数字。
// 走真实生产抽取路径 (memory_extract_dryrun MCP 工具 -> extractPipeline.ts 的
// buildExtractPrompt / callExtractModel / normalizeCandidate)，不落库、不碰游标。
//
// 用法:
//   node scripts/eval-extract.mjs --endpoint https://worker.example/mcp?token=xxx --file scripts/eval/sample.jsonl
//   node scripts/eval-extract.mjs --endpoint ... --file ... --namespace default --json
//
// 依赖: 无。仅用 Node >=18 内置的 fetch / fs / path。

import { readFile } from "node:fs/promises";

function parseArgs(argv) {
  const args = { endpoint: null, file: null, namespace: null, json: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--endpoint") args.endpoint = argv[++i];
    else if (arg === "--file") args.file = argv[++i];
    else if (arg === "--namespace") args.namespace = argv[++i];
    else if (arg === "--json") args.json = true;
    else if (arg === "--help" || arg === "-h") args.help = true;
  }
  return args;
}

function usage() {
  return [
    "用法: node scripts/eval-extract.mjs --endpoint <mcp-url> --file <cases.jsonl> [--namespace ns] [--json]",
    "",
    "  --endpoint  Aelios MCP 端点 (streamable HTTP)，例如 https://worker.example/mcp?token=xxx",
    "  --file      JSONL 标注用例文件，格式见 scripts/eval/README.md",
    "  --namespace 覆盖用例默认走的 namespace (可选，不传则用 key 自带的 namespace)",
    "  --json      输出机器可读 JSON 而不是表格"
  ].join("\n");
}

// 归一化：小写 + 去掉空白和标点符号，剩纯文字用于 bigram 比较。
function normalizeText(text) {
  return String(text ?? "")
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]/gu, "");
}

// 字符 bigram 的 Dice 系数：2*|交集| / (|A的bigram总数| + |B的bigram总数|)。
// 对短中文句子比纯 Jaccard 或编辑距离更稳，也不需要分词。
function bigramDice(a, b) {
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return a.length === 0 && b.length === 0 ? 1 : 0;

  const countBigrams = (s) => {
    const map = new Map();
    for (let i = 0; i < s.length - 1; i += 1) {
      const bigram = s.slice(i, i + 2);
      map.set(bigram, (map.get(bigram) ?? 0) + 1);
    }
    return map;
  };

  const bigramsA = countBigrams(a);
  const bigramsB = countBigrams(b);
  let intersection = 0;
  for (const [bigram, count] of bigramsA) {
    const other = bigramsB.get(bigram);
    if (other) intersection += Math.min(count, other);
  }
  const totalA = [...bigramsA.values()].reduce((sum, n) => sum + n, 0);
  const totalB = [...bigramsB.values()].reduce((sum, n) => sum + n, 0);
  if (totalA + totalB === 0) return 0;
  return (2 * intersection) / (totalA + totalB);
}

function isMatch(expectedItem, extractedItem) {
  const bothHaveFactKey = expectedItem.fact_key && extractedItem.fact_key;
  if (bothHaveFactKey) {
    return expectedItem.fact_key.trim() === extractedItem.fact_key.trim();
  }
  const similarity = bigramDice(normalizeText(expectedItem.content), normalizeText(extractedItem.content));
  return similarity >= 0.5;
}

// 贪心匹配：每条 expected 最多消费一条 extracted，避免一条抽取结果重复计数命中多个 expected。
function scoreCase(expected, extracted) {
  const remaining = extracted.map((item, index) => ({ item, index }));
  const hits = [];
  const misses = [];

  for (const expectedItem of expected) {
    const matchAt = remaining.findIndex(({ item }) => isMatch(expectedItem, item));
    if (matchAt === -1) {
      misses.push(expectedItem);
      continue;
    }
    hits.push({ expected: expectedItem, extracted: remaining[matchAt].item });
    remaining.splice(matchAt, 1);
  }

  const falsePositives = remaining.map(({ item }) => item);
  return { hits, misses, falsePositives };
}

async function callDryRun(endpoint, input) {
  const body = {
    jsonrpc: "2.0",
    id: Date.now(),
    method: "tools/call",
    params: {
      name: "memory_extract_dryrun",
      arguments: input
    }
  };

  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${await response.text().catch(() => "")}`);
  }

  const rpc = await response.json();
  if (rpc.error) {
    throw new Error(`JSON-RPC error ${rpc.error.code}: ${rpc.error.message}`);
  }

  const result = rpc.result;
  if (result?.isError) {
    const message = result.content?.[0]?.text ?? "unknown tool error";
    throw new Error(`tool error: ${message}`);
  }

  const text = result?.content?.[0]?.text;
  if (typeof text !== "string") {
    throw new Error("unexpected MCP response shape (no content[0].text)");
  }

  const parsed = JSON.parse(text);
  return Array.isArray(parsed?.memories) ? parsed.memories : [];
}

async function loadCases(file) {
  const raw = await readFile(file, "utf8");
  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      try {
        return JSON.parse(line);
      } catch (error) {
        throw new Error(`第 ${index + 1} 行不是合法 JSON: ${error.message}`);
      }
    });
}

function formatTable(rows) {
  const headers = ["case", "expected", "hit", "miss", "fp", "precision", "recall"];
  const widths = headers.map((h, i) => Math.max(h.length, ...rows.map((r) => String(r[i]).length)));
  const line = (cells) => cells.map((cell, i) => String(cell).padEnd(widths[i])).join("  ");
  return [line(headers), line(widths.map((w) => "-".repeat(w))), ...rows.map(line)].join("\n");
}

function ratio(numerator, denominator) {
  return denominator === 0 ? null : numerator / denominator;
}

function formatRatio(value) {
  return value === null ? "-" : value.toFixed(2);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args.endpoint || !args.file) {
    console.log(usage());
    process.exit(0);
    return;
  }

  const cases = await loadCases(args.file);
  const caseResults = [];
  let totalTp = 0;
  let totalFp = 0;
  let totalFn = 0;
  let negativeCaseCount = 0;
  let negativeViolationCount = 0;

  for (const testCase of cases) {
    const caseId = testCase.id ?? `case_${caseResults.length + 1}`;
    const expected = Array.isArray(testCase.expected) ? testCase.expected : [];
    const isNegativeCase = expected.length === 0;
    if (isNegativeCase) negativeCaseCount += 1;

    try {
      const extracted = await callDryRun(args.endpoint, {
        namespace: args.namespace ?? undefined,
        messages: testCase.messages ?? []
      });

      const { hits, misses, falsePositives } = scoreCase(expected, extracted);
      const tp = hits.length;
      const fp = falsePositives.length;
      const fn = misses.length;
      totalTp += tp;
      totalFp += fp;
      totalFn += fn;

      const violatesNegative = isNegativeCase && extracted.length > 0;
      if (violatesNegative) negativeViolationCount += 1;

      caseResults.push({
        id: caseId,
        isNegativeCase,
        violatesNegative,
        expectedCount: expected.length,
        extractedCount: extracted.length,
        tp,
        fp,
        fn,
        precision: ratio(tp, tp + fp),
        recall: isNegativeCase ? null : ratio(tp, tp + fn),
        misses,
        falsePositives,
        error: null
      });
    } catch (error) {
      caseResults.push({
        id: caseId,
        isNegativeCase,
        violatesNegative: false,
        expectedCount: expected.length,
        extractedCount: 0,
        tp: 0,
        fp: 0,
        fn: 0,
        precision: null,
        recall: null,
        misses: [],
        falsePositives: [],
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  const microPrecision = ratio(totalTp, totalTp + totalFp);
  const microRecall = ratio(totalTp, totalTp + totalFn);
  const microF1 =
    microPrecision !== null && microRecall !== null && microPrecision + microRecall > 0
      ? (2 * microPrecision * microRecall) / (microPrecision + microRecall)
      : null;

  const summary = {
    cases: caseResults.length,
    negativeCases: negativeCaseCount,
    negativeViolations: negativeViolationCount,
    totalTp,
    totalFp,
    totalFn,
    microPrecision,
    microRecall,
    microF1
  };

  if (args.json) {
    console.log(JSON.stringify({ summary, cases: caseResults }, null, 2));
    process.exit(0);
    return;
  }

  const rows = caseResults.map((r) => [
    r.id + (r.error ? " (ERROR)" : r.violatesNegative ? " (NEG-VIOLATION)" : ""),
    r.expectedCount,
    r.tp,
    r.fn,
    r.fp,
    formatRatio(r.precision),
    formatRatio(r.recall)
  ]);

  console.log(formatTable(rows));
  console.log("");

  for (const r of caseResults) {
    if (r.error) console.log(`[${r.id}] 调用失败: ${r.error}`);
    for (const miss of r.misses) console.log(`[${r.id}] MISS (没抽到): ${miss.content}`);
    for (const fp of r.falsePositives) console.log(`[${r.id}] FALSE POSITIVE (多抽了): ${fp.content}`);
  }

  console.log("");
  console.log(`用例数: ${summary.cases}  负样本数: ${summary.negativeCases}  负样本违规数: ${summary.negativeViolations}`);
  console.log(
    `micro precision: ${formatRatio(summary.microPrecision)}  ` +
      `micro recall: ${formatRatio(summary.microRecall)}  ` +
      `micro F1: ${formatRatio(summary.microF1)}`
  );

  process.exit(0);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exit(0);
});
