import { callOpenAICompat } from "../../proxy/openaiAdapter";
import type { Env, MemoryApiRecord, MessageRecord, OpenAIChatRequest, OpenAIChatResponse } from "../../types";
import { extractJsonObject } from "../../utils/parse";
import { extractDreamMemoriesFromMessages } from "../dreamExtract";
import { readDreamMaxTokens, readDreamModel } from "../dreamEnv";
import type { ExtractedMemory } from "../extract";
import {
  type DailyDigestResult,
  type DigestModelCallResult,
  formatExistingMemories,
  formatTranscript,
  normalizeDigestResult
} from "./helpers";

const DREAM_MODEL_RETRY_BACKOFF_MS = [2000, 8000];

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetriableModelStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

export function buildDigestPrompt(input: {
  dateLabel: string;
  startIso: string;
  endIso: string;
  messages: MessageRecord[];
  existingMemories: MemoryApiRecord[];
  hasMore: boolean;
}): string {
  return [
    "你是 Aelios 的 nightly dream 记忆整理器。你的任务不是简单总结，而是在用户休息时整理长期记忆。",
    "你会读取旧长期记忆和当天聊天 transcript，产出一份更干净、更一致、更有用的 memory store 整理计划。",
    "只输出 JSON，不要 markdown，不要解释，不要输出思考过程。",
    "",
    "Dream 目标：",
    "- 合并重复记忆，避免同一事实以多个版本长期存在。",
    "- 发现过时、被新信息否定、互相矛盾的旧记忆，并提出更新或删除建议（全部进入审核队列）。",
    "- 检查当天夜间抽取候选和旧记忆之间是否重复、过时或冲突。",
    "- 形成简洁的昨日日志，而不是保存流水账。",
    "",
    "窗口：",
    `- 你只能处理 ${input.dateLabel} 这一天窗口内的聊天。窗口是 ${input.startIso} 到 ${input.endIso}。`,
    input.hasMore ? "- 这是当天的一批聊天，不是完整一天；只整理这一批里明确出现的信息。" : "- 这是当天最后一批或完整批次。",
    "",
    "总原则：",
    "- 原始聊天不要逐条变成记忆，只保留未来真的会用到的事实、偏好、边界、项目进展、承诺。",
    "- 宁可少记，也不要把临时语气、寒暄、重复话、空内容、调试内容写进长期记忆。",
    "- 当旧记忆和新信息冲突时，优先更新或删除旧记忆，不要并排留下互相打架的版本。",
    "- 当新信息只是旧记忆的更准确版本，优先 memories_to_update，不要 memories_to_add。",
    "- 稳定事实的首次抽取由 dream 夜间管线负责，产物全部进审核队列；memories_to_add 默认给空数组。",
    "- 当多条旧记忆重复，保留更完整的一条并删除重复项；必要时先 update 保留项。",
    "- pinned=true 的旧记忆不能删除，只能在 memories_to_update 中提出更保守的补充。",
    "- 旧记忆里的临时计划/意图（例如“打算下个月充值X”）如果已经过期、已经发生、或被当天新信息取代，优先更新成持久事实或直接删除，不要让过期的打算一直躺在库里。",
    "- 站在“我=助手”的视角写。关于用户，用“你……”；关于助手承诺，用“我需要……”。",
    "- 不要提到 D1、Vectorize、RAG、数据库、记忆系统、代理层等实现细节。",
    "",
    "Dream 输出格式：",
    "- title 是 12 字以内标题。",
    "- summary 写成一段简短自然中文，描述这次 dream 整理出了什么。",
    "- sections 最多 3 段，每段有 heading 和 content；没有必要可以给空数组。",
    "- memories_to_add 保留兼容字段，v2 下默认输出空数组。",
    "- memories_to_update 只针对给出的旧记忆 id。",
    "- memories_to_update 里的 type 只能从这 8 个里选：fact、event、preference、relationship、boundary、habit、decision、note；项目进展归 fact，承诺/决定归 decision。绝不输出 project、world_fact 等其他值。",
    "- memories_to_delete 只删除空、重复、明显过期或被新信息否定的旧记忆。",
    "- 控制总输出长度，宁可少写也不要输出超长 JSON。",
    "",
    "输出 JSON 结构：",
    JSON.stringify({
      date: input.dateLabel,
      title: "夜间整理",
      summary: "这次 dream 合并了重复记忆，更新了项目状态。",
      sections: [{ heading: "整理结果", content: "……" }],
      memories_to_add: [],
      memories_to_update: [
        {
          target_id: "mem_x",
          content: "更新后的旧记忆正文",
          type: "fact",
          importance: 0.88,
          confidence: 0.9,
          tags: ["project"]
        }
      ],
      memories_to_delete: [{ target_id: "mem_y", reason: "空内容或重复" }]
    }),
    "",
    "旧长期记忆候选：",
    formatExistingMemories(input.existingMemories),
    "",
    "今日原始聊天：",
    formatTranscript(input.messages)
  ].join("\n");
}

