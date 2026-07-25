# Production score accuracy audit — 2026-07-24

## Verdict

The score arithmetic was exact for every production capture that still had raw PSI evidence, but the dataset was not yet fully auditable or safe to treat as uniformly trustworthy.

- 34 of 56 captures had raw reports and reconciled exactly.
- 22 of 56 captures had no linked raw report, including all 11 baseline captures.
- One anonymous page (`P-01`) had only one or two successful samples for several recent strategies, and every successful sample carried a Lighthouse timeout warning.
- The current improvement label for `P-01` should therefore not be used as customer evidence.

The appropriate release posture at audit time was: trust the 34 reconciled captures conditionally, quarantine the warned/low-sample result, and do not make claims from the 22 unauditable captures.

## Scope and privacy

This audit covered the live production data plane through approximately 2026-07-24 03:04 UTC:

- 11 monitored page records;
- 56 successful history captures;
- 56 succeeded collection jobs; and
- 16 historical failed jobs.

Local demo data and two explicit mock collections were excluded. Page names, URLs, tenant names, resource URLs, and internal identifiers are not included in this artifact. `P-01` and `P-02` are audit-local aliases only.

## Evidence reconciliation

| Check | Result |
| --- | ---: |
| Structurally valid production history rows | 56 / 56 |
| Raw capture reports found | 34 / 56 |
| Strategy reports inspected | 68 |
| Raw PSI responses inspected | 325 |
| Category score cells recomputed | 272 |
| Score mismatches | 0 |
| Runtime errors in retained raw responses | 0 |
| Mock responses in production evidence | 0 |
| Lighthouse version | 13.4.0 |

The 272 cells are 34 captures × 2 strategies × 4 Lighthouse categories. Recomputed median/range values matched the stored values exactly.

All requested and final URLs agreed after harmless trailing-slash normalization. URLs were used only for in-memory comparison and are not retained here.

## Sample quality and warnings

Across the 68 strategy reports with raw evidence:

| Successful samples | Strategy reports |
| ---: | ---: |
| 5 | 63 |
| 4 | 1 |
| 2 | 2 |
| 1 | 2 |

Four low-sample strategy reports belonged to `P-01`:

- one mobile sample on 2026-07-22;
- two mobile and one desktop sample on 2026-07-23; and
- two mobile samples on 2026-07-24.

Fifteen retained Lighthouse responses for `P-01` warned that the page loaded too slowly for Lighthouse to finish within its time limit and that results could be incomplete. Every successful sample in the affected six strategy reports carried that warning.

`P-01` was labeled improving from a mobile baseline of 14 to a latest median of 26, but the latest value came from only two warned samples. Its baseline raw report was also missing, and the baseline desktop score had only one sample. That status is not sufficiently evidenced.

## Variability

PSI performance measurements showed meaningful run-to-run variability:

- 38 of 56 captures had a Performance spread of at least 10 points on one or both strategies.
- 52 strategy/capture combinations had a spread of at least 10 points.
- The largest observed spread was 32 points on `P-02` mobile: median 31, range 22–54.

All 325 retained PSI payloads were distinct. Repeated provider fetch timestamps were observed, but distinct payloads do not support a cache-reuse claim.

## Auditability gate

A provisional strict gate was applied to each capture:

1. linked raw report exists;
2. at least three successful samples exist for both strategies; and
3. no Lighthouse run warnings are present.

| Outcome | Captures |
| --- | ---: |
| Pass | 31 |
| Fail quality gate | 3 |
| Unverifiable because raw report is missing | 22 |

This gate did not yet exclude warned samples from score aggregation. The remediation adopted after this audit does: warned runs remain stored but no longer contribute to trusted medians or recommendation quorum.

## Recommendation evidence

The retained raw reports contained substantially more page-specific evidence than the application was using:

- 535 legacy Lighthouse opportunity instances;
- 5,200 Lighthouse audit/insight instances; and
- 111 normalized strategy-level opportunities.

At audit time, the application selected opportunities from one representative mobile run. That could promote an intermittent finding or miss a finding repeated in the other runs. It also discarded item-level evidence before the recommendation agent ran.

The adopted replacement is strict-majority aggregation across warning-free runs. All observations remain in the private raw report; only repeatable findings are eligible for customer recommendations.

## Other findings

- No customer-specific performance-threshold object was persisted in the audited production snapshot.
- The existing recommendations were limited to two generic titles: unused JavaScript and unused CSS.
- The recommendation prompt received the page title/URL, recommendation title/category, estimated savings, and a hard-coded effort band. It did not receive the raw affected resources or independently inspect the page.
- Some generated summaries made SEO or conversion claims that were not supported by the measured evidence.
- The legacy migration path verified the state checksum but did not verify raw-report object counts, links, or checksums. This allowed the 22 missing raw reports to go undetected.
- Missing/null Lighthouse category scores were converted to zero by the collection client instead of being rejected as invalid.

## Remediation plan

1. Reject PSI runtime errors and missing category scores instead of storing zeroes.
2. Store exact per-run Lighthouse warnings and normalized failing audits alongside every retained raw response.
3. Require at least three warning-free samples before a normal five-run collection can commit.
4. Aggregate findings by stable Lighthouse audit ID with a strict-majority quorum.
5. Run the privacy-safe reconciliation audit weekly and retain its dated/latest health summaries.
6. Add raw-report count/link/checksum verification to migration and backfill the 22 missing reports where source evidence still exists.
7. Re-baseline `P-01` after it can produce at least three warning-free samples per strategy.
8. Build the recommendation agent only after deterministic data-quality and finding-quorum gates pass.

## Reproducibility note

The audit used read-only production D1 history/state queries and the linked R2 report objects. It recomputed category medians and ranges directly from retained raw PSI responses, checked sample counts and warnings, compared requested/final URLs in memory, and excluded demo/mock records. No customer content was copied into this repository.
