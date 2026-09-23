import {
  handleAdmin,
  handleDiaryAdmin,
  handleDiaryRewriteAdmin,
  handleMonthlyRollupAdmin,
  handleStarmap,
  handleWeeklyRollupAdmin,
  handleWeeklyApproveAdmin
} from "./api/admin";
import { handleHealth } from "./api/health";
import { handleVectorBackfill, handleVectorDoctor, handleVectorHealth, handleVectorReindex } from "./api/debug";
import { handleDreamHarvest, handleDreamRun, handleDreamStatus } from "./api/dream";
import { handleGateway } from "./gateway/handler";
import { handleGatewayAdmin, handleGatewayEnv, handleRecallHistory } from "./gateway/admin";
import { identityNamespace, loadConfig, loadSettings, type Protocol } from "./gateway/config";
import { applySettings } from "./gateway/settings";
import { handleGuideDogChatCompletions } from "./api/guideDog";
import {
  handleGlossaryApi,
  handleIngestMessagesApi,
  handleMemories,
  handleMemoryBoot,
  handleMemoryCandidates,
  handleLongtailApi,
  handlePrecious,
  handleSearchMemoriesApi,
  handleDiaryApi
} from "./api/memories";
import { handleMcp } from "./api/mcp";
import { handleModels } from "./api/models";
import { handleRelationsGraph } from "./api/relations";
import { runCandidateJudge } from "./memory/candidateJudge";
import { runDailyMemoryDigest, runDreamBackfill } from "./memory/dailyDigest";
import { backfillFts } from "./memory/fts";
import { runVectorBackfill } from "./memory/vectorBackfill";
import {
  runDiaryTrigger,
  runGithubDailyTrigger,
  runMonthlyRollupTrigger,
  runWeeklyRollupTrigger
} from "./memory/dream/rollupPhase";
import { runMemoryRetention } from "./memory/retention";
import { handleQueueMessage } from "./queue/consumer";
import type { Env, QueueMessage } from "./types";
import { openAiError } from "./utils/json";

const DAILY_MAINTENANCE_CRON = "10 20 * * *";

const GATEWAY_ENDPOINTS: Record<string, Protocol> = {
  "chat/completions": "chat",
  messages: "messages",
  responses: "responses"
};

/** Identities live in the first path segment: /<identity>/v1/... , or /v1/... for the key default. */
export function gatewayRoute(pathname: string): { slug: string | null; endpoint: string } | null {
  const parts = pathname.replace(/^\/+|\/+$/g, "").split("/");
  const version = parts.indexOf("v1");
  if (version < 0 || version > 1) return null;
  return { slug: version === 1 ? parts[0] : null, endpoint: parts.slice(version + 1).join("/") };
}

function getDailyDigestNamespace(env: Env): string {
  return env.DREAM_NAMESPACE?.trim() || "default";
}

function getDailyDigestMaxRuns(env: Env): number {
  const parsed = Number(env.DREAM_MAX_RUNS || env.DAILY_DIGEST_MAX_RUNS || 10);
  if (!Number.isFinite(parsed)) return 10;
  return Math.min(Math.max(Math.floor(parsed), 1), 10);
}

async function runDailyMemoryDigestBatches(env: Env, namespace: string): Promise<unknown[]> {
  const results: unknown[] = [];
  const maxRuns = getDailyDigestMaxRuns(env);

  for (let i = 0; i < maxRuns; i += 1) {
    const result = await runDailyMemoryDigest(env, namespace, { trigger: "cron" });
    results.push({ type: "primary", result });
    if (!result.ran || !result.stats?.hasMore) break;
  }

  const backfill = await runDreamBackfill(env, namespace, { maxDates: 2, lookback: 3 });
  for (const item of backfill) {
    results.push({ type: "backfill", date_label: item.dateLabel, result: item.result });
  }

  return results;
}

