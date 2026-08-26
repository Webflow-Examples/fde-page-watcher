import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { NOT_MEASURED } from "../impact-format";
import type { IssueCase } from "../issue-case";
import {
  ARRIVAL_WINDOW_DAYS,
  buildPageChanges,
  openCaseCountsByPage,
  PAGE_CHANGE_GROUPS,
  PAGE_CHANGE_GROUP_STARTS_OPEN,
  pageArrivedAt,
  pathOf,
  type PageChangeGroup,
} from "../pageChanges";
import {
  PAGES_CASES_ZERO,
  PAGES_DELTA_FIRST,
  PAGES_DELTA_NONE,
  PAGES_GROUP_LABEL,
  PAGES_GROUP_MEANS,
  PAGES_GROUP_SHOW,
  PAGES_VIEW_LABEL,
  pagesCasesUnit,
  pagesDelta,
  pagesDeltaLine,
  pagesGroupHeading,
  pagesStuckDuration,
  pagesSubtitle,
} from "../pages-copy";
import { DEFAULT_PAGES_VIEW, PAGES_VIEWS, pagesViewPath, parsePagesView } from "../pagesView";
import { BAND_HEALTH } from "../scoring";
import type { CategoryScore, Night, NightScores, ScoreByCategory, StrategyScores, WatchPage } from "../types";
import { DESTINATION_PATH, HEALTHS, WORK_STATES, type WorkState } from "../vocabulary";

/**
 * The pages inventory's Changes view, checked against the decisions S6 states
 * rather than against the branches that implement them.
 *
 * There is no DOM here and this chunk does not add one. The property that
 * needed a renderer — group order — stops needing one once the group list is
 * data: the view maps `PAGE_CHANGE_GROUPS`, so asserting the array is asserting
 * the screen. Everything else here is either a pure derivation or a source
 * guard on a decision.
 *
 * The five that matter, and which test holds each:
 *
 *   - Group order is stated once, and reordering it fails  → "the group order"
 *   - A heading is true of everything under it             → "the headings"
 *   - Regressing is read over the longest window with
 *     evidence, not over a week                            → "a slide a week cannot see"
 *   - No group claims a reading nobody took                → "a page nobody measured"
 *   - The unchanged group's count is exact and complete    → "a quiet week"
 */

/* ── Fixtures ───────────────────────────────────────────────────────────── */

const DAY = 24 * 60 * 60 * 1000;
/** The reference "now" every case below is dated against: the last run. */
const RUN_AT = "2026-08-20T03:00:00.000Z";
const ago = (days: number) => new Date(Date.parse(RUN_AT) - days * DAY).toISOString();

const cat = (m: number): CategoryScore => ({ m, lo: m - 1, hi: m + 1 });
const ns = (s: ScoreByCategory): NightScores => ({ perf: cat(s.perf), a11y: cat(s.a11y), bp: cat(s.bp), seo: cat(s.seo) });
const strat = (s: ScoreByCategory): StrategyScores => ({ mobile: ns(s), desktop: ns(s) });
const scores = (perf: number): ScoreByCategory => ({ perf, a11y: 95, bp: 95, seo: 95 });

interface MeasuredOptions {
  /** How long ago the baseline was captured. Dates the page's arrival. */
  arrivedDaysAgo?: number;
  /** Days between nights. The default is a nightly run. */
  everyDays?: number;
}

/**
 * A page measured on both devices, one night per entry, newest last.
 *
 * `perfByNight` is the Performance median each night reported. Everything else
 * a trend needs — a captured baseline, ISO-dated nights — is the same for every
 * fixture, so the tests differ only in the readings and their spacing.
 */
