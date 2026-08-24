# Page Watch · Brand Studio

Nightly Lighthouse (PageSpeed Insights), weekly Chrome UX Report field
evidence, and agent-readiness monitoring for a watchlist of priority
Webflow.com pages. For each page it tracks per-strategy (mobile + desktop)
scores over time, classifies status, surfaces recommendations, lets you triage
them into tasks, log change markers, posts one daily regression digest to a
workspace webhook, and sends 2/7/30-day follow-up comparisons to Slack.

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
| `CRUX_API_KEY`               | Google Cloud key with the Chrome UX Report API enabled; required by the collector Worker.                     |
| `CRON_SECRET`                | Existing shared bearer secret for FDE state/report access, Workflow dispatch, and manual nightly requests.    |
| `COLLECTOR_URL`              | Production Workflow endpoint, ending in `/jobs`.                                                              |
| `FDE_DATA_URL`               | Optional FDE Worker base URL. If omitted, it is derived from `COLLECTOR_URL`.                                  |
| `STORAGE_DRIVER`             | Set to `remote` only after the one-time FDE copy verifies; unset keeps Webflow storage as the source.          |
| `DATASET_MODE`               | `demo` uses the existing sample namespace; `live` uses an isolated, initially empty namespace.                |
| `BASE_URL`                   | Webflow Cloud mount path (for example `/page-watch`); client routes and APIs are prefixed automatically.       |
| `SLACK_WEBHOOK_URL`          | Incoming Slack webhook for 2/7/30-day follow-up reports.                                                  |
| `PSI_MOCK`                   | Local-only deterministic scores instead of PSI.                                                               |
| `PSI_RUNS`                   | Samples per strategy (1–5, default 5).                                                                         |
| `ANTHROPIC_API_KEY`          | Enables post-commit recommendation explanations and Watcher narratives on the app.                           |
| `ANTHROPIC_MOCK`             | Uses deterministic placeholder AI text without making Anthropic requests.                                    |
| `ORA_SCAN_ENABLED`           | Collector gate for outbound external agent audits. Defaults to `false`; a project must also opt in.            |
| `ORA_SCAN_API_KEY`           | Optional Ora partner key. Absent means keyless operation on the shared public quota.                          |
| `WEBFLOW_TOKEN_ENCRYPTION_KEY` | Collector-only base64 AES-256 key used to encrypt tenant Webflow site tokens before D1 persistence.         |
| `AUTH_BROKER_URL`            | Access-protected gateway origin used only for the email-code identity step.                                   |
| `AUTH_PUBLIC_ORIGIN`         | Fixed public app origin used as the signed handoff audience and callback origin.                              |
| `AUTH_HANDOFF_SECRET`        | HMAC key shared only by the gateway and Webflow Cloud; use at least 32 random characters.                     |
| `AUTH_SESSION_SECRET`        | Webflow-only HMAC key for host-only login sessions; use an independent random value of at least 32 characters.|

Put these in `.env.local`.

## How it works

- **Collection** — baseline, on-demand, and nightly actions reserve a durable
  job in FDE D1 and return `202`. A Cloudflare Workflow performs up to five
  staggered PSI samples per strategy and stores every successful raw response,
  Lighthouse warning, and normalized failing audit in FDE R2. Cached/replayed
  responses are retained for diagnosis but do not count as independent
  samples. Warned runs are also excluded from trusted medians. A collection
  needs at least three unique, warning-free measurements before it can commit;
  otherwise the Workflow sleeps durably and retries up to twice at one-hour
  intervals.
  Recommendations require a strict-majority Lighthouse finding across those
  eligible runs. The Workflow also scans agent readiness and runs one fail-open
  Kitesurf rendered-page probe. Kitesurf retains compact DOM, accessibility,
  network, runtime-error, and diagnostic navigation evidence while staging the
  rendered HTML and accessibility snapshot in R2. Its non-Chromium timings never
  affect Lighthouse/CrUX scores, baselines, status, or collection success. The
  rendered HTML improves native-element detection when available; the existing
  HTTP scan remains the fallback. The Workflow commits the
  completed result directly into FDE storage. The SSO-protected Webflow app
  only makes authenticated outbound requests; the Worker never has to call
  into the Webflow Access tenant. Retries are durable, duplicates coalesce,
  stale jobs become visible failures, and a run ID can append history only
  once.
- **Baselines** — ordinary on-demand/nightly runs may store snapshots, history,
  recommendations, and scan results, but a page stays Pending until the user
  explicitly captures a baseline. Zero placeholders are never treated or shown
  as real baselines.
