-- ChangeMarker gained a stable `id` field (main branch): `i` is now resolved
-- from the marker's date rather than guaranteed unique per page (multiple
-- markers can land on the same history index). Re-key the markers table on
-- `id` instead of `i` so a second marker never silently overwrites the first.
DROP TABLE IF EXISTS markers;

CREATE TABLE IF NOT EXISTS markers (
  tenant TEXT NOT NULL,
  page_id TEXT NOT NULL,
  id TEXT NOT NULL,
  marker_json TEXT NOT NULL,
  PRIMARY KEY (tenant, page_id, id)
);
