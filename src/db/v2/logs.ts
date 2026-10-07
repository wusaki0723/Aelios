import { nowIso } from "../../utils/time";
import { parseStringArray } from "../../utils/parse";

// =====================================================================
// 昨天日志 daily_log (dream 每天写一条，boot 读"昨天")
// =====================================================================

export interface DailyLogRow {
  namespace: string;
  date: string;
  title: string;
  summary: string;
  source_message_ids: string[];
  updated_at: string;
}

function readSourceMessageIds(value: unknown): string[] {
  return parseStringArray(value);
}

type DailyLogDbRow = {
  namespace: string;
  date: string;
  title: string;
  summary: string;
  source_message_ids?: string | null;
  updated_at: string;
};

function mapDailyLog(row: DailyLogDbRow): DailyLogRow {
  return {
    namespace: row.namespace,
    date: row.date,
    title: row.title,
    summary: row.summary,
    source_message_ids: readSourceMessageIds(row.source_message_ids),
    updated_at: row.updated_at
  };
}

export async function getDailyLog(
  db: D1Database,
  input: { namespace: string; date: string }
): Promise<DailyLogRow | null> {
  const row = await db
    .prepare("SELECT namespace, date, title, summary, source_message_ids, updated_at FROM daily_log WHERE namespace = ? AND date = ?")
    .bind(input.namespace, input.date)
    .first<DailyLogDbRow>();
  return row ? mapDailyLog(row) : null;
}

export async function upsertDailyLog(
  db: D1Database,
  input: { namespace: string; date: string; title: string; summary: string; sourceMessageIds?: string[] }
): Promise<DailyLogRow> {
  const now = nowIso();
  const sourceMessageIds = [...new Set((input.sourceMessageIds ?? []).filter(Boolean))];
  const encoded = JSON.stringify(sourceMessageIds);
  await db
    .prepare(
      `INSERT INTO daily_log (namespace, date, title, summary, source_message_ids, updated_at) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(namespace, date) DO UPDATE SET
         title = excluded.title,
         summary = excluded.summary,
         source_message_ids = excluded.source_message_ids,
         updated_at = excluded.updated_at`
    )
    .bind(input.namespace, input.date, input.title, input.summary, encoded, now)
    .run();
  return {
    namespace: input.namespace,
    date: input.date,
    title: input.title,
    summary: input.summary,
    source_message_ids: sourceMessageIds,
    updated_at: now
  };
}

export async function listDailyLogsInRange(
  db: D1Database,
  input: { namespace: string; startDate: string; endDate: string }
): Promise<DailyLogRow[]> {
  const result = await db
    .prepare(
      `SELECT namespace, date, title, summary, source_message_ids, updated_at
       FROM daily_log
       WHERE namespace = ?
         AND date >= ?
         AND date <= ?
       ORDER BY date ASC`
    )
    .bind(input.namespace, input.startDate, input.endDate)
    .all<DailyLogDbRow>();
  return (result.results ?? []).map(mapDailyLog);
}

// 每篇日记挂的原文里还有几条没被保留期清掉，按日期返回。后台用它说清"能溯源"还是"原文已清理"。
export async function countKeptDiarySources(
  db: D1Database,
  input: { namespace: string; startDate: string; endDate: string }
): Promise<Map<string, number>> {
  const result = await db
    .prepare(
      `SELECT d.date AS date, COUNT(m.id) AS kept
       FROM daily_log d,
         json_each(CASE WHEN json_valid(d.source_message_ids) THEN d.source_message_ids ELSE '[]' END) j
       JOIN messages m ON m.namespace = d.namespace AND m.id = j.value
       WHERE d.namespace = ? AND d.date >= ? AND d.date <= ?
       GROUP BY d.date`
    )
    .bind(input.namespace, input.startDate, input.endDate)
    .all<{ date: string; kept: number }>();
  return new Map((result.results ?? []).map((row) => [row.date, Number(row.kept) || 0]));
}

export async function listRecentDailyLogs(
  db: D1Database,
  input: { namespace: string; limit: number }
): Promise<DailyLogRow[]> {
  const limit = Math.min(Math.max(Math.floor(input.limit), 1), 100);
  const result = await db
    .prepare(
      `SELECT namespace, date, title, summary, source_message_ids, updated_at
       FROM daily_log
       WHERE namespace = ?
       ORDER BY date DESC
       LIMIT ?`
    )
    .bind(input.namespace, limit)
    .all<DailyLogDbRow>();
  return (result.results ?? []).map(mapDailyLog);
}

export async function listDailyLogDatesBefore(
  db: D1Database,
  input: { namespace: string; beforeDate: string }
): Promise<string[]> {
  const result = await db
    .prepare(
      `SELECT date
       FROM daily_log
       WHERE namespace = ?
         AND date < ?
       ORDER BY date ASC`
    )
    .bind(input.namespace, input.beforeDate)
    .all<{ date: string }>();
  return (result.results ?? []).map((row) => row.date);
}

export interface WeeklyLogRow {
  namespace: string;
  week: string;
  start_date: string;
  end_date: string;
  title: string;
  summary: string;
  source_days: number;
  updated_at: string;
}

export async function listRecentWeeklyLogs(
  db: D1Database,
  input: { namespace: string; limit: number }
): Promise<WeeklyLogRow[]> {
  const limit = Math.min(Math.max(Math.floor(input.limit), 1), 100);
  const result = await db
    .prepare(
      `SELECT namespace, week, start_date, end_date, title, summary, source_days, updated_at
       FROM weekly_log
       WHERE namespace = ?
       ORDER BY week DESC
       LIMIT ?`
    )
    .bind(input.namespace, limit)
    .all<WeeklyLogRow>();
  return result.results ?? [];
}

