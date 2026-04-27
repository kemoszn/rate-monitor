CREATE TABLE IF NOT EXISTS collection_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  triggered_by TEXT NOT NULL,
  trigger_reason TEXT,
  status TEXT NOT NULL,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  success_count INTEGER NOT NULL DEFAULT 0,
  failure_count INTEGER NOT NULL DEFAULT 0,
  total_sources INTEGER NOT NULL DEFAULT 0,
  error_summary TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS rate_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id INTEGER NOT NULL,
  currency TEXT NOT NULL,
  provider_key TEXT NOT NULL,
  provider_name TEXT NOT NULL,
  source_url TEXT,
  now_mode TEXT,
  rate REAL,
  status TEXT NOT NULL,
  failure_code TEXT,
  failure_message TEXT,
  evidence_text TEXT,
  evidence_value TEXT,
  extraction_mode TEXT,
  fetched_at TEXT NOT NULL,
  derived_from_provider_key TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY(run_id) REFERENCES collection_runs(id)
);

CREATE INDEX IF NOT EXISTS idx_rate_snapshots_currency_provider_fetched
  ON rate_snapshots (currency, provider_key, fetched_at);

CREATE TABLE IF NOT EXISTS margin_config (
  currency TEXT PRIMARY KEY,
  margin_percentage REAL NOT NULL,
  updated_at TEXT NOT NULL
);
