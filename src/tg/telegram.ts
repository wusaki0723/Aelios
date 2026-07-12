import type { Env } from "../types";

const TG_API_BASE = "https://api.telegram.org";
// Telegram sendMessage hard limit is 4096 UTF-16 code units per message.
const TG_MAX_MESSAGE_CHARS = 4096;
const TG_SEND_MAX_RETRIES = 2;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function requireBotToken(env: Env): string {
  const token = env.TG_BOT_TOKEN?.trim();
  if (!token) {
    throw new Error("TG bot requires TG_BOT_TOKEN secret (wrangler secret put TG_BOT_TOKEN)");
  }
  return token;
}

async function tgApi(env: Env, method: string, payload: Record<string, unknown>): Promise<Response> {
  const token = requireBotToken(env);
  return fetch(`${TG_API_BASE}/bot${token}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload)
  });
}

/**
 * Split reply text into bubbles: a blank line (two or more newlines) is an
 * explicit bubble boundary the model is instructed to emit. Any single bubble
 * still over the Telegram limit gets hard-split at the last newline/space
 * before the limit.
 */
export function splitIntoBubbles(text: string): string[] {
  const bubbles = text
    .split(/\n{2,}/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);

  const chunks: string[] = [];
  for (const bubble of bubbles) {
    let rest = bubble;
    while (rest.length > TG_MAX_MESSAGE_CHARS) {
      const window = rest.slice(0, TG_MAX_MESSAGE_CHARS);
      const cut = Math.max(window.lastIndexOf("\n"), window.lastIndexOf(" "));
      const at = cut > 0 ? cut : TG_MAX_MESSAGE_CHARS;
      chunks.push(rest.slice(0, at).trim());
      rest = rest.slice(at).trim();
    }
    if (rest.length > 0) chunks.push(rest);
  }
  return chunks;
}

async function sendOneMessage(env: Env, chatId: string, text: string): Promise<void> {
  for (let attempt = 0; attempt <= TG_SEND_MAX_RETRIES; attempt += 1) {
    const response = await tgApi(env, "sendMessage", { chat_id: chatId, text });
    if (response.ok) return;

    const body = await response.text();
    if (response.status === 429 && attempt < TG_SEND_MAX_RETRIES) {
      let retryAfterSec = 3;
      try {
        const parsed = JSON.parse(body) as { parameters?: { retry_after?: number } };
        if (typeof parsed.parameters?.retry_after === "number") {
          retryAfterSec = parsed.parameters.retry_after;
        }
      } catch {
        // keep default backoff when the 429 body is not JSON
      }
      await delay(retryAfterSec * 1000);
      continue;
    }

    throw new Error(`tg sendMessage failed (${response.status}): ${body.slice(0, 300)}`);
  }
}

/**
 * Send a full model reply as sequential bubbles. A bubble that keeps failing
 * after retries is logged and skipped so the rest of the reply still goes out.
 */
export async function sendMessageChunks(env: Env, chatId: string, text: string): Promise<void> {
  const chunks = splitIntoBubbles(text);
  if (chunks.length === 0) chunks.push("（空回复）");

  for (const chunk of chunks) {
    try {
      await sendOneMessage(env, chatId, chunk);
    } catch (error) {
      console.error("tg: bubble send failed, skipping", { chatId, error: String(error) });
    }
  }
}

const MIME_BY_EXT: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif"
};

function bytesToBase64(bytes: Uint8Array): string {
  // btoa 只吃 latin1 字符串；分块拼接避免大图撑爆调用栈。
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/**
 * Resolve a Telegram file_id to a base64 data URI. Returns null on any
 * failure — callers degrade to a "photo unavailable" placeholder instead of
 * failing the whole turn. Data URI (not the Telegram file URL) is what goes
 * to the vision model, so the bot token never leaves this worker.
 */
export async function fetchTelegramFileAsDataUri(env: Env, fileId: string): Promise<string | null> {
  try {
    const infoResponse = await tgApi(env, "getFile", { file_id: fileId });
    if (!infoResponse.ok) {
      console.error("tg: getFile failed", { status: infoResponse.status });
      return null;
    }
    const info = (await infoResponse.json()) as { ok?: boolean; result?: { file_path?: string } };
    const filePath = info.result?.file_path;
    if (!info.ok || !filePath) {
      console.error("tg: getFile returned no file_path");
      return null;
    }

    const token = requireBotToken(env);
    const fileResponse = await fetch(`${TG_API_BASE}/file/bot${token}/${filePath}`);
    if (!fileResponse.ok) {
      console.error("tg: file download failed", { status: fileResponse.status });
      return null;
    }
    const bytes = new Uint8Array(await fileResponse.arrayBuffer());
    const ext = filePath.split(".").pop()?.toLowerCase() ?? "";
    const mime = MIME_BY_EXT[ext] ?? "image/jpeg";
    return `data:${mime};base64,${bytesToBase64(bytes)}`;
  } catch (error) {
    console.error("tg: fetchTelegramFileAsDataUri failed", { error: String(error) });
    return null;
  }
}

export async function sendChatAction(env: Env, chatId: string, action = "typing"): Promise<void> {
  try {
    await tgApi(env, "sendChatAction", { chat_id: chatId, action });
  } catch (error) {
    // typing indicator is cosmetic; never let it break the reply path
    console.warn("tg: sendChatAction failed", { chatId, error: String(error) });
  }
}