function measured(id: string, perfByNight: number[], options: MeasuredOptions = {}): WatchPage {
  const everyDays = options.everyDays ?? 1;
  const lastIndex = perfByNight.length - 1;
  const daysAgoOf = (index: number) => (lastIndex - index) * everyDays;
  // Older than the arrival window unless a case says otherwise, so a fixture
  // about a trend is not also a fixture about a new page.
  const arrivedDaysAgo = options.arrivedDaysAgo ?? Math.max(30, daysAgoOf(0) + 1);
  const history: Night[] = perfByNight.map((perf, index) => ({
    i: index,
    date: `night ${index}`,
    iso: ago(daysAgoOf(index)),
    scores: strat(scores(perf)),
  }));
  return {
    id,
    title: id,
    url: `webflow.com/${id}`,
    flag: "watching",
    status: "stable",
    baseline: strat(scores(perfByNight[0])),
    baselineCapturedAt: ago(arrivedDaysAgo),
    current: { mobile: scores(perfByNight[lastIndex]), desktop: scores(perfByNight[lastIndex]) },
    history,
    markers: [],
    agent: [],
  };
}

/** Added, and nothing has been read yet. No baseline, no nights. */
function unmeasured(id: string, flag: WatchPage["flag"] = "watching"): WatchPage {
  return {
    id,
    title: id,
    url: `webflow.com/${id}`,
    flag,
    status: "pending",
    current: { mobile: scores(0), desktop: scores(0) },
    history: [],
    markers: [],
    agent: [],
  };
}

const view = (pages: WatchPage[], cases: IssueCase[] = []) =>
  buildPageChanges({ pages, cases, now: RUN_AT });

const rowFor = (pages: WatchPage[], id: string) => view(pages).rows.find((row) => row.pageId === id)!;

const groupOf = (pages: WatchPage[], id: string): PageChangeGroup | undefined =>
  view(pages).rows.find((row) => row.pageId === id)?.group;

const countIn = (pages: WatchPage[], key: PageChangeGroup) =>
  view(pages).groups.find((group) => group.key === key)!.count;

/**
 * The selector reads three fields off a case — state, pageIds and the
 * exclusions — so the fixture carries exactly those. Building a whole case
 * through `fromRec` would add fifty fields none of this depends on.
 */
const openCase = (state: WorkState, pageIds: string[], excludedPages?: Record<string, "Intentional">): IssueCase =>
  ({ state, pageIds, ...(excludedPages ? { excludedPages } : {}) } as unknown as IssueCase);

/** Every source file in `src/`, for the guards below. */
function sourceFiles(): string[] {
  const root = path.join(__dirname, "..", "..");
  const found: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(ts|tsx)$/.test(entry.name)) found.push(path.relative(root, full));
    }
  };
  walk(root);
  return found;
}

const sourceOf = (relative: string) => readFileSync(path.join(__dirname, "..", "..", relative), "utf8");

const CHANGES_VIEW = "app/(app)/pages/pages-changes.tsx";
const MATRIX_VIEW = "app/(app)/pages/pages-content.tsx";

/* ── The group order ────────────────────────────────────────────────────── */

describe("the group order", () => {
  it("is the screen's reading order: worst news first, the foldable one last", () => {
    expect([...PAGE_CHANGE_GROUPS]).toEqual(["regressing", "poor_and_flat", "added", "no_change"]);
  });

  it("is stated once in src/, and the view renders from it", () => {
    // `poor_and_flat` belongs to no other scheme in the app, so a second file
    // naming it would be a second statement of these groups. Two files may:
    // the derivation that owns them, and the copy that names them — a keyed
    // lookup is not an order. Nothing else, and no second ordered list.
    const allowed = new Set(["lib/pageChanges.ts", "lib/pages-copy.ts", `lib/__tests__/${path.basename(__filename)}`]);
    const offenders = sourceFiles().filter(
      (file) => !allowed.has(file.split(path.sep).join("/")) && sourceOf(file).includes("poor_and_flat"),
    );
    expect(offenders, "a second statement of the group scheme").toEqual([]);

    // The view names no group at all: it maps the array.
    const changes = sourceOf(CHANGES_VIEW);
    expect(changes).toContain("view.groups.map");
    for (const group of PAGE_CHANGE_GROUPS) {
      expect(changes, `${group} is hard-coded in the view`).not.toContain(`"${group}"`);
    }
  });

  it("always renders four groups, even with no pages at all", () => {
    const empty = view([]);
    expect(empty.groups.map((group) => group.key)).toEqual([...PAGE_CHANGE_GROUPS]);
    expect(empty.groups.every((group) => group.count === 0)).toBe(true);
  });

  it("folds the unchanged group and nothing else", () => {
    expect(PAGE_CHANGE_GROUP_STARTS_OPEN).toEqual({
      regressing: true,
      poor_and_flat: true,
      added: true,
      no_change: false,
    });
  });
});

