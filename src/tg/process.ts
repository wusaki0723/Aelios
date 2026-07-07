import { handleChatCompletions } from "../api/chatCompletions";
import { callOpenAICompat } from "../proxy/openaiAdapter";
import type { Env, OpenAIChatMessage, OpenAIChatRequest, OpenAIChatResponse } from "../types";
import { claimInbox, getChatState, saveChatState, unclaimInbox, type TgChatState, type TgRecentTurn } from "./state";
import { sendChatAction, sendMessageChunks } from "./telegram";

const DEFAULT_RECENT_MAX_TURNS = 12;
const SUMMARY_TARGET_CHARS = 1500;
const DEFAULT_SYSTEM_PROMPT = "You are a helpful assistant chatting over Telegram.";
const BUBBLE_FORMAT_RULE =
  "回复时，想拆成多条聊天气泡的内容之间用空行（连续两个换行）隔开；一个完整的意思放在同一个气泡里。";

function readRecentMaxTurns(env: Env): number {
  const parsed = Number(env.TG_RECENT_MAX_TURNS);
  if (!Number.isFinite(parsed) || parsed < 2) return DEFAULT_RECENT_MAX_TURNS;
  return Math.floor(parsed);
}

function buildSystemPrompt(env: Env, summary: string): string {
  const base = [env.TG_SYSTEM_PROMPT?.trim(), env.TG_SYSTEM_PROMPT_EXTRA?.trim()]
    .filter((part): part is string => Boolean(part))
    .join("\n");
  const sections = [base || DEFAULT_SYSTEM_PROMPT, BUBBLE_FORMAT_RULE];
  if (summary) {
    sections.push(`[对话滚动摘要]\n以下是这段对话更早部分的摘要，当作你们已经聊过的内容：\n${summary}`);
  }
  return sections.join("\n\n");
}

function extractAssistantText(response: OpenAIChatResponse): string {
  const content = response.choices?.[0]?.message?.content;
  if (typeof content === "string") return content;
  if (content == null) return "";
  return JSON.stringify(content);
}

/**
 * Fold the evicted oldest turns into the rolling summary with a bare LLM call
 * (deliberately NOT the chat pipeline: folding must not feed memory ingest or
 * the conversation archive). Returns null when the fold fails; the caller then
 * keeps the un-evicted state and retries on a later turn.
 */
async function foldIntoSummary(
  env: Env,
  previousSummary: string,
  evicted: TgRecentTurn[]
): Promise<string | null> {
  const model = env.TG_SUMMARY_MODEL?.trim() || env.DREAM_MODEL?.trim() || env.CHAT_MODEL?.trim();
  if (!model) {
    console.error("tg: summary fold skipped, no model configured (TG_SUMMARY_MODEL/DREAM_MODEL/CHAT_MODEL)");
    return null;
  }

  const transcript = evicted.map((t) => `${t.role === "user" ? "用户" : "助手"}：${t.content}`).join("\n");
  const request: OpenAIChatRequest = {
    model,
    messages: [
      {
        role: "system",
        content: `你是对话摘要器。把已有摘要和新增对话合并成一份不超过${SUMMARY_TARGET_CHARS}字的滚动摘要，保留事实、约定、称呼和未完成的话题，删掉寒暄。只输出摘要正文。`
      },
      {
        role: "user",
        content: `已有摘要：\n${previousSummary || "（无）"}\n\n新增对话：\n${transcript}`
      }
    ],
    temperature: 0,
    stream: false
  };

  try {
    const response = await callOpenAICompat(env, request);
    if (!response.ok) {
      console.error("tg: summary fold model returned non-ok", { status: response.status });
      return null;
    }
    const parsed = (await response.json()) as OpenAIChatResponse;
    const summary = extractAssistantText(parsed).trim();
    return summary || null;
  } catch (error) {
    console.error("tg: summary fold failed", { error: String(error) });
    return null;
  }
}

async function maybeFoldSummary(env: Env, chatId: string, state: TgChatState): Promise<TgChatState> {
  const maxTurns = readRecentMaxTurns(env);
  if (state.recent.length <= maxTurns) return state;

  const evictCount = Math.ceil(state.recent.length / 2);
  const evicted = state.recent.slice(0, evictCount);
  const folded = await foldIntoSummary(env, state.summary, evicted);
  if (folded == null) return state;

  return { summary: folded, recent: state.recent.slice(evictCount) };
}

function buildExecutionContextStub(pending: Promise<unknown>[]): ExecutionContext {
  return {
    waitUntil(promise: Promise<unknown>) {
      pending.push(promise);
    },
    passThroughOnException() {
      // no-op outside a fetch handler
    },
    props: {}
  } as ExecutionContext;
}

/**
 * Consume one tg_process queue task: claim the chat's buffered messages (empty
 * claim = an earlier task already handled them), run the full chat pipeline via
 * a synthetic in-worker request, send the reply as bubbles, update rolling state.
 */
export async function processTgChat(env: Env, chatId: string, ctx?: ExecutionContext): Promise<void> {
  const claimed = await claimInbox(env.DB, chatId);
  if (claimed.length === 0) return;

  if (!env.IM_API_KEY?.trim()) {
    console.error("tg: IM_API_KEY secret is required for the bot's internal chat calls");
    await sendMessageChunks(env, chatId, "配置缺失：需要设置 IM_API_KEY，请查看 docs/telegram-bot.md");
    return;
  }

  const userText = claimed.map((row) => row.text).join("\n");

  try {
    await sendChatAction(env, chatId, "typing");

    const state = await getChatState(env.DB, chatId);
    const messages: OpenAIChatMessage[] = [
      { role: "system", content: buildSystemPrompt(env, state.summary) },
      ...state.recent.map((turn) => ({ role: turn.role, content: turn.content }) as OpenAIChatMessage),
      { role: "user", content: userText }
    ];

    const body: OpenAIChatRequest = {
      model: env.PUBLIC_MODEL_NAME || "companion",
      messages,
      stream: false
    };

    const pending: Promise<unknown>[] = [];
    const execCtx = ctx ?? buildExecutionContextStub(pending);
    const syntheticRequest = new Request("https://internal/v1/chat/completions", {
      method: "POST",
      headers: {
        authorization: `Bearer ${env.IM_API_KEY}`,
        "content-type": "application/json"
      },
      body: JSON.stringify(body)
    });

    const response = await handleChatCompletions(syntheticRequest, env, execCtx);
    if (!response.ok) {
      const errBody = await response.text();
      throw new Error(`chat pipeline returned ${response.status}: ${errBody.slice(0, 300)}`);
    }

    const parsed = (await response.json()) as OpenAIChatResponse;
    const assistantText = extractAssistantText(parsed).trim();

    await sendMessageChunks(env, chatId, assistantText);

    let nextState: TgChatState = {
      summary: state.summary,
      recent: [...state.recent, { role: "user", content: userText }, { role: "assistant", content: assistantText }]
    };
    nextState = await maybeFoldSummary(env, chatId, nextState);
    await saveChatState(env.DB, chatId, nextState);

    // Only meaningful for the stub path: flush the pipeline's deferred work
    // (memory maintenance enqueue etc.) before the queue message is acked.
    if (!ctx && pending.length > 0) {
      await Promise.allSettled(pending);
    }
  } catch (error) {
    // Give the messages back to the inbox so the queue retry reprocesses them.
    await unclaimInbox(
      env.DB,
      claimed.map((row) => row.id)
    );
    throw error;
  }
}
