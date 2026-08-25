import { NOT_MEASURED } from "./impact-format";
import { ARRIVAL_WINDOW_DAYS, type PageChangeGroup } from "./pageChanges";
import type { PagesView } from "./pagesView";
import { HEALTH_LABEL, TREND_LABEL } from "./vocabulary";

/**
 * The words the pages inventory says, in one place.
 *
 * Locked copy from the S6 brief. Every string a reader sees on this screen is
 * built here, so the header, a group heading and a row cannot describe the same
 * reading in three voices.
 *
 * Three of the strings are NOT written out here even though the brief lists
 * them, because the registry already owns the words inside them (rule 20):
 * "Regressing" is `TREND_LABEL.regressing`, "Poor and not moving" opens with
 * `HEALTH_LABEL.poor`, and "No change or better" extends `TREND_LABEL.no_change`
 * rather than inventing a fifth trend word. They are composed from the registry
 * and asserted against the brief's literals in `page-changes.test.ts`, so a
 * relabel in the registry moves this screen with it and a drift from the brief
 * fails.
 *
 * The absent-reading string is not written out either: S2's `impact-format.ts`
 * owns `NOT_MEASURED` for the whole app, and a second copy of it here is the
 * rule 20 defect. A test asserts this file contains no such literal.
 */

/* ── The two views ──────────────────────────────────────────────────────── */

export const PAGES_VIEW_LABEL: Record<PagesView, string> = {
  changes: "Changes",
  all: "All pages",
};

/**
 * The line under the title on Changes.
 *
 * "since last week" is deliberately absent: the groups are read over the
 * longest window each page has evidence for, so a claim about the last seven
 * days would be describing a different measurement than the one on the rows.
 *
 * `{n} pages` is written in the singular when there is one of them. The brief's
 * template is the sentence, not the grammar — shipping "1 pages measured today"
 * would be a defect the lock was never meant to protect.
 */
export function pagesSubtitle(measured: number, when: string, moved: number): string {
  return `${measured} ${measured === 1 ? "page" : "pages"} measured ${when}. ${moved} moved.`;
}

/** The other view keeps the line it had: what you do there, in one sentence. */
export const PAGES_ALL_PURPOSE =
  "Review current scores, trends, and agent readiness for every watched page.";

/* ── The four group headings ────────────────────────────────────────────── */

/**
 * A heading has to be true of everything under it, which is what decided two of
 * these four.
 *
 * "No change" was false over a group that also holds pages which improved, and
 * "Added this week" was false over a month-old page still waiting for its first
 * verdict. Both are renamed rather than split: four groups is the right number,
 * because an improvement needs no looking and this screen answers where to
 * look.
 */
export const PAGES_GROUP_LABEL: Record<PageChangeGroup, string> = {
  regressing: TREND_LABEL.regressing,
  poor_and_flat: `${HEALTH_LABEL.poor} and not moving`,
  added: "New or not yet measured",
  no_change: `${TREND_LABEL.no_change} or better`,
};

/**
 * A group heading with its count, and — for the one group whose label covers
 * two things — how many of them are the second thing.
 *
 * The count is the members', never a statistic over them: rule 19 forbids a
 * header that totals or averages what its rows say, and this one counts rows.
 */
export function pagesGroupHeading(
  group: PageChangeGroup,
  count: number,
  improved = 0,
): string {
  const heading = `${PAGES_GROUP_LABEL[group]} · ${count} ${count === 1 ? "page" : "pages"}`;
  return improved > 0 ? `${heading}, ${improved} of them improved` : heading;
}

/** The control on the one folded group. It shows; it never gates. */
export const PAGES_GROUP_SHOW = "Show";
export const PAGES_GROUP_HIDE = "Hide";

/**
 * What each group holds, in one line under the heading.
 *
 * The heading is the scannable thing and has to be true on its own; these say
 * how membership is decided, which is the part a heading cannot carry — in
 * particular that direction is read over the longest window a page has
 * evidence for rather than over a week.
 */
export const PAGES_GROUP_MEANS: Record<PageChangeGroup, string> = {
  regressing: "Performance dropped on at least one device, over the longest window with evidence.",
  poor_and_flat: "Poor health, and not moving on its own.",
  added: `Arrived in the last ${ARRIVAL_WINDOW_DAYS} days, or still waiting for a first verdict.`,
  no_change: "Held where they were, or better.",
};

/** What an empty group says. Empty is the good news in three of the four. */
export const PAGES_GROUP_EMPTY: Record<PageChangeGroup, string> = {
  regressing: "Nothing dropped.",
  poor_and_flat: "No page is sitting poor and still.",
  added: "No pages arrived, and every page has been measured.",
  no_change: "Every page moved.",
};

/** Said once, above the groups, when all three open groups are empty. */
export const PAGES_CALM = "Nothing dropped, nothing is sitting poor, and every page has been measured.";

/* ── A row ──────────────────────────────────────────────────────────────── */

/** A movement of exactly zero is a reading, and it says so in words. */
export const PAGES_DELTA_NONE = "No change";

/** One reading is not a movement. It is also not an absent measurement. */
export const PAGES_DELTA_FIRST = "First reading";

export interface DeltaCopy {
  /** The numeral, or the words that stand in for one. */
  value: string;
  /** Present only when `value` is a numeral. A figure never renders bare. */
  unit?: string;
}

/**
 * How a movement is written.
 *
 * Four readings, four sentences, and only one of them is a number:
 *
 *   a measured movement   "−14 pts over 30 days"
 *   a measured nothing    "No change"
 *   one reading so far    "First reading"
 *   no reading at all     NOT_MEASURED, S2's string (rule 18)
 *
 * The window rides with the figure because the group does: "Regressing" is
 * evaluated over the longest window a page has evidence for, so a row has to
 * say which window produced its number or the reader cannot check it.
 */
export function pagesDelta(
  movement: { points: number; days: number | null } | null,
  hasReading: boolean,
): DeltaCopy {
  if (!movement) return { value: hasReading ? PAGES_DELTA_FIRST : NOT_MEASURED };
  if (movement.points === 0) return { value: PAGES_DELTA_NONE };
  // U+2212, the minus sign, matching every other signed figure in the app.
  const sign = movement.points > 0 ? "+" : "\u2212";
  return {
    value: `${sign}${Math.abs(movement.points)}`,
    unit: movement.days === null ? "pts" : `pts over ${movement.days} days`,
  };
}

/** The same reading as one string, for an accessible name or a test. */
export function pagesDeltaLine(delta: DeltaCopy): string {
  return delta.unit ? `${delta.value} ${delta.unit}` : delta.value;
}

/**
 * How many cases a counted queue still holds for this page.
 *
 * "Open" is a quantity here, not a state — registry rule 9 bans the word as a
 * work-state label and this is a count over Decide, Fix and Watch.
 */
export function pagesCasesUnit(count: number): string {
  return `open ${count === 1 ? "case" : "cases"}`;
}

export const PAGES_CASES_ZERO = "No open cases";

/**
 * How long a page has been poor, for the group where that is the whole point.
 *
 * Whole days while a reader still counts in days, then whole weeks. It is only
 * ever said when there are two readings to measure it between: a duration
 * inferred from a single night would be a claim about a stretch nobody watched.
 */
export function pagesStuckDuration(days: number): string {
  const duration = days < 14
    ? `${days} ${days === 1 ? "day" : "days"}`
    : `${Math.floor(days / 7)} weeks`;
  return `${HEALTH_LABEL.poor} for ${duration}`;
}
