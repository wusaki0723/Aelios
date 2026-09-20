/**
 * 离线重放：拿 memory_candidates 里已有的人工标注，把当前的 candidateJudge 重跑一遍，
 * 算它和人工判断的一致率，并按 approve / discard 两侧分别导出误判样例。
 *
 * 只读。整个脚本对 D1 只发 SELECT，不写候选队列、不写 memories、不碰召回链路，
 * 也不会因为判成 approve 就真的入库——approveCandidate 那条路径在这里根本没有被引用。
 *
 * 复用的是线上同一份实现：judgeKindFor / buildJudgePrompt / parseJudgeModelResult /
 * decideJudge 都直接从 src/memory/candidateJudge.ts 导入，没有在这里重写一份。
 * runCandidateJudge 本身不能直接调用，因为它需要 Worker 的 Env 绑定，而且它会写库。
 * 这里按它的控制流逐条复刻：
 *   1. source === "zone_full"      → 跳过，不判（线上同样跳过）
 *   2. 取不到任何原始消息          → 短路成 {score:0, grounded:false, durable:false}，不调模型
 *   3. 其余                        → 调模型，解析，decideJudge
 *
 * 用法：
 *   # 只跑确定性部分（第 1、2 步），不需要模型凭据，纯本地可复现
 *   npx tsx scripts/replay-candidate-judge.ts --no-model
 *
 *   # 全量重放，需要一个 OpenAI 兼容端点
 *   JUDGE_REPLAY_BASE_URL=https://api.cloudflare.com/client/v4/accounts/<acct>/ai/v1 \
 *   JUDGE_REPLAY_API_KEY=<cf-api-token> \
 *   npx tsx scripts/replay-candidate-judge.ts
 *
 * 参数：
 *   --namespace <ns>   默认 default
 *   --limit <n>        最多重放多少条已标注候选（默认全部）
 *   --no-model         不调模型；只有证据缺失的候选能出确定性结论，其余记为 skipped
 *   --model <name>     覆盖判定模型（默认读 JUDGE_MODEL / DREAM_MODEL，再退到 wrangler.toml 的 DREAM_MODEL）
 *   --approve-min <f>  覆盖 approve 阈值（默认 0.8，同线上 DEFAULT_APPROVE_MIN）
 *   --discard-max <f>  覆盖 discard 阈值（默认 0.3，同线上 DEFAULT_DISCARD_MAX）
 *   --out <path>       报告 JSON 落盘路径（默认 ./replay-candidate-judge.report.json）
 *   --db <name>        D1 数据库名（默认 companion_memory_proxy）
 */

import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";

import {
  buildJudgePrompt,
  decideJudge,
  judgeKindFor,
  parseJudgeModelResult,
  type JudgeDecision,
  type JudgeKind,
  type JudgeModelResult
} from "../src/memory/candidateJudge";
import type { MemoryCandidateRow } from "../src/db/v2/candidates";
import { speakersForNamespace, validateConfig, type DreamSpeakers } from "../src/gateway/config";
import type { MessageRecord } from "../src/types";
import { extractJsonObject } from "../src/utils/parse";

// 和线上保持一致的默认值（src/memory/candidateJudge.ts）
const DEFAULT_APPROVE_MIN = 0.8;
const DEFAULT_DISCARD_MAX = 0.3;
const JUDGE_MAX_TOKENS = 300;
const JUDGE_SYSTEM_PROMPT = "你是严格的 JSON 生成器。你只输出 JSON。";

// 线上 messages 的排序（src/db/messages.ts MESSAGE_ORDER_SQL），重放时照抄，
// 否则 transcript 顺序不同，prompt 就不是线上那一份了。
const MESSAGE_ORDER_SQL =
  "created_at ASC, seq ASC, CASE role WHEN 'user' THEN 0 WHEN 'assistant' THEN 1 ELSE 2 END ASC, id ASC";

// 人工判决写进 decision_note 的是 approved / approve_update / discarded / merged 之类；
// 自动评审写的一律是 "judge: ..."。用这个前缀把机器判过的排除掉，
// 只留真正的人工标注当作金标准。
const JUDGE_NOTE_PREFIX = "judge:";

interface Args {
  namespace: string;
  limit: number | null;
  noModel: boolean;
  model: string | null;
  approveMin: number;
  discardMax: number;
  out: string;
  db: string;
}

