import { causeLineOf } from "./case-copy";
import { byWorstMeasured, casesInQueue, hasMeasuredImpact, type Effort, type IssueCase, type RemediationGroup } from "./issue-case";
import { CONFIDENCES, COUNTED_QUEUES, WORK_STATES, type Confidence, type Queue, type WorkState } from "./vocabulary";

/* ── Issue-list selectors ───────────────────────────────────────────────── */

/**
 * Everything the issues list reads, derived in one place.
 *
 * The rule these exist to keep is that queue membership is never stored and
 * never worked out locally. `queueOf` in `issue-case/` owns it, so the header
 * sentence, the tab badges and the rows below them are three readings of one
 * number rather than three numbers that happen to agree today.
 *
 * They are exported as plain functions and consumed by the one hook at the
 * bottom. Nothing here touches React, so the list's behaviour is unit-testable
 * without rendering it.
 */

/**
 * How many cases each counted queue holds.
 *
 * Deliberately partial. `show_all` is the unfiltered view rather than a queue,
 * so the registry marks it uncounted and this never produces a number for it —
 * a badge cannot appear on it by accident, because there is nothing to read.
 */
export type QueueCounts = Partial<Record<Queue, number>>;

export function queueCountsOf(cases: readonly IssueCase[]): QueueCounts {
  const counts: QueueCounts = {};
  for (const queue of COUNTED_QUEUES) counts[queue] = casesInQueue(cases, queue).length;
  return counts;
}

/* ── The low-impact tail ────────────────────────────────────────────────── */

/* ── Sorting ────────────────────────────────────────────────────────────── */

export const ISSUE_SORTS = [
  "impact",
  "newest",
  "changed",
  "state",
  "cause",
  "pages",
  "confidence",
  "effort",
] as const;
export type IssueSort = (typeof ISSUE_SORTS)[number];

/** Impact is the default, because it is the only one that ranks by consequence. */
export const DEFAULT_ISSUE_SORT: IssueSort = "impact";

export const ISSUE_SORT_LABEL: Record<IssueSort, string> = {
  impact: "Impact",
  newest: "Newest",
  changed: "What changed",
  state: "State",
  cause: "Cause",
  pages: "Pages",
  confidence: "Confidence",
  effort: "Effort",
};

export function parseIssueSort(value: string | null | undefined): IssueSort {
  return (ISSUE_SORTS as readonly string[]).includes(value ?? "") ? (value as IssueSort) : DEFAULT_ISSUE_SORT;
}

/* ── Direction ──────────────────────────────────────────────────────────── */

export const SORT_DIRECTIONS = ["asc", "desc"] as const;
export type SortDirection = (typeof SORT_DIRECTIONS)[number];

/**
 * The direction each sort reads in when you first ask for it.
 *
 * Not a uniform default, because "descending" is not a useful opening move for
 * half of these: a triage list wants the lifecycle from `new`, effort from the
 * cheapest, confidence from the strongest, and impact from the largest. These
 * are the directions the sorts already had before they could be reversed, kept
 * as the first click so nothing about the list changed under anyone.
 */
export const DEFAULT_SORT_DIRECTION: Record<IssueSort, SortDirection> = {
  impact: "desc",
  newest: "desc",
  changed: "desc",
  state: "asc",
  cause: "asc",
  pages: "desc",
  confidence: "asc",
  effort: "asc",
};

export function parseSortDirection(
  value: string | null | undefined,
  sort: IssueSort,
): SortDirection {
  return (SORT_DIRECTIONS as readonly string[]).includes(value ?? "")
    ? (value as SortDirection)
    : DEFAULT_SORT_DIRECTION[sort];
}

/** The direction a second click on an already-sorted column asks for. */
export function reverseDirection(direction: SortDirection): SortDirection {
  return direction === "asc" ? "desc" : "asc";
}

/** Least work first, so a sort by effort surfaces what can be cleared today. */
const EFFORT_ORDER: Record<Effort, number> = { minutes: 0, hours: 1, days: 2, unknown: 3 };

/**
 * State and confidence rank in the registry's own declared order, derived from
 * its arrays rather than restated here.
 *
 * Both arrays are already ordered the way a reader wants to read them — the
 * lifecycle from `new` to `dismissed`, and confidence from `confirmed` down to
 * `unclear` — so indexing them IS the comparator. Copying the numbers out would
 * be R1's F10 again: a rule stated in one place and duplicated in a constant
 * that no longer changes with it. A state added to the registry lands in the
 * right position here without this file being touched.
 */