- **Scheduled collection** — every 15 minutes, the FDE Worker reads the live
  watchlist from its own D1 and dispatches only pages due in the workspace's
  saved local-time/timezone window. Active pages receive stable 15-minute
  offsets, and individual PSI samples are spaced one minute apart. `POST
  /nightly` still provides a force-all operation for authenticated manual
  tests. There is no Webflow callback and no Cloudflare Access service token.
- **Weekly data audit** — each Monday at 05:30 UTC, the Worker reconciles the
  prior seven days of stored scores against their raw PSI responses. It checks
  raw-report coverage, usable sample counts, Lighthouse warnings/runtime
  errors, score medians/ranges, and finding quorum. The saved health report has
  hashed page references and no customer names, URLs, raw payloads, or raw
  errors. See [audits/README.md](audits/README.md).
- **Weekly field evidence** — each Tuesday at 06:15 UTC, the Worker queries the
  CrUX History API for phone and desktop evidence on every active page. It
  prefers exact-URL data, falls back to origin data only when URL evidence is
  unavailable, stores rolling 28-day p75 metrics and histograms in dedicated
  D1 tables, and retains the complete provider response in R2. An authenticated
  `POST /crux/collect` runs the same collection manually.
- **External agent-readiness evidence** — an origin-scoped store for
  third-party agent audits (currently Ora, which also powers Is Agentic) sits
  beside the existing evidence rather than on top of it. Page Watch's own HTTP
  checks and the Kitesurf probe are page-level; an external auditor evaluates a
  whole origin/product, so one reading is shared by every watched page on that
  origin instead of being copied into each night's record. Compact summaries and
  provider-operation status live in `agent_audit_snapshots` and
  `agent_audit_status` (60 snapshots retained per origin); the untruncated
  provider payload stays in R2 under `agent-audits/`. Provider scores are never
  averaged with the local pass percentage, and provider readings never affect
  `Night.agent`, the frozen `AgentReadinessSnapshot`, Lighthouse, CrUX, page
  status, or whether a collection is complete. An authenticated `GET
  /data/:tenant/agent-audits` returns the compact read model, and an
  authenticated `POST /data/:tenant/agent-audits/ora/refresh` runs one
  user-triggered audit. Nothing is ever scanned on a schedule: a refresh needs
  the collector's `ORA_SCAN_ENABLED` gate *and* the project's own opt-in in Watch
  List settings, which carries the public-scan disclosure. Refreshes deduplicate
  by origin, read Ora's stored score before spending scan quota, and preserve the
  last successful audit when the provider is rate-limited or unavailable. The
  Agent-readiness tab shows the Is Agentic essentials reading with Ora's own
  score and report link under advanced evidence; the two are never averaged with
  each other or with the Page Watch check percentage.
  Webflow staging hosts (`webflow.io` and any subdomain) are refused before any
  outbound request: a normal external scan is public and attributes a subdomain
  to its parent company's leaderboard row, so a staging hostname and grade would
  be published under Webflow's own row. Page Watch audits production URLs. The
  phased rollout is described in
  [docs/ora-agent-readiness-integration-plan.md](docs/ora-agent-readiness-integration-plan.md).
- **Storage** — the production source of truth is the FDE-owned
  `page-watcher-fde` D1 database plus the `page-watcher-reports` R2 bucket. The
  Webflow app uses a tenant-scoped remote `DataStore`; D1 state updates use
  version-guarded compare-and-swap retries. Local development continues to use
  `.data/`. The Webflow-provisioned D1/R2 bindings remain intact as a reversible
  migration source and are not deleted by the migration.
- **State mutations** go through targeted server-side domain endpoints
  (`/api/pages`, `/api/recs`, `/api/pages/[id]/*`) and the store-level atomic
  update primitive. External PSI/webhook/Slack work happens outside that critical
  section; result commits re-read authoritative state.
- **Background execution** — Cloudflare Workflows own production execution.
  The local runner uses Next.js `after()` only for development.
- **Post-commit enrichment** — after the scores/raw reports are safely stored,
  optional Anthropic recommendation explanations, Watcher narrative refreshes,
  webhook alerts, and due Slack follow-ups cannot roll back or mislabel a successful
  collection.
- **Webflow Enterprise activity** — Settings can connect one Enterprise site
  per tenant with a site token scoped to `sites:read`, `site_activity:read`,
  `pages:read`, `assets:read`, and `cms:read`. The collector validates every
  capability, encrypts the token with AES-GCM before D1 persistence, imports
  normalized actor/resource activity into D1, retains bounded raw events in
  R2, and refreshes activity on the existing 15-minute scheduler. Webflow
  failures are recorded on the connection and never block scheduled PSI. See
  [docs/webflow-activity.md](docs/webflow-activity.md) for the product contract
  and remaining publish-verification phases.

