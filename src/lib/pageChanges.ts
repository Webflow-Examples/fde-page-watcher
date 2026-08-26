import type { IssueCase } from "./issue-case";
import { queueOf } from "./issue-case";
import { normalizePerformanceThresholds } from "./performanceThresholds";
import type { ScoreBand } from "./scoring";
import {
  historyForStrategy,
  pageHistoryForRange,
  pageRangeTrend,
  rangeComparison,
  scoreBand,
  statusMeta,
} from "./scoring";
import type { Night, PerformanceThresholds, RangeDays, Strategy, WatchPage } from "./types";
import type { Trend } from "./vocabulary";
import { COUNTED_QUEUES } from "./vocabulary";
import { isPageActivelyMonitored } from "./watchCapacity";

/**
 * What changed on the watchlist, as four groups.
 *
 * This is the derivation behind the Pages destination's Changes view. It is
 * pure and takes its reference time as an argument, so the grouping is a
 * function of stored state and can be read without rendering anything. It holds
 * ids, membership and counts; every word the screen says is in
 * `pages-copy.ts`.
 *
 * Three decisions are worth reading before editing:
 *
 * **It is a partition.** Every actively monitored page lands in exactly one
 * group. A page that quietly appeared in none of them would be a row a reader
 * cannot find, which is the failure "collapse behind a count, never behind a
 * gate" exists to prevent. Paused pages are the one exclusion, and they are
 * counted and named rather than dropped: nothing measures them, so no group
 * could say anything true about them.
 *
 * **No group claims a reading nobody took.** `no_change` is the group most at
 * risk of it — it is where an "everything else" bucket would put a page with no
 * verdict at all, which is exactly the claim R1's F3 removed from the Watcher.
 * A page without a trend verdict is not "unchanged"; it is new or still
 * waiting, and the `added` group is named for both. Rule 18, on this screen.
 *
 * **Direction is read over the longest window a page has evidence for.** The
 * group is "Regressing", not "Regressing in the last seven days". Reading it
 * over a seven-day selector let a thirty-day slide render as calm — the same
 * false all-clear as F3, made by asking a window that could not contain the
 * answer. There is no range control on this screen, and every row states the
 * window its figure came from so the claim can be checked.
 *
 * Both devices are always consulted: a drop on either one is a drop. The figure
 * a row shows names the device it came from, so it is always one run's reading
 * rather than a blend of two (rule 19).
 */

/* ── The groups ─────────────────────────────────────────────────────────── */

/**
 * The one statement of group order, in the screen's reading order: what got
 * worse, what is bad and stuck, what is new, then everything that held.
 *
 * The view renders by mapping this array, so the order on screen cannot be
 * stated anywhere else — reordering it reorders the screen, and nothing else
 * in `src/` lists these ids. That is what makes the order testable without a
 * DOM: it is data, not layout.
 */
export const PAGE_CHANGE_GROUPS = ["regressing", "poor_and_flat", "added", "no_change"] as const;
export type PageChangeGroup = (typeof PAGE_CHANGE_GROUPS)[number];

/**
 * How long a page counts as new, in days.
 *
 * Fixed. Arrival is a fact about a page rather than a reading over a window, so
 * it does not move with the evidence the other groups are read over.
 */
export const ARRIVAL_WINDOW_DAYS = 7;

/**
 * The window the trend and the delta are read over.
 *
 * The longest the app retains, so the answer is the longest one the page has
 * evidence for; each row reports the span its own readings actually covered.
 */
export const LONGEST_WINDOW_DAYS: RangeDays = 90;

/**
 * Which groups arrive open.
 *
 * Only the unchanged group folds, and it folds behind an exact count rather
 * than behind a gate: it is the one group a reader can safely not read today,
 * and the other three are the reason they came.
 */
export const PAGE_CHANGE_GROUP_STARTS_OPEN: Record<PageChangeGroup, boolean> = {
  regressing: true,
  poor_and_flat: true,
  added: true,
  no_change: false,
};

/* ── One row ────────────────────────────────────────────────────────────── */

export interface ScoreMovement {
  /** The device the figure was measured on. */
  device: Strategy;
  /** Signed points: newest median in the window minus oldest. */
  points: number;
  /** Days the readings behind it span, or null when they carry no usable dates. */
  days: number | null;
}