const indexOrder = <T extends string>(values: readonly T[]): Record<T, number> =>
  Object.fromEntries(values.map((value, index) => [value, index])) as Record<T, number>;

const STATE_ORDER: Record<WorkState, number> = indexOrder(WORK_STATES);
const CONFIDENCE_ORDER: Record<Confidence, number> = indexOrder(CONFIDENCES);

/** The calendar day of an ISO stamp, for comparing a detection to a run. */
const dayOf = (iso: string): string => iso.slice(0, 10);

/**
 * Order the groups, without changing which of them there are.
 *
 * Every comparator is a total order over the same array — sorting is never a
 * filter here, so switching one cannot make a case disappear. "What changed"
 * is the one worth spelling out: it puts the cases the last run detected first
 * and everything else after, still in date order. That is a sort, so the older
 * cases are further down rather than gone.
 */
export function sortRemediationGroups(
  groups: readonly RemediationGroup[],
  sort: IssueSort,
  lastRunAt?: string,
  direction: SortDirection = DEFAULT_SORT_DIRECTION[sort],
): RemediationGroup[] {
  // Applied to the PRIMARY key only. Everything after the first `||` is a
  // tie-break, and a tie-break that flipped with the header would reshuffle
  // rows the reader did not ask to reorder.
  const sign = direction === DEFAULT_SORT_DIRECTION[sort] ? 1 : -1;
  const lastRunDay = lastRunAt ? dayOf(lastRunAt) : undefined;
  const inLastRun = (group: RemediationGroup): number =>
    lastRunDay && group.detectedAt && dayOf(group.detectedAt) >= lastRunDay ? 0 : 1;

  const byNewest = (a: RemediationGroup, b: RemediationGroup) => b.detectedAt.localeCompare(a.detectedAt);

  /**
   * Rule 18, split out of `byWorstMeasured` so it can sit OUTSIDE the sign.
   *
   * Reversing "largest saving first" has to give "smallest MEASURED first", not
   * "no reading first". An absent measurement is not a small one, and a
   * direction toggle is not permission to rank it as zero — which is exactly
   * what negating the combined comparator would have done.
   */
  const measuredFirst = (a: RemediationGroup, b: RemediationGroup) =>
    Number(hasMeasuredImpact(b.impactMs)) - Number(hasMeasuredImpact(a.impactMs));
  const byImpactSize = (a: RemediationGroup, b: RemediationGroup) => b.impactMs - a.impactMs;
  // The id tie-break keeps the order stable when the sort key matches, so a
  // re-render never reshuffles equal rows.
  const byId = (a: RemediationGroup, b: RemediationGroup) => a.primary.id.localeCompare(b.primary.id);

  // Wherever impact is the ranking key, `byWorstMeasured` applies rule 18: the
  // unmeasured groups move to the end of the band as a block instead of being
  // ordered by a zero they never measured. Newest and What changed rank on a
  // date every case carries, so no measurement stands in for a missing one.
  const compare: Record<IssueSort, (a: RemediationGroup, b: RemediationGroup) => number> = {
    impact: (a, b) => measuredFirst(a, b) || sign * byImpactSize(a, b) || byNewest(a, b) || byId(a, b),
    newest: (a, b) => sign * byNewest(a, b) || byId(a, b),
    changed: (a, b) => sign * (inLastRun(a) - inLastRun(b)) || byNewest(a, b) || byId(a, b),
    state: (a, b) => sign * (STATE_ORDER[a.state] - STATE_ORDER[b.state]) || byWorstMeasured(a, b) || byId(a, b),
    // The text the row actually shows, so the order a reader sees is the order
    // they could have worked out from the screen.
    cause: (a, b) => sign * causeLineOf(a.primary).localeCompare(causeLineOf(b.primary)) || byId(a, b),
    // Broadest first: the count is the reason to look, and one fix covering six
    // pages is the case this sort exists to surface.
    pages: (a, b) => sign * (b.pageIds.length - a.pageIds.length) || byWorstMeasured(a, b) || byId(a, b),
    confidence: (a, b) =>
      sign * (CONFIDENCE_ORDER[a.confidence] - CONFIDENCE_ORDER[b.confidence]) || byWorstMeasured(a, b) || byId(a, b),
    // The effort tie-break keeps rule 18 inside each band in both directions:
    // reversing to "hardest first" must not float an unmeasured finding to the
    // top of its band.
    effort: (a, b) => sign * (EFFORT_ORDER[a.effort] - EFFORT_ORDER[b.effort]) || byWorstMeasured(a, b) || byId(a, b),
  };

  return [...groups].sort(compare[sort]);
}

