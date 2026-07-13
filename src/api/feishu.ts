// 飞书 ↔ 旦九 消息桥 (SPEC-FEISHU.md)
// POST /api/feishu/webhook  — 飞书事件 → TG 中继
// POST /api/feishu/send     — Bearer 鉴权 → 回飞书
// GET  /api/feishu/inbox    — Bearer 鉴权 → 审计列表
// retryUnrelayedFeishuInbox — cron 补投 relayed=0

import { authenticate } from "../auth/apiKey";
import {
  listFeishuInbox,
  listUnrelayedFeishuInbox,
  markFeishuInboxRelayed,
  tryInsertFeishuEvent,
  upsertFeishuInbox
} from "../db/feishu";
import type { Env } from "../types";
import { sha256Hex } from "../utils/hash";
import { json, openAiError } from "../utils/json";
import { isRecord, readJsonObject, readPositiveInt, readString } from "../utils/request";

const FEISHU_OPEN_API = "https://open.feishu.cn/open-apis";
const REJECT_TEXT = "这里是私人助理，请联系主人";
const SEND_CHUNK_LIMIT = 150;
const TOKEN_REFRESH_SKEW_MS = 5 * 60 * 1000;
const RETRY_WINDOW_MS = 24 * 60 * 60 * 1000;
const RETRY_BATCH_LIMIT = 10;

// ---------------------------------------------------------------------------
// Env helpers
// ---------------------------------------------------------------------------

function missingSecretsResponse(names: string[]): Response {
  return json(
    {
      error: {
        message: `Feishu bridge not configured: missing ${names.join(", ")}`,
        type: "service_unavailable",
        param: null,
        code: null
      }
    },
    { status: 503 }
  );
}

function requireEnv(env: Env, keys: Array<keyof Env>): { ok: true } | { ok: false; response: Response } {
  const missing: string[] = [];
  for (const key of keys) {
    const value = env[key];
    if (typeof value !== "string" || !value.trim()) {
      missing.push(String(key));
    }
  }
  if (missing.length > 0) return { ok: false, response: missingSecretsResponse(missing) };
  return { ok: true };
}

function parseAllowedOpenIds(env: Env): string[] {
  const raw = env.FEISHU_ALLOWED_OPEN_IDS?.trim() ?? "";
  if (!raw) return [];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

// ---------------------------------------------------------------------------
// WebCrypto: AES-256-CBC decrypt + signature
// ---------------------------------------------------------------------------

/** key = SHA256(encrypt_key)；iv = 密文前 16 字节；PKCS7 由 WebCrypto 自动处理 */
export async function decryptFeishuEvent(encryptB64: string, encryptKey: string): Promise<string> {
  const keyDigest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(encryptKey));
  const raw = Uint8Array.from(atob(encryptB64), (c) => c.charCodeAt(0));
  if (raw.byteLength < 17) {
    throw new Error("encrypted payload too short");
  }
  const iv = raw.slice(0, 16);
  const ciphertext = raw.slice(16);
  const cryptoKey = await crypto.subtle.importKey("raw", keyDigest, { name: "AES-CBC" }, false, ["decrypt"]);
  const plainBuf = await crypto.subtle.decrypt({ name: "AES-CBC", iv }, cryptoKey, ciphertext);
  return new TextDecoder().decode(plainBuf);
}

/** SHA256(timestamp + nonce + encrypt_key + rawBody) hex，对齐飞书官方算法 */
export async function computeFeishuSignature(
  timestamp: string,
  nonce: string,
  encryptKey: string,
  rawBody: string
): Promise<string> {
  return sha256Hex(timestamp + nonce + encryptKey + rawBody);
}

// ---------------------------------------------------------------------------
// Message content extraction
// ---------------------------------------------------------------------------

