-- Weekly Chrome UX Report field evidence. CrUX remains separate from the
-- per-run Lighthouse history because every row describes a rolling 28-day
-- real-user collection period rather than one synthetic collection.

CREATE TABLE IF NOT EXISTS crux_snapshots (
  tenant TEXT NOT NULL,
  page_id TEXT NOT NULL,
  form_factor TEXT NOT NULL CHECK (form_factor IN ('PHONE', 'DESKTOP')),
  scope TEXT NOT NULL CHECK (scope IN ('url', 'origin')),
  requested_url TEXT NOT NULL,
  effective_url TEXT NOT NULL,
  collection_start TEXT NOT NULL,
  collection_end TEXT NOT NULL,
  fetched_at TEXT NOT NULL,
  lcp_p75_ms INTEGER,
  inp_p75_ms INTEGER,
  cls_p75 REAL,
  ttfb_p75_ms INTEGER,
  metrics_json TEXT NOT NULL,
  raw_report_key TEXT,
  PRIMARY KEY (tenant, page_id, form_factor, collection_end)
);

CREATE INDEX IF NOT EXISTS crux_snapshots_page_period_idx
  ON crux_snapshots (tenant, page_id, form_factor, collection_end DESC);

CREATE TABLE IF NOT EXISTS crux_status (
  tenant TEXT NOT NULL,
  page_id TEXT NOT NULL,
  form_factor TEXT NOT NULL CHECK (form_factor IN ('PHONE', 'DESKTOP')),
  status TEXT NOT NULL CHECK (status IN ('available', 'partial', 'insufficient', 'error')),
  effective_scope TEXT CHECK (effective_scope IS NULL OR effective_scope IN ('url', 'origin')),
  latest_collection_end TEXT,
  last_attempted_at TEXT NOT NULL,
  last_succeeded_at TEXT,
  error_code TEXT,
  error_message TEXT,
  PRIMARY KEY (tenant, page_id, form_factor)
);

