import type { AssembledPrompt } from "../assembler/types";
import { assembledToOpenAIChatMessages } from "../assembler/toOpenAI";
import type { Env, OpenAIChatRequest, OpenAIChatResponse } from "../types";

function workersAiModelName(model: string): string | null {
  const normalized = model.trim();
  if (normalized.startsWith("workers-ai/")) return normalized.slice("workers-ai/".length);
  if (normalized.startsWith("worker/")) return normalized.slice("worker/".length);
  if (normalized.startsWith("@cf/")) return normalized;
  return null;
}

function readWorkersAiChatContent(result: unknown): string {
  if (!result || typeof result !== "object") return "";
  const value = result as {
    response?: unknown;
    choices?: unknown;
    answer?: unknown;
    caption?: unknown;
    result?: unknown;
  };
  if (typeof value.response === "string") return value.response;
  if (typeof value.answer === "string") return value.answer;
  if (typeof value.caption === "string") return value.caption;
  // Moondream nests its payload one level down: {result: {answer, caption, …}, usage}.
  if (value.result && typeof value.result === "object") {
    const nested = value.result as { answer?: unknown; caption?: unknown; response?: unknown };
    if (typeof nested.answer === "string") return nested.answer;
    if (typeof nested.caption === "string") return nested.caption;
    if (typeof nested.response === "string") return nested.response;
  }
  if (Array.isArray(value.choices)) {
    const first = value.choices[0] as { message?: { content?: unknown } } | undefined;
    if (typeof first?.message?.content === "string") return first.message.content;
  }
  return "";
}

// Moondream takes {task, image, question} instead of OpenAI-style messages.
function isMoondreamModel(model: string): boolean {
  return model.toLowerCase().includes("moondream");
}

function buildMoondreamRunInput(body: OpenAIChatRequest): Record<string, unknown> {
  let image: string | undefined;
  const textParts: string[] = [];
  for (const message of body.messages ?? []) {
    const content = (message as { content?: unknown }).content;
    if (typeof content === "string") {
      if (content.trim()) textParts.push(content.trim());
      continue;
    }
    if (!Array.isArray(content)) continue;
    for (const part of content) {
      if (!part || typeof part !== "object") continue;
      const typed = part as { type?: unknown; text?: unknown; image_url?: unknown };
      if (typed.type === "text" && typeof typed.text === "string" && typed.text.trim()) {
        textParts.push(typed.text.trim());
      }
      if (typed.type === "image_url" || typed.type === "input_image") {
        const raw = typed.image_url;
        const url =
          typeof raw === "string" ? raw : raw && typeof raw === "object" ? (raw as { url?: unknown }).url : undefined;
        if (typeof url === "string" && url) image = url;
      }
    }
  }
  const input: Record<string, unknown> = {
    task: "query",
    question: textParts.join("\n") || "What's in this image?",
    reasoning: false,
    stream: false
  };
  if (image) input.image = image;
  if (body.temperature !== undefined) input.temperature = body.temperature;
  // 无上限时 moondream 会在低信息量图片上复读到天荒地老，必须封顶。
  input.max_tokens = body.max_tokens !== undefined ? body.max_tokens : 768;
  return input;
}

function toSingleChunkSse(response: OpenAIChatResponse): string {
  const chunk = {
    id: response.id,
    object: "chat.completion.chunk",
    created: response.created,
    model: response.model,
    choices: [
      {
        index: 0,
        delta: { role: "assistant", content: response.choices?.[0]?.message?.content ?? "" },
        finish_reason: "stop"
      }
    ]
  };
  return `data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`;
}

function buildWorkersAiRunInput(body: OpenAIChatRequest): Record<string, unknown> {
  const input: Record<string, unknown> = {
    messages: body.messages
  };
  if (body.temperature !== undefined) input.temperature = body.temperature;
  if (body.max_tokens !== undefined) input.max_tokens = body.max_tokens;
  if (body.chat_template_kwargs !== undefined) input.chat_template_kwargs = body.chat_template_kwargs;
  const responseFormat = body.response_format;
  if (responseFormat && typeof responseFormat === "object") {
    input.response_format = responseFormat;
  }
  return input;
}

