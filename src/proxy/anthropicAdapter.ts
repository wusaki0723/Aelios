import { buildStableMemoryPack } from "../memory/stablePack";
import type { AssembledPrompt } from "../assembler/types";
import { assembledToAnthropicMessages, assembledToAnthropicSystem } from "../assembler/toAnthropic";
import type { Env, MemoryApiRecord, OpenAIChatMessage, OpenAIChatRequest, OpenAIChatResponse, TokenUsage } from "../types";
import { formatMemoryPatch } from "../memory/inject";
import { normalizeAiGatewayBaseUrl } from "./openaiAdapter";

interface AnthropicTextBlock {
  type: "text";
  text: string;
  cache_control?: {
    type: "ephemeral";
    ttl?: "5m" | "1h";
  };
}

interface AnthropicMessage {
  role: "user" | "assistant";
  content: AnthropicTextBlock[];
}

interface AnthropicRequest {
  model: string;
  max_tokens: number;
  temperature?: number;
  stream?: boolean;
  thinking?: {
    type: "enabled";
    budget_tokens: number;
    display?: "summarized" | "omitted";
  };
  system: AnthropicTextBlock[];
  messages: AnthropicMessage[];
}

interface AnthropicResponse {
  id?: string;
  model?: string;
  role?: string;
  content?: Array<{ type?: string; text?: string; thinking?: string }>;
  stop_reason?: string | null;
  usage?: TokenUsage;
}

function contentToText(content: OpenAIChatMessage["content"]): string {
  if (typeof content === "string") return content;
  if (content == null) return "";
  return JSON.stringify(content);
}

