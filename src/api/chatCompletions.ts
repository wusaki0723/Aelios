import { authenticate } from "../auth/apiKey";
import { requireScope } from "../auth/scopes";
import { getOrCreateConversation } from "../db/conversations";
import { saveAssistantMessage, saveUserMessages } from "../db/messages";
import { saveUsageLog } from "../db/usageLogs";
import {
  extractLastUserText,
  formatMemoryPatch,
  injectMemoryPatchBeforeCurrentUser,
} from "../memory/inject";
import { searchMemories } from "../memory/search";
import { assemble } from "../assembler/assemble";
import { enqueueRetentionIfNeeded } from "../queue/producer";
import { listPrecious, markPreciousInjected } from "../db/v2";
import { buildBootPackage, buildCoreFingerprint, isV2Enabled, runRecall } from "../memory/v2/recall";
import {
  buildAnthropicNativeRequest,
  buildAnthropicRequestFromAssembled,
  callAnthropicNative,
  getAnthropicCacheMode,
  parseAnthropicNonStream
} from "../proxy/anthropicAdapter";
import {
  buildOpenAICompatRequest,
  buildOpenAIRequestFromAssembled,
  callOpenAICompat,
} from "../proxy/openaiAdapter";
import { classifyProvider, resolveTargetModel } from "../proxy/resolveModel";
import { streamAnthropicToOpenAI } from "../proxy/streamAnthropic";
import { streamOpenAIWithTee } from "../proxy/streamOpenAI";
import { CONTENT_RULES } from "../preset/regexRules";
import { applyRegexRules } from "../preset/regexPipeline";
import type { Env, OpenAIChatMessage, OpenAIChatRequest, OpenAIChatResponse } from "../types";
import { openAiError } from "../utils/json";
import { hasImageContent } from "../utils/messages";

function extractAssistantText(response: OpenAIChatResponse): string {
  const message = response.choices?.[0]?.message;
  if (!message) return "";

  if (typeof message.content === "string") return message.content;
  if (message.content == null) return "";
  return JSON.stringify(message.content);
}

export function hasToolContent(body: OpenAIChatRequest): boolean {
  return body.messages.some(
    (m) => m.role === "tool" || (m.role === "assistant" && m.tool_calls != null)
  );
}

export function hasTools(body: OpenAIChatRequest): boolean {
  return Array.isArray(body.tools) && body.tools.length > 0;
}

/** Determine whether this request needs the tool-call passthrough path. */
export function hasToolRound(body: OpenAIChatRequest): boolean {
  return hasTools(body) || hasToolContent(body);
}

function recallHitToMemoryRecord(
  h: {
    id: string;
    type: string;
    content: string;
    score: number;
    source_layer: string;
  },
  namespace: string
) {
  return {
    id: h.id,
    namespace,
    type: h.type,
    content: h.content,
    summary: null,
    importance: h.score,
    confidence: 1,
    status: "active",
    pinned: false,
    tags: [] as string[],
    source: h.source_layer,
    source_message_ids: [] as string[],
    vector_id: null,
    last_recalled_at: null,
    recall_count: 0,
    created_at: "",
    updated_at: "",
    expires_at: null,
    fact_key: null,
    supersedes_id: null,
    superseded_by_id: null,
    review_reason: null,
    valid_as_of: null,
    last_seen_at: null,
    seen_count: 0,
    last_injected_at: null,
    score: h.score,
  };
}

