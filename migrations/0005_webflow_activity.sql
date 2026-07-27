-- Enterprise Webflow connection and activity evidence.
--
-- The site token is encrypted with the collector's
-- WEBFLOW_TOKEN_ENCRYPTION_KEY secret before it reaches D1. Safe connection
-- status is exposed through the authenticated data plane; ciphertext and IV
-- are never included in application state.

CREATE TABLE IF NOT EXISTS webflow_connections (
  tenant TEXT PRIMARY KEY,
  site_id TEXT NOT NULL,
  token_ciphertext TEXT NOT NULL,
  token_iv TEXT NOT NULL,
  token_version INTEGER NOT NULL DEFAULT 1 CHECK (token_version = 1),
  site_name TEXT NOT NULL,
  site_slug TEXT NOT NULL,
  domains_json TEXT NOT NULL,
  time_zone TEXT NOT NULL,
  last_published TEXT,
  connected_at TEXT NOT NULL,
  last_validated_at TEXT NOT NULL,
  last_synced_at TEXT,
  sync_status TEXT NOT NULL CHECK (sync_status IN ('pending', 'running', 'succeeded', 'failed')),
  sync_error TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS webflow_events (
  tenant TEXT NOT NULL,
  event_id TEXT NOT NULL,
  site_id TEXT NOT NULL,
  created_on TEXT NOT NULL,
  last_updated TEXT,
  event_type TEXT NOT NULL,
  resource_operation TEXT,
  actor_id TEXT,
  actor_name TEXT,
  actor_type TEXT,
  resource_id TEXT,
  resource_name TEXT,
  source TEXT,
  page_id TEXT,
  branch_id TEXT,
  change_count INTEGER,
  raw_report_key TEXT NOT NULL,
  ingested_at TEXT NOT NULL,
  PRIMARY KEY (tenant, event_id)
);

CREATE INDEX IF NOT EXISTS webflow_events_site_time_idx
  ON webflow_events (tenant, site_id, created_on DESC);

CREATE INDEX IF NOT EXISTS webflow_events_page_time_idx
  ON webflow_events (tenant, page_id, created_on DESC);
