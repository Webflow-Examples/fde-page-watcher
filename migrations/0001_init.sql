-- Cloudflare D1 schema for the fde-page-watcher DataStore adapter.
-- Mirrors the three tiers fsStore.ts implements on the local filesystem:
--   state   -> key-value read model (the whole AppState blob), version-guarded
--              for compare-and-swap writes from concurrent server-side callers.
--   history -> append-only per-page Night entries.
--   markers -> append-only per-page ChangeMarker entries.
-- Raw PSI/agent report payloads live in R2, not D1 (see cfStore.ts putReport/getReport).

CREATE TABLE IF NOT EXISTS state (
  tenant TEXT PRIMARY KEY,
  json TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS history (
  tenant TEXT NOT NULL,
  page_id TEXT NOT NULL,
  i INTEGER NOT NULL,
  night_json TEXT NOT NULL,
  PRIMARY KEY (tenant, page_id, i)
);

CREATE TABLE IF NOT EXISTS markers (
  tenant TEXT NOT NULL,
  page_id TEXT NOT NULL,
  i INTEGER NOT NULL,
  marker_json TEXT NOT NULL,
  PRIMARY KEY (tenant, page_id, i)
);
