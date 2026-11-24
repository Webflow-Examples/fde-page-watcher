import { causeLineOf } from "./case-copy";
import {
  byWorstMeasured,
  casesInQueue,
  hasAnyImpact,
  remediationKey,
  type Effort,
  type IssueCase,
  type RemediationGroup,
} from "./issue-case";
import { CONFIDENCES, COUNTED_QUEUES, type Confidence, type Queue } from "./vocabulary";

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
 * Deliberately partial. `settled` is the terminal view rather than a queue,
 * and `show_all` remains the internal unfiltered view; neither is counted,
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
  "date",
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
  date: "Date",
  cause: "Cause",
  pages: "Pages",
  confidence: "Confidence",
  effort: "Effort",
};

export function parseIssueSort(value: string | null | undefined): IssueSort {
  // Old links keep working: the three retired sort keys map to the column that
  // now carries their meaning.
  if (value === "newest" || value === "changed") return "date";
  if (value === "state") return "cause";
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
  date: "desc",
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
const EFFORT_ORDER: Record<Effort, number> = { minutes: 0, hours: 1, days: 2, unknown: 3 };/**
 * Confidence ranks in the registry's own declared order, derived from its
 * array rather than restated here.
 *
 * The array is already ordered the way a reader wants to read it, from
 * `confirmed` down to `unclear`, so indexing it IS the comparator. Copying the
 * numbers out would be a rule stated twice. A value added to the registry lands
 * in the right position here without this file being touched.
 */
const indexOrder = <T extends string>(values: readonly T[]): Record<T, number> =>
  Object.fromEntries(values.map((value, index) => [value, index])) as Record<T, number>;

const CONFIDENCE_ORDER: Record<Confidence, number> = indexOrder(CONFIDENCES);

/**
 * Order the groups, without changing which of them there are.
 *
 * Every comparator is a total order over the same array — sorting is never a
 * filter here, so switching one cannot make a case disappear. Date is the
 * detected date; "what changed" is a marker in that column, not a direction
 * hidden behind a third sort.
 */
export function sortRemediationGroups(
  groups: readonly RemediationGroup[],
  sort: IssueSort,
  direction: SortDirection = DEFAULT_SORT_DIRECTION[sort],
): RemediationGroup[] {
  // Applied to the PRIMARY key only. Everything after the first `||` is a
  // tie-break, and a tie-break that flipped with the header would reshuffle
  // rows the reader did not ask to reorder.
  const sign = direction === DEFAULT_SORT_DIRECTION[sort] ? 1 : -1;

  const byDate = (a: RemediationGroup, b: RemediationGroup) => b.detectedAt.localeCompare(a.detectedAt);

  /**
   * Rule 18, split out of `byWorstMeasured` so it can sit OUTSIDE the sign.
   *
   * Reversing "largest saving first" has to give "smallest MEASURED first", not
   * "no reading first". An absent measurement is not a small one, and a
   * direction toggle is not permission to rank it as zero — which is exactly
   * what negating the combined comparator would have done. "Measured" means
   * measured in either unit: a byte-only finding has a reading.
   */
  const measuredFirst = (a: RemediationGroup, b: RemediationGroup) =>
    Number(hasAnyImpact(b)) - Number(hasAnyImpact(a));
  // Time first, then bytes — the same order `impactReading` displays them in,
  // so the list is ordered by the number the reader can see on each row.
  const byImpactSize = (a: RemediationGroup, b: RemediationGroup) =>
    b.impactMs - a.impactMs || (b.impactBytes ?? 0) - (a.impactBytes ?? 0);
  // The id tie-break keeps the order stable when the sort key matches, so a
  // re-render never reshuffles equal rows.
  const byId = (a: RemediationGroup, b: RemediationGroup) => a.primary.id.localeCompare(b.primary.id);

  // Wherever impact is the ranking key, `byWorstMeasured` applies rule 18: the
  // unmeasured groups move to the end of the band as a block instead of being
  // ordered by a zero they never measured. Date ranks on a value every case
  // carries, so no measurement stands in for a missing one.
  const compare: Record<IssueSort, (a: RemediationGroup, b: RemediationGroup) => number> = {
    impact: (a, b) => measuredFirst(a, b) || sign * byImpactSize(a, b) || byDate(a, b) || byId(a, b),
    date: (a, b) => sign * byDate(a, b) || byId(a, b),
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


/* ── Start Here's ranking ───────────────────────────────────────────────── */

/**
 * The order Start Here reads cases in, and the reason the table's sort is a
 * different thing.
 *
 * The table is sorted however the reader asks; this is the answer to "what
 * should I look at first", so it is not a preference. Three keys, in the order
 * of what they say about a case:
 *
 *   1. Evidence origin. A reading real visitors produced outranks a simulated
 *      estimate whatever the numbers are, because the first is what happened and
 *      the second is what a test predicted. This is what stops a simulated 12 s
 *      aggregate from heading the block above a field-confirmed finding.
 *   2. Measured impact, largest first — within a band, in the unit the case
 *      displays. Absent measurements sort last (rule 18).
 *   3. Oldest first seen. A long-standing case that nobody has decided is a gap
 *      in triage, and the oldest is the one that has been ignored longest.
 *
 * A total order: the id breaks exact ties, so two runs over the same data read
 * identically.
 */
export function caseRank(a: IssueCase, b: IssueCase): number {
  const originRank = (item: IssueCase) => item.impactOrigin === "observed" ? 0 : 1;
  return originRank(a) - originRank(b)
    || byWorstMeasured(a, b)
    || (a.detectedAt || "").localeCompare(b.detectedAt || "")
    || a.id.localeCompare(b.id);
}

/** How many decisions the block asks for. Three is a first session, not a list. */
export const START_HERE_LIMIT = 3;

/**
 * The three cases Decide leads with.
 *
 * A fresh project's Decide queue is a wall of sixteen equal rows, and a
 * first-time reader needs a place to start rather than a sort to choose. These
 * are chosen, not filtered: the table below still holds every case, and a case
 * that is not in the block is one row in it either the same as before.
 *
 * Two rules the block keeps:
 *
 *   - A case the customer cannot act on is not a place to start. A
 *     platform-owned case is Webflow's work, not the reader's, and Start Here is
 *     a list of decisions.
 *   - One case per remediation. Two cases a single fix covers would ask for the
 *     same decision twice; the table still shows both.
 *
 * Fewer than three cases in Decide yields fewer than three items — the block is
 * a view of what is there, never a promise of three.
 */
export function startHereCases(cases: readonly IssueCase[], limit = START_HERE_LIMIT): IssueCase[] {
  const seen = new Set<string>();
  const chosen: IssueCase[] = [];
  const candidates = casesInQueue(cases, "decide")
    .filter((issue) => issue.remediation.actionability !== "platform")
    .sort(caseRank);
  for (const issue of candidates) {
    const key = remediationKey(issue);
    if (seen.has(key)) continue;
    seen.add(key);
    chosen.push(issue);
    if (chosen.length >= limit) break;
  }
  return chosen;
}
