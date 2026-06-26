import { buildStableMemoryPack } from "../memory/stablePack";
import type { AssembledPrompt } from "../assembler/types";
import {
  assembledToAnthropicMessages,
  assembledToAnthropicSystem,
  applyMessageCacheBreakpoints,
  openAIToolsToAnthropic,
  openAIToolChoiceToAnthropic,
  isForcedToolChoice,
  anthropicToolUseBlocksToOpenAI,
  safeParseJSON,
  stableStringify,
  type AnthropicTextBlock,
  type AnthropicWireMessage,
  type AnthropicTool,
  type AnthropicToolChoice,
  type AnthropicToolUseBlock,
  type AnthropicContentBlock,
} from "../assembler/toAnthropic";
import type { Env, OpenAIChatMessage, OpenAIChatRequest, OpenAIChatResponse, TokenUsage } from "../types";
import type { BootPackage } from "../memory/v2/recall";
import { formatBootStable, formatRecallPatch } from "../assembler/types";
import { normalizeAiGatewayBaseUrl } from "./openaiAdapter";

// ---------------------------------------------------------------------------
// Anthropic wire types (request-level)
// ---------------------------------------------------------------------------

interface AnthropicMessage {
  role: "user" | "assistant";
  content: AnthropicContentBlock[];
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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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
  return { slug: match[1], model: match[2] };
}

function stripAnthropicModelPrefix(model: string): string {
  return parseCustomProviderModel(model)?.model || stripAnthropicProviderPrefix(model);
}

function getCustomAnthropicMessagesPath(env: Env): string {
  return (env.CUSTOM_ANTHROPIC_MESSAGES_PATH || "messages").replace(/^\/+/, "");
}

// ---------------------------------------------------------------------------
// Cache helpers
// ---------------------------------------------------------------------------

function buildCacheControl(env: Env): { type: "ephemeral"; ttl?: "5m" | "1h" } | undefined {
  if (env.ANTHROPIC_CACHE_ENABLED === "false") return undefined;
  const ttl = env.ANTHROPIC_CACHE_TTL === "1h" ? "1h" : "5m";
  return ttl === "1h" ? { type: "ephemeral", ttl } : { type: "ephemeral" };
}

export function getAnthropicCacheMode(env: Env): string | null {
  if (env.ANTHROPIC_CACHE_ENABLED === "false") return null;
  const parts = ["anthropic", "explicit"];
  // auto (top-level) is now off by default
  if (env.ANTHROPIC_AUTO_CACHE_ENABLED === "true") parts.push("auto");
  return parts.join("_");
}

/**
 * Apply explicit cache breakpoints from the assembler to system blocks
 * and wire messages.
 *
 * System breakpoint (history_read_anchor) is already applied by the
 * assembler via SystemBlock.cache_control. This function handles
 * message-level breakpoints (forward_write_anchor).
 */
function applyExplicitCacheBreakpoints(
  systemBlocks: AnthropicTextBlock[],
  messages: AnthropicWireMessage[],
  assembled: AssembledPrompt,
  env: Env
): void {
  const cc = buildCacheControl(env);
  if (!cc) {
    // Cache disabled: strip all cache_control
    for (const b of systemBlocks) delete b.cache_control;
    return;
  }

  // Normalize TTL on system blocks that already have cache_control from assembler
  for (const b of systemBlocks) {
    if (b.cache_control) {
      b.cache_control = { type: "ephemeral", ...(cc.ttl ? { ttl: cc.ttl } : {}) };
    }
  }

  // Apply message-level breakpoints
  applyMessageCacheBreakpoints(messages, assembled.meta.cache_breakpoints, cc);
}

// ---------------------------------------------------------------------------
// Rolling cache (legacy, opt-in via ANTHROPIC_ROLLING_CACHE_ENABLED=true)
// ---------------------------------------------------------------------------

function getRollingCacheWindowSize(env: Env): number {
  const value = Number(env.ANTHROPIC_ROLLING_CACHE_WINDOW_SIZE || 20);
  if (!Number.isFinite(value)) return 20;
  return Math.max(Math.floor(value), 1);
}

