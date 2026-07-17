import { authenticate } from "../auth/apiKey";
import { listDreamRunsForNamespace } from "../db/dreamRuns";
import { listJudgedCandidatesInRange, listMemoriesCreatedInRange, listMemoriesGoneDormantInRange } from "../db/v2";
import {
  countRawMessagesForDateLabel,
  getDateLabelsLookback,
  getDateRangeForLabel,
  getTargetDigestDateLabel,
  readDreamCursorValue,
  readDreamTimeZoneFromEnv,
  runDailyMemoryDigest
} from "../memory/dailyDigest";
import { json, openAiError } from "../utils/json";
import { readBoolean, readJsonObject, readString } from "../utils/request";
import type { Env } from "../types";

const DREAM_STATUS_LOOKBACK_DAYS = 7;
const DREAM_CURSOR_DATE_LABELS = 3;
const DREAM_HARVEST_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isValidHarvestDateLabel(label: string): boolean {
  if (!DREAM_HARVEST_DATE_RE.test(label)) return false;
  const [year, month, day] = label.split("-").map(Number);
  if (year < 1970 || month < 1 || month > 12 || day < 1 || day > 31) return false;
  // 回环反验：Date.UTC 会把 2/31 这类不存在的日期静默规整进下月，
  // 构造后年月日对不上即非法（闰年 2/29 由此自然判别）。
  const utc = new Date(Date.UTC(year, month - 1, day));
  return utc.getUTCFullYear() === year && utc.getUTCMonth() === month - 1 && utc.getUTCDate() === day;
}

export async function handleDreamStatus(request: Request, env: Env): Promise<Response> {
  const auth = await authenticate(request, env);
  if (!auth.ok) return openAiError("Unauthorized", 401, "authentication_error");
  if (!auth.profile.scopes.includes("memory:write")) {
    return openAiError("Missing required scope: memory:write", 403);
  }

  const url = new URL(request.url);
  const namespace = readString(url.searchParams.get("namespace")) || auth.profile.namespace;
  const timeZone = readDreamTimeZoneFromEnv(env);
  const anchorDateLabel = getTargetDigestDateLabel(timeZone);
  const cursorDateLabels = getDateLabelsLookback(anchorDateLabel, DREAM_CURSOR_DATE_LABELS, timeZone);
  const sinceIso = new Date(Date.now() - DREAM_STATUS_LOOKBACK_DAYS * 24 * 60 * 60 * 1000).toISOString();

  try {
    const [runs, cursors, rawMessageCounts] = await Promise.all([
      listDreamRunsForNamespace(env.DB, { namespace, sinceIso }),
      Promise.all(
        cursorDateLabels.map(async (dateLabel) => ({
          date_label: dateLabel,
          cursor: await readDreamCursorValue(env.DB, { namespace, dateLabel })
        }))
      ),
      Promise.all(
        cursorDateLabels.map(async (dateLabel) => ({
          date_label: dateLabel,
          raw_messages: await countRawMessagesForDateLabel(env.DB, { namespace, dateLabel, timeZone })
        }))
      )
    ]);

    return json({
      data: {
        namespace,
        time_zone: timeZone,
        anchor_date_label: anchorDateLabel,
        dream_runs: runs,
        cursors,
        raw_message_counts: rawMessageCounts
      }
    });
  } catch (error) {
    return json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}

export async function handleDreamRun(request: Request, env: Env): Promise<Response> {
  const auth = await authenticate(request, env);
  if (!auth.ok) return openAiError("Unauthorized", 401, "authentication_error");
  if (!auth.profile.scopes.includes("memory:write")) {
    return openAiError("Missing required scope: memory:write", 403);
  }

  const body = await readJsonObject(request);
  if (!body) return openAiError("Request body must be a JSON object", 400);

  const namespace = readString(body.namespace) || auth.profile.namespace;
  const dateLabel = readString(body.date);
  const force = readBoolean(body.force, false);
  const dryRun = readBoolean(body.dry_run, false);

  try {
    const result = await runDailyMemoryDigest(env, namespace, {
      dateLabel: dateLabel ?? undefined,
      force,
      dryRun,
      trigger: "manual"
    });

    const response: Record<string, unknown> = {
      namespace,
      date: dateLabel ?? getTargetDigestDateLabel(readDreamTimeZoneFromEnv(env)),
      force,
      dry_run: dryRun,
      result
    };

    if (dryRun && result.ran) {
      if ("proposal" in result && result.proposal) response.proposal = result.proposal;
      if ("routing_plan" in result && result.routing_plan) response.routing_plan = result.routing_plan;
      if ("extracted_memories" in result && result.extracted_memories) {
        response.extracted_memories = result.extracted_memories;
      }
    }

    return json({ data: response });
  } catch (error) {
    return json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}

// 当夜收成 (harvest)：返回某个 date_label 当晚的记忆变动，只读。
// created 新生 / dormant 沉眠 (superseded+archived) / candidates 判决 (approved+discarded)。
export async function handleDreamHarvest(request: Request, env: Env): Promise<Response> {
  const auth = await authenticate(request, env);
  if (!auth.ok) return openAiError("Unauthorized", 401, "authentication_error");
  if (!auth.profile.scopes.includes("memory:write")) {
    return openAiError("Missing required scope: memory:write", 403);
  }

  const url = new URL(request.url);
  const namespace = readString(url.searchParams.get("namespace")) || auth.profile.namespace;
  const dateLabel = readString(url.searchParams.get("date"));
  if (!dateLabel || !isValidHarvestDateLabel(dateLabel)) {
    return openAiError("date must be YYYY-MM-DD", 400);
  }

  const timeZone = readDreamTimeZoneFromEnv(env);
  let startIso: string;
  let endIso: string;
  try {
    ({ startIso, endIso } = getDateRangeForLabel(dateLabel, timeZone));
  } catch {
    return openAiError("date must be YYYY-MM-DD", 400);
  }

  try {
    const [created, dormant, candidates] = await Promise.all([
      listMemoriesCreatedInRange(env.DB, { namespace, startIso, endIso }),
      listMemoriesGoneDormantInRange(env.DB, { namespace, startIso, endIso }),
      listJudgedCandidatesInRange(env.DB, { namespace, startIso, endIso })
    ]);

    return json({
      data: {
        namespace,
        date: dateLabel,
        time_zone: timeZone,
        created,
        dormant,
        candidates
      }
    });
  } catch (error) {
    return json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}