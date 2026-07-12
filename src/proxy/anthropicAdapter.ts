import { buildStableMemoryPack } from "../memory/stablePack";
import type { AssembledPrompt } from "../assembler/types";
import { assembledToAnthropicMessages, assembledToAnthropicSystem } from "../assembler/toAnthropic";
import type { Env, MemoryApiRecord, OpenAIChatMessage, OpenAIChatRequest, OpenAIChatResponse, TokenUsage } from "../types";
import { formatMemoryPatch } from "../memory/inject";
import { normalizeAiGatewayBaseUrl } from "./openaiAdapter";
import {
  anthropicToolUseBlocksToOpenAI,
  isForcedToolChoice,
  openAIToolChoiceToAnthropic,
  openAIToolsToAnthropic,
  safeParseJSON,
  type AnthropicToolChoice,
  type AnthropicToolUseBlock,
} from "./toolAdapters";

interface AnthropicTextBlock {
  type: "text";
  text: string;
  cache_control?: {
    type: "ephemeral";
    ttl?: "5m" | "1h";
  };
}

type AnthropicContentBlock =
  | AnthropicTextBlock
  | AnthropicToolUseBlock
  | {
      type: "tool_result";
      tool_use_id: string;
      content: string | Array<{ type: "text"; text: string }>;
      cache_control?: {
        type: "ephemeral";
        ttl?: "5m" | "1h";
      };
    };

interface AnthropicMessage {
  role: "user" | "assistant";
  content: AnthropicContentBlock[];
}

interface AnthropicTool {
  name: string;
  description: string;
  input_schema: { type: "object"; [key: string]: unknown };
}

interface AnthropicRequest {
  model: string;
  max_tokens: number;
  cache_control?: {
    type: "ephemeral";
    ttl?: "5m" | "1h";
  };
  temperature?: number;
  stream?: boolean;
  thinking?: {
    type: "enabled";
    budget_tokens: number;
    display?: "summarized" | "omitted";
  };
  system: AnthropicTextBlock[];
  messages: AnthropicMessage[];
  tools?: AnthropicTool[];
  tool_choice?: AnthropicToolChoice;
}

interface AnthropicResponse {
  id?: string;
  model?: string;
  role?: string;
  content?: Array<{
    type?: string;
    text?: string;
    thinking?: string;
    id?: string;
    name?: string;
    input?: unknown;
  }>;
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

function parseCustomProviderModel(model: string): { slug: string; model: string } | null {
  const match = model.match(/^custom-([a-z0-9-]+)\/(.+)$/i);
  if (!match) return null;
  return {
    slug: match[1],
    model: match[2]
  };
}

function stripAnthropicModelPrefix(model: string): string {
  return parseCustomProviderModel(model)?.model || stripAnthropicProviderPrefix(model);
}

function getCustomAnthropicMessagesPath(env: Env): string {
  return (env.CUSTOM_ANTHROPIC_MESSAGES_PATH || "messages").replace(/^\/+/, "");
}

function buildCacheControl(env: Env): AnthropicTextBlock["cache_control"] | undefined {
  if (env.ANTHROPIC_CACHE_ENABLED === "false") return undefined;
  const ttl = env.ANTHROPIC_CACHE_TTL === "1h" ? "1h" : "5m";
  return ttl === "1h" ? { type: "ephemeral", ttl } : { type: "ephemeral" };
}

function buildAutomaticCacheControl(env: Env): AnthropicRequest["cache_control"] | undefined {
  if (env.ANTHROPIC_CACHE_ENABLED === "false") return undefined;
  if (env.ANTHROPIC_AUTO_CACHE_ENABLED !== "true") return undefined;
  return buildCacheControl(env);
}

function getRollingCacheWindowSize(env: Env): number {
  const value = Number(env.ANTHROPIC_ROLLING_CACHE_WINDOW_SIZE || 20);
  if (!Number.isFinite(value)) return 20;
  return Math.max(Math.floor(value), 1);
}

export function getAnthropicCacheMode(env: Env): string | null {
  if (env.ANTHROPIC_CACHE_ENABLED === "false") return null;
  const parts = ["anthropic"];
  parts.push("explicit");
  if (env.ANTHROPIC_AUTO_CACHE_ENABLED === "true") parts.push("auto");
  if (env.ANTHROPIC_ROLLING_CACHE_ENABLED !== "false") parts.push("rolling");
  return parts.join("_");
}

function applyRollingMessageCache(messages: AnthropicMessage[], env: Env, systemBlocks?: AnthropicTextBlock[]): void {
  const cacheControl = buildCacheControl(env);
  if (!cacheControl) return;
  if (env.ANTHROPIC_ROLLING_CACHE_ENABLED === "false") return;

  // Anthropic limits cache_control markers to 4 total; subtract system-level markers.
  const systemCacheCount = systemBlocks?.filter((b) => b.cache_control).length ?? 0;
  const MAX_MESSAGE_MARKERS = Math.max(1, 4 - systemCacheCount);

  const userIndices: number[] = [];
  for (let i = 0; i < messages.length; i++) {
    if (messages[i].role === "user" && messages[i].content.length > 0) {
      userIndices.push(i);
    }
  }
  if (userIndices.length === 0) return;

  const last = userIndices[userIndices.length - 1];
  messages[last].content[messages[last].content.length - 1].cache_control = cacheControl;

  // Distribute remaining markers evenly across earlier user messages
  const remaining = Math.min(userIndices.length - 1, MAX_MESSAGE_MARKERS - 1);
  for (let m = 0; m < remaining; m++) {
    const idx = userIndices[Math.floor(m * (userIndices.length - 1) / remaining)];
    messages[idx].content[messages[idx].content.length - 1].cache_control = cacheControl;
  }
}

function appendUncachedUserContext(messages: AnthropicMessage[], text: string | null | undefined): void {
  const trimmed = text?.trim();
  if (!trimmed) return;

  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (message.role !== "user") continue;
    message.content.push({ type: "text", text: trimmed });
    return;
  }

