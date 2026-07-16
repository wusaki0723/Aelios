// LMC-5 spontaneous recall: dream end-phase perception_cache picker.
// Rules: importance high + not recalled in 7 days + non-secret (cmh redaction).

import {
  getPerceptionCache,
  listPerceptionCandidates,
  parsePerceptionItems,
  upsertPerceptionCache
} from "../db/v2";
import type { Env, PerceptionCacheItem } from "../types";
import { containsSecret, redactEnvValues, redactSecrets } from "../utils/redact";

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const DEFAULT_MIN_IMPORTANCE = 0.75;
const PICK_COUNT = 2;

export interface PerceptionPickStats {
  date: string;
  picked: number;
  skipped_secret: number;
  excluded_yesterday: number;
}

function dateLabelDaysAgo(dateLabel: string, days: number): string {
  // dateLabel is YYYY-MM-DD; shift by calendar days in UTC (good enough for cache key).
  const [y, m, d] = dateLabel.split("-").map(Number);
  const utc = Date.UTC(y, (m || 1) - 1, d || 1);
  const shifted = new Date(utc - days * 24 * 60 * 60 * 1000);
  const yy = shifted.getUTCFullYear();
  const mm = String(shifted.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(shifted.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

export async function runPerceptionPickPhase(
  env: Env,
  input: { namespace: string; dateLabel: string; minImportance?: number }
): Promise<PerceptionPickStats> {
  const notRecalledSinceIso = new Date(Date.now() - SEVEN_DAYS_MS).toISOString();
  const yesterdayLabel = dateLabelDaysAgo(input.dateLabel, 1);
  const yesterdayRow = await getPerceptionCache(env.DB, {
    namespace: input.namespace,
    date: yesterdayLabel
  });
  const yesterdayIds = new Set(parsePerceptionItems(yesterdayRow).map((item) => item.id));

  const candidates = await listPerceptionCandidates(env.DB, {
    namespace: input.namespace,
    minImportance: input.minImportance ?? DEFAULT_MIN_IMPORTANCE,
    notRecalledSinceIso,
    excludeIds: [...yesterdayIds],
    limit: 30
  });

  // String-only env snapshot for value redaction (Workers bindings that aren't strings are skipped).
  const envStrings: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(env as unknown as Record<string, unknown>)) {
    if (typeof value === "string") envStrings[key] = value;
  }

  let skippedSecret = 0;
  const picked: PerceptionCacheItem[] = [];
  for (const row of candidates) {
    if (picked.length >= PICK_COUNT) break;
    if (containsSecret(row.content)) {
      skippedSecret += 1;
      continue;
    }
    // cmh-lite rules: regex secret patterns + opt-in env-value redaction (SPEC-LMC5 spontaneous).
    const redacted = redactEnvValues(redactSecrets(row.content), envStrings).trim();
    if (!redacted) continue;
    picked.push({
      id: row.id,
      content: redacted,
      importance: row.importance
    });
  }

  await upsertPerceptionCache(env.DB, {
    namespace: input.namespace,
    date: input.dateLabel,
    items: picked
  });

  return {
    date: input.dateLabel,
    picked: picked.length,
    skipped_secret: skippedSecret,
    excluded_yesterday: yesterdayIds.size
  };
}

/** Today's spontaneous items for SessionStart / boot injection. Empty if none. */
export async function loadSpontaneousForBoot(
  env: Env,
  input: { namespace: string; dateLabel?: string; timeZone?: string }
): Promise<PerceptionCacheItem[]> {
  const timeZone = input.timeZone || "Asia/Shanghai";
  const dateLabel =
    input.dateLabel ||
    new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).format(new Date());

  // Prefer today; if dream wrote for "yesterday" label relative to dream cron, also try yesterday.
  const today = await getPerceptionCache(env.DB, { namespace: input.namespace, date: dateLabel });
  const todayItems = parsePerceptionItems(today);
  if (todayItems.length > 0) return todayItems;

  const yesterday = dateLabelDaysAgo(dateLabel, 1);
  const yRow = await getPerceptionCache(env.DB, { namespace: input.namespace, date: yesterday });
  return parsePerceptionItems(yRow);
}
