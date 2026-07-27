-- Publish-scoped Webflow activity evidence.
--
-- A publish set is created when the site's lastPublished timestamp advances.
-- Its event membership is rebuilt during later syncs so delayed activity-log
-- entries can be incorporated without creating duplicate publishes.

CREATE TABLE IF NOT EXISTS webflow_publish_sets (
  tenant TEXT NOT NULL,
  publish_id TEXT NOT NULL,
  site_id TEXT NOT NULL,
  published_at TEXT NOT NULL,
  previous_published_at TEXT NOT NULL,
  detected_at TEXT NOT NULL,
  refreshed_at TEXT NOT NULL,
  domains_json TEXT NOT NULL,
  publisher_actor_id TEXT,
  publisher_actor_name TEXT,
  activity_count INTEGER NOT NULL DEFAULT 0,
  change_count INTEGER NOT NULL DEFAULT 0,
  page_count INTEGER NOT NULL DEFAULT 0,
  actor_count INTEGER NOT NULL DEFAULT 0,
  resource_count INTEGER NOT NULL DEFAULT 0,
  change_density TEXT NOT NULL
    CHECK (change_density IN ('small', 'moderate', 'high-change')),
  PRIMARY KEY (tenant, publish_id),
  UNIQUE (tenant, site_id, published_at)
);

CREATE TABLE IF NOT EXISTS webflow_publish_events (
  tenant TEXT NOT NULL,
  publish_id TEXT NOT NULL,
  event_id TEXT NOT NULL,
  PRIMARY KEY (tenant, publish_id, event_id),
  FOREIGN KEY (tenant, publish_id)
    REFERENCES webflow_publish_sets (tenant, publish_id)
    ON DELETE CASCADE,
  FOREIGN KEY (tenant, event_id)
    REFERENCES webflow_events (tenant, event_id)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS webflow_publish_sets_site_time_idx
  ON webflow_publish_sets (tenant, site_id, published_at DESC);

CREATE INDEX IF NOT EXISTS webflow_publish_events_event_idx
  ON webflow_publish_events (tenant, event_id);