function extractPostPlainText(contentJson: string): string {
  try {
    const parsed = JSON.parse(contentJson) as unknown;
    if (!isRecord(parsed)) return "[富文本]";

    // 直接 content 或 i18n 包装 (zh_cn / en_us)
    let root: Record<string, unknown> = parsed;
    if (!Array.isArray(parsed.content) && isRecord(parsed.zh_cn)) {
      root = parsed.zh_cn as Record<string, unknown>;
    } else if (!Array.isArray(parsed.content) && isRecord(parsed.en_us)) {
      root = parsed.en_us as Record<string, unknown>;
    }

    const parts: string[] = [];
    const title = typeof root.title === "string" ? root.title.trim() : "";
    if (title) parts.push(title);

    const content = root.content;
    if (Array.isArray(content)) {
      for (const paragraph of content) {
        if (!Array.isArray(paragraph)) continue;
        const line: string[] = [];
        for (const node of paragraph) {
          if (!isRecord(node)) continue;
          const tag = typeof node.tag === "string" ? node.tag : "";
          if (tag === "text" || tag === "a") {
            if (typeof node.text === "string") line.push(node.text);
          } else if (tag === "at") {
            const name = typeof node.user_name === "string" ? node.user_name : "";
            line.push(name ? `@${name}` : "@");
          } else if (tag === "img") {
            line.push("[图片]");
          } else if (tag === "media" || tag === "emotion") {
            line.push(`[${tag}]`);
          }
        }
        if (line.length > 0) parts.push(line.join(""));
      }
    }

    const text = parts.join("\n").trim();
    return text || "[富文本]";
  } catch {
    return "[富文本]";
  }
}

export function extractMessageText(msgType: string, content: string, messageId: string): string {
  const type = msgType.toLowerCase();
  if (type === "text") {
    try {
      const parsed = JSON.parse(content) as unknown;
      if (isRecord(parsed) && typeof parsed.text === "string") {
        return parsed.text;
      }
    } catch {
      /* fall through */
    }
    return content || "";
  }
  if (type === "image") {
    return `[图片] ${messageId}`;
  }
  if (type === "file" || type === "audio" || type === "media" || type === "folder") {
    return `[文件] ${messageId}`;
  }
  if (type === "post") {
    return extractPostPlainText(content);
  }
  return `[${msgType || "unknown"}] ${messageId}`;
}

// ---------------------------------------------------------------------------
// Feishu tenant token + send message
// ---------------------------------------------------------------------------

interface TokenCache {
  token: string;
  expiresAtMs: number;
}

let tenantTokenCache: TokenCache | null = null;

export async function getTenantAccessToken(env: Env): Promise<string> {
  const appId = env.FEISHU_APP_ID?.trim();
  const appSecret = env.FEISHU_APP_SECRET?.trim();
  if (!appId || !appSecret) {
    throw new Error("FEISHU_APP_ID / FEISHU_APP_SECRET not configured");
  }

  const now = Date.now();
  if (tenantTokenCache && tenantTokenCache.expiresAtMs - TOKEN_REFRESH_SKEW_MS > now) {
    return tenantTokenCache.token;
  }

  const res = await fetch(`${FEISHU_OPEN_API}/auth/v3/tenant_access_token/internal`, {
    method: "POST",
    headers: { "content-type": "application/json; charset=utf-8" },
    body: JSON.stringify({ app_id: appId, app_secret: appSecret })
  });
  const data = (await res.json()) as {
    code?: number;
    msg?: string;
    tenant_access_token?: string;
    expire?: number;
  };
  if (!res.ok || data.code !== 0 || !data.tenant_access_token) {
    throw new Error(`tenant_access_token failed: ${data.msg ?? res.status}`);
  }

  const expireSec = typeof data.expire === "number" && data.expire > 0 ? data.expire : 7200;
  tenantTokenCache = {
    token: data.tenant_access_token,
    expiresAtMs: now + expireSec * 1000
  };
  return data.tenant_access_token;
}

/** 按段落边界切分，单段不超过 maxLen（默认 150） */
export function splitTextForFeishu(text: string, maxLen = SEND_CHUNK_LIMIT): string[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  if (trimmed.length <= maxLen) return [trimmed];

  const chunks: string[] = [];
  // 先按段落（空行 / 换行）切，再对超长段落硬切
  const paragraphs = trimmed.split(/\n{2,}|\n/).filter((p) => p.length > 0);
  let buf = "";

  const flush = () => {
    if (buf) {
      chunks.push(buf);
      buf = "";
    }
  };

  const pushPiece = (piece: string) => {
    if (!piece) return;
    if (piece.length > maxLen) {
      flush();
      for (let i = 0; i < piece.length; i += maxLen) {
        chunks.push(piece.slice(i, i + maxLen));
      }
      return;
    }
    if (!buf) {
      buf = piece;
      return;
    }
    const joined = `${buf}\n${piece}`;
    if (joined.length <= maxLen) {
      buf = joined;
    } else {
      flush();
      buf = piece;
    }
  };

  for (const p of paragraphs) {
    pushPiece(p);
  }
  flush();
  return chunks.length > 0 ? chunks : [trimmed.slice(0, maxLen)];
}