## Production setup

The interactive app is served directly from `https://page-watcher.webflow.io`.
Its login button briefly sends the browser to the existing Access-protected
gateway for Cloudflare's email-code authentication. The gateway validates the
Access JWT, signs a one-minute state-bound handoff, and returns the browser to
the Webflow hostname, which creates a signed host-only session cookie. No
custom email sender or DNS access is required. The app's role registry remains
authoritative for app-admin and project-level access, including after login.
Local storage keeps only the last opened project ID. See
[docs/native-auth.md](docs/native-auth.md) for deployment and cutover steps.

The immutable bootstrap app administrators are `matthew@webflow.com`,
`ben@webflow.com`, and `diego.rangel@webflow.com`. Additional app admins must
also use `@webflow.com`. Non-interactive nightly and collector result endpoints
remain protected separately by `CRON_SECRET`.

1. Apply `migrations/` to the FDE-owned `page-watcher-fde` database, then deploy
   `collector-worker/wrangler.jsonc`. The Worker uses its `BROWSER` binding for
   Kitesurf and needs `PAGESPEED_API_KEY`,
   `CRUX_API_KEY`, `CRON_SECRET`, and a base64-encoded 32-byte
   `WEBFLOW_TOKEN_ENCRYPTION_KEY` generated with `openssl rand -base64 32`.
   `ORA_SCAN_ENABLED` defaults to `false`; set it to `true` only when external
   agent audits should be available, and optionally add an `ORA_SCAN_API_KEY`
   secret to lift the shared public scan quota.
   Its D1, R2, Workflow, 15-minute due-page/Webflow-activity scheduler, Monday
   05:30 UTC audit, and Tuesday 06:15 UTC CrUX Cron bindings are declared in
   that config. Each schedule resolves the shared project registry and runs
   every active tenant independently; one project's failure does not block the
   remaining projects.
2. Deploy the Webflow app code with `STORAGE_DRIVER` still unset. The app keeps
   reading and writing its existing Webflow-provisioned D1/R2 bindings at this
   stage.
3. While signed into the app as an app administrator, make this same-origin request from
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

   The endpoint copies the tenant selected by the request's `project` query
   parameter (or the first active project when omitted) and all of its raw
   reports outward, verifies a SHA-256 state checksum, and never mutates the
   source. It refuses to overwrite differing destination state unless the body
   explicitly contains `{ "replace": true }`.
4. Only after the response reports `ok: true`, set `STORAGE_DRIVER=remote` on
   the Webflow app and redeploy. `FDE_DATA_URL` is optional when `COLLECTOR_URL`
   already points to the same Worker and ends in `/jobs`.
5. Call `/api/health`; `storage.driver` should be `remote`. Run one page or send
   an authenticated `POST /nightly` to the FDE Worker, then verify the new
   history entry before relying on the next scheduled run. After the first
   weekly audit, an authenticated
   `GET /audits/weekly/latest?tenant=<tenant>` on the collector returns that
   project's privacy-safe health summary; the public collector `/health`
   response exposes only aggregate status and project counts. Before relying
   on the CrUX Cron, send one authenticated `POST /crux/collect` and verify the
   `crux_snapshots` and `crux_status` rows plus the public `/health` summary.

Rollback is just as deliberate: remove `STORAGE_DRIVER=remote` and redeploy to
return to the preserved Webflow bindings. Do not write to both stores after
cutover and expect automatic bidirectional merging.

Use `DATASET_MODE=demo` for the existing sample state and `DATASET_MODE=live`
for real URLs. The two modes use separate tenant keys in the same D1 database,
so switching modes is reversible and never overwrites the demo dataset.

### Demo dataset

The bundled demo is date-relative and intentionally scenario-rich. It includes
stable, improving, regressing, paused, failed, partial, agent-only, and pending
pages; custom and task-linked chart markers; a verified PSI provider incident
with excluded anomaly bands; Lighthouse quality/provenance, native Webflow
elements, Kitesurf evidence, agent-ignore history, and recommendation/task
lifecycles. Separate CrUX fixtures cover URL and origin scope, stable/improving/
worsening trends, partial metrics, insufficient traffic, and provider errors.
When no collector URL is configured, Settings also shows a local Webflow
activity/publish example.

The disposable `brand-studio` demo namespace carries a fixture version. Local
filesystem and demo D1/FDE stores replace an older bundled fixture once when
that version changes; live namespaces and arbitrary project tenants are never
refreshed this way.

## Deferred integrations

- Automated page remediation

## Product decisions

The four fixed scoring/scheduling choices for this phase are documented in
[DECISIONS.md](DECISIONS.md).