export interface PageChangeRow {
  pageId: string;
  /** The URL path, which is what names a page on this screen. */
  path: string;
  /** The page's own name, kept for the row's secondary line and for sorting. */
  title: string;
  url: string;
  /**
   * The worst band any device reported, or `null` when no device has a reading.
   * The worst observed reading, never an average of the two (rule 19).
   */
  band: ScoreBand | null;
  /** The score behind `band`, for the row's tooltip. `null` whenever `band` is. */
  score: number | null;
  /** The device `band` and `score` came from. `null` when nothing was read. */
  scoreDevice: Strategy | null;
  /** Direction over the window. `null` means no verdict has been reached yet. */
  trend: Trend | null;
  /** The worst movement any device measured. `null` when none did. */
  delta: ScoreMovement | null;
  /**
   * Days this page has been poor without a break, when two readings can measure
   * it. `null` otherwise — including for a page that is poor on its first night.
   */
  poorForDays: number | null;
  /** Cases a counted queue still holds for this page. */
  openCases: number;
  group: PageChangeGroup;
  /** Earliest evidence this page carries, when it carries any. */
  arrivedAt?: string;
}

export interface PageChangeGroupView {
  key: PageChangeGroup;
  /** Exact, always. The count is the whole point of a folded group. */
  count: number;
  rows: PageChangeRow[];
  startsOpen: boolean;
  /**
   * How many rows in this group improved. Read by the `no_change` heading,
   * whose label covers both, and 0 everywhere else.
   */
  improved: number;
}

export interface PageChangesView {
  /** Always four, always in `PAGE_CHANGE_GROUPS` order. */
  groups: PageChangeGroupView[];
  /** Every actively monitored page, once. */
  rows: PageChangeRow[];
  /** Pages with at least one reading. The rest are waiting for a first run. */
  measuredCount: number;
  /** Pages that moved either way. Not a sum of anything (rule 19). */
  movedCount: number;
  /** Pages nothing measures, counted so the screen can say what it left out. */
  pausedCount: number;
  /** True when no page is in any of the three open groups. */
  calm: boolean;
}

/* ── Readings ───────────────────────────────────────────────────────────── */

/**
 * Mobile first, so a device tie in "which reading is worst" reports mobile.
 * Both devices are always consulted; this only fixes the tie-break.
 */
const DEVICES: readonly Strategy[] = ["mobile", "desktop"];

const DAY_MS = 24 * 60 * 60 * 1000;

/** ISO stamps only. A display date like "Jul 16" is not a timestamp. */
function parsedISO(value: string | undefined): number | null {
  if (!value) return null;
  const at = Date.parse(value);
  return Number.isFinite(at) ? at : null;
}

/** One night's Performance median for one device, or null if it has none. */
function perfOf(night: Night | undefined, device: Strategy): number | null {
  const median = night?.scores?.[device]?.perf?.m;
  return typeof median === "number" && Number.isFinite(median) ? median : null;
}

/** Whole days from the first of these nights to the last. */
function spanDays(nights: readonly Night[]): number | null {
  const first = parsedISO(nights[0]?.iso);
  const last = parsedISO(nights.at(-1)?.iso);
  if (first === null || last === null) return null;
  const days = Math.round((last - first) / DAY_MS);
  return days >= 1 ? days : null;
}

/**
 * The earliest dated evidence a page carries.
 *
 * There is no stored "added on" field, and inventing one for this screen would
 * be a schema change to date a heading. The earliest reading is the honest
 * bound instead: a page cannot have been added after it was first measured. A
 * page with no dated evidence returns undefined and is handled as what it
 * actually is — a page still waiting for a first reading.
 */
export function pageArrivedAt(page: WatchPage): string | undefined {
  const candidates = [page.baselineCapturedAt, ...page.history.map((night) => night.iso)]
    .filter((value): value is string => parsedISO(value) !== null)
    .sort();
  return candidates[0];
}

/**
 * The path a page is known by, from its stored URL.
 *
 * Stored URLs are inconsistent about the scheme ("webflow.com/pricing" and
 * "https://webflow.com/pricing" both occur), so one is assumed when it is
 * missing. Anything that will not parse is shown as stored rather than
 * silently blanked.
 */
export function pathOf(url: string): string {
  const trimmed = url.trim();
  if (!trimmed) return "/";
  const absolute = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const parsed = new URL(absolute);
    const path = `${parsed.pathname.replace(/\/+$/, "")}${parsed.search}`;
    return path || "/";
  } catch {
    return trimmed;
  }
}