/* ── The headings ───────────────────────────────────────────────────────── */

describe("the headings", () => {
  it("are the brief's, to the letter", () => {
    expect(PAGES_VIEW_LABEL.changes).toBe("Changes");
    expect(PAGES_VIEW_LABEL.all).toBe("All pages");
    expect(PAGES_GROUP_LABEL.regressing).toBe("Regressing");
    expect(PAGES_GROUP_LABEL.poor_and_flat).toBe("Poor and not moving");
    expect(PAGES_GROUP_LABEL.added).toBe("New or not yet measured");
    expect(PAGES_GROUP_LABEL.no_change).toBe("No change or better");
    expect(PAGES_GROUP_SHOW).toBe("Show");
  });

  it("counts pages under the folded one, and says how many improved", () => {
    expect(pagesGroupHeading("no_change", 12, 3)).toBe("No change or better · 12 pages, 3 of them improved");
    // Nothing improved: the clause would be a sentence about nothing.
    expect(pagesGroupHeading("no_change", 12, 0)).toBe("No change or better · 12 pages");
    expect(pagesGroupHeading("regressing", 1)).toBe("Regressing · 1 page");
  });

  it("is true of everything under it", () => {
    // The two headings this replaced were not. "No change" was false over a
    // group that also holds improved pages; "Added this week" was false over a
    // month-old page still waiting for a verdict.
    expect(PAGES_GROUP_LABEL.no_change).toContain("or better");
    expect(PAGES_GROUP_LABEL.added).toContain("not yet measured");
  });

  it("names the arrival window in the subline rather than in the heading", () => {
    // The heading no longer says "this week", so the window is stated where it
    // can be stated exactly.
    expect(PAGES_GROUP_MEANS.added).toContain(String(ARRIVAL_WINDOW_DAYS));
    expect(PAGES_GROUP_LABEL.added).not.toContain("week");
  });

  it("drops 'since last week' from the subtitle, which is no longer true", () => {
    expect(pagesSubtitle(7, "today", 2)).toBe("7 pages measured today. 2 moved.");
    expect(pagesSubtitle(1, "yesterday", 0)).toBe("1 page measured yesterday. 0 moved.");
    expect(pagesSubtitle(7, "today", 2)).not.toContain("last week");
  });
});

/* ── The longest window ─────────────────────────────────────────────────── */