  messages.push({ role: "user", content: [{ type: "text", text: trimmed }] });
}

function splitDynamicMemorySystemBlock(
  assembled: AssembledPrompt
): { systemBlocks: AssembledPrompt["system_blocks"]; dynamicMemoryPatch: string | null } {
  const idx = assembled.meta.block_ids.indexOf("dynamic_memory_patch");
  if (idx < 0 || idx >= assembled.system_blocks.length) {
    return { systemBlocks: assembled.system_blocks, dynamicMemoryPatch: null };
  }

  return {
    systemBlocks: [
      ...assembled.system_blocks.slice(0, idx),
      ...assembled.system_blocks.slice(idx + 1),
    ],
    dynamicMemoryPatch: assembled.system_blocks[idx].text,
  };
}

function getMaxTokens(req: OpenAIChatRequest): number {
  const value = typeof req.max_tokens === "number" ? req.max_tokens : 1024;
  return Math.max(Math.floor(value), 1);
}

function clampThinkingBudget(value: unknown): number | null {
  const numeric = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isFinite(numeric)) return null;
  return Math.min(Math.max(Math.floor(numeric), 1024), 32000);
}

function getEnvThinkingBudget(env: Env): number {
  const value = clampThinkingBudget(env.ANTHROPIC_THINKING_BUDGET);
  return value ?? 1024;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parseBooleanLike(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  if (["true", "1", "yes", "on", "enabled"].includes(normalized)) return true;
  if (["false", "0", "no", "off", "disabled", "none"].includes(normalized)) return false;
  return null;
}

function budgetFromReasoningEffort(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  if (["none", "off", "disabled", "disable"].includes(normalized)) return 0;
  if (["minimal", "low"].includes(normalized)) return 1024;
  if (["medium", "auto"].includes(normalized)) return 2048;
  if (normalized === "high") return 4096;
  if (["xhigh", "extra_high"].includes(normalized)) return 8192;
  return null;
}

function readThinkingDirective(source: Record<string, unknown>): { enabled?: boolean; budget?: number } {
  const effortBudget = budgetFromReasoningEffort(source.reasoning_effort);
  if (effortBudget === 0) return { enabled: false };
  if (effortBudget && effortBudget > 0) return { enabled: true, budget: effortBudget };

  const enableThinking = parseBooleanLike(source.enable_thinking);
  if (enableThinking !== null) {
    return {
      enabled: enableThinking,
      budget: clampThinkingBudget(source.thinking_budget ?? source.reasoning_budget ?? source.budget_tokens) ?? undefined
    };
  }

  const thinking = source.thinking;
  if (parseBooleanLike(thinking) !== null) {
    const enabled = parseBooleanLike(thinking);
    return {
      enabled: enabled ?? undefined,
      budget: clampThinkingBudget(source.thinking_budget ?? source.reasoning_budget ?? source.budget_tokens) ?? undefined
    };
  }

  if (isRecord(thinking)) {
    const type = typeof thinking.type === "string" ? thinking.type.trim().toLowerCase() : "";
    if (["disabled", "off", "none"].includes(type)) return { enabled: false };
    const budget = clampThinkingBudget(thinking.budget_tokens ?? thinking.budget ?? source.thinking_budget);
    if (type === "enabled" || budget) return { enabled: true, budget: budget ?? undefined };
  }

  const reasoning = source.reasoning;
  if (parseBooleanLike(reasoning) !== null) {
    const enabled = parseBooleanLike(reasoning);
    return {
      enabled: enabled ?? undefined,
      budget: clampThinkingBudget(source.reasoning_budget ?? source.budget_tokens) ?? undefined
    };
  }

  if (isRecord(reasoning)) {
    const enabled = parseBooleanLike(reasoning.enabled);
    if (enabled === false) return { enabled: false };
    const budget =
      clampThinkingBudget(reasoning.budget_tokens ?? reasoning.budget ?? source.reasoning_budget) ??
      budgetFromReasoningEffort(reasoning.effort);
    if (enabled === true || (budget && budget > 0)) return { enabled: true, budget: budget ?? undefined };
  }

  const budget = clampThinkingBudget(source.thinking_budget ?? source.reasoning_budget ?? source.budget_tokens);
  if (budget) return { enabled: true, budget };

  return {};
}

function getRequestThinkingDirective(req: OpenAIChatRequest): { enabled?: boolean; budget?: number } {
  for (const source of [req, isRecord(req.extra_body) ? req.extra_body : null, isRecord(req.extraBody) ? req.extraBody : null]) {
    if (!source) continue;
    const directive = readThinkingDirective(source);
    if (directive.enabled !== undefined || directive.budget !== undefined) return directive;
  }

  return {};
}

function buildThinkingConfig(env: Env, req: OpenAIChatRequest): AnthropicRequest["thinking"] | undefined {
  const requestDirective = getRequestThinkingDirective(req);
  if (requestDirective.enabled === false) return undefined;

  if (requestDirective.enabled === true || requestDirective.budget) {
    return {
      type: "enabled",
      budget_tokens: requestDirective.budget ?? getEnvThinkingBudget(env),
      display: "summarized"
    };
  }

  if (env.ANTHROPIC_THINKING_ENABLED !== "true") return undefined;
  return {
    type: "enabled",
    budget_tokens: getEnvThinkingBudget(env),
    display: "summarized"
  };
}

function getAnthropicMaxTokens(
  req: OpenAIChatRequest,
  env: Env,
  thinking: AnthropicRequest["thinking"] | undefined
): number {
  const maxTokens = getMaxTokens(req);
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

    // OpenAI tool result message → Anthropic user message with tool_result block
    if (message.role === "tool") {
      const toolUseId = message.tool_call_id ?? "unknown";
      const text = typeof message.content === "string" ? message.content : contentToText(message.content);
      const block: AnthropicContentBlock = {
        type: "tool_result",
        tool_use_id: toolUseId,
        content: text,
      };

      const previous = result[result.length - 1];
      if (previous?.role === "user") {
        previous.content.push(block);
      } else {
        result.push({ role: "user", content: [block] });
      }
      continue;
    }

    // assistant with tool_calls → Anthropic assistant message with tool_use blocks
    if (message.role === "assistant" && message.tool_calls != null) {
      const blocks: AnthropicContentBlock[] = [];
      const text = contentToText(message.content);
      if (text) blocks.push({ type: "text", text });

      const toolCalls = Array.isArray(message.tool_calls) ? message.tool_calls : [];
      for (const tc of toolCalls) {
        const call = tc as { id?: string; function?: { name?: string; arguments?: string } };
        blocks.push({
          type: "tool_use",
          id: call.id ?? `call_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          name: call.function?.name ?? "",
          input: safeParseJSON(call.function?.arguments),
        });
      }

      if (blocks.length > 0) {
        result.push({ role: "assistant", content: blocks });
      }
      continue;
    }

    // regular user or assistant message
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

export function getAnthropicUrlForModel(env: Env, targetModel: string): string {
  const customProvider = parseCustomProviderModel(targetModel);
  if (!customProvider) return getAnthropicNativeUrl(env);
  return `${normalizeAiGatewayBaseUrl(env)}/custom-${customProvider.slug}/${getCustomAnthropicMessagesPath(env)}`;
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
  let thinking = buildThinkingConfig(input.env, req);
  const tools = openAIToolsToAnthropic(req.tools);
  const toolChoice = openAIToolChoiceToAnthropic(req.tool_choice);
  // Anthropic extended thinking does not support forced tool_choice (any/tool).
  // Tool priority: disable thinking when forced tool_choice is present.
  if (thinking && isForcedToolChoice(req.tool_choice)) {
    thinking = undefined;
  }
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

  const messages = convertMessages(req.messages);
  applyRollingMessageCache(messages, input.env, system);
  appendUncachedUserContext(messages, dynamicMemoryPatch);

  return {
    model: stripAnthropicModelPrefix(input.targetModel),
    max_tokens: getAnthropicMaxTokens(req, input.env, thinking),
    cache_control: buildAutomaticCacheControl(input.env),
    temperature: thinking ? undefined : typeof req.temperature === "number" ? req.temperature : undefined,
    stream: Boolean(req.stream),
    thinking,
    system,
    messages,
    ...(tools ? { tools } : {}),
    ...(toolChoice ? { tool_choice: toolChoice } : {}),
    ...(input.env.ANTHROPIC_CACHE_USER_ID ? { metadata: { user_id: input.env.ANTHROPIC_CACHE_USER_ID } } : {}),
  };
}

/**
 * Build an Anthropic native request from an AssembledPrompt.
 *
 * - System blocks are converted via assembledToAnthropicSystem
 * - Messages via assembledToAnthropicMessages
 *   (structured content like image_url is JSON.stringify'd — temporary fallback)
 * - dynamic_memory_patch is moved out of system and appended after the
 *   rolling cache point, so changing RAG hits do not poison cached prefixes
 * - cache_control is applied to the client_system anchor block and the
 *   rolling user/window block, respecting ANTHROPIC_CACHE_ENABLED and
 *   ANTHROPIC_CACHE_TTL
 */
export function buildAnthropicRequestFromAssembled(
  req: OpenAIChatRequest,
  targetModel: string,
  assembled: AssembledPrompt,
  env: Env
): AnthropicRequest {
  let thinking = buildThinkingConfig(env, req);
  const tools = openAIToolsToAnthropic(req.tools);
  const toolChoice = openAIToolChoiceToAnthropic(req.tool_choice);
  // Tool priority: disable thinking when forced tool_choice is present.
  if (thinking && isForcedToolChoice(req.tool_choice)) {
    thinking = undefined;
  }
  const { systemBlocks, dynamicMemoryPatch } = splitDynamicMemorySystemBlock(assembled);
  const system = assembledToAnthropicSystem(systemBlocks);
  const messages = assembledToAnthropicMessages(assembled.messages);
  applyCacheOverrides(system, env);
  applyRollingMessageCache(messages, env, system);
  appendUncachedUserContext(messages, dynamicMemoryPatch);

  return {
    model: stripAnthropicModelPrefix(targetModel),
    max_tokens: getAnthropicMaxTokens(req, env, thinking),
    cache_control: buildAutomaticCacheControl(env),
    temperature: thinking ? undefined : typeof req.temperature === "number" ? req.temperature : undefined,
    stream: Boolean(req.stream),
    thinking,
    system,
    messages,
    ...(tools ? { tools } : {}),
    ...(toolChoice ? { tool_choice: toolChoice } : {}),
    ...(env.ANTHROPIC_CACHE_USER_ID ? { metadata: { user_id: env.ANTHROPIC_CACHE_USER_ID } } : {}),
  };
}

function applyCacheOverrides(systemBlocks: AnthropicTextBlock[], env: Env): void {
  if (env.ANTHROPIC_CACHE_ENABLED === "false") {
    for (const b of systemBlocks) delete b.cache_control;
    return;
  }
  const ttl = env.ANTHROPIC_CACHE_TTL === "1h" ? "1h" : "5m";
  for (const b of systemBlocks) {
    if (b.cache_control) {
      b.cache_control = { type: "ephemeral", ttl };
    }
  }
}

export async function callAnthropicNative(env: Env, body: AnthropicRequest, targetModel?: string): Promise<Response> {
  return fetch(getAnthropicUrlForModel(env, targetModel || body.model), {
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

  // Collect tool_use blocks and convert to OpenAI tool_calls
  const toolUseBlocks: AnthropicToolUseBlock[] = (response.content ?? [])
    .filter((block): block is AnthropicToolUseBlock =>
      block.type === "tool_use" && typeof block.id === "string" && typeof block.name === "string")
    .map((block) => ({
      type: "tool_use" as const,
      id: block.id!,
      name: block.name!,
      input: block.input ?? {},
    }));

  const toolCalls = anthropicToolUseBlocksToOpenAI(toolUseBlocks);

  const usage = normalizeAnthropicUsage(response.usage);

  const message = {
    role: "assistant" as const,
    content: toolCalls.length > 0 ? (content || null) : content,
    ...(reasoningContent ? { reasoning_content: reasoningContent } : {}),
    ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
  };

  // Map Anthropic stop_reason → OpenAI finish_reason for tool calls
  const mappedFinishReason = mapAnthropicToOpenAIFinishReason(response.stop_reason);

  return {
    content,
    finishReason: mappedFinishReason,
    usage,
    openai: {
      id: response.id,
      object: "chat.completion",
      created: Math.floor(Date.now() / 1000),
      model: response.model,
      choices: [
        {
          index: 0,
          message,
          finish_reason: mappedFinishReason
        }
      ],
      usage
    }
  };
}

function mapAnthropicToOpenAIFinishReason(stopReason: string | null | undefined): string | null {
  if (!stopReason) return null;
  switch (stopReason) {
    case "end_turn":
      return "stop";
    case "tool_use":
      return "tool_calls";
    case "max_tokens":
      return "length";
    case "stop_sequence":
      return "stop";
    default:
      return stopReason;
  }
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
