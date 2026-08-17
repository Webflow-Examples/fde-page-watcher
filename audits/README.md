# Data accuracy audits

This directory contains versioned, privacy-reviewed summaries of Page Watcher data audits. Raw PSI responses remain in access-controlled R2 storage and must not be copied into this directory.

## Customer-data policy

Committed audit artifacts may contain:

- aggregate counts and rates;
- Lighthouse versions and public audit identifiers;
- per-audit aliases such as `P-01`; and
- remediation decisions and verification results.

They must not contain:

- customer, tenant, or page names;
- page or resource URLs;
- internal page, run, or job IDs;
- raw Lighthouse payloads;
- raw provider errors or warnings that could embed a URL; or
- generated recommendation prose based on customer content.

The weekly Worker follows the same policy. It inspects raw reports in memory one at a time, reduces them to health counters, replaces tenant/page IDs with truncated SHA-256 references, and stores only the reduced audit in R2.

## Weekly automation

The collector Worker resolves the shared project registry for every schedule:

- `*/15 * * * *` — dispatch pages due in their saved local collection window.
- `30 5 * * 1` — weekly PSI data-accuracy audit, Monday at 05:30 UTC.

Weekly reports are written under each tenant prefix:

- `<tenant>/audits/weekly/YYYY-MM-DD.json` for the dated record;
- `<tenant>/audits/weekly/latest.json` for monitoring;
- `<tenant>/scheduler/audit-latest.json` for per-project scheduler status; and
- `scheduler/audit-latest.json` for aggregate scheduler execution status.

The authenticated collector route
`GET /audits/weekly/latest?tenant=<tenant>` returns the latest reduced report
for a known active project. Omitting the query retains the deployment-default
project for backward compatibility.

The weekly health result fails closed:

- `failed`: missing raw evidence, invalid scores, runtime errors, sample-count mismatches, score reconciliation mismatches, finding-aggregation mismatches, missing agent scans/readiness snapshots, or a readiness snapshot that does not reconcile with its raw checks.
- `degraded`: Lighthouse warnings, fewer than three usable samples, failed jobs, or a currently monitored page with no capture in the period.
- `healthy`: none of the conditions above were observed.

## Multi-run Lighthouse finding policy

Every successful PSI response keeps its full raw Lighthouse payload and normalized run evidence. Customer-facing recommendations use warning-free runs only and are aggregated separately for mobile and desktop.

For a normal collection:

1. At least three unique, warning-free measurements are required; duplicate
   provider responses remain raw audit evidence but do not count toward quorum.
2. A finding needs a strict majority: 2-of-3, 3-of-4, or 3-of-5.
3. A repeatable finding is `high` confidence at 80% or more support with at least four eligible runs; another strict-majority finding is `medium`.
4. A minority finding is retained as `intermittent` evidence but is not promoted to a recommendation.
5. Lighthouse run warnings are quality signals, never recommendations.
6. Estimated savings use the median of supporting warning-free runs and retain the low/high range. Savings from different audits are not added because they can overlap.

Findings from mobile and desktop remain device-specific. A later recommendation engine may label a finding cross-device only when each strategy independently passes its quorum.

## Agent-readiness history

Every successful collection stores the raw agent checks plus an immutable summary containing pass, fail, applicable, unavailable, ignored, percentage, and the exact ignored-check keys effective when that run completed. Historical charts use that stored summary; later ignore-setting changes do not rewrite earlier points. The weekly audit validates both presence and reconciliation without emitting check names or customer identifiers.

## Rollout gates

The audit Worker and evidence schema should be deployed before recommendation-agent changes. Recommendation generation must remain downstream of:

1. raw report presence;
2. score reconciliation;
3. minimum warning-free sample size;
4. finding quorum; and
5. customer threshold/alert evaluation.

The recommendation agent may inspect the page and the private item-level Lighthouse evidence only after those deterministic gates pass. It must distinguish measured PSI evidence from its own inference.