describe("a slide a week cannot see", () => {
  /** Six nights over thirty days: flat, then a slide, then flat again lower. */
  const slide = measured("pricing", [92, 92, 90, 80, 62, 58], { everyDays: 6, arrivedDaysAgo: 40 });

  it("is regressing, read over the window that contains it", () => {
    // The defect this replaced: at seven days the same page read as calm while
    // the site degraded — F3's false all-clear, made by asking a window that
    // could not contain the answer.
    expect(groupOf([slide], "pricing")).toBe("regressing");
  });

  it("is what a seven-day window would have called no change", () => {
    // The same last week of readings, on their own: a two-point wobble.
    const lastWeekOnly = measured("pricing", [62, 58], { everyDays: 6, arrivedDaysAgo: 40 });
    expect(groupOf([lastWeekOnly], "pricing")).not.toBe("regressing");
  });

  it("says which window its figure came from", () => {
    const row = rowFor([slide], "pricing");
    expect(row.delta?.days).toBe(30);
    expect(pagesDeltaLine(pagesDelta(row.delta, true))).toBe("\u221230 pts over 30 days");
  });

  it("falls back to the bare unit when the readings carry no dates", () => {
    // Imported histories exist with no ISO stamps. A window it cannot measure
    // is one it does not name, rather than one it guesses.
    const undated = measured("legacy", [90, 90, 60, 58]);
    undated.history = undated.history.map((night) => ({ ...night, iso: undefined }));
    const row = rowFor([undated], "legacy");
    expect(row.delta?.days).toBeNull();
    expect(pagesDeltaLine(pagesDelta(row.delta, true))).toBe("\u221231 pts");
  });
});

/* ── Membership ─────────────────────────────────────────────────────────── */

describe("where a page lands", () => {
  const dropped = measured("pricing", [92, 90, 60, 58]);
  const poorAndFlat = measured("designer", [40, 41, 40, 41]);
  const improved = measured("hosting", [70, 72, 80, 82]);
  const held = measured("home", [95, 95, 96, 95]);
  const arrived = measured("localization", [88, 88], { arrivedDaysAgo: 2 });

  it("groups a page that dropped as regressing", () => {
    expect(groupOf([dropped], "pricing")).toBe("regressing");
  });

  it("groups a poor page that is not moving on its own", () => {
    const row = rowFor([poorAndFlat], "designer");
    expect(row.group).toBe("poor_and_flat");
    // The row agrees with the heading: the band is what the chip paints.
    expect(row.band).toBe("poor");
    expect(row.trend).toBe("no_change");
  });

  it("keeps a page that dropped out of the poor group even when it is poor", () => {
    // Precedence, not overlap: a live drop is the more urgent claim, and a page
    // in two groups is a page counted twice.
    expect(groupOf([measured("templates", [60, 58, 30, 28])], "templates")).toBe("regressing");
  });

  it("groups a page that arrived inside the window as new", () => {
    expect(groupOf([arrived], "localization")).toBe("added");
  });

  it("does not call a page new once the window has passed", () => {
    const older = measured("about", [88, 88], { arrivedDaysAgo: ARRIVAL_WINDOW_DAYS + 1 });
    expect(groupOf([older], "about")).toBe("no_change");
  });

  it("puts an improved page in the group whose heading covers it", () => {
    const built = view([improved, held]);
    const unchanged = built.groups.find((group) => group.key === "no_change")!;
    expect(unchanged.count).toBe(2);
    expect(unchanged.improved).toBe(1);
    expect(built.rows.find((row) => row.pageId === "hosting")!.trend).toBe("improving");
  });

  it("is a partition: every watched page is in exactly one group", () => {
    const pages = [dropped, poorAndFlat, improved, held, arrived, unmeasured("careers")];
    const built = view(pages);
    const grouped = built.groups.flatMap((group) => group.rows.map((row) => row.pageId));
    expect(grouped.sort()).toEqual(pages.map((page) => page.id).sort());
    expect(built.groups.reduce((total, group) => total + group.count, 0)).toBe(pages.length);
  });

  it("counts paused pages out loud instead of dropping them", () => {
    // Nothing measures a paused page, so no group could say anything true about
    // it. The screen says how many it left out and where they are.
    const built = view([held, unmeasured("archive", "paused")]);
    expect(built.rows).toHaveLength(1);
    expect(built.pausedCount).toBe(1);
  });

  it("counts what the subtitle claims", () => {
    const built = view([dropped, improved, held, unmeasured("careers")]);
    expect(built.measuredCount).toBe(3);
    // Moved is a count of pages that moved, either way — never a sum of their
    // deltas (rule 19).
    expect(built.movedCount).toBe(2);
  });
});

