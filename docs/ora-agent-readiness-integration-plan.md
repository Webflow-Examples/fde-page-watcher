# Ora and Is Agentic integration plan

Date: 2026-08-24

Status: implementation handoff; no product code has been changed for this plan.

## Outcome

Add Ora as an external agent-readiness evidence provider while preserving Page Watch's existing lightweight HTTP scan and Kitesurf rendered-page probe.

The integration should improve diagnosis, applicability, remediation, and verification. It must not add another unexplained score to the dashboard or average incompatible provider scores together.

The product-level outcome should be:

> Page Watch tells the user what prevents agents from using the site, why it believes that, how to fix it, and whether the fix worked. Ora, Is Agentic, Page Watch HTTP checks, and Kitesurf appear as evidence behind that conclusion.

## Architecture decision

Integrate with Ora directly rather than running `npx is-agentic` in the collector or relying only on the Is Agentic read-only report endpoint.

Ora performs the underlying scan used by Is Agentic. The `include=essentials` option returns the same website-focused Essential/Recommended/Bonus interpretation while the full Ora result retains richer per-check evidence and applicability.

Use these surfaces:

1. Read an existing cached result before scanning.
2. Run a complete audit with `POST /api/scan?include=essentials&format=audit` only when freshness policy and quota permit.
3. Poll the documented `Location` endpoint if Ora returns `202` with partial analysis.
4. Use `POST /api/scan/checks` to verify only the checks associated with a completed remediation.
5. Keep the Is Agentic canonical report URL as an optional external reference when one is available.

Do not:

- Spawn either the `is-agentic` or `@ora-ai/ax` CLI from the Cloudflare Worker.
- Treat an Ora transport, quota, or provider failure as a site failure.
- Average the Ora/Is Agentic score with Page Watch's local pass percentage.
- duplicate one origin-level Ora audit into every page's `Night` record.
- send authenticated, preview, private, localhost, or credential-bearing URLs to Ora.

## Existing Page Watch boundaries

The implementation must preserve these current behaviors:

- `src/lib/agentReadiness.ts` runs the dependency-free page-level HTTP scan.
- `src/lib/agentChecks.ts` defines the current 20 Cloudflare-style checks.
- `collector-worker/kitesurf.ts` captures page-level rendered DOM, accessibility, network, runtime, and timing evidence.
- `collector-worker/index.ts` commits local checks and Kitesurf into a page's run history independently of Lighthouse and CrUX.
- `AgentReadinessSnapshot` freezes the ignore configuration used by each historical local score.
- Kitesurf timings remain diagnostic-only and do not affect Lighthouse, CrUX, baselines, or page-performance status.

Ora differs in two important ways:

- It is primarily product/domain or origin scoped, while the Page Watch scanner and Kitesurf are page scoped.
- It supports pass, partial, failed, not-applicable, unavailable, tier, maturity, applicability, evidence, and remediation. The current `AgentCheck` boolean cannot faithfully represent that model.

## Evidence model

Keep each source intact and create a normalization layer above them.

| Source | Scope | Cadence | Authority |
| --- | --- | --- | --- |
| Page Watch HTTP | Exact watched page plus origin resources | Every normal collection | Fast deterministic monitoring |
| Kitesurf | Exact watched page | Every normal production collection | Rendered-page and runtime evidence |
| Ora full audit | Unique public origin/product | Cached daily or after a relevant change | Independent applicability-aware audit |
| Is Agentic essentials | Interpretation of the same Ora result | Same timestamp as Ora | Simple website-focused benchmark |

Never flatten these into one arithmetic score. Generate a Page Watch verdict from normalized issue cases and retain the source readings beneath it.

## Proposed data model

Add provider-neutral types in `src/lib/agentAudit.ts` or `src/lib/types.ts`:

```ts
export type ExternalAgentProvider = "ora";

export type ExternalAgentCheckResult =
  | "pass"
  | "partial"
  | "failed"
  | "not-applicable"
  | "unavailable";

export type ExternalAgentTier =
  | "essential"
  | "recommended"
  | "bonus"
  | "unclassified";

export interface ExternalAgentFinding {
  provider: ExternalAgentProvider;
  providerCheckId: string;
  name: string;
  category?: string;
  tier: ExternalAgentTier;
  result: ExternalAgentCheckResult;
  details?: string;
  recommendation?: string;
  applicability?: string;
  maturity?: string;
  estimatedGain?: number;
}

export interface ExternalAgentScoreBucket {
  earned: number;
  available: number;
  passing: number;
  total: number;
}

export interface ExternalAgentAuditSnapshot {
  schemaVersion: 1;
  contractVersion?: string;
  provider: "ora";
  origin: string;
  target: string;
  status: "available" | "partial";
  scannedAt: string;
  fetchedAt: string;
  score: number | null;
  grade?: string;
  essentials?: {
    score: number | null;
    label: string;
    essential: ExternalAgentScoreBucket;
    recommended: ExternalAgentScoreBucket;
    bonusPoints: number;
  };
  findings: ExternalAgentFinding[];
  reportUrl?: string;
  rawReportKey: string;
}

export interface ExternalAgentAuditStatus {
  provider: "ora";
  origin: string;
  status:
    | "available"
    | "pending"
    | "not-found"
    | "rate-limited"
    | "unavailable"
    | "error";
  latestScannedAt?: string;
  lastAttemptedAt: string;
  lastSucceededAt?: string;
  nextEligibleAt?: string;
  errorCode?: string;
  errorMessage?: string;
}
```

Keep `AgentCheck` and `AgentReadinessSnapshot` backward compatible for the existing local scanner. Do not force provider data into that boolean type.

## Persistence

Follow the origin-level version of the existing CrUX pattern: compact indexed summaries in D1, raw provider payloads in R2, and a data-plane read endpoint.

Create `migrations/0007_agent_audits.sql`:

```sql
CREATE TABLE IF NOT EXISTS agent_audit_snapshots (
  tenant TEXT NOT NULL,
  provider TEXT NOT NULL CHECK (provider IN ('ora')),
  origin TEXT NOT NULL,
  scanned_at TEXT NOT NULL,
  fetched_at TEXT NOT NULL,
  contract_version TEXT,
  score REAL,
  essentials_score REAL,
  summary_json TEXT NOT NULL,
  raw_report_key TEXT NOT NULL,
  PRIMARY KEY (tenant, provider, origin, scanned_at)
);

CREATE INDEX IF NOT EXISTS agent_audit_snapshots_latest_idx
  ON agent_audit_snapshots (tenant, provider, origin, scanned_at DESC);

CREATE TABLE IF NOT EXISTS agent_audit_status (
  tenant TEXT NOT NULL,
  provider TEXT NOT NULL CHECK (provider IN ('ora')),
  origin TEXT NOT NULL,
  status TEXT NOT NULL CHECK (
    status IN ('available', 'pending', 'not-found', 'rate-limited', 'unavailable', 'error')
  ),
  latest_scanned_at TEXT,
  last_attempted_at TEXT NOT NULL,
  last_succeeded_at TEXT,
  next_eligible_at TEXT,
  error_code TEXT,
  error_message TEXT,
  PRIMARY KEY (tenant, provider, origin)
);
```

Store raw reports under a path such as:

```text
agent-audits/{tenant}/ora/{origin-hash}/{scanned-at}.json
```

Retain a bounded number of snapshots per origin. Start with 60, matching the order of magnitude of CrUX history, and make the retention constant explicit.

## Ora client

Create `src/lib/ora.ts` for pure parsing and normalization, and `collector-worker/ora.ts` for network, retry, persistence, and scheduling behavior.

The pure module should include:

- URL normalization to a public `http` or `https` origin.
- Runtime validation/type guards for the documented audit response. Avoid adding a validation dependency unless the implementation clearly benefits from it.
- Conversion from Ora check status to `ExternalAgentCheckResult`.
- Conversion from Ora layers/checks plus the essentials check map into normalized findings.
- Safe truncation of provider-controlled details and recommendations.
- Stable mapping from provider check IDs to Page Watch issue keys.
- Helpers for score labels and provider freshness.

