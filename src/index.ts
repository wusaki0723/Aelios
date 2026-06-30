import { handleAdmin } from "./api/admin";
import { handleHealth } from "./api/health";
import { handleCache } from "./api/cache";
import { handleCacheHealth, handleVectorHealth, handleVectorReindex } from "./api/debug";
import { handleChatCompletions } from "./api/chatCompletions";
import { handleGuideDogChatCompletions } from "./api/guideDog";
import {
  handleGlossaryApi,
  handleIngestMessagesApi,
  handleMemories,
  handleMemoryBoot,
  handleMemoryCandidates,
  handleLongtailApi,
  handlePrecious,
  handleSearchMemoriesApi
} from "./api/memories";
import { handleMcp } from "./api/mcp";
import { handleModels } from "./api/models";
import { runDailyMemoryDigest } from "./memory/dailyDigest";
import { runMemoryExtractionBatches } from "./memory/extractPipeline";
import { runMemoryRetention } from "./memory/retention";
import { handleQueueMessage } from "./queue/consumer";
import type { Env, QueueMessage } from "./types";
import { openAiError } from "./utils/json";

const EXTRACT_CRON = "0 */4 * * *";
const DAILY_MAINTENANCE_CRON = "10 20 * * *";

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
    const result = await runDailyMemoryDigest(env, namespace);
    results.push(result);
    if (!result.ran || !result.stats?.hasMore) break;
  }

  return results;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "GET" && (url.pathname === "/admin" || url.pathname === "/memory-admin")) {
      return handleAdmin();
    }

    if (request.method === "GET" && url.pathname === "/health") {
      return handleHealth(env);
    }

    if (request.method === "GET" && url.pathname === "/v1/models") {
      return handleModels(request, env);
    }

    if (request.method === "POST" && url.pathname === "/v1/chat/completions") {
      return handleChatCompletions(request, env, ctx);
    }

    if (
      request.method === "POST" &&
      (url.pathname === "/v1/guide-dog/chat/completions" || url.pathname === "/guide-dog/v1/chat/completions")
    ) {
      return handleGuideDogChatCompletions(request, env);
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

    if (url.pathname === "/v1/memory" || url.pathname.startsWith("/v1/memory/")) {
      return handleMemories(request, env, ctx);
    }

    if (url.pathname === "/v1/memory_boot") {
      return handleMemoryBoot(request, env);
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

    if (url.pathname.startsWith("/v1/cache/")) {
      return handleCache(request, env);
    }

    if (request.method === "GET" && url.pathname === "/v1/debug/cache_health") {
      return handleCacheHealth(request, env);
    }

    if (request.method === "GET" && url.pathname === "/v1/debug/vector_health") {
      return handleVectorHealth(request, env);
    }

    if (request.method === "POST" && url.pathname === "/v1/debug/vector_reindex") {
      return handleVectorReindex(request, env);
    }

    return openAiError("Not found", 404);
  },

  async queue(batch: MessageBatch<QueueMessage>, env: Env): Promise<void> {
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

  async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    const namespace = getDailyDigestNamespace(env);
    const cron = controller.cron;
    const shouldRunExtract = !cron || cron === EXTRACT_CRON;
    const shouldRunDailyMaintenance = !cron || cron === DAILY_MAINTENANCE_CRON;
    const tasks: Array<Promise<unknown>> = [];

    if (shouldRunExtract) {
      tasks.push(runMemoryExtractionBatches(env, namespace, { scheduledTime: controller.scheduledTime }));
    }

    if (shouldRunDailyMaintenance) {
      tasks.push(
        Promise.all([
          runDailyMemoryDigestBatches(env, namespace),
          runMemoryRetention(env, namespace)
        ]).then(([digest, retention]) => ({ digest, retention }))
      );
    }

    if (tasks.length === 0) {
      console.log("scheduled memory maintenance skipped unknown cron", { namespace, cron });
      return;
    }

    ctx.waitUntil(
      Promise.all(tasks).then((results) => {
        console.log("scheduled memory maintenance", { namespace, cron, results });
      })
    );
  }
};