/* ── Rule 18 on this screen ─────────────────────────────────────────────── */

describe("a page nobody measured", () => {
  it("is never reported as unchanged", () => {
    // The F3 failure, in a new place: an "everything else" bucket would call a
    // page with no verdict stable. A page waiting for a reading has not held.
    const waiting = unmeasured("localization");
    expect(groupOf([waiting], "localization")).toBe("added");
    expect(countIn([waiting], "no_change")).toBe(0);
  });

  it("is still not reported as unchanged when it has been waiting for months", () => {
    // One night post-baseline is below the grace runs, so there is no verdict —
    // and the page arrived long before the window, so the group is carrying it
    // on the no-verdict half of its name rather than on its date.
    const stuck = measured("legacy", [80], { arrivedDaysAgo: 90 });
    expect(rowFor([stuck], "legacy").trend).toBeNull();
    expect(groupOf([stuck], "legacy")).toBe("added");
  });

  it("shows no band and no delta rather than a zero", () => {
    const row = rowFor([unmeasured("localization")], "localization");
    expect(row.band).toBeNull();
    expect(row.delta).toBeNull();
    expect(row.score).toBeNull();
  });

  it("says so in S2's words, not in a second copy of them", () => {
    const delta = pagesDelta(null, false);
    expect(delta.value).toBe(NOT_MEASURED);
    expect(delta.unit).toBeUndefined();
    expect(delta.value).not.toContain("0");
    // One string, one owner. A copy here would drift the day S2 rewords it.
    expect(sourceOf("lib/pages-copy.ts")).not.toContain('"Not measured"');
  });

  it("tells one reading apart from none at all", () => {
    // A page measured once has a reading and no movement. Calling that "Not
    // measured" would be as wrong as calling it zero.
    expect(pagesDelta(null, true).value).toBe(PAGES_DELTA_FIRST);
    expect(pagesDelta(null, false).value).toBe(NOT_MEASURED);
  });
});

/* ── Units ──────────────────────────────────────────────────────────────── */

describe("a movement always carries its unit", () => {
  it("writes the brief's figure", () => {
    expect(pagesDeltaLine(pagesDelta({ points: -14, days: null }, true))).toBe("\u221214 pts");
    expect(pagesDeltaLine(pagesDelta({ points: 6, days: 30 }, true))).toBe("+6 pts over 30 days");
  });

  it("uses the minus sign, not a hyphen", () => {
    expect(pagesDelta({ points: -14, days: null }, true).value).toBe("\u221214");
  });

  it("says a measured nothing in words", () => {
    // Zero is a reading. It is also not a movement, and "0 pts" reads as one.
    expect(pagesDelta({ points: 0, days: 30 }, true)).toEqual({ value: PAGES_DELTA_NONE });
  });

  it("never returns a bare number", () => {
    for (const movement of [{ points: -14, days: 7 }, { points: 1, days: null }, { points: 0, days: 3 }]) {
      const delta = pagesDelta(movement, true);
      // Either a numeral with its unit, or words. Never a numeral alone.
      expect(delta.unit !== undefined || Number.isNaN(Number(delta.value))).toBe(true);
    }
  });

  it("counts open cases in cases", () => {
    expect(pagesCasesUnit(3)).toBe("open cases");
    expect(pagesCasesUnit(1)).toBe("open case");
    expect(PAGES_CASES_ZERO).toBe("No open cases");
  });
});

/* ── Readings ───────────────────────────────────────────────────────────── */