async function sendFeishuTextMessage(
  env: Env,
  input: { receiveId: string; text: string; receiveIdType?: string }
): Promise<string[]> {
  const token = await getTenantAccessToken(env);
  const receiveIdType = input.receiveIdType ?? "open_id";
  const parts = splitTextForFeishu(input.text);
  const messageIds: string[] = [];

  for (const part of parts) {
    const res = await fetch(
      `${FEISHU_OPEN_API}/im/v1/messages?receive_id_type=${encodeURIComponent(receiveIdType)}`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json; charset=utf-8",
          authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          receive_id: input.receiveId,
          msg_type: "text",
          content: JSON.stringify({ text: part })
        })
      }
    );
    const data = (await res.json()) as {
      code?: number;
      msg?: string;
      data?: { message_id?: string };
    };
    if (!res.ok || data.code !== 0 || !data.data?.message_id) {
      throw new Error(`feishu send message failed: ${data.msg ?? res.status}`);
    }
    messageIds.push(data.data.message_id);
  }

  return messageIds;
}

// ---------------------------------------------------------------------------
// Telegram relay
// ---------------------------------------------------------------------------

function formatRelayText(sender: string, text: string, messageId: string): string {
  return `【飞书】${sender}: ${text}\n\n[feishu_message_id: ${messageId}]`;
}

export async function relayToTelegram(
  env: Env,
  input: { sender: string; text: string; messageId: string }
): Promise<void> {
  const botToken = env.BRIDGE_TG_BOT_TOKEN?.trim();
  const chatId = env.BRIDGE_TG_CHAT_ID?.trim();
  if (!botToken || !chatId) {
    throw new Error("BRIDGE_TG_BOT_TOKEN / BRIDGE_TG_CHAT_ID not configured");
  }

  const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json; charset=utf-8" },
    body: JSON.stringify({
      chat_id: chatId,
      text: formatRelayText(input.sender, input.text, input.messageId)
    })
  });
  const data = (await res.json()) as { ok?: boolean; description?: string };
  if (!res.ok || !data.ok) {
    throw new Error(`telegram sendMessage failed: ${data.description ?? res.status}`);
  }
}

// ---------------------------------------------------------------------------
// Event processing (heavy path, runs under waitUntil)
// ---------------------------------------------------------------------------

async function processIncomingMessage(
  env: Env,
  payload: Record<string, unknown>
): Promise<void> {
  const event = isRecord(payload.event) ? payload.event : null;
  if (!event) return;

  const senderObj = isRecord(event.sender) ? event.sender : null;
  const senderId = senderObj && isRecord(senderObj.sender_id) ? senderObj.sender_id : null;
  const openId =
    (senderId && typeof senderId.open_id === "string" ? senderId.open_id : "") || "";

  const message = isRecord(event.message) ? event.message : null;
  if (!message) return;

  const messageId = typeof message.message_id === "string" ? message.message_id : "";
  if (!messageId) return;

  const msgType =
    (typeof message.message_type === "string" && message.message_type) ||
    (typeof message.msg_type === "string" && message.msg_type) ||
    "unknown";
  const content = typeof message.content === "string" ? message.content : "";
  const text = extractMessageText(msgType, content, messageId);
  const senderLabel = openId || "unknown";

  const allowed = parseAllowedOpenIds(env);
  if (allowed.length > 0 && !allowed.includes(openId)) {
    // 白名单外：礼貌拒答，不中继
    try {
      if (env.FEISHU_APP_ID?.trim() && env.FEISHU_APP_SECRET?.trim() && openId) {
        await sendFeishuTextMessage(env, { receiveId: openId, text: REJECT_TEXT });
      } else {
        console.warn("feishu reject reply skipped: app credentials or open_id missing");
      }
    } catch (error) {
      console.error("feishu reject reply failed", error);
    }
    return;
  }

  let relayed: 0 | 1 = 0;
  try {
    await relayToTelegram(env, { sender: senderLabel, text, messageId });
    relayed = 1;
  } catch (error) {
    console.error("feishu telegram relay failed", error);
    relayed = 0;
  }

  try {
    await upsertFeishuInbox(env.DB, {
      messageId,
      sender: senderLabel,
      text,
      relayed
    });
  } catch (error) {
    console.error("feishu inbox write failed", error);
  }
}

// ---------------------------------------------------------------------------
// POST /api/feishu/webhook
// ---------------------------------------------------------------------------