function applyRollingMessageCache(messages: AnthropicWireMessage[], env: Env): void {
  const cacheControl = buildCacheControl(env);
  if (!cacheControl) return;
  if (env.ANTHROPIC_ROLLING_CACHE_ENABLED !== "true") return; // default off now

  const isFullWindow = messages.length >= getRollingCacheWindowSize(env);
  const start = isFullWindow ? 0 : messages.length - 1;
  const end = isFullWindow ? messages.length : -1;
  const step = isFullWindow ? 1 : -1;

  for (let i = start; i !== end; i += step) {
    const message = messages[i];
    if (message.role !== "user" || message.content.length === 0) continue;
    const lastBlock = message.content[message.content.length - 1];
    if (lastBlock.type === "text") {
      lastBlock.cache_control = cacheControl;
    }
    return;
  }
}

// ---------------------------------------------------------------------------
// dynamic_memory_patch → append as uncached user context
// ---------------------------------------------------------------------------

function appendUncachedUserContext(
  messages: AnthropicWireMessage[],
  text: string | null | undefined
): void {
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

// ---------------------------------------------------------------------------
// Thinking config (unchanged)
// ---------------------------------------------------------------------------

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
      budget: clampThinkingBudget(source.thinking_budget ?? source.reasoning_budget ?? source.budget_tokens) ?? undefined,
    };
  }

  const thinking = source.thinking;
  if (parseBooleanLike(thinking) !== null) {
    const enabled = parseBooleanLike(thinking);
    return {
      enabled: enabled ?? undefined,
      budget: clampThinkingBudget(source.thinking_budget ?? source.reasoning_budget ?? source.budget_tokens) ?? undefined,
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
      budget: clampThinkingBudget(source.reasoning_budget ?? source.budget_tokens) ?? undefined,
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
      display: "summarized",
    };
  }

  if (env.ANTHROPIC_THINKING_ENABLED !== "true") return undefined;
  return {
    type: "enabled",
    budget_tokens: getEnvThinkingBudget(env),
    display: "summarized",
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

// ---------------------------------------------------------------------------
// Message conversion (OpenAI → Anthropic wire)
// ---------------------------------------------------------------------------

function extractSystemBlocks(messages: OpenAIChatMessage[]): AnthropicTextBlock[] {
  return messages
    .filter((message) => message.role === "system")
    .map((message) => contentToText(message.content).trim())
    .filter(Boolean)
    .map((text) => ({ type: "text" as const, text }));
}

function convertMessages(messages: OpenAIChatMessage[]): AnthropicWireMessage[] {
  const result: AnthropicWireMessage[] = [];

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
      content: [{ type: "text", text }],
    });
  }

  if (result.length === 0) {
    result.push({ role: "user", content: [{ type: "text", text: "" }] });
  }

  return result;
}

// ---------------------------------------------------------------------------
// URL + headers
// ---------------------------------------------------------------------------

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
    "cf-aig-skip-cache": "true",
  });

  if (env.CF_AIG_TOKEN) {
    headers.set("cf-aig-authorization", `Bearer ${env.CF_AIG_TOKEN}`);
  }

  return headers;
}

// ---------------------------------------------------------------------------
// buildAnthropicNativeRequest — legacy path (no assembler)
// ---------------------------------------------------------------------------

export async function buildAnthropicNativeRequest(
  req: OpenAIChatRequest,
  input: {
    env: Env;
    targetModel: string;
    namespace: string;
    boot: BootPackage | null;
    recallHits: Array<{ type: string; content: string; score: number }>;
  }
): Promise<AnthropicRequest> {
  let thinking = buildThinkingConfig(input.env, req);
  const tools = openAIToolsToAnthropic(req.tools);
  const toolChoice = openAIToolChoiceToAnthropic(req.tool_choice);
  if (thinking && isForcedToolChoice(req.tool_choice)) {
    thinking = undefined;
  }

  const stableText = input.boot
    ? formatBootStable(input.boot)
    : await buildStableMemoryPack(input.env, input.namespace);
  const stableBlock: AnthropicTextBlock = {
    type: "text",
    text: stableText || "固定长期记忆：暂无。",
  };

  if (input.env.ANTHROPIC_CACHE_STABLE_SYSTEM !== "false") {
    stableBlock.cache_control = buildCacheControl(input.env);
  }

  const dynamicMemoryPatch = input.recallHits.length > 0 ? formatRecallPatch(input.recallHits) : "";
  const system: AnthropicTextBlock[] = [
    ...extractSystemBlocks(req.messages),
    {
      type: "text",
      text: [
        "以下长期记忆来自代理层。",
        "你可以自然使用它们，但不要提到记忆系统、数据库、RAG、代理层。",
        "如果记忆与当前用户消息无关，不要强行提起。",
      ].join("\n"),
    },
    stableBlock,
  ];

  const messages = convertMessages(req.messages);
  // Legacy path: rolling cache disabled by default
  if (input.env.ANTHROPIC_ROLLING_CACHE_ENABLED === "true") {
    applyRollingMessageCache(messages, input.env);
  }
  appendUncachedUserContext(messages, dynamicMemoryPatch);

  return {
    model: stripAnthropicModelPrefix(input.targetModel),
    max_tokens: getAnthropicMaxTokens(req, input.env, thinking),
    // No top-level cache_control by default
    ...(input.env.ANTHROPIC_AUTO_CACHE_ENABLED === "true"
      ? { cache_control: buildCacheControl(input.env) }
      : {}),
    temperature: thinking ? undefined : typeof req.temperature === "number" ? req.temperature : undefined,
    stream: Boolean(req.stream),
    thinking,
    system,
    messages,
    ...(tools ? { tools } : {}),
    ...(toolChoice ? { tool_choice: toolChoice } : {}),
  };
}

