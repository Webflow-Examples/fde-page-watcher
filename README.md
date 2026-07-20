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
npm test         # vitest (unit tests for scoring / follow-ups / watcher)
```

## Environment

All are optional for local development — the app runs without them.

| Variable            | Purpose                                                                                     |
| ------------------- | ------------------------------------------------------------------------------------------- |
| `PAGESPEED_API_KEY` | PageSpeed Insights API key. Works keyless at low volume; a key raises the quota.            |
| `SLACK_WEBHOOK_URL` | Incoming webhook for drop alerts and follow-up reports. Unset → messages are logged only.   |
| `CRON_SECRET`       | If set, `POST /api/cron/nightly` requires `Authorization: Bearer <CRON_SECRET>`.            |
| `PSI_MOCK`          | When set, collection returns deterministic synthetic scores instead of calling PSI (tests). |
| `PSI_RUNS`          | Override the number of PSI runs per strategy (1–5, default 5) for quick checks.             |

Put these in `.env.local`.

## How it works

- **Collection** — `runPage` measures each page 5× per strategy via PSI (runs
  execute concurrently), takes the per-category median with the run-to-run
  range, runs a dependency-free agent-readiness scan, and appends a night to the
  page's history. On-demand runs are asynchronous: `POST /api/pages/[id]/run`
  returns `202` immediately and the client polls `GET /api/state` until the
  page's `runState` settles.
- **Nightly job** — wire a scheduled job to `POST /api/cron/nightly` (priority
  pages first, then due follow-ups). Protect it with `CRON_SECRET`.
- **Storage** — a tenant-scoped `DataStore` (see `src/lib/store`) mirrors the
  three Webflow Cloud tiers (key-value read model, append-only history/markers,
  object storage for raw reports) on the local filesystem under `.data/`, with
  an in-memory fallback for read-only hosts. Swap in a Webflow Cloud adapter by
  implementing the same interface — no call-site changes.
- **State mutations** go through targeted server-side domain endpoints
  (`/api/pages`, `/api/recs`, `/api/pages/[id]/*`) that read-modify-write one
  slice of state, so a client action can't overwrite data from a concurrent
  nightly run.

## Product decisions

Four scoring/scheduling choices are documented in [DECISIONS.md](DECISIONS.md)
and are pending explicit product sign-off.