The worker module should include:

- `getCachedOraAudit(origin)` before any write or scan operation.
- `scanOraOrigin(origin, { maxAgeSeconds, force, ephemeral })`.
- `runOraChecks(origin, checkIds)` for post-remediation verification.
- Abort timeouts and bounded response sizes.
- `Retry-After` handling for `429` responses.
- Support for `200` and `202`; poll only the documented `Location` URL and cap total wait time.
- Optional `Authorization: Bearer ${ORA_SCAN_API_KEY}` only when configured.
- Provider errors that preserve the last successful snapshot.

Use `format=audit` so the application depends on Ora's versioned, allowlisted contract rather than undocumented internal fields.

## Collection policy

Ora scans should be origin scoped and deduplicated across watched pages.

Recommended policy:

1. Build the set of unique public origins across actively monitored pages.
2. Read the cached score first.
3. Treat an audit younger than 24 hours as fresh for normal monitoring.
4. Request a scan after a relevant change marker or an explicit user refresh.
5. Never request more than one scan for the same origin at a time.
6. Use a separate weekly scheduled job for automatic refreshes rather than placing Ora inside every per-page Lighthouse workflow.
7. Require `ORA_SCAN_API_KEY` before enabling automatic production refresh across all tenants. Keyless operation is acceptable for development and explicit low-volume refreshes, but the public quota is shared by Worker egress IP.
8. If a cached read succeeds but a refresh fails, retain the cached snapshot and mark the status stale/unavailable.

Do not make Lighthouse collection wait for Ora. Ora is independent external evidence, like weekly CrUX, and must not make a performance collection inconclusive.

## Privacy and user consent

- Scan only URLs already configured as public watched pages.
- Strip usernames, passwords, fragments, queries, and credentials before forming the origin.
- Reject localhost, loopback, RFC 1918, link-local, and non-HTTP(S) targets.
- Do not send preview or staging URLs unless a future explicit setting authorizes them.
- Explain that a normal Ora scan may be stored in its public directory/history.
- Offer `ephemeral: true` only for explicitly authorized temporary targets, subject to Ora's documented restrictions.
- Keep provider report URLs out of unauthenticated Page Watch payloads.

## Finding normalization and deduplication

Create a provider crosswalk keyed by stable Ora check ID. The crosswalk should map only clear semantic equivalents; unfamiliar provider checks should remain provider-specific rather than being guessed.

Initial examples:

| Ora concept/check | Page Watch issue family |
| --- | --- |
| robots policy/discovery | `agent-discoverability:robots` |
| sitemap discovery | `agent-discoverability:sitemap` |
| Markdown negotiation and `Vary` correctness | `agent-content:markdown` |
| server-rendered/no-JS content | `agent-content:no-js` |
| agent-friendly 404s | `agent-http:recovery` |
| OpenAPI publication | `agent-api:openapi` |
| typed error model | `agent-api:errors` |
| scoped permissions | `agent-auth:scopes` |
| MCP manifest/handshake | `agent-mcp:discovery` |
| MCP resource listing/quality | `agent-mcp:resources` |
| rate-limit headers | `agent-api:rate-limits` |

Normalized issue cases should contain:

- Plain-language diagnosis.
- Why it matters to an agent.
- Scope: origin or exact page.
- Confidence based on number and independence of supporting sources.
- Source evidence with timestamps.
- Conflicting or missing evidence.
- Ordered remediation derived from provider guidance but rewritten into Page Watch's task structure.
- Verification check IDs and success criteria.

Do not copy provider prose blindly into tasks. Retain the original evidence separately and generate concise, reviewable steps.

## Product and UI behavior

### Agent access summary

Replace the current score-first reading order with:

1. Product verdict: Ready, Needs attention, Blocked, or Unknown.
2. Highest-priority issue and next action.
3. Essential blockers, recommended improvements, and evidence freshness.
4. Expandable source details.

Example:

