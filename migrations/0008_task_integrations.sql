-- Task-tool integrations (workstream 2).
--
-- Deliberately NOT stored in the state blob. AppState is a whole-blob
-- compare-and-swap that already carries history, and putting task links, tokens
-- or sync cursors in it would make every checkout of a task state race every
-- nightly collection write. These tables are project-scoped and appended or
-- upserted on their own.
--
-- The boundary these tables serve is in DECISIONS.md 7: Page Watch owns the
-- problem, its evidence, its lifecycle and its plan; the task tool owns
-- execution. A row here records WHERE the work was sent, never a second
-- lifecycle. `external_state` is a reading of the task tool, never a Page Watch
-- state, and nothing in these tables is consulted to decide Resolved.

CREATE TABLE IF NOT EXISTS integration_connections (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  provider TEXT NOT NULL CHECK (provider IN ('asana', 'linear')),
  workspace_id TEXT,
  workspace_name TEXT,
  default_destination_id TEXT,
  default_destination_name TEXT,
  -- AES-256-GCM ciphertext and the per-write nonce, both base64. The key is
  -- INTEGRATION_TOKEN_KEY and never lives in this table.
  encrypted_token TEXT NOT NULL,
  token_nonce TEXT NOT NULL,
  -- JSON array of granted scope strings, as the provider reported them.
  scopes TEXT NOT NULL DEFAULT '[]',
  installed_by TEXT NOT NULL,
  installed_at TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('connected', 'error', 'disconnected')),
  last_error TEXT,
  UNIQUE (project_id, provider)
);

CREATE INDEX IF NOT EXISTS integration_connections_project_idx
  ON integration_connections (project_id);

-- One task per remediation. `remediation_key` is the same key the decision log
-- uses, so siblings of a shared fix resolve to one row rather than one each.
-- The unique index is the duplicate guard, not a convention: a retry cannot
-- create a second link even if the provider call succeeded twice.
CREATE TABLE IF NOT EXISTS task_links (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  remediation_key TEXT NOT NULL,
  provider TEXT NOT NULL,
  connection_id TEXT NOT NULL,
  external_id TEXT NOT NULL,
  external_url TEXT,
  external_state TEXT,
  assignee TEXT,
  last_synced_at TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (project_id, provider, remediation_key)
);

CREATE INDEX IF NOT EXISTS task_links_project_idx
  ON task_links (project_id, provider);

-- Idempotency ledger for outbound events and, later, for inbound webhooks.
-- event_id is deterministic for the fact it describes (a decision's stamp, a
-- transition's stamp), so a retried dispatch finds its own row and does nothing.
CREATE TABLE IF NOT EXISTS integration_events (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  event_id TEXT NOT NULL,
  type TEXT NOT NULL,
  payload_digest TEXT NOT NULL,
  received_at TEXT NOT NULL,
  processed_at TEXT,
  result TEXT,
  UNIQUE (project_id, provider, event_id)
);

CREATE INDEX IF NOT EXISTS integration_events_project_idx
  ON integration_events (project_id, received_at DESC);

-- Project-level integration configuration that is not a provider connection:
-- the four named automations, the outbound signed-event webhook, and the
-- project-scoped API token for external automation. Secrets are stored
-- encrypted or hashed, never in plaintext, and never returned to the browser.
CREATE TABLE IF NOT EXISTS integration_settings (
  project_id TEXT PRIMARY KEY,
  automations_json TEXT NOT NULL DEFAULT '{}',
  webhook_url TEXT,
  webhook_secret_encrypted TEXT,
  webhook_secret_nonce TEXT,
  api_token_hash TEXT,
  api_token_prefix TEXT,
  api_token_issued_at TEXT,
  api_token_issued_by TEXT,
  updated_at TEXT NOT NULL
);
