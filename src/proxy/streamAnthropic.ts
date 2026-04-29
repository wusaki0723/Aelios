import { saveAssistantMessage } from "../db/messages";
import { saveUsageLog } from "../db/usageLogs";
import { enqueueMemoryMaintenanceIfNeeded, enqueueRetentionIfNeeded } from "../queue/producer";
import { normalizeAnthropicUsage } from "./anthropicAdapter";
import {
  createThinkingFilterState,
  flushPendingDash,
  processStreamChunk,
  type ThinkingFilterState,
} from "../preset/streamFilters";
import type { Env, KeyProfile, TokenUsage } from "../types";
import { getSseData, splitSseEvents } from "../utils/sseParser";

interface StreamAnthropicOptions {
  env: Env;
  ctx: ExecutionContext;
  profile: KeyProfile;
  conversationId: string;
  fromMessageId?: string;
  requestModel: string;
  upstreamModel: string;
  provider: string;
  clientSystemHash?: string | null;
  cacheAnchorBlock?: string | null;
}

interface StreamState {
  assistantText: string;
  reasoningText: string;
  finishReason: string | null;
  usage?: TokenUsage;
  thinkingFilter: ThinkingFilterState;
}

function openAIChunk(delta: { content?: string; reasoning_content?: string }): Uint8Array {
  return new TextEncoder().encode(
    `data: ${JSON.stringify({
      choices: [
        {
          index: 0,
          delta,
          finish_reason: null
        }
      ]
    })}\n\n`
  );
}

function doneChunk(): Uint8Array {
  return new TextEncoder().encode("data: [DONE]\n\n");
}

function consumeAnthropicData(data: string, state: StreamState): { content?: string; reasoning_content?: string } | null {
  try {
    const parsed = JSON.parse(data) as {
      type?: string;
      delta?: {
        type?: string;
        text?: string;
        thinking?: string;
        stop_reason?: string | null;
      };
      usage?: TokenUsage;
      message?: {
        usage?: TokenUsage;
      };
    };

    if (parsed.type === "message_start" && parsed.message?.usage) {
      state.usage = normalizeAnthropicUsage(parsed.message.usage);
    }

    if (parsed.type === "content_block_delta" && parsed.delta?.type === "text_delta" && parsed.delta.text) {
      // Filter visible content: strip leaked <thinking>, replace dashes, remove ■.
      // reasoning_content (thinking_delta) is handled separately and never filtered.
      const filtered = processStreamChunk(parsed.delta.text, state.thinkingFilter);
      if (!filtered) return null;
      state.assistantText += filtered;
      return { content: filtered };
    }

    if (parsed.type === "content_block_delta" && parsed.delta?.type === "thinking_delta" && parsed.delta.thinking) {
      // reasoning_content is NEVER filtered — pass through as-is.
      state.reasoningText += parsed.delta.thinking;
      return { reasoning_content: parsed.delta.thinking };
    }

    if (parsed.type === "message_delta") {
      if (parsed.delta?.stop_reason) state.finishReason = parsed.delta.stop_reason;
      if (parsed.usage) {
        state.usage = normalizeAnthropicUsage({
          ...(state.usage ?? {}),
          ...parsed.usage
        });
      }
    }
  } catch {
    // Ignore malformed provider events while keeping the client stream alive.
  }

  return null;
}

async function persistStreamResult(options: StreamAnthropicOptions, state: StreamState): Promise<void> {
  const messageId = await saveAssistantMessage(options.env.DB, {
    conversationId: options.conversationId,
    namespace: options.profile.namespace,
    source: options.profile.source,
    content: state.assistantText,
    requestModel: options.requestModel,
    upstreamModel: options.upstreamModel,
    provider: options.provider,
    stream: true,
    finishReason: state.finishReason,
    usage: state.usage,
    cacheMode: "anthropic_explicit",
    cacheTtl: options.env.ANTHROPIC_CACHE_TTL || "5m"
  });

  await saveUsageLog(options.env.DB, {
    messageId,
    namespace: options.profile.namespace,
    provider: options.provider,
    model: options.upstreamModel,
    usage: state.usage,
    cacheMode: "anthropic_explicit",
    cacheTtl: options.env.ANTHROPIC_CACHE_TTL || "5m",
    clientSystemHash: options.clientSystemHash ?? null,
    cacheAnchorBlock: options.cacheAnchorBlock ?? null
  });

  await enqueueMemoryMaintenanceIfNeeded(options.env, {
    namespace: options.profile.namespace,
    conversationId: options.conversationId,
    fromMessageId: options.fromMessageId,
    toMessageId: messageId,
    source: options.profile.source
  });

  await enqueueRetentionIfNeeded(options.env, options.profile.namespace);
}

export function streamAnthropicToOpenAI(upstream: Response, options: StreamAnthropicOptions): Response {
  if (!upstream.body) {
    return new Response(upstream.body, {
      status: upstream.status,
      headers: upstream.headers
    });
  }

  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
  const reader = upstream.body.getReader();
  const writer = writable.getWriter();
  const decoder = new TextDecoder();
  const state: StreamState = {
    assistantText: "",
    reasoningText: "",
    finishReason: null,
    thinkingFilter: createThinkingFilterState()
  };

  void (async () => {
    let buffered = "";

    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!value) continue;

        buffered += decoder.decode(value, { stream: true });
        const parsed = splitSseEvents(buffered);
        buffered = parsed.rest;

        for (const event of parsed.events) {
          const data = getSseData(event);
          if (!data) continue;
          const delta = consumeAnthropicData(data, state);
          if (delta) await writer.write(openAIChunk(delta));
        }
      }

      buffered += decoder.decode();
      const parsed = splitSseEvents(buffered);
      for (const event of parsed.events) {
        const data = getSseData(event);
        if (!data) continue;
        const delta = consumeAnthropicData(data, state);
        if (delta) await writer.write(openAIChunk(delta));
      }

      // Flush any trailing dash that was held for cross-chunk collapsing.
      const trailing = flushPendingDash(state.thinkingFilter);
      if (trailing) {
        state.assistantText += trailing;
        await writer.write(openAIChunk({ content: trailing }));
      }

      await writer.write(doneChunk());
      await writer.close();
      options.ctx.waitUntil(
        persistStreamResult(options, state).catch((error) => {
          console.error("failed to persist anthropic stream result", error);
        })
      );
    } catch (error) {
      console.error("anthropic stream proxy error", error);
      await writer.abort(error);
    } finally {
      reader.releaseLock();
      writer.releaseLock();
    }
  })();

  return new Response(readable, {
    status: upstream.status,
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache"
    }
  });
}
