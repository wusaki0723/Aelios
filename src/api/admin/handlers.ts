import { authenticate } from "../../auth/apiKey";
import { countKeptDiarySources, listRecentDailyLogs, listRecentWeeklyLogs } from "../../db/v2";
import { runDiaryWriter } from "../../memory/diaryWriter";
import { runMonthlyRollup } from "../../memory/monthlyRollup";
import { approveWeeklyRollup, runWeeklyRollup } from "../../memory/weeklyRollup";
import type { Env } from "../../types";
import { json, openAiError } from "../../utils/json";
import { readBoolean, readJsonObject, readString } from "../../utils/request";
import { STARMAP_HTML } from "./starmap";
import { ADMIN_HTML } from "./ui";

export function handleAdmin(): Response {
  return new Response(ADMIN_HTML, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store"
    }
  });
}

/** 记忆星图 v2 · 两江交汇（独立 Three.js 页，鉴权与 admin 面板一致：前端 Bearer） */
export function handleStarmap(): Response {
  return new Response(STARMAP_HTML, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store"
    }
  });
}

const DATE_LABEL_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function handleDiaryAdmin(request: Request, env: Env): Promise<Response> {
  const auth = await authenticate(request, env);
  if (!auth.ok) return openAiError("Unauthorized", 401, "authentication_error");
  if (!auth.profile.scopes.includes("memory:read")) {
    return openAiError("Missing required scope: memory:read", 403);
  }

  const url = new URL(request.url);
  const namespace = readString(url.searchParams.get("namespace")) || auth.profile.namespace;
  const parsedLimit = Number(url.searchParams.get("limit") || 30);
  const limit = Number.isFinite(parsedLimit) ? parsedLimit : 30;

  const [dailyRows, weeklies] = await Promise.all([
    listRecentDailyLogs(env.DB, { namespace, limit }),
    listRecentWeeklyLogs(env.DB, { namespace, limit })
  ]);
  const dates = dailyRows.map((row) => row.date).sort();
  // 数不出来就不给这个字段，后台退回只显示挂了几条原文，别误报"已清理"。
  const kept = dates.length
    ? await countKeptDiarySources(env.DB, { namespace, startDate: dates[0], endDate: dates[dates.length - 1] })
      .catch((error) => {
        console.error("admin diary: kept-source count failed", error);
        return null;
      })
    : new Map<string, number>();
  const dailies = dailyRows.map((row) => (kept ? { ...row, sources_kept: kept.get(row.date) ?? 0 } : row));

  return json({
    data: {
      namespace,
      limit,
      dailies,
      weeklies
    }
  });
}

export async function handleDiaryRewriteAdmin(request: Request, env: Env): Promise<Response> {
  const auth = await authenticate(request, env);
  if (!auth.ok) return openAiError("Unauthorized", 401, "authentication_error");
  if (!auth.profile.scopes.includes("memory:write")) {
    return openAiError("Missing required scope: memory:write", 403);
  }

  const url = new URL(request.url);
  const body = await readJsonObject(request);
  const namespace =
    readString(url.searchParams.get("namespace")) ||
    (body ? readString(body.namespace) : null) ||
    auth.profile.namespace;
  const date =
    readString(url.searchParams.get("date")) || (body ? readString(body.date) : null);

  if (!date || !DATE_LABEL_RE.test(date)) {
    return openAiError("date must be YYYY-MM-DD", 400);
  }

  try {
    const stats = await runDiaryWriter(env, namespace, date);
    return json({
      data: {
        namespace,
        date,
        stats
      }
    });
  } catch (error) {
    return json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}

export async function handleWeeklyRollupAdmin(request: Request, env: Env): Promise<Response> {
  const auth = await authenticate(request, env);
  if (!auth.ok) return openAiError("Unauthorized", 401, "authentication_error");
  if (!auth.profile.scopes.includes("memory:write")) {
    return openAiError("Missing required scope: memory:write", 403);
  }

  const url = new URL(request.url);
  const body = await readJsonObject(request);
  if (!body) return openAiError("Request body must be a JSON object", 400);

  const namespace =
    readString(url.searchParams.get("namespace")) ||
    readString(body.namespace) ||
    auth.profile.namespace;
  const dryRun = readBoolean(body.dry_run, false);

  try {
    const stats = await runWeeklyRollup(env, namespace, { dryRun });
    return json({
      data: {
        namespace,
        dry_run: dryRun,
        stats
      }
    });
  } catch (error) {
    return json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}

// 审阅通过 → 亲手删该周日志。周记本体不动 (已由 rollup 落库)。
export async function handleWeeklyApproveAdmin(request: Request, env: Env): Promise<Response> {
  const auth = await authenticate(request, env);
  if (!auth.ok) return openAiError("Unauthorized", 401, "authentication_error");
  if (!auth.profile.scopes.includes("memory:write")) {
    return openAiError("Missing required scope: memory:write", 403);
  }

  const url = new URL(request.url);
  const body = await readJsonObject(request);
  if (!body) return openAiError("Request body must be a JSON object", 400);

  const namespace =
    readString(url.searchParams.get("namespace")) ||
    readString(body.namespace) ||
    auth.profile.namespace;
  const week = readString(body.week);
  if (!week) return openAiError("week is required (e.g. 2026-W31)", 400);

  try {
    const result = await approveWeeklyRollup(env, { namespace, week });
    return json({ data: { namespace, ...result } });
  } catch (error) {
    return json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}

export async function handleMonthlyRollupAdmin(request: Request, env: Env): Promise<Response> {
  const auth = await authenticate(request, env);
  if (!auth.ok) return openAiError("Unauthorized", 401, "authentication_error");
  if (!auth.profile.scopes.includes("memory:write")) {
    return openAiError("Missing required scope: memory:write", 403);
  }

  const url = new URL(request.url);
  const body = await readJsonObject(request);
  if (!body) return openAiError("Request body must be a JSON object", 400);

  const namespace =
    readString(url.searchParams.get("namespace")) ||
    readString(body.namespace) ||
    auth.profile.namespace;
  const dryRun = readBoolean(body.dry_run, false);

  try {
    const stats = await runMonthlyRollup(env, namespace, { dryRun });
    return json({
      data: {
        namespace,
        dry_run: dryRun,
        stats
      }
    });
  } catch (error) {
    return json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
