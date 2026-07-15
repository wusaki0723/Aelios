-- weekly_log: daily_log entries older than 7 days roll up into ISO-week summaries.

CREATE TABLE IF NOT EXISTS weekly_log (
  namespace TEXT NOT NULL,
  week TEXT NOT NULL,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  source_days INTEGER NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (namespace, week)
);