export async function handleFeishuWebhook(
  request: Request,
  env: Env,
  ctx: ExecutionContext
): Promise<Response> {
  if (request.method !== "POST") {
    return openAiError("Method not allowed", 405);
  }

  let rawBody: string;
  try {
    rawBody = await request.text();
  } catch {
    return openAiError("Invalid body", 400);
  }

  // 1) 验签（在解密前，用原始 body）
  const signature = request.headers.get("X-Lark-Signature") ?? request.headers.get("x-lark-signature");
  if (signature) {
    const encryptKey = env.FEISHU_ENCRYPT_KEY ?? "";
    const timestamp =
      request.headers.get("X-Lark-Request-Timestamp") ??
      request.headers.get("x-lark-request-timestamp") ??
      "";
    const nonce =
      request.headers.get("X-Lark-Request-Nonce") ?? request.headers.get("x-lark-request-nonce") ?? "";
    if (!timestamp || !nonce) {
      return openAiError("Missing signature headers", 401, "authentication_error");
    }
    try {
      const expected = await computeFeishuSignature(timestamp, nonce, encryptKey, rawBody);
      if (expected !== signature) {
        return openAiError("Invalid signature", 401, "authentication_error");
      }
    } catch (error) {
      console.error("feishu signature check failed", error);
      return openAiError("Signature verification failed", 401, "authentication_error");
    }
  }

  // 2) 解析 + 可选解密
  let parsed: Record<string, unknown>;
  try {
    const outer = JSON.parse(rawBody) as unknown;
    if (!isRecord(outer)) {
      return openAiError("Invalid JSON body", 400);
    }

    if (typeof outer.encrypt === "string" && outer.encrypt) {
      const encryptKey = env.FEISHU_ENCRYPT_KEY;
      if (typeof encryptKey !== "string" || !encryptKey) {
        return missingSecretsResponse(["FEISHU_ENCRYPT_KEY"]);
      }
      const plain = await decryptFeishuEvent(outer.encrypt, encryptKey);
      const inner = JSON.parse(plain) as unknown;
      if (!isRecord(inner)) {
        return openAiError("Decrypted payload is not an object", 400);
      }
      parsed = inner;
    } else {
      parsed = outer;
    }
  } catch (error) {
    console.error("feishu body parse/decrypt failed", error);
    return openAiError(
      error instanceof Error ? error.message : "Failed to parse event body",
      400
    );
  }

  // 3) url_verification：尽快回 challenge（不依赖 TG/APP secrets）
  const type = typeof parsed.type === "string" ? parsed.type : "";
  if (type === "url_verification") {
    const challenge = typeof parsed.challenge === "string" ? parsed.challenge : "";
    // 可选校验 token
    const token = typeof parsed.token === "string" ? parsed.token : "";
    const expectedToken = env.FEISHU_VERIFICATION_TOKEN?.trim();
    if (expectedToken && token && token !== expectedToken) {
      return openAiError("Invalid verification token", 401, "authentication_error");
    }
    return json({ challenge });
  }

  // 4) 事件路径：相关 secrets 缺失 → 503
  const config = requireEnv(env, [
    "FEISHU_VERIFICATION_TOKEN",
    "FEISHU_ALLOWED_OPEN_IDS",
    "BRIDGE_TG_BOT_TOKEN",
    "BRIDGE_TG_CHAT_ID"
  ]);
  if (!config.ok) return config.response;

  // Verification Token：header.token 或 body.token
  const header = isRecord(parsed.header) ? parsed.header : null;
  const bodyToken =
    (header && typeof header.token === "string" ? header.token : "") ||
    (typeof parsed.token === "string" ? parsed.token : "");
  const expectedToken = env.FEISHU_VERIFICATION_TOKEN!.trim();
  if (bodyToken && bodyToken !== expectedToken) {
    return openAiError("Invalid verification token", 401, "authentication_error");
  }
  // 若 payload 未带 token 且配置了 VERIFICATION_TOKEN：在有签名时已验签；无签名则要求 token
  if (!bodyToken && !signature) {
    return openAiError("Missing verification token", 401, "authentication_error");
  }

  const eventType =
    (header && typeof header.event_type === "string" ? header.event_type : "") ||
    (typeof parsed.type === "string" ? parsed.type : "");

  if (eventType !== "im.message.receive_v1") {
    // 非目标事件：直接 200，避免飞书重推
    return json({ ok: true, ignored: true, event_type: eventType || null });
  }

  const eventId =
    (header && typeof header.event_id === "string" ? header.event_id : "") ||
    (typeof parsed.uuid === "string" ? parsed.uuid : "");

  if (eventId) {
    try {
      const isNew = await tryInsertFeishuEvent(env.DB, eventId);
      if (!isNew) {
        return json({ ok: true, duplicate: true });
      }
    } catch (error) {
      console.error("feishu event dedup failed", error);
      // 去重失败不阻断：仍处理，避免丢消息；靠 inbox 审计
    }
  }

  // 5) 3 秒内 200；重活 waitUntil
  ctx.waitUntil(
    processIncomingMessage(env, parsed).catch((error) => {
      console.error("feishu processIncomingMessage failed", error);
    })
  );

  return json({ ok: true });
}