describe("the readings on a row", () => {
  it("reports the worse device, and names it", () => {
    // Rule 19: the worst observed reading, never an average of the two. A blend
    // is a figure no run produced.
    const page = measured("pricing", [90, 90, 90, 90]);
    page.history = page.history.map((night, index) => ({
      ...night,
      scores: { mobile: ns(scores(index === 3 ? 40 : 90)), desktop: ns(scores(90)) },
    }));
    const row = rowFor([page], "pricing");
    expect(row.score).toBe(40);
    expect(row.band).toBe("poor");
    expect(row.scoreDevice).toBe("mobile");
    expect(row.delta?.device).toBe("mobile");
  });

  it("calls a page regressing when either device dropped", () => {
    // Page Watch exists to catch a drop; one that only happened on mobile is
    // still one.
    const page = measured("pricing", [92, 90, 90, 90]);
    page.history = page.history.map((night, index) => ({
      ...night,
      scores: { mobile: ns(scores(index >= 2 ? 55 : 92)), desktop: ns(scores(92)) },
    }));
    expect(groupOf([page], "pricing")).toBe("regressing");
  });

  it("reads a page's arrival from its earliest evidence", () => {
    // There is no stored "added on" field. The earliest reading is the honest
    // bound: a page cannot have been added after it was first measured.
    const page = measured("pricing", [90, 90], { arrivedDaysAgo: 12 });
    expect(pageArrivedAt(page)).toBe(ago(12));
    expect(pageArrivedAt(unmeasured("localization"))).toBeUndefined();
  });
});

/* ── How long it has been poor ──────────────────────────────────────────── */

describe("a page that has been poor a while", () => {
  it("measures the run between two readings", () => {
    const stuck = measured("designer", [40, 41, 40, 41], { everyDays: 7, arrivedDaysAgo: 40 });
    expect(rowFor([stuck], "designer").poorForDays).toBe(21);
  });

  it("counts only the unbroken run, not the whole history", () => {
    // It was fine, then it was not. The duration is how long it has been poor,
    // which is the question the group asks.
    const recentlyPoor = measured("designer", [80, 80, 40, 41], { everyDays: 7, arrivedDaysAgo: 40 });
    expect(rowFor([recentlyPoor], "designer").poorForDays).toBe(7);
  });

  it("says nothing when a single night is all there is to say it from", () => {
    // A page poor on its only night has been poor for as long as anyone has
    // looked, which is not a duration.
    const once = measured("designer", [80, 80, 80, 40], { everyDays: 7, arrivedDaysAgo: 40 });
    expect(rowFor([once], "designer").poorForDays).toBeNull();
  });

  it("says it in days, then in weeks", () => {
    expect(pagesStuckDuration(1)).toBe("Poor for 1 day");
    expect(pagesStuckDuration(13)).toBe("Poor for 13 days");
    expect(pagesStuckDuration(21)).toBe("Poor for 3 weeks");
  });
});

/* ── Order ──────────────────────────────────────────────────────────────── */

describe("reading order", () => {
  it("never orders a group by path", () => {
    // A list sorted by URL puts /about above a page that lost thirty points,
    // which is an alphabet reading as a priority.
    const small = measured("about", [90, 90, 74, 74]);
    const large = measured("zebra", [90, 90, 55, 55]);
    const regressing = view([small, large]).groups.find((group) => group.key === "regressing")!;
    expect(regressing.rows.map((row) => row.pageId)).toEqual(["zebra", "about"]);
  });

  it("puts the longest-stuck page first among the stuck", () => {
    const longer = measured("designer", [40, 41, 40, 41], { everyDays: 7, arrivedDaysAgo: 40 });
    const shorter = measured("blog", [40, 41], { everyDays: 7, arrivedDaysAgo: 40 });
    const stuck = view([shorter, longer]).groups.find((group) => group.key === "poor_and_flat")!;
    expect(stuck.rows.map((row) => row.pageId)).toEqual(["designer", "blog"]);
  });

  it("puts the worst health first in the unchanged group", () => {
    const good = measured("home", [95, 95, 96, 95]);
    const weaker = measured("blog", [70, 70, 71, 70]);
    const unchanged = view([good, weaker]).groups.find((group) => group.key === "no_change")!;
    expect(unchanged.rows.map((row) => row.pageId)).toEqual(["blog", "home"]);
  });

  it("sorts a page with no reading last inside its group", () => {
    // Rule 18: an absent measurement is not a small one, so it does not rank
    // as a zero — it goes to the end of the band.
    const added = view([unmeasured("careers"), measured("localization", [88, 88], { arrivedDaysAgo: 2 })])
      .groups.find((group) => group.key === "added")!;
    expect(added.rows.map((row) => row.pageId)).toEqual(["localization", "careers"]);
  });
});

