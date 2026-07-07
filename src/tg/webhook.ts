import { enqueueTgProcess } from "../queue/producer";
import type { Env } from "../types";
import { insertInbox } from "./state";

interface TgUpdate {
  message?: {
    message_id?: number;
    text?: string;
    from?: { id?: number; is_bot?: boolean };
    chat?: { id?: number | string; type?: string };
  };
}

const DEFAULT_DEBOUNCE_SECONDS = 3;

function readDebounceSeconds(env: Env): number {
  const parsed = Number(env.TG_DEBOUNCE_SECONDS);
  if (!Number.isFinite(parsed) || parsed < 0) return DEFAULT_DEBOUNCE_SECONDS;
  return Math.min(Math.floor(parsed), 60);
}

function isChatAllowed(env: Env, chatId: string): boolean {
  const raw = env.TG_ALLOWED_CHAT_IDS?.trim();
  if (!raw) return false;
  if (raw === "*") return true;
  return raw
    .split(",")
    .map((part) => part.trim())
    .includes(chatId);
}

/**
 * Telegram webhook entry. Always answers 200 for handled-but-ignored updates —
 * any non-200 makes Telegram redeliver the same update forever.
 */
export async function handleTelegramWebhook(request: Request, env: Env): Promise<Response> {
  if (!env.TG_BOT_TOKEN?.trim()) {
    console.error("tg: webhook hit but TG_BOT_TOKEN is not configured");
    return new Response("telegram bot not configured", { status: 503 });
  }

  const expectedSecret = env.TG_WEBHOOK_SECRET?.trim();
  const gotSecret = request.headers.get("x-telegram-bot-api-secret-token");
  if (!expectedSecret || gotSecret !== expectedSecret) {
    return new Response("unauthorized", { status: 401 });
  }

  let update: TgUpdate;
  try {
    update = (await request.json()) as TgUpdate;
  } catch {
    return new Response("bad request", { status: 400 });
  }

  const message = update.message;
  const text = message?.text?.trim();
  const chatIdRaw = message?.chat?.id;
  if (!message || !text || chatIdRaw == null || message.from?.is_bot) {
    // edits, stickers, joins, channel posts, bot echoes — acknowledge and drop
    return new Response("ok");
  }

  const chatId = String(chatIdRaw);
  if (!isChatAllowed(env, chatId)) {
    // Silent drop: no reply that would let strangers probe the bot. The owner
    // copies their chat_id from this log line into TG_ALLOWED_CHAT_IDS.
    console.log("tg: message from non-allowlisted chat dropped", { chatId });
    return new Response("ok");
  }

  await insertInbox(env.DB, { chatId, messageId: message.message_id, text });
  await enqueueTgProcess(env, chatId, readDebounceSeconds(env));

  return new Response("ok");
}
