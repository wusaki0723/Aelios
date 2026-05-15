import type { AssembledPrompt } from "../assembler/types";
import { assembledToOpenAIChatMessages } from "../assembler/toOpenAI";
import type { Env, OpenAIChatRequest } from "../types";

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