/* ── A quiet week ───────────────────────────────────────────────────────── */

describe("a quiet week", () => {
  const pages = [
    measured("home", [95, 95, 96, 95]),
    measured("pricing", [88, 88, 89, 88]),
    measured("blog", [70, 70, 71, 70]),
  ];

  it("shows four groups, three of them empty", () => {
    const built = view(pages);
    expect(built.groups).toHaveLength(4);
    expect(built.groups.filter((group) => group.count === 0).map((group) => group.key))
      .toEqual(["regressing", "poor_and_flat", "added"]);
    expect(built.calm).toBe(true);
  });

  it("holds every page in the unchanged group, with an exact count", () => {
    // Folded, never gated: the count is the whole set, so a reader can see the
    // size of what they are not looking at.
    const unchanged = view(pages).groups.find((group) => group.key === "no_change")!;
    expect(unchanged.count).toBe(pages.length);
    expect(unchanged.rows).toHaveLength(pages.length);
  });

  it("is not calm once anything is in an open group", () => {
    expect(view([...pages, measured("templates", [90, 90, 60, 58])]).calm).toBe(false);
  });
});

/* ── Open cases ─────────────────────────────────────────────────────────── */

describe("the open case count", () => {
  it("counts the cases a counted queue holds, and no others", () => {
    // "Open" here is Decide, Fix or Watch, read from the registry rather than
    // listed out — a state the registry moves between queues moves with it.
    const cases = WORK_STATES.map((state) => openCase(state, ["home"]));
    // Resolved and dismissed are the two the counted queues do not hold.
    expect(openCaseCountsByPage(cases).home).toBe(WORK_STATES.length - 2);
  });

  it("does not count a page the case excludes", () => {
    // Applicability, not lifecycle: the case is open, and it does not apply to
    // this page. The page keeps its reading on its own screen.
    const counts = openCaseCountsByPage([openCase("new", ["home", "pricing"], { home: "Intentional" })]);
    expect(counts.home).toBeUndefined();
    expect(counts.pricing).toBe(1);
  });

  it("reaches the row", () => {
    const built = view([measured("home", [95, 95, 96, 95])], [openCase("todo", ["home"]), openCase("resolved", ["home"])]);
    expect(built.rows[0].openCases).toBe(1);
  });
});

/* ── What the screen refuses to be ──────────────────────────────────────── */

describe("the Changes view", () => {
  const changes = sourceOf(CHANGES_VIEW);

  it("carries no watch control, no alert threshold, and no range selector", () => {
    // Pages is not the Watchlist, thresholds are S8's, and a range control on a
    // screen whose readings ignore it would be a control that lies.
    for (const control of [
      "updatePerformanceThresholds",
      "updatePagePerformanceThresholds",
      "updateAlertWebhookUrl",
      "performanceThresholdOverrides",
      "setFlag",
      "reorderPages",
      "removePage",
      "runPage",
      "captureBaseline",
      "rangeDays",
      "setRangeDays",
    ]) {
      expect(changes, `${control} does not belong on this screen`).not.toContain(control);
    }
  });

  it("links a row to the page instead of listing the page's issues", () => {
    expect(changes).toContain("DESTINATION_PATH.pages");
    for (const inlined of [".diagnosis", ".remediation", ".evidence", "aiSummary", "issue-row", "case-detail"]) {
      expect(changes, `${inlined} belongs on the page or the case`).not.toContain(inlined);
    }
  });

  it("renders no magnitude without a unit", () => {
    // The mechanical form of "no score renders without a unit": every figure on
    // this screen goes through <Magnitude>, and every one of them names what it
    // is counting.
    const magnitudes = [...changes.matchAll(/<Magnitude\s[^>]*>/g)].map((match) => match[0]);
    expect(magnitudes.length).toBeGreaterThan(0);
    for (const magnitude of magnitudes) {
      expect(magnitude, "a magnitude with no unit").toContain("unit=");
    }
  });

  it("authors no copy of its own", () => {
    // Every word comes from `pages-copy.ts`, which is where the brief's locked
    // strings are held and asserted.
    expect(changes).toContain("@/lib/pages-copy");
  });
});

