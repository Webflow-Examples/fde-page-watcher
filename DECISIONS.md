# Product decisions pending sign-off

The implementation resolved product questions that were previously undefined.
They are reasonable defaults, but they should be confirmed (or changed) by
product rather than remaining implicit in the code. Each notes where it lives so
a change is a small, located edit.

## 1. Status is driven by mobile Performance only

Page status is classified from the **Performance** category on the **mobile**
strategy. Accessibility, SEO, Best Practices, and desktop scores are shown and
tracked but do not change status. The four status values (currently Stable /
Improving / Regressing / Pending) are a UI vocabulary, not a product decision;
treat `statusMeta(...)` in `src/lib/scoring.ts` as the single source of truth
for their labels rather than restating them here, so this doc can't drift from
the code again.

- Where: `classifyStatus(...)` default `key = "perf"`; callers pass `"mobile"`.
  `src/lib/scoring.ts`, `src/lib/store/fsStore.ts`.

## 2. Drop threshold is 8 points

A category is considered to have a real drop (vs. noise) when it falls **8 or
more points** below baseline. Used for degraded classification, drop alerts, and
the "dropped on X" Watcher bullets.

- Where: `DROP_THRESHOLD = 8` in `src/lib/scoring.ts`.

## 3. Noise band is `max(4, 2 × mean night-to-night movement)`

"Improving" vs "Stable" (see `statusMeta(...)` in `src/lib/scoring.ts` for the
current status vocabulary) uses a per-page, per-category noise band: twice the
mean absolute night-to-night movement of the median, floored at 4 points so a
flat history still tolerates normal PSI jitter.

- Where: `noiseBand(...)` in `src/lib/scoring.ts`.

## 4. Collection starts at the workspace's saved local time

The first watched page initializes the workspace to **midnight in that user's
browser timezone**. The Watchlist setting can override both time and IANA
timezone. Active pages receive stable offsets after the chosen start so the
workspace does not burst every page or PSI sample simultaneously.

- Where: `src/lib/collectionSchedule.ts`, the Watchlist settings panel, and the
  collector's 15-minute due-page cron.

## 5. Excluding a page and excluding a check are one idea, stored as two records

Applicability is a single concept in the registry, and S8's excluded list shows
pages and checks together — one list, each row carrying its reason and an
Include control. The open question is whether they share that list because they
are **one idea**, or only because showing them together is convenient. The
answer decides where the reason lives, and it is a product call rather than an
implementation detail: it is the same question as whether "this page does not
apply to this remediation" and "this check does not apply to this site" are
things a user would expect to manage, undo, and audit in one place.

Today they are two records with two gates:

- a case's excluded pages — `CaseDecisionRecord`, gated by `case-decisions.ts` (F5).
- an agent check's exclusion — `AgentIgnoreSettings.reasons`, gated by
  `agentCheckExclusionReason` (S4).

What is already settled, and should not change either way: both keep `reason` as
a plain string in `types.ts`, because that module imports nothing and so cannot
reach the registry; and both narrow it to `EXCLUSION_REASONS` at exactly one
place, on read and on write. Two validators for one record is how a reason the
registry retired stays acceptable on one path and not the other.

If the answer is **one idea**, S8 folds `AgentIgnoreSettings.reasons` into the
decision log and `agentCheckExclusionReason` delegates to `case-decisions.ts`
instead of narrowing itself. No caller changes: they already take
`ExclusionReason | null`. If the answer is **two**, nothing moves and S8's list
joins the two records when it renders.

Two properties to preserve on either answer, because both are load-bearing and
neither is obvious:

- The resolver returns `null` for "does not apply", never for "is gone". A
  reason survives an Include and applies again on a re-exclude, so a user who
  puts something back and then takes it out again is not asked twice.
- Nothing synthesises a reason. An exclusion recorded before reasons were stored
  has none, and reads as `Ignored` with no reason text rather than taking a
  default (registry rule 18).

- Where: `agentCheckExclusionReason` and `agentAccessExclusions` in
  `src/lib/agent-access.ts`; `AgentIgnoreSettings.reasons` in `src/lib/types.ts`;
  `caseDecisionFrom` / `decisionOf` in `src/lib/case-decisions.ts` (F5). The set
  of narrowing sites is pinned by a test in
  `src/lib/__tests__/agent-access.test.ts`, so adding or moving one fails the
  suite rather than passing quietly.