/**
 * A case is open while a counted queue holds it — Decide, Fix or Watch.
 *
 * Membership comes from `queueOf`, so "open" is the registry's answer rather
 * than a list of states written out here: a state the registry moves between
 * queues moves in this count with it. Pages a case excludes are not counted,
 * because an excluded page is one the case does not apply to (applicability),
 * and the case still shows its reading on the page itself.
 */
export function openCaseCountsByPage(cases: readonly IssueCase[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const item of cases) {
    if (!COUNTED_QUEUES.includes(queueOf(item.state))) continue;
    for (const pageId of item.pageIds) {
      if (item.excludedPages?.[pageId]) continue;
      counts[pageId] = (counts[pageId] ?? 0) + 1;
    }
  }
  return counts;
}

/* ── The derivation ─────────────────────────────────────────────────────── */

export interface PageChangesInput {
  pages: readonly WatchPage[];
  /** The project's cases, for the open count on each row. */
  cases?: readonly IssueCase[];
  /** Team thresholds; per-page overrides are applied on top, page by page. */
  performanceThresholds?: Partial<PerformanceThresholds>;
  /**
   * The reference "now", as an ISO stamp — normally the newest completed run.
   * Passing it keeps a render a pure function of stored state, the same reason
   * the issues list dates itself from the last run rather than the wall clock.
   */
  now?: string;
}

interface PageReadings {
  band: ScoreBand | null;
  score: number | null;
  scoreDevice: Strategy | null;
  trend: Trend | null;
  delta: ScoreMovement | null;
  poorForDays: number | null;
}

/**
 * How long the page's most recent unbroken run of poor nights has lasted.
 *
 * Measured between two readings or not stated at all: a page that is poor on
 * its only night has been poor for as long as anyone has looked, which is not a
 * duration. Each night is judged on its worst device, the same way the row's
 * band is, so the run and the chip cannot disagree.
 */
function poorRunDays(history: readonly Night[]): number | null {
  const run: Night[] = [];
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const night = history[index];
    const readings = DEVICES.map((device) => perfOf(night, device)).filter(
      (value): value is number => value !== null,
    );
    if (readings.length === 0 || scoreBand(Math.min(...readings)) !== "poor") break;
    run.unshift(night);
  }
  return run.length < 2 ? null : spanDays(run);
}

/**
 * Every reading a row needs, taken device by device and then reduced to the
 * worst of them.
 *
 * The trend is a precedence rather than a vote: a drop on one device outranks a
 * hold on the other, because the page did drop. `improving` only survives when
 * nothing regressed, and `no_change` only when nothing moved either way. A page
 * where no device has reached a verdict returns `null` — not `no_change`.
 */
function readingsFor(page: WatchPage, thresholds: PerformanceThresholds, now: number): PageReadings {
  const history = pageHistoryForRange(page, LONGEST_WINDOW_DAYS, now);
  let band: ScoreBand | null = null;
  let score: number | null = null;
  let scoreDevice: Strategy | null = null;
  let delta: ScoreMovement | null = null;
  const trends: (Trend | null)[] = [];

  for (const device of DEVICES) {
    const nights = historyForStrategy(history, device);

    const latest = perfOf(nights.at(-1), device);
    if (latest !== null && (score === null || latest < score)) {
      score = latest;
      band = scoreBand(latest);
      scoreDevice = device;
    }

    const comparison = rangeComparison(history, device, "perf");
    if (comparison && (delta === null || comparison.delta < delta.points)) {
      delta = { device, points: comparison.delta, days: spanDays(nights) };
    }

    const status = statusMeta(pageRangeTrend(page, device, LONGEST_WINDOW_DAYS, thresholds, now));
    trends.push(status.kind === "trend" ? status.trend : null);
  }

  const trend: Trend | null = trends.includes("regressing")
    ? "regressing"
    : trends.includes("improving")
      ? "improving"
      : trends.includes("no_change")
        ? "no_change"
        : null;

  return { band, score, scoreDevice, trend, delta, poorForDays: poorRunDays(history) };
}

/**
 * The group a page belongs to, from its readings alone.
 *
 * Precedence, top to bottom. Each test is a claim the readings support, so the
 * first one that holds is the truest thing the screen can say about the page.
 */
function groupFor(readings: PageReadings, arrivedRecently: boolean): PageChangeGroup {
  if (readings.trend === "regressing") return "regressing";
  if (readings.band === "poor" && readings.trend === "no_change") return "poor_and_flat";
  // No verdict yet belongs here rather than under "No change or better": a page
  // nobody has been able to read has not held steady, and saying it did is the
  // F3 failure in a different place. The group is named for both.
  if (arrivedRecently || readings.trend === null) return "added";
  return "no_change";
}

