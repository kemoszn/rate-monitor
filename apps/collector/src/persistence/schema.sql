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

CREATE TABLE IF NOT EXISTS alert_state (
  currency TEXT NOT NULL,
  now_mode TEXT NOT NULL,
  alert_type TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 0,
  activated_at TEXT,
  cleared_at TEXT,
  last_run_id INTEGER,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (currency, now_mode, alert_type)
);

CREATE TABLE IF NOT EXISTS alert_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id INTEGER NOT NULL,
  currency TEXT NOT NULL,
  now_mode TEXT NOT NULL,
  alert_type TEXT NOT NULL,
  triggered_at TEXT NOT NULL,
  lookback_days INTEGER,
  current_now_rate REAL NOT NULL,
  google_rate REAL,
  market_rates_json TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  delivery_status TEXT NOT NULL,
  delivery_error TEXT,
  FOREIGN KEY(run_id) REFERENCES collection_runs(id)
);