```text
Agent access needs attention
3 essential blockers across two independent sources

Primary issue
Agents cannot reliably discover machine-readable API documentation.

Next action
Publish the OpenAPI document and expose it from the API catalog.

How we know
Page Watch HTTP · API Catalog failed · 18 minutes ago
Ora · OpenAPI spec failed · scanned today
Kitesurf · rendered page available · 18 minutes ago
```

### Source presentation

Show source readings without compositing them:

- `Page Watch checks: 16/18 applicable`
- `Is Agentic essentials: 63/100`
- `Ora full audit: grade or full score`, if useful
- `Kitesurf: Rendered`, `Unavailable`, or `Awaiting probe`

Every provider value needs a timestamp and short methodology label. The main dashboard should show the Page Watch verdict, not all provider scores.

### Issue detail

The expanded issue should show:

- What happened.
- Why it matters.
- What to do.
- How confident Page Watch is.
- Supporting and conflicting sources.
- Provider check IDs and report link under advanced evidence.
- `Add remediation to Tasks` with the full plan and verification target.

### Ignore and applicability

Do not use Ignore as the primary response to an inapplicable check.

- `Not applicable` is evidence supplied by a provider or explicit Page Watch applicability rule.
- `Ignore` is a user policy decision.
- `Unavailable` means the provider could not determine the result.
- `Partial` is a real result and must not be collapsed into pass or fail.

Keep existing local ignore settings backward compatible. Add external-provider dismissal only at the normalized issue-case layer unless a clear long-term requirement emerges.

## Task and verification loop

When an Ora-backed issue becomes a task, retain:

- Canonical issue key.
- Ora provider check IDs.
- Original evidence timestamp.
- Ordered remediation steps.
- Owner and implementation notes when supplied by the user.
- Verification target: expected status for each check.

When the task is marked implemented:

1. Preserve the existing change marker.
2. Schedule the existing 2/7/30-day Page Watch follow-ups.
3. Offer or schedule an Ora selective re-check for the associated IDs.
4. Move the issue to Verifying.
5. Mark Resolved only when the selected checks pass or become correctly not-applicable.
6. Return the issue if any selected check remains failed or partial.

Provider unavailability should leave the issue in Verifying with a clear retry state; it should not mark the remediation unsuccessful.

## API and data-plane changes

Mirror the current CrUX approach.

Add authenticated collector data-plane routes such as:

```text
GET  /data/:tenant/agent-audits
POST /data/:tenant/agent-audits/ora/refresh
POST /data/:tenant/agent-audits/ora/verify
```

Suggested behavior:

- `GET` returns compact latest/history evidence for the current project's watched origins.
- `refresh` accepts an origin or page ID, normalizes it server-side, and creates or returns one origin-scoped refresh operation.
- `verify` accepts a canonical issue/task ID, resolves the stored provider check IDs server-side, and rejects arbitrary untrusted check IDs.
- Mutating routes use the existing authenticated collector boundary and bounded JSON parsing.
- Responses always distinguish provider status from site check status.

Extend `RemoteStore` with `getExternalAgentAudits()` following `getCruxEvidence()` rather than embedding provider history in `AppState`.

## Configuration

Add these documented variables:

| Variable | Required | Purpose |
| --- | --- | --- |
| `ORA_SCAN_API_KEY` | Optional for development; required for automated multi-tenant scanning | Removes public scan-family limits when Ora issues a partner key |
| `ORA_SCAN_ENABLED` | No; default false for production rollout | Enables external refreshes independently of local checks |
| `ORA_SCAN_MAX_AGE_SECONDS` | No; default 86400 in Page Watch policy | Page Watch freshness policy passed to Ora within Ora's documented bounds |

Never expose `ORA_SCAN_API_KEY` to the Next.js client or store it in D1.

Update:

- `collector-worker/wrangler.jsonc`
- generated `collector-worker/worker-configuration.d.ts`
- README environment table and deployment instructions
- any deployment-secret checklist

Do not hand-edit generated type declarations if the repository's existing type-generation command can produce them.

## Delivery phases

### Phase 1: provider foundation