export default {
  async fetch(request: Request, deployed: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/admin/gateway") return new Response(null, { status: 302, headers: { location: "/admin", "cache-control": "no-store" } });
    // The admin endpoints report and edit the deployed values, so they run before the overrides.
    if (url.pathname === "/api/gateway/config") return handleGatewayAdmin(request, deployed);
    if (request.method === "GET" && url.pathname === "/api/gateway/env") return handleGatewayEnv(request, deployed);

    if (request.method === "GET" && url.pathname === "/api/gateway/recalls") return handleRecallHistory(request, deployed);

    const env = applySettings(deployed, await loadSettings(deployed));

    if (
      request.method === "POST" &&
      (url.pathname === "/v1/guide-dog/chat/completions" || url.pathname === "/guide-dog/v1/chat/completions")
    ) {
      return handleGuideDogChatCompletions(request, env);
    }

    const route = gatewayRoute(url.pathname);
    if (route) {
      const protocol = GATEWAY_ENDPOINTS[route.endpoint];
      if (protocol && request.method === "POST") return handleGateway(request, env, ctx, protocol, route.slug);
      if (route.endpoint === "models" && request.method === "GET") return handleModels(request, env, route.slug);
    }

    if (request.method === "GET" && (url.pathname === "/admin" || url.pathname === "/memory-admin")) {
      return handleAdmin();
    }

    if (request.method === "GET" && url.pathname === "/admin/starmap") {
      return handleStarmap();
    }

    if (request.method === "POST" && url.pathname === "/admin/weekly-rollup") {
      return handleWeeklyRollupAdmin(request, env);
    }

    if (request.method === "POST" && url.pathname === "/admin/weekly-approve") {
      return handleWeeklyApproveAdmin(request, env);
    }

    if (request.method === "POST" && url.pathname === "/admin/monthly-rollup") {
      return handleMonthlyRollupAdmin(request, env);
    }

    if (request.method === "GET" && url.pathname === "/admin/diary") {
      return handleDiaryAdmin(request, env);
    }

    if (request.method === "POST" && url.pathname === "/admin/diary-rewrite") {
      return handleDiaryRewriteAdmin(request, env);
    }

    if (request.method === "GET" && url.pathname === "/health") {
      return handleHealth(env);
    }

    if (url.pathname === "/mcp" || url.pathname === "/memory-mcp") {
      return handleMcp(request, env, ctx);
    }

    if (url.pathname.startsWith("/v1/memories")) {
      return handleMemories(request, env, ctx);
    }

    if (url.pathname === "/api/memories/export") {
      return handleMemories(request, env, ctx);
    }

    if (request.method === "GET" && url.pathname === "/api/relations/graph") {
      return handleRelationsGraph(request, env);
    }

    if (url.pathname === "/v1/memory" || url.pathname.startsWith("/v1/memory/")) {
      return handleMemories(request, env, ctx);
    }

    if (url.pathname === "/v1/memory_boot") {
      return handleMemoryBoot(request, env);
    }

    if (url.pathname === "/v1/diary" || url.pathname === "/v1/diary/recent") {
      return handleDiaryApi(request, env);
    }

    if (url.pathname === "/v1/precious" || url.pathname.startsWith("/v1/precious/")) {
      return handlePrecious(request, env);
    }

    if (url.pathname === "/v1/glossary" || url.pathname.startsWith("/v1/glossary/")) {
      return handleGlossaryApi(request, env);
    }

    if (url.pathname.startsWith("/v1/longtail/")) {
      return handleLongtailApi(request, env);
    }

    if (url.pathname === "/v1/candidates" || url.pathname.startsWith("/v1/candidates/")) {
      return handleMemoryCandidates(request, env);
    }

    if (
      request.method === "POST" &&
      (url.pathname === "/v1/ingest/messages" || url.pathname === "/v1/messages/ingest")
    ) {
      return handleIngestMessagesApi(request, env, ctx);
    }

    if (request.method === "POST" && url.pathname === "/v1/search/memories") {
      return handleSearchMemoriesApi(request, env);
    }

    if (request.method === "GET" && url.pathname === "/v1/debug/vector_health") {
      return handleVectorHealth(request, env);
    }

    if (request.method === "POST" && url.pathname === "/v1/debug/vector_reindex") {
      return handleVectorReindex(request, env);
    }

    if (request.method === "POST" && url.pathname === "/v1/vector-doctor") {
      return handleVectorDoctor(request, env);
    }

    if (request.method === "POST" && url.pathname === "/v1/vector-backfill") {
      return handleVectorBackfill(request, env);
    }

    if (request.method === "GET" && url.pathname === "/admin/dream/harvest") {
      return handleDreamHarvest(request, env);
    }

    if (request.method === "GET" && url.pathname === "/v1/dream/status") {
      return handleDreamStatus(request, env);
    }

    if (request.method === "POST" && url.pathname === "/v1/dream/run") {
      return handleDreamRun(request, env);
    }

    return openAiError("Not found", 404);
  },

  async queue(batch: MessageBatch<QueueMessage>, deployed: Env): Promise<void> {
    const env = applySettings(deployed, await loadSettings(deployed));
    for (const message of batch.messages) {
      try {
        await handleQueueMessage(message.body, env);
        message.ack();
      } catch (error) {
        console.error("queue message failed", error);
        message.retry();
      }
    }
  },

  async scheduled(controller: ScheduledController, deployed: Env, ctx: ExecutionContext): Promise<void> {
    const env = applySettings(deployed, await loadSettings(deployed));
    const cron = controller.cron;
    const shouldRunDailyMaintenance = !cron || cron === DAILY_MAINTENANCE_CRON;

    if (!shouldRunDailyMaintenance) {
      console.log("scheduled memory maintenance skipped unknown cron", { cron });
      return;
    }

    ctx.waitUntil(
      (async () => {
        const config = await loadConfig(env);
        const namespaces = [...new Set([getDailyDigestNamespace(env),
          ...config.identities.filter(i => i.models.length).map(i => identityNamespace(i))])];
        for (const namespace of namespaces) {
          try {
            const results: unknown[] = [];

            const dreamResults = await runDailyMemoryDigestBatches(env, namespace);
            results.push({ type: "dream_batches", results: dreamResults });

            try {
              results.push({ type: "candidate_judge", result: await runCandidateJudge(env, namespace) });
            } catch (error) {
              console.error("scheduled candidate judge failed", {
                namespace,
                error: error instanceof Error ? error.message : String(error)
              });
              results.push({ type: "candidate_judge", result: { ran: false, error: String(error) } });
            }

            // Rollup phase triggers (diary → github∥retention → weekly → monthly). Order preserved.
            let diaryWriter: Awaited<ReturnType<typeof runDiaryTrigger>> | undefined;
            try {
              diaryWriter = await runDiaryTrigger(env, namespace);
            } catch (error) {
              console.error("scheduled diary writer failed", {
                namespace,
                error: error instanceof Error ? error.message : String(error)
              });
            }
            results.push({ type: "diary_writer", result: diaryWriter ?? { ok: false } });

            const [retentionResult, githubResult] = await Promise.all([
              runMemoryRetention(env, namespace).then(
                (retention) => ({ ok: true as const, retention }),
                (error) => {
                  console.error("scheduled memory retention failed", { namespace, error: String(error) });
                  return { ok: false as const, error: String(error) };
                }
              ),
              // 04:10 SGT cron (20:10 UTC) runs ~4h after cmh-lite's 23:50 local push — safe to pull yesterday's daily.
              (namespace === namespaces[0] ? runGithubDailyTrigger(env) : Promise.resolve({ skipped: true })).then(
                (r) => {
                  console.log("github daily pull", r);
                  return r;
                },
                (e) => {
                  console.error("github daily pull failed", String(e));
                  return { ok: false };
                }
              )
            ]);
            results.push({ type: "retention", result: retentionResult });
            results.push({ type: "github_daily", result: githubResult });

            try {
              results.push({
                type: "fts_backfill",
                result: await backfillFts(env.DB, { namespace, limit: 400 })
              });
            } catch (error) {
              console.error("scheduled fts backfill failed", {
                namespace,
                error: error instanceof Error ? error.message : String(error)
              });
              results.push({ type: "fts_backfill", result: { ok: false, error: String(error) } });
            }

            // 有记忆没向量的 (直接写 D1 的、embedding 当时失败的) 每天自动补一轮，每轮最多 50 条。
            try {
              const report = await runVectorBackfill(env, { namespace, dryRun: false, limit: 50 });
              results.push({
                type: "vector_backfill",
                result: {
                  active_memories: report.active_memories,
                  counts: report.counts,
                  unchecked: report.unchecked,
                  repair: report.repair && { ...report.repair, failed: report.repair.failed.slice(0, 10) },
                  errors: report.errors
                }
              });
            } catch (error) {
              console.error("scheduled vector backfill failed", {
                namespace,
                error: error instanceof Error ? error.message : String(error)
              });
              results.push({ type: "vector_backfill", result: { ok: false, error: String(error) } });
            }

            let weeklyRollup: Awaited<ReturnType<typeof runWeeklyRollupTrigger>> | undefined;
            try {
              weeklyRollup = await runWeeklyRollupTrigger(env, namespace);
            } catch (error) {
              console.error("scheduled weekly rollup failed", {
                namespace,
                error: error instanceof Error ? error.message : String(error)
              });
            }
            results.push({ type: "weekly_rollup", result: weeklyRollup ?? { ok: false } });

            let monthlyRollup: Awaited<ReturnType<typeof runMonthlyRollupTrigger>> | undefined;
            try {
              monthlyRollup = await runMonthlyRollupTrigger(env, namespace);
            } catch (error) {
              console.error("scheduled monthly rollup failed", {
                namespace,
                error: error instanceof Error ? error.message : String(error)
              });
            }
            results.push({ type: "monthly_rollup", result: monthlyRollup ?? { ok: false } });

            console.log("scheduled memory maintenance", { namespace, cron, results });
          } catch (error) {
            console.error("scheduled namespace maintenance failed", { namespace, error: String(error) });
          }
        }
      })()
    );
  }
};
