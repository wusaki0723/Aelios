import { getMessagesByIds } from "../db/messages";
import { getDailyLog, getWeeklyLog } from "../db/v2";
import type { MemoryRecord } from "../types";
import { parseStringArray } from "../utils/parse";
import { cleanMessageText } from "../utils/sanitize";
import { clipMiddle, fitTranscriptTexts } from "./chatMaterial";
import { withImpressionDisclaimer } from "./impression";
import { getIsoWeekLabelForDateLabel } from "./weeklyRollup";

// 看一条记忆是从哪来的，一层层往下找：
//   原文还在（默认留 7 天）→ 给原文；
//   原文没了 → 找那天的日记（日记挂的原文 id 和记忆对得上，或者按产出这条记忆的那晚整理对应的日期）；
//   那天日记已并进周记 → 给那一周的周记。
// 原文保留期不因为这里变长：放大只是把还留着的东西找出来。

const SOURCE_MESSAGE_MAX_CHARS = 4000;
// 一次最多给这么多字原文，挂的原文多时按最长的先压，别让一次工具结果吃掉一大截上下文。
const SOURCE_TOTAL_MAX_CHARS = 16_000;
// D1 一条语句最多绑 100 个参数，namespace 占 1 个。
const SOURCE_ID_LIMIT = 90;

export type SourceDateMatch = "diary_sources" | "dream_night";

export type MemorySource =
  | {
      kind: "messages";
      messages: Array<{ id: string; role: string; created_at: string; content: string }>;
      missing: number;
    }
  | {
      kind: "diary";
      date: string;
      matched_by: SourceDateMatch;
      title: string;
      summary: string;
      disclaimer: string;
    }
  | {
      kind: "week";
      date: string;
      week: string;
      matched_by: SourceDateMatch;
      title: string;
      summary: string;
      disclaimer: string;
    }
  | { kind: "none"; reason: "no_sources" | "sources_gone"; date?: string };

function sqlJsonArray(column: string): string {
  return `CASE WHEN json_valid(${column}) THEN ${column} ELSE '[]' END`;
}

async function findDiaryDateBySources(db: D1Database, namespace: string, ids: string[]): Promise<string | null> {
  const placeholders = ids.map(() => "?").join(", ");
  const row = await db
    .prepare(
      `SELECT d.date AS date FROM daily_log d
       WHERE d.namespace = ?
         AND EXISTS (SELECT 1 FROM json_each(${sqlJsonArray("d.source_message_ids")}) j WHERE j.value IN (${placeholders}))
       ORDER BY d.date DESC LIMIT 1`
    )
    .bind(namespace, ...ids)
    .first<{ date: string }>();
  return row?.date ?? null;
}

// 夜间整理产出的候选落在某一晚的 dream_runs 时间窗里，那一晚整理的是哪天的聊天就是 date_label。
// 只认挂着同一批原文的候选：挂着这些原文，就是读过这些原文的那一晚产出的。
// 不按 target_memory_id 找，那上面还有后来针对这条记忆的更新、去重候选，日期会对不上。
async function findDreamNightDate(db: D1Database, namespace: string, ids: string[]): Promise<string | null> {
  const placeholders = ids.map(() => "?").join(", ");
  const candidate = await db
    .prepare(
      `SELECT c.created_at AS created_at FROM memory_candidates c
       WHERE c.namespace = ?
         AND EXISTS (SELECT 1 FROM json_each(${sqlJsonArray("c.source_message_ids")}) j WHERE j.value IN (${placeholders}))
       ORDER BY c.created_at ASC LIMIT 1`
    )
    .bind(namespace, ...ids)
    .first<{ created_at: string }>();
  if (!candidate) return null;
  const run = await db
    .prepare(
      `SELECT date_label FROM dream_runs
       WHERE namespace = ? AND started_at <= ? AND COALESCE(finished_at, started_at) >= ?
       ORDER BY started_at DESC LIMIT 1`
    )
    .bind(namespace, candidate.created_at, candidate.created_at)
    .first<{ date_label: string }>();
  return run?.date_label ?? null;
}

async function findSourceDate(
  db: D1Database,
  namespace: string,
  memory: MemoryRecord,
  ids: string[]
): Promise<{ date: string; matched_by: SourceDateMatch } | null> {
  try {
    const byDiary = await findDiaryDateBySources(db, namespace, ids);
    if (byDiary) return { date: byDiary, matched_by: "diary_sources" };
    const byNight = await findDreamNightDate(db, namespace, ids);
    if (byNight) return { date: byNight, matched_by: "dream_night" };
  } catch (error) {
    console.error("memory source: date lookup failed", { namespace, memory_id: memory.id, error });
  }
  return null;
}

export async function traceMemorySource(
  db: D1Database,
  input: { namespace: string; memory: MemoryRecord; timeZone: string }
): Promise<MemorySource> {
  const { namespace, memory } = input;
  const allIds = [...new Set(parseStringArray(memory.source_message_ids))];
  const ids = allIds.slice(0, SOURCE_ID_LIMIT);
  if (ids.length === 0) return { kind: "none", reason: "no_sources" };

  const kept = await getMessagesByIds(db, { namespace, ids });
  if (kept.length > 0) {
    const contents = fitTranscriptTexts(
      kept.map((message) => clipMiddle(cleanMessageText(message.content), SOURCE_MESSAGE_MAX_CHARS)),
      { budget: SOURCE_TOTAL_MAX_CHARS, floor: 500 }
    );
    return {
      kind: "messages",
      messages: kept.map((message, i) => ({
        id: message.id,
        role: message.role,
        created_at: message.created_at,
        content: contents[i]
      })),
      missing: allIds.length - kept.length
    };
  }

  const found = await findSourceDate(db, namespace, memory, ids);
  if (!found) return { kind: "none", reason: "sources_gone" };

  const daily = await getDailyLog(db, { namespace, date: found.date });
  if (daily) {
    return withImpressionDisclaimer({
      kind: "diary" as const,
      date: daily.date,
      matched_by: found.matched_by,
      title: daily.title,
      summary: daily.summary
    });
  }
  const week = getIsoWeekLabelForDateLabel(found.date, input.timeZone);
  const weekly = await getWeeklyLog(db, { namespace, week });
  if (weekly) {
    return withImpressionDisclaimer({
      kind: "week" as const,
      date: found.date,
      week: weekly.week,
      matched_by: found.matched_by,
      title: weekly.title,
      summary: weekly.summary
    });
  }
  return { kind: "none", reason: "sources_gone", date: found.date };
}
