import { authenticate } from "../auth/apiKey";
import { listDreamRunsForNamespace } from "../db/dreamRuns";
import {
  countRawMessagesForDateLabel,
  getDateLabelsLookback,
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