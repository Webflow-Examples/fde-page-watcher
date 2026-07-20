# Product decisions pending sign-off

The implementation resolved four previously-undefined product questions. They
are reasonable defaults, but they should be confirmed (or changed) by product
rather than remaining implicit in the code. Each notes where it lives so a
change is a one-line edit.

## 1. Status is driven by mobile Performance only

Page status (Healthy / Improvable / Degraded) is classified from the
**Performance** category on the **mobile** strategy. Accessibility, SEO, Best
Practices, and desktop scores are shown and tracked but do not change status.

- Where: `classifyStatus(...)` default `key = "perf"`; callers pass `"mobile"`.
  `src/lib/scoring.ts`, `src/lib/store/fsStore.ts`.

## 2. Drop threshold is 8 points

A category is considered to have a real drop (vs. noise) when it falls **8 or
more points** below baseline. Used for degraded classification, drop alerts, and
the "dropped on X" Watcher bullets.

- Where: `DROP_THRESHOLD = 8` in `src/lib/scoring.ts`.

## 3. Noise band is `max(4, 2 × mean night-to-night movement)`

"Improvable" vs "Healthy" uses a per-page, per-category noise band: twice the
mean absolute night-to-night movement of the median, floored at 4 points so a
flat history still tolerates normal PSI jitter.

- Where: `noiseBand(...)` in `src/lib/scoring.ts`.

## 4. Nightly run time is 03:00 UTC

The nightly collection is anchored to **03:00 UTC** (a fixed absolute moment),
then rendered in each viewer's local timezone. Confirmed with product: store in
UTC, display in local.

- Where: `NIGHTLY_RUN_UTC_HOUR = 3` in `src/lib/schedule.ts`. Wire the scheduled
  job that calls `POST /api/cron/nightly` to the same hour.