/* ── The two views ──────────────────────────────────────────────────────── */

describe("the pages destination's two views", () => {
  it("opens on Changes", () => {
    expect(DEFAULT_PAGES_VIEW).toBe("changes");
    expect(parsePagesView(undefined)).toBe("changes");
    expect(parsePagesView("nonsense")).toBe("changes");
    // Including from the address people already have.
    expect(pagesViewPath("changes")).toBe(DESTINATION_PATH.pages);
  });

  it("has exactly two, and the matrix is one of them", () => {
    expect([...PAGES_VIEWS]).toEqual(["changes", "all"]);
    expect(parsePagesView("all")).toBe("all");
  });

  it("keeps the matrix filter on the matrix", () => {
    // A filter is a control on that table. Carrying it onto Changes would put a
    // filter in the URL of a screen that has none; dropping it on the way back
    // would silently reset the reader's table.
    expect(pagesViewPath("all", "regressions")).toBe(`${DESTINATION_PATH.pages}?view=all&filter=regressions`);
    expect(pagesViewPath("changes", "regressions")).toBe(DESTINATION_PATH.pages);
    expect(pagesViewPath("all", "all")).toBe(`${DESTINATION_PATH.pages}?view=all`);
  });
});

describe("the All pages view", () => {
  const matrix = sourceOf(MATRIX_VIEW);

  it("keeps every filter and control the table had", () => {
    // S6 adds a view; it does not reduce this one. Each of these is a control a
    // reader can already be relying on.
    for (const filter of ["lowPerformance", "agentGaps", "regressions", "improvements"]) {
      expect(matrix, `${filter} is a filter the table had`).toContain(filter);
    }
    for (const control of [
      "StatusSegmentedControl",
      "DeviceSegmentedControl",
      "RANGE_OPTIONS",
      "SortHeader",
      "selectDeviceFilter",
      "dashboard-filter-summary",
    ]) {
      expect(matrix, `${control} is part of the table`).toContain(control);
    }
  });
});

/* ── Paths ──────────────────────────────────────────────────────────────── */

describe("the path a page is known by", () => {
  it("reads a path whether or not the stored URL has a scheme", () => {
    expect(pathOf("webflow.com/pricing")).toBe("/pricing");
    expect(pathOf("https://webflow.com/pricing")).toBe("/pricing");
  });

  it("calls the root page the root", () => {
    expect(pathOf("webflow.com")).toBe("/");
    expect(pathOf("https://webflow.com/")).toBe("/");
  });

  it("keeps a query, which is part of which page this is", () => {
    expect(pathOf("webflow.com/search?q=cms")).toBe("/search?q=cms");
  });

  it("shows an unparseable URL as stored rather than blanking it", () => {
    expect(pathOf("not a url")).toBe("not a url");
  });
});

/* ── Health bands and the registry's words ──────────────────────────────── */

describe("a band and its word", () => {
  it("gives every band a health term of its own", () => {
    const words = Object.values(BAND_HEALTH);
    expect(words.every((word) => HEALTHS.includes(word))).toBe(true);
    expect(new Set(words).size).toBe(words.length);
  });
});
