# Page Watch · Brand Studio

Nightly Lighthouse (PageSpeed Insights) and agent-readiness monitoring for a
watchlist of priority Webflow.com pages. For each page it tracks per-strategy
(mobile + desktop) scores over time, classifies status, surfaces
recommendations, lets you triage them into tasks, log change markers, and posts
drop alerts and 2/7/30-day follow-up comparisons to Slack.

Built with Next.js (App Router) + React. TypeScript throughout.

## Getting started

```bash
npm install
npm run dev      # http://localhost:3000  (the bundled launch config uses 3100)
```

Other scripts:

```bash
npm run build    # production build
npm start        # serve the production build
npm run lint     # eslint
npm test         # vitest (unit + integration-focused concurrency tests)
npm run collector:check    # type-check the durable Workflow worker
npm run collector:dry-run  # bundle/validate the Workflow without deploying
```

## Environment

All are optional for local development — the app runs without them.

| Variable                     | Purpose                                                                                                       |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `PAGESPEED_API_KEY`          | PSI credential. Configure it on the collector Worker; it is also used by the local runner.                     |
| `CRON_SECRET`                | Shared bearer secret for nightly requests, Workflow dispatch, and result polling.                             |
| `COLLECTOR_URL`              | Production Workflow endpoint, ending in `/jobs`.                                                              |
| `PAGE_WATCHER_NIGHTLY_URL`   | Collector Worker target for the authenticated nightly dispatcher.                                             |
| `CF_ACCESS_CLIENT_ID`        | Collector Worker service-token client ID for reaching the SSO-protected app.                                  |
| `CF_ACCESS_CLIENT_SECRET`    | Collector Worker service-token secret for reaching the SSO-protected app.                                     |
| `DATASET_MODE`               | `demo` uses the existing sample namespace; `live` uses an isolated, initially empty namespace.                |
| `BASE_URL`                   | Webflow Cloud mount path (for example `/page-watch`); client routes and APIs are prefixed automatically.       |
| `SLACK_WEBHOOK_URL`          | Incoming webhook for drop alerts and follow-up reports.                                                       |
| `PSI_MOCK`                   | Local-only deterministic scores instead of PSI.                                                               |
| `PSI_RUNS`                   | Samples per strategy (1–5, default 5).                                                                         |
| `ANTHROPIC_API_KEY`          | Enables post-commit recommendation explanations and Watcher narratives on the app.                           |
| `ANTHROPIC_MOCK`             | Uses deterministic placeholder AI text without making Anthropic requests.                                    |

Put these in `.env.local`.

## How it works

- **Collection** — baseline, on-demand, and nightly actions first reserve a
  durable D1 job and return `202`. In production a Cloudflare Workflow performs
  up to five PSI samples per strategy, stages the raw JSON in R2, and scans agent
  readiness. The app polls the Workflow and imports completed results into its
  own D1/R2 bindings, so site-wide SSO never has to admit an inbound callback.
  Retries are durable, duplicates coalesce, stale jobs become visible failures,
  and a run ID can append history only once.
- **Baselines** — ordinary on-demand/nightly runs may store snapshots, history,
  recommendations, and scan results, but a page stays Pending until the user
  explicitly captures a baseline. Zero placeholders are never treated or shown
  as real baselines.
- **Nightly job** — the collector Worker calls `POST /api/cron/nightly` from a
  Cloudflare Cron Trigger at 03:00 UTC. It authenticates through Access with a
  service token and through the app route with `CRON_SECRET`, then priority-sorts
  the watchlist and dispatches Workflows. A guarded `0 20 22 7 *` trigger exists
  only for the Jul 22, 2026 3 PM CDT production test and no-ops in later years.
- **Storage** — a tenant-scoped `DataStore` (see `src/lib/store`) mirrors the
  state snapshot, append-only history/markers, and raw report tiers. Local
  development uses the filesystem under `.data/`, with an in-memory fallback
  for read-only hosts and per-tenant serialized atomic replacement. A deployed
  OpenNext worker with `DB` and `REPORTS` bindings automatically uses D1 plus
  R2; D1 state updates use version-guarded compare-and-swap retries.
- **State mutations** go through targeted server-side domain endpoints
  (`/api/pages`, `/api/recs`, `/api/pages/[id]/*`) and the store-level atomic
  update primitive. External PSI/Slack work happens outside that critical
  section; result commits re-read authoritative state.
- **Background execution** — Cloudflare Workflows own production execution.
  The local runner uses Next.js `after()` only for development.
- **Post-commit enrichment** — after the scores/raw reports are safely stored,
  optional Anthropic recommendation explanations, Watcher narrative refreshes,
  Slack alerts, and due follow-ups cannot roll back or mislabel a successful
  collection.

## Production setup

The interactive app relies on the enclosing site's SSO. There is no second
HTTP Basic layer and no `FDE_ACCESS_*` configuration. Non-interactive nightly
and collector result endpoints remain protected by `CRON_SECRET`.

1. Confirm the app has the `DB` and `REPORTS` declarations from
   `wrangler.json`. Webflow Cloud applies `0003_collection_jobs.sql` during the
   GitHub-driven deployment. Production intentionally fails instead of falling
   back to process memory when either binding is absent.
2. Deploy `collector-worker/wrangler.jsonc`. It binds the collector to the
   `page-watcher-reports` R2 bucket for temporary raw-report staging and owns
   the nightly Cron Trigger. Configure its `PAGESPEED_API_KEY`, `CRON_SECRET`,
   `CF_ACCESS_CLIENT_ID`, and `CF_ACCESS_CLIENT_SECRET` secrets, and allow that
   service token through the app's Cloudflare Access policy.
3. Set `COLLECTOR_URL`, `CRON_SECRET`, and `DATASET_MODE` on the Webflow app.
   `BASE_URL` is supplied automatically by Webflow Cloud. The app makes
   authenticated outbound status/report requests to the collector; no direct
   Webflow Worker origin or Access service token is required.
4. Call `/api/health` after deployment. It returns `503` if durable storage or
   the production collector is missing, without exposing secret values.

Use `DATASET_MODE=demo` for the existing sample state and `DATASET_MODE=live`
for real URLs. The two modes use separate tenant keys in the same D1 database,
so switching modes is reversible and never overwrites the demo dataset.

## Deferred integrations

- Per-user identity and role-based authorization
- Automated page remediation

## Product decisions

The four fixed scoring/scheduling choices for this phase are documented in
[DECISIONS.md](DECISIONS.md).