export async function handleChatCompletions(
  request: Request,
  env: Env,
  ctx: ExecutionContext
): Promise<Response> {
  const auth = await authenticate(request, env);
  if (!auth.ok) return openAiError("Unauthorized", 401, "authentication_error");

  const scopeError = requireScope(auth.profile, "chat:proxy");
  if (scopeError) return scopeError;

  let body: OpenAIChatRequest;
  try {
    body = (await request.json()) as OpenAIChatRequest;
  } catch {
    return openAiError("Request body must be valid JSON", 400);
  }

  if (!Array.isArray(body.messages)) {
    return openAiError("messages must be an array", 400);
  }

  let targetModel: string;
  try {
    targetModel = resolveTargetModel(body.model, auth.profile, env);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to resolve target model";
    return openAiError(message, 500);
  }

  if (hasImageContent(body)) {
    if (!env.VISION_MODEL) return openAiError("Missing VISION_MODEL", 500);
    targetModel = env.VISION_MODEL;
  }

  const provider = classifyProvider(targetModel);

  const namespace = auth.profile.namespace;
  const lastUserText = extractLastUserText(body.messages);

  // Two independent pre-upstream chains under one Promise.all:
  // A: conversation + save user messages (serial inside chain — save needs conversation.id)
  // B: precious → fingerprint → Promise.all(boot, recall) when v2 is enabled
  const [chainA, chainB] = await Promise.all([
    (async () => {
      const conversation = await getOrCreateConversation(env.DB, { namespace });
      const savedUserMessageIds = await saveUserMessages(env.DB, {
        conversationId: conversation.id,
        namespace,
        source: auth.profile.source,
        messages: body.messages,
        requestModel: body.model,
        upstreamModel: targetModel,
        upstreamProvider: provider,
        stream: Boolean(body.stream)
      });
      return { conversation, savedUserMessageIds };
    })(),
    (async () => {
      if (!isV2Enabled(env)) {
        return {
          boot: null as Awaited<ReturnType<typeof buildBootPackage>> | null,
          recallResult: null as Awaited<ReturnType<typeof runRecall>> | null
        };
      }
      const preciousRows = await listPrecious(env.DB, { namespace, limit: 50 });
      const coreFingerprint = buildCoreFingerprint(preciousRows.map((r) => r.content));
      const [boot, recallResult] = await Promise.all([
        buildBootPackage(env, { namespace, preciousRows }),
        runRecall(env, {
          namespace,
          query: lastUserText,
          core_fingerprint: coreFingerprint,
          waitUntil: ctx.waitUntil.bind(ctx)
        })
      ]);
      return { boot, recallResult };
    })()
  ]);

  const { conversation, savedUserMessageIds } = chainA;
  const latestUserMessageId = savedUserMessageIds[savedUserMessageIds.length - 1];
  const boot = chainB.boot;
  const recallResult = chainB.recallResult;

  // Precious injection accounting: off response path (was inside buildBootPackage).
  if (boot && boot.precious.length > 0) {
    ctx.waitUntil(
      markPreciousInjected(env.DB, {
        namespace,
        ids: boot.precious.map((p) => p.id)
      })
    );
  }

  const recallHitsAsMemories = recallResult
    ? recallResult.hits.map((h) => recallHitToMemoryRecord(h, namespace))
    : [];

  let upstream: Response;
  let clientSystemHash: string | null = null;
  let cacheAnchorBlock: string | null = null;
  try {
    if (!isV2Enabled(env)) {
      const ragMemories = lastUserText
        ? await searchMemories(env, {
            namespace,
            query: lastUserText,
            waitUntil: ctx.waitUntil.bind(ctx)
          })
        : [];
      const memoryPatch = formatMemoryPatch(ragMemories);
      const patchedBody: OpenAIChatRequest = {
        ...body,
        messages: injectMemoryPatchBeforeCurrentUser(body.messages, memoryPatch),
      };

      if (provider === "anthropic") {
        upstream = await callAnthropicNative(
          env,
          await buildAnthropicNativeRequest(patchedBody, {
            env,
            targetModel,
            namespace,
            boot: null,
            recallHits: [],
          }),
          targetModel
        );
      } else {
        upstream = await callOpenAICompat(env, buildOpenAICompatRequest(patchedBody, targetModel));
      }
    } else if (provider === "anthropic") {
      const assembled = assemble({
        request: body,
        pinnedPersonaMemories: null,
        boot,
        ragMemories: recallHitsAsMemories,
        visionOutput: null,
      });
      clientSystemHash = assembled.meta.client_system_hash;
      cacheAnchorBlock = assembled.meta.anchor_index >= 0 ? "persona_pinned" : null;
      upstream = await callAnthropicNative(
        env,
        buildAnthropicRequestFromAssembled(body, targetModel, assembled, env),
        targetModel
      );
    } else {
      const assembled = assemble({
        request: body,
        pinnedPersonaMemories: null,
        boot,
        ragMemories: recallHitsAsMemories,
        visionOutput: null,
      });
      clientSystemHash = assembled.meta.client_system_hash;
      upstream = await callOpenAICompat(
        env,
        buildOpenAIRequestFromAssembled(body, targetModel, assembled)
      );
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to call upstream";
    return openAiError(message, 502);
  }

  if (!upstream.ok) {
    const errorText = await upstream.text();
    return new Response(errorText, {
      status: upstream.status,
      headers: {
        "content-type": upstream.headers.get("content-type") || "application/json; charset=utf-8"
      }
    });
  }

  if (body.stream) {
    if (provider === "anthropic") {
      return streamAnthropicToOpenAI(upstream, {
        env,
        ctx,
        profile: auth.profile,
        conversationId: conversation.id,
        fromMessageId: latestUserMessageId,
        requestModel: body.model,
        upstreamModel: targetModel,
        provider,
        clientSystemHash,
        cacheAnchorBlock
      });
    }

    return streamOpenAIWithTee(upstream, {
      env,
      ctx,
      profile: auth.profile,
      conversationId: conversation.id,
      fromMessageId: latestUserMessageId,
      requestModel: body.model,
      upstreamModel: targetModel,
      provider,
      clientSystemHash,
      cacheAnchorBlock
    });
  }

  const responseText = await upstream.text();

  if (provider === "anthropic") {
    let anthropicParsed: unknown;
    try {
      anthropicParsed = JSON.parse(responseText) as unknown;
    } catch {
      return openAiError("Upstream returned invalid JSON", 502);
    }

    const parsed = parseAnthropicNonStream(anthropicParsed as never);
    const anthropicCacheMode = getAnthropicCacheMode(env);
    // Filter visible content only — reasoning_content is preserved upstream.
    const filteredContent = applyRegexRules(parsed.content, CONTENT_RULES);
    if (parsed.openai.choices?.[0]?.message) {
      parsed.openai.choices[0].message.content = filteredContent;
    }
    const assistantMessageId = await saveAssistantMessage(env.DB, {
      conversationId: conversation.id,
      namespace: auth.profile.namespace,
      source: auth.profile.source,
      content: filteredContent,
      requestModel: body.model,
      upstreamModel: targetModel,
      provider,
      stream: false,
      finishReason: parsed.finishReason,
      usage: parsed.usage,
      cacheMode: anthropicCacheMode,
      cacheTtl: env.ANTHROPIC_CACHE_TTL || "5m"
    });

    ctx.waitUntil(
      Promise.all([
        saveUsageLog(env.DB, {
          messageId: assistantMessageId,
          namespace: auth.profile.namespace,
          provider,
          model: targetModel,
          usage: parsed.usage,
          cacheMode: anthropicCacheMode,
          cacheTtl: env.ANTHROPIC_CACHE_TTL || "5m",
          clientSystemHash,
          cacheAnchorBlock
        }),
        enqueueRetentionIfNeeded(env, auth.profile.namespace)
      ])
    );

    return new Response(JSON.stringify(parsed.openai), {
      status: 200,
      headers: {
        "content-type": "application/json; charset=utf-8"
      }
    });
  }

  let parsed: OpenAIChatResponse;
  try {
    parsed = JSON.parse(responseText) as OpenAIChatResponse;
  } catch {
    return openAiError("Upstream returned invalid JSON", 502);
  }

  const assistantContent = extractAssistantText(parsed);
  const filteredContent = applyRegexRules(assistantContent, CONTENT_RULES);
  // Patch the response that goes back to the client.
  if (parsed.choices?.[0]?.message) {
    parsed.choices[0].message.content = filteredContent;
  }
  const assistantMessageId = await saveAssistantMessage(env.DB, {
    conversationId: conversation.id,
    namespace: auth.profile.namespace,
    source: auth.profile.source,
    content: filteredContent,
    requestModel: body.model,
    upstreamModel: targetModel,
    provider,
    stream: false,
    finishReason: parsed.choices?.[0]?.finish_reason,
    usage: parsed.usage
  });

  ctx.waitUntil(
    Promise.all([
      saveUsageLog(env.DB, {
        messageId: assistantMessageId,
        namespace: auth.profile.namespace,
        provider,
        model: targetModel,
        usage: parsed.usage,
        clientSystemHash,
        cacheAnchorBlock
      }),
      enqueueRetentionIfNeeded(env, auth.profile.namespace)
    ])
  );

  return new Response(JSON.stringify(parsed), {
    status: 200,
    headers: {
      "content-type": "application/json; charset=utf-8"
    }
  });
}