function stripAnthropicProviderPrefix(model: string): string {
  return model.replace(/^anthropic\//i, "");
}

function buildCacheControl(env: Env): AnthropicTextBlock["cache_control"] | undefined {
  if (env.ANTHROPIC_CACHE_ENABLED === "false") return undefined;
  const ttl = env.ANTHROPIC_CACHE_TTL === "1h" ? "1h" : "5m";
  return ttl === "1h" ? { type: "ephemeral", ttl } : { type: "ephemeral" };
}

function getMaxTokens(req: OpenAIChatRequest): number {
  const value = typeof req.max_tokens === "number" ? req.max_tokens : 1024;
  return Math.max(Math.floor(value), 1);
}

function getThinkingBudget(env: Env): number {
  const value = Number(env.ANTHROPIC_THINKING_BUDGET || 1024);
  return Number.isFinite(value) ? Math.min(Math.max(Math.floor(value), 1024), 32000) : 1024;
}

function buildThinkingConfig(env: Env): AnthropicRequest["thinking"] | undefined {
  if (env.ANTHROPIC_THINKING_ENABLED !== "true") return undefined;
  return {
    type: "enabled",
    budget_tokens: getThinkingBudget(env),
    display: "summarized"
  };
}

function getAnthropicMaxTokens(req: OpenAIChatRequest, env: Env): number {
  const maxTokens = getMaxTokens(req);
  const thinking = buildThinkingConfig(env);
  if (!thinking) return maxTokens;
  return Math.max(maxTokens, thinking.budget_tokens + Math.min(Math.max(maxTokens, 256), 4096));
}

function extractSystemBlocks(messages: OpenAIChatMessage[]): AnthropicTextBlock[] {
  return messages
    .filter((message) => message.role === "system")
    .map((message) => contentToText(message.content).trim())
    .filter(Boolean)
    .map((text) => ({ type: "text", text }));
}

function convertMessages(messages: OpenAIChatMessage[]): AnthropicMessage[] {
  const result: AnthropicMessage[] = [];

  for (const message of messages) {
    if (message.role === "system") continue;
    const role = message.role === "assistant" ? "assistant" : "user";
    const text = contentToText(message.content);
    if (!text) continue;

    const previous = result[result.length - 1];
    if (previous?.role === role) {
      previous.content.push({ type: "text", text });
      continue;
    }

    result.push({
      role,
      content: [{ type: "text", text }]
    });
  }

  if (result.length === 0) {
    result.push({ role: "user", content: [{ type: "text", text: "" }] });
  }

  return result;
}

export function getAnthropicNativeUrl(env: Env): string {
  return `${normalizeAiGatewayBaseUrl(env)}/anthropic/v1/messages`;
}

export function buildAnthropicHeaders(env: Env): Headers {
  const headers = new Headers({
    "content-type": "application/json",
    "anthropic-version": "2023-06-01",
    "cf-aig-skip-cache": "true"
  });

  if (env.CF_AIG_TOKEN) {
    headers.set("cf-aig-authorization", `Bearer ${env.CF_AIG_TOKEN}`);
  }

  return headers;
}

export async function buildAnthropicNativeRequest(
  req: OpenAIChatRequest,
  input: { env: Env; targetModel: string; namespace: string; memories: MemoryApiRecord[] }
): Promise<AnthropicRequest> {
  const thinking = buildThinkingConfig(input.env);
  const stableMemoryPack = await buildStableMemoryPack(input.env, input.namespace);
  const stableBlock: AnthropicTextBlock = {
    type: "text",
    text: stableMemoryPack
  };

  if (input.env.ANTHROPIC_CACHE_STABLE_SYSTEM !== "false") {
    stableBlock.cache_control = buildCacheControl(input.env);
  }

  const dynamicMemoryPatch = formatMemoryPatch(input.memories);
  const system: AnthropicTextBlock[] = [
    ...extractSystemBlocks(req.messages),
    {
      type: "text",
      text: [
        "以下长期记忆来自代理层。",
        "你可以自然使用它们，但不要提到记忆系统、数据库、RAG、代理层。",
        "如果记忆与当前用户消息无关，不要强行提起。"
      ].join("\n")
    },
    stableBlock
  ];

  if (dynamicMemoryPatch) {
    system.push({
      type: "text",
      text: dynamicMemoryPatch
    });
  }

  return {
    model: stripAnthropicProviderPrefix(input.targetModel),
    max_tokens: getAnthropicMaxTokens(req, input.env),
    temperature: thinking ? undefined : typeof req.temperature === "number" ? req.temperature : undefined,
    stream: Boolean(req.stream),
    thinking,
    system,
    messages: convertMessages(req.messages)
  };
}

/**
 * Build an Anthropic native request from an AssembledPrompt.
 *
 * - System blocks are converted via assembledToAnthropicSystem
 * - Messages via assembledToAnthropicMessages
 *   (structured content like image_url is JSON.stringify'd — temporary fallback)
 * - cache_control is applied only to the client_system anchor block,
 *   respecting ANTHROPIC_CACHE_ENABLED and ANTHROPIC_CACHE_TTL
 */
export function buildAnthropicRequestFromAssembled(
  req: OpenAIChatRequest,
  targetModel: string,
  assembled: AssembledPrompt,
  env: Env
): AnthropicRequest {
  const thinking = buildThinkingConfig(env);
  const system = assembledToAnthropicSystem(assembled.system_blocks);
  applyCacheOverrides(system, env);

  return {
    model: stripAnthropicProviderPrefix(targetModel),
    max_tokens: getAnthropicMaxTokens(req, env),
    temperature: thinking ? undefined : typeof req.temperature === "number" ? req.temperature : undefined,
    stream: Boolean(req.stream),
    thinking,
    system,
    messages: assembledToAnthropicMessages(assembled.messages),
  };
}

function applyCacheOverrides(systemBlocks: AnthropicTextBlock[], env: Env): void {
  const anchor = systemBlocks.find((b) => b.cache_control);
  if (!anchor) return;

  if (env.ANTHROPIC_CACHE_ENABLED === "false") {
    delete anchor.cache_control;
    return;
  }

  const ttl = env.ANTHROPIC_CACHE_TTL === "1h" ? "1h" : "5m";
  anchor.cache_control = { type: "ephemeral", ttl };
}

export async function callAnthropicNative(env: Env, body: AnthropicRequest): Promise<Response> {
  return fetch(getAnthropicNativeUrl(env), {
    method: "POST",
    headers: buildAnthropicHeaders(env),
    body: JSON.stringify(body)
  });
}

export function parseAnthropicNonStream(response: AnthropicResponse): {
  openai: OpenAIChatResponse;
  content: string;
  finishReason: string | null;
  usage?: TokenUsage;
} {
  const content = (response.content ?? [])
    .filter((block) => block.type === "text" && typeof block.text === "string")
    .map((block) => block.text)
    .join("");
  const reasoningContent = (response.content ?? [])
    .filter((block) => block.type === "thinking" && typeof block.thinking === "string")
    .map((block) => block.thinking)
    .join("");

  const usage = normalizeAnthropicUsage(response.usage);

  return {
    content,
    finishReason: response.stop_reason ?? null,
    usage,
    openai: {
      id: response.id,
      object: "chat.completion",
      created: Math.floor(Date.now() / 1000),
      model: response.model,
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content,
            ...(reasoningContent ? { reasoning_content: reasoningContent } : {})
          },
          finish_reason: response.stop_reason ?? null
        }
      ],
      usage
    }
  };
}

export function normalizeAnthropicUsage(usage: TokenUsage | undefined): TokenUsage | undefined {
  if (!usage) return undefined;

  const input = usage.input_tokens ?? usage.prompt_tokens;
  const output = usage.output_tokens ?? usage.completion_tokens;

  return {
    ...usage,
    prompt_tokens: input,
    completion_tokens: output,
    total_tokens: typeof input === "number" && typeof output === "number" ? input + output : usage.total_tokens
  };
}