/** Biggest measured drop first; a page with no comparison sorts last (rule 18). */
function byWorstMovement(left: PageChangeRow, right: PageChangeRow): number {
  if (!left.delta || !right.delta) return left.delta ? -1 : right.delta ? 1 : 0;
  return left.delta.points - right.delta.points;
}

/** Worst health first; a page with no reading sorts last, for the same reason. */
function byWorstHealth(left: PageChangeRow, right: PageChangeRow): number {
  const rank: Record<ScoreBand, number> = { poor: 0, warn: 1, good: 2 };
  const leftRank = left.band ? rank[left.band] : 3;
  const rightRank = right.band ? rank[right.band] : 3;
  if (leftRank !== rightRank) return leftRank - rightRank;
  return (left.score ?? 101) - (right.score ?? 101);
}

/** Longest stuck first; an unmeasurable duration sorts last. */
function byLongestStuck(left: PageChangeRow, right: PageChangeRow): number {
  if (left.poorForDays === null || right.poorForDays === null) {
    return left.poorForDays === null ? (right.poorForDays === null ? 0 : 1) : -1;
  }
  return right.poorForDays - left.poorForDays;
}

/** Newest arrival first; an undated page sorts last. */
function byNewestArrival(left: PageChangeRow, right: PageChangeRow): number {
  if (!left.arrivedAt || !right.arrivedAt) return left.arrivedAt ? -1 : right.arrivedAt ? 1 : 0;
  return right.arrivedAt.localeCompare(left.arrivedAt);
}

/**
 * How each group orders its own rows.
 *
 * Every comparator answers the question its group is about, and none of them
 * starts from the path: a list sorted by URL puts `/about` above a page that
 * lost fourteen points, which is an alphabet reading as a priority. The title
 * only ever breaks a tie.
 */
const GROUP_ORDER: Record<PageChangeGroup, (left: PageChangeRow, right: PageChangeRow) => number> = {
  regressing: (left, right) => byWorstMovement(left, right) || byWorstHealth(left, right),
  poor_and_flat: (left, right) => byLongestStuck(left, right) || byWorstHealth(left, right),
  added: (left, right) => byNewestArrival(left, right) || byWorstHealth(left, right),
  no_change: (left, right) => byWorstHealth(left, right) || byWorstMovement(left, right),
};

export function buildPageChanges({
  pages,
  cases = [],
  performanceThresholds,
  now,
}: PageChangesInput): PageChangesView {
  const teamThresholds = normalizePerformanceThresholds(performanceThresholds);
  const reference = parsedISO(now) ?? Date.now();
  const openCases = openCaseCountsByPage(cases);
  const monitored = pages.filter(isPageActivelyMonitored);

  const rows: PageChangeRow[] = monitored.map((page) => {
    const thresholds = normalizePerformanceThresholds(teamThresholds);
    const readings = readingsFor(page, thresholds, reference);
    const arrivedAt = pageArrivedAt(page);
    const arrivedMs = parsedISO(arrivedAt);
    const arrivedRecently = arrivedMs !== null && reference - arrivedMs <= ARRIVAL_WINDOW_DAYS * DAY_MS;

    return {
      pageId: page.id,
      path: pathOf(page.url),
      title: page.title,
      url: page.url,
      ...readings,
      openCases: openCases[page.id] ?? 0,
      group: groupFor(readings, arrivedRecently),
      ...(arrivedAt ? { arrivedAt } : {}),
    };
  });

  const groups: PageChangeGroupView[] = PAGE_CHANGE_GROUPS.map((key) => {
    const held = rows
      .filter((row) => row.group === key)
      // The tie-break is the page's name, never its path.
      .sort((left, right) => GROUP_ORDER[key](left, right) || left.title.localeCompare(right.title));
    return {
      key,
      count: held.length,
      rows: held,
      startsOpen: PAGE_CHANGE_GROUP_STARTS_OPEN[key],
      improved: key === "no_change" ? held.filter((row) => row.trend === "improving").length : 0,
    };
  });

  return {
    groups,
    rows,
    measuredCount: rows.filter((row) => row.band !== null).length,
    movedCount: rows.filter((row) => row.trend === "improving" || row.trend === "regressing").length,
    pausedCount: pages.length - monitored.length,
    calm: groups.every((group) => group.key === "no_change" || group.count === 0),
  };
}
