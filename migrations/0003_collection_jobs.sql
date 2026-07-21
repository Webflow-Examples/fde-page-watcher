CREATE TABLE IF NOT EXISTS collection_jobs (
  tenant TEXT NOT NULL,
  id TEXT NOT NULL,
  page_id TEXT NOT NULL,
  state TEXT NOT NULL,
  job_json TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant, id)
);

CREATE INDEX IF NOT EXISTS collection_jobs_state_idx
  ON collection_jobs (tenant, state, updated_at);