export async function callDigestModel(
  env: Env,
  prompt: string,
  meta: { dateLabel: string; messageCount: number; memoryCount: number; hasMore: boolean }
): Promise<DigestModelCallResult> {
  const model = readDreamModel(env);
  if (!model) {
    console.error("dream: missing model");
    return { digest: null, reason: "missing_model" };
  }

  const request: OpenAIChatRequest = {
    model,
    messages: [
      { role: "system", content: "你是严格的 JSON 生成器。你只输出 JSON，不要输出思考过程。" },
      { role: "user", content: prompt }
    ],
    temperature: 0,
    max_tokens: readDreamMaxTokens(env),
    response_format: {
      type: "json_object"
    },
    stream: false
  };

  const startedAt = Date.now();
  console.log("dream: calling model", {
    date: meta.dateLabel,
    model,
    messageCount: meta.messageCount,
    memoryCount: meta.memoryCount,
    hasMore: meta.hasMore,
    promptChars: prompt.length,
    maxTokens: request.max_tokens
  });

  const maxAttempts = 1 + DREAM_MODEL_RETRY_BACKOFF_MS.length;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    if (attempt > 0) {
      const backoffMs = DREAM_MODEL_RETRY_BACKOFF_MS[attempt - 1] ?? DREAM_MODEL_RETRY_BACKOFF_MS.at(-1) ?? 8000;
      console.warn("dream: retrying model call after non-ok response", {
        date: meta.dateLabel,
        model,
        attempt: attempt + 1,
        maxAttempts,
        backoffMs
      });
      await delay(backoffMs);
    }

    try {
      const response = await callOpenAICompat(env, request);
      const elapsedMs = Date.now() - startedAt;
      if (!response.ok) {
        const retriable = isRetriableModelStatus(response.status);
        console.error("dream: model returned non-ok", {
          date: meta.dateLabel,
          model,
          status: response.status,
          statusText: response.statusText,
          elapsedMs,
          attempt: attempt + 1,
          retriable
        });
        if (retriable && attempt < maxAttempts - 1) continue;
        return { digest: null, reason: "model_error", model, status: response.status };
      }
      const parsed = (await response.json()) as OpenAIChatResponse;
      const choice = parsed.choices?.[0];
      const message = choice?.message as ({ content?: unknown; reasoning_content?: unknown }) | undefined;
      const content = typeof message?.content === "string" ? message.content.trim() : "";
      const reasoning = typeof message?.reasoning_content === "string" ? message.reasoning_content.trim() : "";
      const json = extractJsonObject(content || reasoning);
      if (!json) {
        console.error("dream: model returned invalid JSON", {
          date: meta.dateLabel,
          model,
          elapsedMs,
          finishReason: choice?.finish_reason ?? null,
          contentChars: content.length,
          reasoningChars: reasoning.length
        });
        return { digest: null, reason: "model_invalid_json", model, finishReason: choice?.finish_reason };
      }
      console.log("dream: model returned valid JSON", {
        date: meta.dateLabel,
        model,
        elapsedMs,
        finishReason: choice?.finish_reason ?? null,
        contentChars: content.length,
        reasoningChars: reasoning.length,
        attempt: attempt + 1
      });
      return { digest: normalizeDigestResult(json), model };
    } catch (error) {
      const elapsedMs = Date.now() - startedAt;
      const message = error instanceof Error && error.message ? error.message : String(error);
      console.error("dream model failed", {
        date: meta.dateLabel,
        model,
        elapsedMs,
        attempt: attempt + 1,
        error: message
      });
      // Thrown fetch errors are almost always network-level and worth retrying.
      if (attempt < maxAttempts - 1) continue;
      return { digest: null, reason: "model_error", model };
    }
  }

  return { digest: null, reason: "model_error", model };
}

/** Run digest model (with length-truncation shrink) then dream extract on the same batch. */
export async function runExtractPhase(
  env: Env,
  input: {
    namespace: string;
    dateLabel: string;
    startIso: string;
    endIso: string;
    messages: MessageRecord[];
    existingMemories: MemoryApiRecord[];
    hasMore: boolean;
  }
): Promise<{
  messages: MessageRecord[];
  hasMore: boolean;
  modelResult: DigestModelCallResult;
  extractedMemories: ExtractedMemory[];
  extractReason?: "model_error" | "model_invalid_json" | "missing_model";
  extractModel?: string;
  extractStatus?: number;
}> {
  let messages = input.messages;
  let hasMore = input.hasMore;
  let modelResult: DigestModelCallResult;

  for (;;) {
    const prompt = buildDigestPrompt({
      dateLabel: input.dateLabel,
      startIso: input.startIso,
      endIso: input.endIso,
      messages,
      existingMemories: input.existingMemories,
      hasMore
    });
    modelResult = await callDigestModel(env, prompt, {
      dateLabel: input.dateLabel,
      messageCount: messages.length,
      memoryCount: input.existingMemories.length,
      hasMore
    });
    if (modelResult.digest) break;
    if (modelResult.reason !== "model_invalid_json" || modelResult.finishReason !== "length" || messages.length <= 1) break;

    const nextSize = Math.max(1, Math.floor(messages.length / 2));
    if (nextSize >= messages.length) break;
    console.warn("dream: retrying with smaller batch after length-truncated JSON", {
      date: input.dateLabel,
      previousMessageCount: messages.length,
      nextMessageCount: nextSize,
      model: modelResult.model
    });
    messages = messages.slice(0, nextSize);
    hasMore = true;
  }

  if (!modelResult.digest) {
    return {
      messages,
      hasMore,
      modelResult,
      extractedMemories: []
    };
  }

  const extractResult = await extractDreamMemoriesFromMessages(env, {
    namespace: input.namespace,
    messages
  });

  return {
    messages,
    hasMore,
    modelResult,
    extractedMemories: extractResult.memories,
    extractReason: extractResult.reason,
    extractModel: extractResult.model,
    extractStatus: extractResult.status
  };
}

// Keep DailyDigestResult type re-export for local consumers if needed
export type { DailyDigestResult };
