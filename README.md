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
```

## Environment

All are optional for local development — the app runs without them.

| Variable                     | Purpose                                                                                                  |
| ---------------------------- | -------------------------------------------------------------------------------------------------------- |
| `PAGESPEED_API_KEY`          | PageSpeed Insights API key. Works keyless at low volume; a key raises the quota.                         |
| `SLACK_WEBHOOK_URL`          | Incoming webhook for drop alerts and follow-up reports. Unset → attempts remain pending.                 |
| `CRON_SECRET`                | Required outside development. Nightly callers send `Authorization: Bearer <CRON_SECRET>`.                |
| `FDE_ACCESS_USERNAME`        | Required in production with `FDE_ACCESS_PASSWORD`; protects the app and mutation routes with HTTP Basic. |
| `FDE_ACCESS_PASSWORD`        | Required in production with `FDE_ACCESS_USERNAME`; store it as a Webflow Cloud secret.                   |
| `PSI_MOCK`                   | When set, collection returns deterministic synthetic scores instead of calling PSI (tests).              |
| `PSI_RUNS`                   | Override the number of PSI runs per strategy (1–5, default 5) for quick checks.                          |
| `NIGHTLY_PAGE_CONCURRENCY`   | Number of pages collected concurrently by nightly (1–4, default 2).                                     |
| `ANTHROPIC_API_KEY`          | Enables AI explanations for new recommendations and the nightly Watcher narrative.                       |
| `ANTHROPIC_MOCK`             | Uses deterministic placeholder AI text without making Anthropic requests.                               |

Put these in `.env.local`.

## How it works

- **Collection** — `runPage` measures each page 5× per strategy via PSI (runs
  execute concurrently), takes the per-category median with the run-to-run
  range, runs a dependency-free agent-readiness scan, and appends a night to the
  page's history. Every collection has a stable run ID. Duplicate requests for
  an active page coalesce, stale runs recover as failed, and a run ID can append
  history only once. On-demand `POST /api/pages/[id]/run` returns `202` and the
  client polls until that job settles.
- **Baselines** — ordinary on-demand/nightly runs may store snapshots, history,
  recommendations, and scan results, but a page stays Pending until the user
  explicitly captures a baseline. Zero placeholders are never treated or shown
  as real baselines.
- **Nightly job** — wire a scheduled job to `POST /api/cron/nightly` (priority
  pages start first with bounded concurrency, then due follow-ups run).
  `CRON_SECRET` is mandatory outside development.
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
- **Background execution** — the local runner adapts Next.js `after()`. This
  keeps the request short but is not a durable queue. `BackgroundJobRunner` is
  the replacement boundary for a future Webflow job/queue adapter.
- **AI text** — new Lighthouse recommendations can receive concise Anthropic
  explanations, and nightly runs refresh the Watcher narrative. Both paths
  fail open to the existing non-AI UI when no key is configured or generation
  fails.

## Deployment access decision

Webflow Cloud does not provide a private authenticated boundary for an app
environment: its current documentation says anyone who can reach the deployed
mount-path URL can view it. Therefore this repository protects all production
app/API routes with HTTP Basic credentials in `proxy.ts`; missing credentials
return `503` rather than exposing the app. The cron route is excluded from Basic
auth because it uses its own mandatory bearer `CRON_SECRET`.

Configure `FDE_ACCESS_USERNAME`, `FDE_ACCESS_PASSWORD`, and `CRON_SECRET` as
secret runtime environment variables before a production deployment. Local
`npm run dev` remains open. See Webflow's [environment access and permissions](https://developers.webflow.com/webflow-cloud/environments)
and [secret environment variable guidance](https://developers.webflow.com/webflow-cloud/environments).

This is a shared internal-tool boundary, not per-user identity or role-based
authorization. If the deployment later needs individual accounts, replace it
with an identity provider while keeping the route protection fail closed.

## Deferred integrations

- Durable Webflow background job/queue adapter
- Production Anthropic, PageSpeed, and Slack credentials
- Per-user identity and role-based authorization
- Automated page remediation

## Product decisions

The four fixed scoring/scheduling choices for this phase are documented in
[DECISIONS.md](DECISIONS.md).