export async function getWeeklyLog(
  db: D1Database,
  input: { namespace: string; week: string }
): Promise<WeeklyLogRow | null> {
  const row = await db
    .prepare(
      `SELECT namespace, week, start_date, end_date, title, summary, source_days, updated_at
       FROM weekly_log
       WHERE namespace = ? AND week = ?`
    )
    .bind(input.namespace, input.week)
    .first<WeeklyLogRow>();
  return row ?? null;
}

export function bindUpsertWeeklyLogStatement(
  db: D1Database,
  input: {
    namespace: string;
    week: string;
    startDate: string;
    endDate: string;
    title: string;
    summary: string;
    sourceDays: number;
  }
): D1PreparedStatement {
  const now = nowIso();
  return db
    .prepare(
      `INSERT INTO weekly_log (namespace, week, start_date, end_date, title, summary, source_days, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(namespace, week) DO UPDATE SET
         start_date = excluded.start_date,
         end_date = excluded.end_date,
         title = excluded.title,
         summary = excluded.summary,
         source_days = excluded.source_days,
         updated_at = excluded.updated_at`
    )
    .bind(
      input.namespace,
      input.week,
      input.startDate,
      input.endDate,
      input.title,
      input.summary,
      input.sourceDays,
      now
    );
}

export async function upsertWeeklyLog(
  db: D1Database,
  input: {
    namespace: string;
    week: string;
    startDate: string;
    endDate: string;
    title: string;
    summary: string;
    sourceDays: number;
  }
): Promise<WeeklyLogRow> {
  const now = nowIso();
  await bindUpsertWeeklyLogStatement(db, input).run();
  return {
    namespace: input.namespace,
    week: input.week,
    start_date: input.startDate,
    end_date: input.endDate,
    title: input.title,
    summary: input.summary,
    source_days: input.sourceDays,
    updated_at: now
  };
}

export function bindDeleteDailyLogsInRangeStatement(
  db: D1Database,
  input: { namespace: string; startDate: string; endDate: string }
): D1PreparedStatement {
  return db
    .prepare(
      `DELETE FROM daily_log
       WHERE namespace = ?
         AND date >= ?
         AND date <= ?`
    )
    .bind(input.namespace, input.startDate, input.endDate);
}

export async function deleteDailyLogsInRange(
  db: D1Database,
  input: { namespace: string; startDate: string; endDate: string }
): Promise<number> {
  const result = await bindDeleteDailyLogsInRangeStatement(db, input).run();
  return result.meta.changes ?? 0;
}

export interface MonthlyLogRow {
  namespace: string;
  month: string;
  title: string;
  summary: string;
  source_week_count: number;
  created_at: string;
  updated_at: string;
}

export async function listRecentMonthlyLogs(
  db: D1Database,
  input: { namespace: string; limit: number }
): Promise<MonthlyLogRow[]> {
  const limit = Math.min(Math.max(Math.floor(input.limit), 1), 100);
  const result = await db
    .prepare(
      `SELECT namespace, month, title, summary, source_week_count, created_at, updated_at
       FROM monthly_log
       WHERE namespace = ?
       ORDER BY month DESC
       LIMIT ?`
    )
    .bind(input.namespace, limit)
    .all<MonthlyLogRow>();
  return result.results ?? [];
}

export async function getMonthlyLog(
  db: D1Database,
  input: { namespace: string; month: string }
): Promise<MonthlyLogRow | null> {
  const row = await db
    .prepare(
      `SELECT namespace, month, title, summary, source_week_count, created_at, updated_at
       FROM monthly_log
       WHERE namespace = ? AND month = ?`
    )
    .bind(input.namespace, input.month)
    .first<MonthlyLogRow>();
  return row ?? null;
}

export async function listWeeklyLogsBeforeStartDate(
  db: D1Database,
  input: { namespace: string; beforeStartDate: string }
): Promise<WeeklyLogRow[]> {
  const result = await db
    .prepare(
      `SELECT namespace, week, start_date, end_date, title, summary, source_days, updated_at
       FROM weekly_log
       WHERE namespace = ?
         AND start_date < ?
       ORDER BY start_date ASC`
    )
    .bind(input.namespace, input.beforeStartDate)
    .all<WeeklyLogRow>();
  return result.results ?? [];
}

export function bindUpsertMonthlyLogStatement(
  db: D1Database,
  input: {
    namespace: string;
    month: string;
    title: string;
    summary: string;
    sourceWeekCount: number;
    createdAt?: string;
  }
): D1PreparedStatement {
  const now = nowIso();
  const createdAt = input.createdAt ?? now;
  return db
    .prepare(
      `INSERT INTO monthly_log (namespace, month, title, summary, source_week_count, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(namespace, month) DO UPDATE SET
         title = excluded.title,
         summary = excluded.summary,
         source_week_count = excluded.source_week_count,
         updated_at = excluded.updated_at`
    )
    .bind(
      input.namespace,
      input.month,
      input.title,
      input.summary,
      input.sourceWeekCount,
      createdAt,
      now
    );
}

export function bindDeleteWeeklyLogsByWeeksStatement(
  db: D1Database,
  input: { namespace: string; weeks: string[] }
): D1PreparedStatement[] {
  if (input.weeks.length === 0) return [];
  const placeholders = input.weeks.map(() => "?").join(", ");
  return [
    db
      .prepare(
        `DELETE FROM weekly_log
         WHERE namespace = ?
           AND week IN (${placeholders})`
      )
      .bind(input.namespace, ...input.weeks)
  ];
}