// ---------------------------------------------------------------------------
// buildAnthropicRequestFromAssembled — v4 assembler path
//
// Cache strategy:
//   1. history_read_anchor (system): cache_control on client_system block.
//      All stable blocks before it (proxy_static_rules, persona_pinned,
//      preset_lite, boot_stable) stay cached across rounds.
//   2. forward_write_anchor (message): cache_control on the last content
//      block of the last history message, so R1→R2 appends keep the
//      R1 prefix warm.
//   3. dynamic_memory_patch is extracted from system and appended as
//      uncached user context AFTER both breakpoints, so changing RAG
//      hits never invalidate cached prefixes.
//   4. Top-level cache_control (automatic) is OFF by default to avoid
//      competing with explicit breakpoints.
//   5. Rolling cache is OFF by default (opt-in via env).
// ---------------------------------------------------------------------------

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

  // Apply explicit cache breakpoints (history_read_anchor + forward_write_anchor)
  applyExplicitCacheBreakpoints(system, messages, assembled, env);

  // Rolling cache: off by default, opt-in
  if (env.ANTHROPIC_ROLLING_CACHE_ENABLED === "true") {
    applyRollingMessageCache(messages, env);
  }

  // dynamic_memory_patch goes AFTER all cache breakpoints as uncached user context
  appendUncachedUserContext(messages, dynamicMemoryPatch);

  // Stable tools JSON: keys sorted, so Anthropic's cache sees identical bytes
  const stableToolsJson = tools
    ? JSON.parse(stableStringify(tools)) as AnthropicTool[]
    : undefined;

  return {
    model: stripAnthropicModelPrefix(targetModel),
    max_tokens: getAnthropicMaxTokens(req, env, thinking),
    // No top-level cache_control by default
    ...(env.ANTHROPIC_AUTO_CACHE_ENABLED === "true"
      ? { cache_control: buildCacheControl(env) }
      : {}),
    temperature: thinking ? undefined : typeof req.temperature === "number" ? req.temperature : undefined,
    stream: Boolean(req.stream),
    thinking,
    system,
    messages,
    ...(stableToolsJson ? { tools: stableToolsJson } : {}),
    ...(toolChoice ? { tool_choice: toolChoice } : {}),
  };
}

// ---------------------------------------------------------------------------
// HTTP call + response parsing
// ---------------------------------------------------------------------------

export async function callAnthropicNative(
  env: Env,
  body: AnthropicRequest,
  targetModel?: string
): Promise<Response> {
  return fetch(getAnthropicUrlForModel(env, targetModel || body.model), {
    method: "POST",
    headers: buildAnthropicHeaders(env),
    body: JSON.stringify(body),
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
    .map((block) => block.text!)
    .join("");
  const reasoningContent = (response.content ?? [])
    .filter((block) => block.type === "thinking" && typeof block.thinking === "string")
    .map((block) => block.thinking!)
    .join("");

  // Collect tool_use blocks and convert to OpenAI tool_calls
  const toolUseBlocks: AnthropicToolUseBlock[] = (response.content ?? [])
    .filter(
      (block): block is AnthropicToolUseBlock =>
        block.type === "tool_use" && typeof block.id === "string" && typeof block.name === "string"
    )
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
    content: toolCalls.length > 0 ? content || null : content,
    ...(reasoningContent ? { reasoning_content: reasoningContent } : {}),
    ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
  };

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
          finish_reason: mappedFinishReason,
        },
      ],
      usage,
    },
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
    total_tokens:
      typeof input === "number" && typeof output === "number" ? input + output : usage.total_tokens,
  };
}