function parseArgs(argv: string[]): Args {
  const get = (flag: string): string | null => {
    const i = argv.indexOf(flag);
    return i === -1 || i + 1 >= argv.length ? null : argv[i + 1];
  };
  const num = (flag: string, fallback: number): number => {
    const raw = get(flag);
    if (raw === null) return fallback;
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : fallback;
  };
  const limitRaw = get("--limit");
  return {
    namespace: get("--namespace") ?? "default",
    limit: limitRaw === null ? null : Math.max(1, Math.floor(Number(limitRaw))),
    noModel: argv.includes("--no-model"),
    model: get("--model"),
    approveMin: num("--approve-min", DEFAULT_APPROVE_MIN),
    discardMax: num("--discard-max", DEFAULT_DISCARD_MAX),
    out: get("--out") ?? "./replay-candidate-judge.report.json",
    db: get("--db") ?? "companion_memory_proxy"
  };
}

// ---------------------------------------------------------------------------
// D1：走 wrangler d1 execute --remote --json，跟 npm run db:migrate:remote 同一条路，
// 不额外引一个 Cloudflare SDK。只允许 SELECT。
// ---------------------------------------------------------------------------

function d1Select<T>(db: string, sql: string): T[] {
  const trimmed = sql.trim();
  if (!/^(SELECT|WITH)\b/i.test(trimmed)) {
    throw new Error(`refusing to run a non-SELECT statement in a read-only replay: ${trimmed.slice(0, 60)}`);
  }
  const stdout = execFileSync(
    "npx",
    ["wrangler", "d1", "execute", db, "--remote", "--json", "--command", trimmed],
    { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 }
  );
  // wrangler 会在 JSON 前后打一些横幅，取最外层的数组。
  const start = stdout.indexOf("[");
  const end = stdout.lastIndexOf("]");
  if (start === -1 || end <= start) throw new Error(`unexpected wrangler output: ${stdout.slice(0, 200)}`);
  const parsed = JSON.parse(stdout.slice(start, end + 1)) as Array<{ results?: T[] }>;
  return parsed[0]?.results ?? [];
}

function sqlString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function loadLabeledCandidates(args: Args): MemoryCandidateRow[] {
  const limit = args.limit === null ? "" : ` LIMIT ${args.limit}`;
  return d1Select<MemoryCandidateRow>(
    args.db,
    `SELECT * FROM memory_candidates
      WHERE namespace = ${sqlString(args.namespace)}
        AND status IN ('approved','discarded')
        AND (decision_note IS NULL OR decision_note NOT LIKE ${sqlString(`${JUDGE_NOTE_PREFIX}%`)})
      ORDER BY updated_at ASC${limit}`
  );
}

function loadMessagesByIds(args: Args, ids: string[]): MessageRecord[] {
  if (ids.length === 0) return [];
  const list = ids.map(sqlString).join(", ");
  return d1Select<MessageRecord>(
    args.db,
    `SELECT id, conversation_id, namespace, role, content, source, created_at, seq
       FROM messages
      WHERE namespace = ${sqlString(args.namespace)} AND id IN (${list})
      ORDER BY ${MESSAGE_ORDER_SQL}`
  );
}

// 线上 loadSpeakersForNamespace 走 Env 绑定读 gateway_config；这里读同一张表，
// 再交给线上同一个 validateConfig / speakersForNamespace，好让 prompt 里的
// 称呼规则和线上逐字一致，而不是在这儿重新猜一遍 identity 的匹配规则。
function loadSpeakers(args: Args): DreamSpeakers | null {
  try {
    const rows = d1Select<{ config_json: string }>(args.db, "SELECT config_json FROM gateway_config WHERE id = 1");
    const raw = rows[0]?.config_json;
    if (!raw) return null;
    return speakersForNamespace(validateConfig(JSON.parse(raw)), args.namespace);
  } catch {
    return null;
  }
}

function parseJsonArray(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) return parsed.filter((item): item is string => typeof item === "string");
  } catch {
    // 老行里的坏 JSON：当空数组，跟线上一致
  }
  return [];
}

