-- External agent-readiness audit evidence, scoped to a public origin rather
-- than a watched page. Page Watch's own HTTP checks and the Kitesurf probe are
-- page-level and stay in the per-run history; an external auditor evaluates a
-- whole origin/product once, so one reading is shared by every watched page on
-- that origin instead of being duplicated into each night's record.
--
-- Compact summaries are indexed here; the untruncated provider payload lives in
-- R2 under the key recorded in raw_report_key. Nothing in these tables feeds
-- page status, Lighthouse or CrUX evidence, or collection completion.

CREATE TABLE IF NOT EXISTS agent_audit_snapshots (
  tenant TEXT NOT NULL,
  provider TEXT NOT NULL CHECK (provider IN ('ora')),
  origin TEXT NOT NULL,
  scanned_at TEXT NOT NULL,
  fetched_at TEXT NOT NULL,
  contract_version TEXT,
  -- The provider's own 0-100 score. NULL means the provider could not evaluate
  -- the target, which is not the same as a real zero.
  score REAL,
  -- The website-focused essentials reading of the same scan. Deliberately kept
  -- in its own column: it is an alternate interpretation, never an average.
  essentials_score REAL,
  summary_json TEXT NOT NULL,
  raw_report_key TEXT NOT NULL,
  PRIMARY KEY (tenant, provider, origin, scanned_at)
);

CREATE INDEX IF NOT EXISTS agent_audit_snapshots_latest_idx
  ON agent_audit_snapshots (tenant, provider, origin, scanned_at DESC);

-- Provider-operation state, held apart from any site verdict so a quota or
-- transport failure never presents itself as a failing check.
CREATE TABLE IF NOT EXISTS agent_audit_status (
  tenant TEXT NOT NULL,
  provider TEXT NOT NULL CHECK (provider IN ('ora')),
  origin TEXT NOT NULL,
  status TEXT NOT NULL CHECK (
    status IN ('available', 'pending', 'not-found', 'rate-limited', 'unavailable', 'error')
  ),
  latest_scanned_at TEXT,
  last_attempted_at TEXT NOT NULL,
  last_succeeded_at TEXT,
  next_eligible_at TEXT,
  error_code TEXT,
  error_message TEXT,
  PRIMARY KEY (tenant, provider, origin)
);
