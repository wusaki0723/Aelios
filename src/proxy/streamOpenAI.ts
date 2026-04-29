import { saveAssistantMessage } from "../db/messages";
import { saveUsageLog } from "../db/usageLogs";
import { enqueueMemoryMaintenanceIfNeeded, enqueueRetentionIfNeeded } from "../queue/producer";
import {
  createThinkingFilterState,
  flushPendingDash,
  processStreamChunk,
  type ThinkingFilterState,
} from "../preset/streamFilters";
import type { Env, KeyProfile, TokenUsage } from "../types";
import { getSseData, splitSseEvents } from "../utils/sseParser";

interface StreamOpenAIOptions {
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
  finishReason: string | null;
  usage?: TokenUsage;
  thinkingFilter: ThinkingFilterState;
}

/**
 * Parse an OpenAI SSE data payload and apply stream content filters.
 * Returns the filtered SSE event bytes to write to the client.
 *
 * - content: filtered through processStreamChunk (strips <thinking>, replaces dashes, removes ■)
 * - reasoning_content: passed through as-is, NEVER filtered
 * - If both are present in the same delta, both are handled independently.
 *   Only drops the chunk if content is fully consumed AND there's no reasoning_content.
 * - usage: passed through as-is
 * - [DONE]: flushes any held trailing dash first, then passes [DONE]
 * - finish_reason: passed through as-is
 *
 * Returns null only if the entire chunk has nothing to emit.
 */
function filterOpenAISSEData(
  data: string,
  state: StreamState
): Uint8Array | null {
  if (data === "[DONE]") {
    const trailing = flushPendingDash(state.thinkingFilter);
    if (!trailing) return new TextEncoder().encode("data: [DONE]\n\n");

    state.assistantText += trailing;
    const trailingChunk = {
      choices: [{ index: 0, delta: { content: trailing }, finish_reason: null }]
    };
    return new TextEncoder().encode(
      `data: ${JSON.stringify(trailingChunk)}\n\ndata: [DONE]\n\n`
    );
  }

  try {
    const parsed = JSON.parse(data) as {
      choices?: Array<{
        delta?: {
          content?: string;
          reasoning_content?: string;
        };
        finish_reason?: string | null;
      }>;
      usage?: TokenUsage;
    };

    const choice = parsed.choices?.[0];

    // Track finish_reason and usage for DB persistence (never filter these).
    if (choice?.finish_reason) state.finishReason = choice.finish_reason;
    if (parsed.usage) state.usage = parsed.usage;

    const hasReasoning = Boolean(choice?.delta?.reasoning_content);
    const hasContent = Boolean(choice?.delta?.content);

    // Filter content if present.
    if (hasContent && choice?.delta) {
      const filtered = processStreamChunk(choice.delta.content!, state.thinkingFilter);
      if (filtered) {
        choice.delta.content = filtered;
        state.assistantText += filtered;
      } else {
        // Content fully consumed by <thinking>. Remove it from delta.
        delete choice.delta.content;
      }
    }

    // If the delta still has something to send (reasoning or filtered content), emit it.
    if (hasReasoning || choice?.delta?.content) {
      return new TextEncoder().encode(`data: ${JSON.stringify(parsed)}\n\n`);
    }

    // Delta is empty — but if there's finish_reason or usage, still emit.
    if (choice?.finish_reason || parsed.usage) {
      return new TextEncoder().encode(`data: ${JSON.stringify(parsed)}\n\n`);
    }

    // Entirely consumed (e.g., content-only chunk fully eaten by <thinking>).
    return null;
  } catch {
    // Malformed JSON — pass through raw to avoid breaking the stream.
    return new TextEncoder().encode(`data: ${data}\n\n`);
  }
}

async function persistStreamResult(options: StreamOpenAIOptions, state: StreamState): Promise<void> {
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
    usage: state.usage
  });

  await saveUsageLog(options.env.DB, {
    messageId,
    namespace: options.profile.namespace,
    provider: options.provider,
    model: options.upstreamModel,
    usage: state.usage,
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

export function streamOpenAIWithTee(upstream: Response, options: StreamOpenAIOptions): Response {
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
          const filtered = filterOpenAISSEData(data, state);
          if (filtered) await writer.write(filtered);
        }
      }

      buffered += decoder.decode();
      const parsed = splitSseEvents(buffered);
      for (const event of parsed.events) {
        const data = getSseData(event);
        if (!data) continue;
        const filtered = filterOpenAISSEData(data, state);
        if (filtered) await writer.write(filtered);
      }

      // Flush any trailing dash that was held for cross-chunk collapsing.
      const trailing = flushPendingDash(state.thinkingFilter);
      if (trailing) {
        state.assistantText += trailing;
        const trailingChunk = {
          choices: [{ index: 0, delta: { content: trailing }, finish_reason: null }]
        };
        await writer.write(new TextEncoder().encode(`data: ${JSON.stringify(trailingChunk)}\n\n`));
      }

      await writer.close();
      options.ctx.waitUntil(
        persistStreamResult(options, state).catch((error) => {
          console.error("failed to persist stream result", error);
        })
      );
    } catch (error) {
      console.error("openai stream proxy error", error);
      await writer.abort(error);
    } finally {
      reader.releaseLock();
      writer.releaseLock();
    }
  })();

  const headers = new Headers(upstream.headers);
  headers.set("content-type", "text/event-stream; charset=utf-8");
  headers.set("cache-control", "no-cache");

  return new Response(readable, {
    status: upstream.status,
    headers
  });
}
