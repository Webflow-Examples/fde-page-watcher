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
| `CRON_SECRET`                | Existing shared bearer secret for FDE state/report access, Workflow dispatch, and manual nightly requests.    |
| `COLLECTOR_URL`              | Production Workflow endpoint, ending in `/jobs`.                                                              |
| `FDE_DATA_URL`               | Optional FDE Worker base URL. If omitted, it is derived from `COLLECTOR_URL`.                                  |
| `STORAGE_DRIVER`             | Set to `remote` only after the one-time FDE copy verifies; unset keeps Webflow storage as the source.          |
| `DATASET_MODE`               | `demo` uses the existing sample namespace; `live` uses an isolated, initially empty namespace.                |
| `BASE_URL`                   | Webflow Cloud mount path (for example `/page-watch`); client routes and APIs are prefixed automatically.       |
| `SLACK_WEBHOOK_URL`          | Incoming webhook for drop alerts and follow-up reports.                                                       |
| `PSI_MOCK`                   | Local-only deterministic scores instead of PSI.                                                               |
| `PSI_RUNS`                   | Samples per strategy (1–5, default 5).                                                                         |
| `ANTHROPIC_API_KEY`          | Enables post-commit recommendation explanations and Watcher narratives on the app.                           |
| `ANTHROPIC_MOCK`             | Uses deterministic placeholder AI text without making Anthropic requests.                                    |

Put these in `.env.local`.

## How it works

- **Collection** — baseline, on-demand, and nightly actions reserve a durable
  job in FDE D1 and return `202`. A Cloudflare Workflow performs up to five PSI
  samples per strategy, stores the raw JSON in FDE R2, scans agent readiness,
  and commits the completed result directly into FDE storage. The SSO-protected
  Webflow app only makes authenticated outbound requests; the Worker never has
  to call into the Webflow Access tenant. Retries are durable, duplicates
  coalesce, stale jobs become visible failures, and a run ID can append history
  only once.
- **Baselines** — ordinary on-demand/nightly runs may store snapshots, history,
  recommendations, and scan results, but a page stays Pending until the user
  explicitly captures a baseline. Zero placeholders are never treated or shown
  as real baselines.
- **Nightly job** — the FDE Worker reads the live watchlist from its own D1 at
  03:00 UTC, priority-sorts it, and dispatches Workflows directly. `POST
  /nightly` provides the same operation for authenticated manual tests. There
  is no Webflow callback and no Cloudflare Access service token.
- **Storage** — the production source of truth is the FDE-owned
  `page-watcher-fde` D1 database plus the `page-watcher-reports` R2 bucket. The
  Webflow app uses a tenant-scoped remote `DataStore`; D1 state updates use
  version-guarded compare-and-swap retries. Local development continues to use
  `.data/`. The Webflow-provisioned D1/R2 bindings remain intact as a reversible
  migration source and are not deleted by the migration.
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

1. Apply `migrations/` to the FDE-owned `page-watcher-fde` database, then deploy
   `collector-worker/wrangler.jsonc`. The Worker needs only the existing
   `PAGESPEED_API_KEY` and `CRON_SECRET` secrets. Its D1, R2, Workflow, and
   03:00 UTC Cron bindings are declared in that config.
2. Deploy the Webflow app code with `STORAGE_DRIVER` still unset. The app keeps
   reading and writing its existing Webflow-provisioned D1/R2 bindings at this
   stage.
3. While signed into the app through SSO, make this same-origin request from
   the browser console:

   ```js
   fetch("/api/admin/migrate-fde", {
     method: "POST",
     headers: {
       "content-type": "application/json",
       "x-page-watcher-migration": "copy-to-fde",
     },
     body: "{}",
   }).then((response) => response.json()).then(console.log)
   ```

   The endpoint copies the selected `DATASET_MODE` tenant and all of its raw
   reports outward, verifies a SHA-256 state checksum, and never mutates the
   source. It refuses to overwrite differing destination state unless the body
   explicitly contains `{ "replace": true }`.
4. Only after the response reports `ok: true`, set `STORAGE_DRIVER=remote` on
   the Webflow app and redeploy. `FDE_DATA_URL` is optional when `COLLECTOR_URL`
   already points to the same Worker and ends in `/jobs`.
5. Call `/api/health`; `storage.driver` should be `remote`. Run one page or send
   an authenticated `POST /nightly` to the FDE Worker, then verify the new
   history entry before relying on the next scheduled run.

Rollback is just as deliberate: remove `STORAGE_DRIVER=remote` and redeploy to
return to the preserved Webflow bindings. Do not write to both stores after
cutover and expect automatic bidirectional merging.

Use `DATASET_MODE=demo` for the existing sample state and `DATASET_MODE=live`
for real URLs. The two modes use separate tenant keys in the same D1 database,
so switching modes is reversible and never overwrites the demo dataset.

## Deferred integrations

- Per-user identity and role-based authorization
- Automated page remediation

## Product decisions

The four fixed scoring/scheduling choices for this phase are documented in
[DECISIONS.md](DECISIONS.md).
