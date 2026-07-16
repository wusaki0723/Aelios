-- monthly_log: weekly_log entries older than 35 days roll up into monthly impressions.

CREATE TABLE IF NOT EXISTS monthly_log (
  namespace TEXT NOT NULL,
  month TEXT NOT NULL,
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  source_week_count INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (namespace, month)
);