// ---------------------------------------------------------------------------
// POST /api/feishu/send
// ---------------------------------------------------------------------------

export async function handleFeishuSend(request: Request, env: Env): Promise<Response> {
  if (request.method !== "POST") {
    return openAiError("Method not allowed", 405);
  }

  const auth = await authenticate(request, env);
  if (!auth.ok) return openAiError("Unauthorized", 401, "authentication_error");

  const config = requireEnv(env, ["FEISHU_APP_ID", "FEISHU_APP_SECRET", "FEISHU_ALLOWED_OPEN_IDS"]);
  if (!config.ok) return config.response;

  const body = await readJsonObject(request);
  if (!body) return openAiError("Invalid JSON body", 400);

  const text = readString(body.text);
  if (!text) return openAiError("text is required", 400);

  const allowed = parseAllowedOpenIds(env);
  if (allowed.length === 0) {
    return missingSecretsResponse(["FEISHU_ALLOWED_OPEN_IDS"]);
  }

  const receiveId = readString(body.receive_id) || allowed[0];

  try {
    const messageIds = await sendFeishuTextMessage(env, { receiveId, text });
    return json({
      ok: true,
      receive_id: receiveId,
      message_ids: messageIds,
      // 单段时兼容 message_id 字段
      message_id: messageIds[0] ?? null
    });
  } catch (error) {
    console.error("feishu send failed", error);
    return openAiError(
      error instanceof Error ? error.message : "feishu send failed",
      502,
      "feishu_error"
    );
  }
}

// ---------------------------------------------------------------------------
// GET /api/feishu/inbox
// ---------------------------------------------------------------------------

export async function handleFeishuInbox(request: Request, env: Env): Promise<Response> {
  if (request.method !== "GET") {
    return openAiError("Method not allowed", 405);
  }

  const auth = await authenticate(request, env);
  if (!auth.ok) return openAiError("Unauthorized", 401, "authentication_error");

  const url = new URL(request.url);
  const limit = readPositiveInt(url.searchParams.get("limit"), 20, 100);

  try {
    const rows = await listFeishuInbox(env.DB, { limit });
    return json({
      data: rows.map((row) => ({
        message_id: row.message_id,
        sender: row.sender,
        text: row.text,
        created_at: row.created_at,
        relayed: row.relayed === 1
      })),
      meta: { limit, count: rows.length }
    });
  } catch (error) {
    console.error("feishu inbox list failed", error);
    return openAiError(
      error instanceof Error ? error.message : "feishu inbox list failed",
      500,
      "feishu_error"
    );
  }
}

// ---------------------------------------------------------------------------
// Cron: retry unrelayed inbox (24h window, max 10)
// ---------------------------------------------------------------------------

export async function retryUnrelayedFeishuInbox(env: Env): Promise<{
  ok: boolean;
  attempted: number;
  succeeded: number;
  skipped?: string;
}> {
  const botToken = env.BRIDGE_TG_BOT_TOKEN?.trim();
  const chatId = env.BRIDGE_TG_CHAT_ID?.trim();
  if (!botToken || !chatId) {
    return { ok: true, attempted: 0, succeeded: 0, skipped: "bridge tg not configured" };
  }

  const sinceIso = new Date(Date.now() - RETRY_WINDOW_MS).toISOString();
  let rows;
  try {
    rows = await listUnrelayedFeishuInbox(env.DB, { sinceIso, limit: RETRY_BATCH_LIMIT });
  } catch (error) {
    console.error("feishu list unrelayed failed", error);
    return { ok: false, attempted: 0, succeeded: 0, skipped: String(error) };
  }

  let succeeded = 0;
  for (const row of rows) {
    try {
      await relayToTelegram(env, {
        sender: row.sender,
        text: row.text,
        messageId: row.message_id
      });
      await markFeishuInboxRelayed(env.DB, row.message_id);
      succeeded += 1;
    } catch (error) {
      console.error("feishu retry relay failed", { message_id: row.message_id, error: String(error) });
    }
  }

  return { ok: true, attempted: rows.length, succeeded };
}