- Add types and pure Ora response parser.
- Add fixtures captured from the documented `format=audit` contract.
- Add migration `0007_agent_audits.sql`.
- Implement R2 raw storage, D1 summaries/status, retention, and query helpers.
- Add data-plane GET route and `RemoteStore` reader.
- No UI score and no automatic scans yet.

Acceptance criteria:

- A stored fixture round-trips into the normalized model.
- Partial, N/A, unavailable, malformed, `202`, `429`, and `5xx` behaviors are tested.
- Provider data does not alter `Night.agent`, `AgentReadinessSnapshot`, performance status, or Lighthouse collection completion.

### Phase 2: explicit external audit

- Add `ORA_SCAN_ENABLED`.
- Add an authenticated user-triggered refresh endpoint.
- Add an Agent access source card with freshness, essentials score, and report link.
- Show external findings below the product verdict, not as another dashboard card.
- Disclose public external scanning before the first refresh.

Acceptance criteria:

- Refresh deduplicates by origin.
- A second page on the same origin reuses the same snapshot.
- A quota/provider error preserves the last successful audit.
- Private or credential-bearing targets are rejected before any outbound request.

### Phase 3: canonical issues and tasks

- Add the crosswalk and normalized issue-case assembler.
- Merge corroborating Page Watch, Kitesurf, and Ora evidence.
- Add plain-language consequence, remediation, confidence, scope, and success criteria.
- Copy the complete remediation into Tasks.

Acceptance criteria:

- Overlapping Markdown, API, robots, and MCP findings produce one issue each.
- Provider-only checks remain visible and correctly attributed.
- No provider prose is presented as a guaranteed impact.
- Ignore, N/A, unavailable, partial, and failed are visibly distinct.

### Phase 4: verification and scheduled refresh

- Add selective Ora re-checks for implemented tasks.
- Connect results to Implemented -> Verifying -> Resolved/Returned.
- Add weekly origin-scoped refresh with concurrency and quota controls.
- Require `ORA_SCAN_API_KEY` for automatic multi-tenant refresh.
- Add metrics, structured logs, and operator status.

Acceptance criteria:

- A successful targeted re-check resolves the issue.
- Partial or failed results return the issue.
- Provider failure leaves it Verifying and retryable.
- Scheduled refresh never blocks or changes the outcome of the normal Page Watch collection workflow.

## Tests

Add or extend tests in these areas:

### Pure parser and normalization

- `src/lib/__tests__/ora.test.ts`
- Contract validation and safe rejection of malformed payloads.
- Mapping of Ora statuses, essentials tiers, and check IDs.
- Stable origin normalization.
- Redaction/rejection of unsafe URLs.
- Crosswalk behavior with unknown IDs.

### Worker integration

- `collector-worker/__tests__/ora.test.ts`
- Cached read before scan.
- `200` complete response.
- `202` and bounded polling.
- `429` with `Retry-After`.
- `5xx`, timeout, invalid JSON, and oversized body.
- Optional bearer header behavior.
- One scan per unique origin.
- Last-known-good preservation.
- D1 upsert and retention.
- R2 raw payload key and metadata.

### Data plane and store

- Route authentication remains handled by the existing parent boundary.
- Method and body validation.
- Compact response does not expose secrets or raw provider payloads.
- Remote store normalizes missing external evidence for backward compatibility.

### Issue cases and UI

- One normalized issue for duplicated evidence.
- Product verdict priority.
- Partial/N/A/unavailable copy and styling.
- Accessibility names for source details and refresh/verification actions.
- Tasks preserve provider IDs and verification targets.

### Regression suite

- Existing agent-readiness scoring and ignore tests remain unchanged and passing.
- Existing Kitesurf fail-open tests remain unchanged and passing.
- Data-audit expectations include the new provider tables only if the weekly audit is intentionally extended.

## Observability

Log one structured event per provider operation with:

- operation: cached-read, full-scan, poll, selective-checks, persist
- tenant
- hashed origin or safe hostname
- status and HTTP status
- served-from-cache
- result age
- scan/check count
- duration
- retry-after
- provider error code