function wrapWorkersAiChatResponse(model: string, result: unknown): OpenAIChatResponse {
  const content = readWorkersAiChatContent(result);
  const usage =
    result && typeof result === "object" && "usage" in result
      ? (result as { usage?: OpenAIChatResponse["usage"] }).usage
      : undefined;
  return {
    id: `workers-ai-${Date.now()}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [
      {
        index: 0,
        message: { role: "assistant", content },
        finish_reason: "stop"
      }
    ],
    ...(usage ? { usage } : {})
  };
}

function stripClaudeNativeThinkingFields(req: OpenAIChatRequest): OpenAIChatRequest {
  const cleaned: OpenAIChatRequest = { ...req };
  delete cleaned.thinking;
  return cleaned;
}

export function buildOpenAICompatRequest(req: OpenAIChatRequest, targetModel: string): OpenAIChatRequest {
  const cleaned = stripClaudeNativeThinkingFields(req);
  return {
    ...cleaned,
    model: targetModel,
    stream: Boolean(cleaned.stream)
  };
}

/**
 * Build an OpenAI-compatible request from an AssembledPrompt.
 * System blocks are merged into one system message; conversation messages
 * (including image_url) are preserved as-is.
 */
export function buildOpenAIRequestFromAssembled(
  req: OpenAIChatRequest,
  targetModel: string,
  assembled: AssembledPrompt
): OpenAIChatRequest {
  const messages = assembledToOpenAIChatMessages(assembled);
  return buildOpenAICompatRequest({ ...req, messages }, targetModel);
}

export function getOpenAICompatUrl(env: Env): string {
  return `${normalizeAiGatewayBaseUrl(env)}/compat/chat/completions`;
}

export function normalizeAiGatewayBaseUrl(env: Env): string {
  const base = env.AI_GATEWAY_BASE_URL;
  if (!base) {
    throw new Error("Missing AI_GATEWAY_BASE_URL");
  }

  return base
    .replace(/\/+$/, "")
    .replace(/\/compat$/i, "")
    .replace(/\/compat\/chat\/completions$/i, "")
    .replace(/\/compat\/embeddings$/i, "")
    .replace(/\/anthropic\/v1\/messages$/i, "");
}

export function buildOpenAICompatHeaders(env: Env): Headers {
  const headers = new Headers({
    "content-type": "application/json"
  });

  if (env.CF_AIG_TOKEN) {
    headers.set("cf-aig-authorization", `Bearer ${env.CF_AIG_TOKEN}`);
  }

  return headers;
}

export async function callOpenAICompat(env: Env, body: OpenAIChatRequest): Promise<Response> {
  const workersAiModel = workersAiModelName(body.model);
  if (workersAiModel) {
    if (!env.AI) {
      return new Response(
        JSON.stringify({ error: { message: "Missing Workers AI binding", type: "workers_ai_error" } }),
        { status: 503, headers: { "content-type": "application/json" } }
      );
    }

    try {
      if (isMoondreamModel(workersAiModel)) {
        const result = await env.AI.run(workersAiModel as never, buildMoondreamRunInput(body));
        const wrapped = wrapWorkersAiChatResponse(body.model, result);
        if (body.stream) {
          return new Response(toSingleChunkSse(wrapped), {
            status: 200,
            headers: { "content-type": "text/event-stream" }
          });
        }
        return new Response(JSON.stringify(wrapped), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      }

      if (body.stream) {
        const stream = await env.AI.run(workersAiModel as never, {
          ...buildWorkersAiRunInput(body),
          stream: true
        });
        return new Response(stream as unknown as BodyInit, {
          status: 200,
          headers: { "content-type": "text/event-stream" }
        });
      }

      const result = await env.AI.run(workersAiModel as never, buildWorkersAiRunInput(body));
      return new Response(JSON.stringify(wrapWorkersAiChatResponse(body.model, result)), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return new Response(JSON.stringify({ error: { message, type: "workers_ai_error" } }), {
        status: 500,
        headers: { "content-type": "application/json" }
      });
    }
  }

  return fetch(getOpenAICompatUrl(env), {
    method: "POST",
    headers: buildOpenAICompatHeaders(env),
    body: JSON.stringify(body)
  });
}

export async function callOpenAICompatEmbeddings(
  env: Env,
  body: { model: string; input: string | string[]; dimensions?: number }
): Promise<Response> {
  const headers = buildOpenAICompatHeaders(env);
  if (body.model.startsWith("workers-ai/") && env.CLOUDFLARE_API_TOKEN) {
    headers.set("authorization", `Bearer ${env.CLOUDFLARE_API_TOKEN}`);
  }

  return fetch(`${normalizeAiGatewayBaseUrl(env)}/compat/embeddings`, {
    method: "POST",
    headers,
    body: JSON.stringify(body)
  });
}