// ---------------------------------------------------------------------------
// 模型：OpenAI 兼容端点，请求体和 callModelWithRetry 构造的那份一致
// (temperature 0, response_format json_object, 同样的 system prompt 和 max_tokens)。
// ---------------------------------------------------------------------------

async function callJudgeModel(
  baseUrl: string,
  apiKey: string,
  model: string,
  prompt: string
): Promise<JudgeModelResult | null> {
  const response = await fetch(`${baseUrl.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: JUDGE_SYSTEM_PROMPT },
        { role: "user", content: prompt }
      ],
      temperature: 0,
      max_tokens: JUDGE_MAX_TOKENS,
      response_format: { type: "json_object" },
      stream: false
    })
  });
  if (!response.ok) return null;
  const parsed = (await response.json()) as {
    choices?: Array<{ message?: { content?: unknown; reasoning_content?: unknown } }>;
  };
  const message = parsed.choices?.[0]?.message;
  const content = typeof message?.content === "string" ? message.content.trim() : "";
  const reasoning = typeof message?.reasoning_content === "string" ? message.reasoning_content.trim() : "";
  return parseJudgeModelResult(extractJsonObject(content || reasoning));
}

// ---------------------------------------------------------------------------
// 重放
// ---------------------------------------------------------------------------

type Outcome = "approve" | "discard" | "keep" | "skipped" | "failed";

interface ReplayRow {
  id: string;
  kind: JudgeKind;
  source: string;
  human: "approved" | "discarded";
  judge: Outcome;
  agreed: boolean | null;
  evidence: "present" | "expired" | "none_recorded";
  deterministic: boolean;
  score: number | null;
  grounded: boolean | null;
  durable: boolean | null;
  reason: string;
  content: string;
  human_note: string | null;
  created_at: string;
  updated_at: string;
}

function toOutcome(decision: JudgeDecision): Outcome {
  return decision;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const baseUrl = process.env.JUDGE_REPLAY_BASE_URL ?? "";
  const apiKey = process.env.JUDGE_REPLAY_API_KEY ?? "";
  const model =
    args.model ?? process.env.JUDGE_MODEL ?? process.env.DREAM_MODEL ?? "workers-ai/@cf/openai/gpt-oss-120b";
  const modelAvailable = !args.noModel && Boolean(baseUrl && apiKey);

  if (!args.noModel && !modelAvailable) {
    console.warn(
      "no JUDGE_REPLAY_BASE_URL / JUDGE_REPLAY_API_KEY set — falling back to --no-model (deterministic pass only)"
    );
  }

  const candidates = loadLabeledCandidates(args);
  const speakers = loadSpeakers(args);
  console.log(
    `loaded ${candidates.length} human-labeled candidates (namespace=${args.namespace}), speakers=${
      speakers ? `${speakers.userName}/${speakers.assistantName}` : "(none)"
    }`
  );

  const rows: ReplayRow[] = [];

  for (const candidate of candidates) {
    const kind = judgeKindFor(candidate.source);
    const human = candidate.status as "approved" | "discarded";
    const sourceMessageIds = parseJsonArray(candidate.source_message_ids);
    const messages = loadMessagesByIds(args, sourceMessageIds);
    const evidence: ReplayRow["evidence"] =
      sourceMessageIds.length === 0 ? "none_recorded" : messages.length === 0 ? "expired" : "present";

    const base = {
      id: candidate.id,
      kind,
      source: candidate.source,
      human,
      content: candidate.content,
      human_note: candidate.decision_note,
      created_at: candidate.created_at,
      updated_at: candidate.updated_at,
      evidence
    };

    // 线上 runCandidateJudge 对 zone_full 直接 kept，不判。
    if (candidate.source === "zone_full") {
      rows.push({
        ...base,
        judge: "keep",
        agreed: false,
        deterministic: true,
        score: null,
        grounded: null,
        durable: null,
        reason: "zone_full: 线上跳过不判"
      });
      continue;
    }

    // 证据缺失分支：线上不调模型，直接短路成 ungrounded。完全确定性，
    // 不需要模型凭据也能重放，这是 --no-model 下唯一能出结论的一类。
    if (messages.length === 0) {
      const judgeResult: JudgeModelResult = {
        score: 0,
        grounded: false,
        durable: false,
        shouldDelete: null,
        reason: "没有可核对的原始消息，无法确认是否有据"
      };
      const decision = decideJudge(kind, judgeResult, {
        approveMin: args.approveMin,
        discardMax: args.discardMax
      });
      rows.push({
        ...base,
        judge: toOutcome(decision),
        agreed: decision === "approve" ? human === "approved" : decision === "discard" ? human === "discarded" : false,
        deterministic: true,
        score: 0,
        grounded: false,
        durable: false,
        reason: judgeResult.reason
      });
      continue;
    }

    if (!modelAvailable) {
      rows.push({
        ...base,
        judge: "skipped",
        agreed: null,
        deterministic: false,
        score: null,
        grounded: null,
        durable: null,
        reason: "--no-model：有证据，但没跑模型"
      });
      continue;
    }

    const prompt = buildJudgePrompt(candidate, messages, speakers);
    const modelResult = await callJudgeModel(baseUrl, apiKey, model, prompt);
    if (!modelResult) {
      rows.push({
        ...base,
        judge: "failed",
        agreed: null,
        deterministic: false,
        score: null,
        grounded: null,
        durable: null,
        reason: "模型调用失败或返回的 JSON 无法解析"
      });
      continue;
    }

    const decision = decideJudge(kind, modelResult, {
      approveMin: args.approveMin,
      discardMax: args.discardMax
    });
    rows.push({
      ...base,
      judge: toOutcome(decision),
      agreed: decision === "approve" ? human === "approved" : decision === "discard" ? human === "discarded" : false,
      deterministic: false,
      score: modelResult.score,
      grounded: modelResult.grounded,
      durable: modelResult.durable,
      reason: modelResult.reason
    });
  }

  // -------------------------------------------------------------------------
  // 统计
  // -------------------------------------------------------------------------

  const scored = rows.filter((row) => row.agreed !== null);
  const agreed = scored.filter((row) => row.agreed === true).length;
  const humanApproved = scored.filter((row) => row.human === "approved");
  const humanDiscarded = scored.filter((row) => row.human === "discarded");

  // 人工 approve 却被判 discard / keep —— 判定器会吃掉的记忆
  const falseDiscards = humanApproved.filter((row) => row.judge !== "approve");
  // 人工 discard 却被判 approve —— 判定器会放进长期记忆的噪音
  const falseApproves = humanDiscarded.filter((row) => row.judge !== "discard");

  const byEvidence = {
    present: rows.filter((row) => row.evidence === "present").length,
    expired: rows.filter((row) => row.evidence === "expired").length,
    none_recorded: rows.filter((row) => row.evidence === "none_recorded").length
  };

  const pct = (n: number, d: number): string => (d === 0 ? "n/a" : `${((n / d) * 100).toFixed(1)}%`);

  const summary = {
    namespace: args.namespace,
    model: modelAvailable ? model : null,
    mode: modelAvailable ? "full" : "deterministic-only",
    thresholds: { approveMin: args.approveMin, discardMax: args.discardMax },
    labeled_total: rows.length,
    scored_total: scored.length,
    skipped: rows.filter((row) => row.judge === "skipped").length,
    failed: rows.filter((row) => row.judge === "failed").length,
    evidence: byEvidence,
    agreement: { n: agreed, of: scored.length, rate: pct(agreed, scored.length) },
    approve_side: {
      human_approved: humanApproved.length,
      judge_also_approved: humanApproved.length - falseDiscards.length,
      recall: pct(humanApproved.length - falseDiscards.length, humanApproved.length),
      false_discards: falseDiscards.length
    },
    discard_side: {
      human_discarded: humanDiscarded.length,
      judge_also_discarded: humanDiscarded.length - falseApproves.length,
      recall: pct(humanDiscarded.length - falseApproves.length, humanDiscarded.length),
      false_approves: falseApproves.length
    }
  };

  console.log(JSON.stringify(summary, null, 2));

  const sample = (list: ReplayRow[], n: number): ReplayRow[] => list.slice(0, n);
  writeFileSync(
    args.out,
    JSON.stringify(
      {
        summary,
        false_discards: sample(falseDiscards, 50),
        false_approves: sample(falseApproves, 50),
        rows
      },
      null,
      2
    )
  );
  console.log(`\nwrote ${args.out} (${rows.length} rows, ${falseDiscards.length} false discards, ${falseApproves.length} false approves)`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