Never log query strings, credentials, raw response bodies, or authorization headers.

Add operator-level counters for:

- origins with current/stale/missing audits
- cache hit ratio
- scans attempted/succeeded/rate-limited
- selective verification outcomes
- parser/contract failures

## Documentation updates

- Explain that Ora powers Is Agentic and that Page Watch shows the essentials interpretation.
- Explain why Page Watch does not average provider scores.
- Document scope: local checks and Kitesurf are page-level; Ora is origin/product-level.
- Document public scan behavior, freshness, limits, and methodology-change risk.
- Link to Ora's methodology and the original provider report.
- Update the in-product Guide without adding another glossary-heavy path; common explanations belong inline.

## Required verification before commit

Repository instructions require npm 10.9.7 for dependency and lockfile operations.

If a dependency or lockfile changes, run:

```bash
npx --yes npm@10.9.7 ci --dry-run --ignore-scripts --no-audit --no-fund
```

For every implementation phase, run:

```bash
npm run lint
npm test -- --run
npm run collector:check
npm run collector:dry-run
npm run build
```

Use npm 10.9.7 for any install or lockfile command. Do not regenerate `package-lock.json` with npm 11.

## Open decisions for the implementation session

These should be resolved from current product context before Phase 2, but they do not block Phase 1:

1. Whether the first external scan requires a modal confirmation or can be enabled at the project level in Watch List settings.
2. Whether Ora refresh happens after every publish marker or only after implemented agent-readiness tasks.
3. Whether the full Ora score is useful in advanced evidence, or whether only Is Agentic essentials should be user-facing.
4. Whether automatic production scanning will wait for an Ora partner key or launch at a deliberately low project cap.
5. Whether provider reports should be retained for 60 snapshots or a time-based period.

Default recommendations:

- Project-level opt-in with clear public-scan disclosure.
- Refresh after agent-related implementation markers plus a weekly maximum.
- Show Is Agentic essentials by default; keep the full Ora score in advanced evidence.
- Require a partner key before enabling multi-tenant automatic scans.
- Retain 60 compact snapshots and lifecycle raw R2 reports according to the existing report policy.

## Fresh coding-session prompt

Copy the prompt below into a fresh session:

```text
Implement Phase 1 of docs/ora-agent-readiness-integration-plan.md in this repository.

Before changing code:
1. Read AGENTS.md and follow the npm 10.9.7 requirement.
2. Read the entire integration plan.
3. Inspect the current working tree and preserve unrelated user changes.
4. Verify the current Ora `format=audit` and `include=essentials` contracts against https://ora.ai/docs and its OpenAPI specification. Do not rely on undocumented response fields.

Phase 1 scope only:
- Add provider-neutral external agent-audit types.
- Add a pure Ora response parser/normalizer with fixtures and tests.
- Add migration 0007 for origin-scoped audit snapshots and status.
- Store compact summaries in D1 and raw reports in R2 with bounded retention.
- Add a read-only authenticated data-plane endpoint and RemoteStore reader.
- Keep all external evidence separate from Night.agent, AgentReadinessSnapshot, Kitesurf, Lighthouse, CrUX, page status, and collection completion.
- Do not add automatic scans or user-facing score UI yet.

Use the existing CrUX implementation as the storage/data-plane pattern. Do not add a package unless it materially improves contract safety; if a dependency changes, use npm 10.9.7 and run the lockfile dry-run required by AGENTS.md.

Before handing off, run lint, tests, collector type-check, collector dry-run, and build. Report changed files, migration behavior, tests, and any contract assumptions that remain.
```

## Primary external references

- Ora documentation: <https://ora.ai/docs>
- Ora OpenAPI: <https://ora.ai/openapi.json>
- Is Agentic methodology: <https://is-agentic.com/methodology>
- Is Agentic developer documentation: <https://is-agentic.com/docs>
- Is Agentic OpenAPI: <https://is-agentic.com/openapi.json>
- Cloudflare standards-oriented scanner: <https://isitagentready.com/>
