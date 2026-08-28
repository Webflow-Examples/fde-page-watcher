import { describe, expect, it } from "vitest";
import {
  DEFAULT_ISSUE_SORT,
  DEFAULT_SORT_DIRECTION,
  ISSUE_SORTS,
  issueCasesFrom,
  lastRunAtOf,
  parseIssueSort,
  parseSortDirection,
  partitionByImpact,
  queueCountsOf,
  sortRemediationGroups,
} from "@/components/store";
import { casesInQueue, groupByRemediation, hasMeasuredImpact, type IssueCase } from "../issue-case";
import { formatGroupImpact, formatImpact } from "@/components/issue-row";
import { COUNTED_QUEUES, QUEUES } from "../vocabulary";
import type { Rec, ScoreByCategory, WatchPage } from "../types";

/**
 * The issues list's shaping rules, tested without rendering it.
 *
 * Three properties matter more than any individual case here, because each one
 * is a way the screen could quietly lose a finding:
 *
 *   - the queue counts and the rows read the same selector;
 *   - the fold is a partition, so nothing is in both halves or neither;
 *   - every sort is a permutation, so switching one cannot hide anything.
 */

const ZERO: ScoreByCategory = { perf: 0, a11y: 0, bp: 0, seo: 0 };

function makePage(overrides: Partial<WatchPage> = {}): WatchPage {
  return {
    id: "home",
    title: "Home",
    url: "example.com",
    flag: "watching",
    status: "stable",
    current: { mobile: ZERO, desktop: ZERO },
    history: [],
    markers: [],
    agent: [],
    lastRunAt: "2026-08-24T06:00:00.000Z",
    ...overrides,
  };
}

function makeRec(overrides: Partial<Rec> = {}): Rec {
  return {
    key: "home:unused-javascript",
    pageId: "home",
    pageTitle: "Home",
    url: "example.com",
    id: "unused-javascript",
    source: "lighthouse",
    title: "Reduce unused JavaScript",
    category: "Performance",
    savings: "1.8 s",
    estTime: "2 days",
    status: "inbox",
    taskStatus: "todo",
    added: "2026-08-22",
    doneDate: null,
    ...overrides,
  };
}

function makeCase(overrides: Partial<IssueCase> = {}): IssueCase {
  return {
    id: "home:a",
    cause: "a",
    state: "new",
    title: "A",
    diagnosis: "A slows the page down.",
    detectedAt: "2026-08-20T00:00:00.000Z",
    confirmedRuns: 2,
    scope: "page",
    pageIds: ["home"],
    strategies: ["mobile"],
    impactMs: 900,
    effort: "hours",
    confidence: "confirmed",
    remediation: { steps: [], actionability: "direct" },
    successCriteria: "",
    checkpoints: [],
    evidence: [],
    history: [],
    ...overrides,
  };
}

/* ── The case list is a pure function of stored state ───────────────────── */

describe("issueCasesFrom", () => {
  it("reads the newest completed run as its reference, not the wall clock", () => {
    const pages = [
      makePage({ id: "home", lastRunAt: "2026-08-24T06:00:00.000Z" }),
      makePage({ id: "pricing", lastRunAt: "2026-08-25T06:00:00.000Z" }),
      makePage({ id: "docs", lastRunAt: undefined }),
    ];
    expect(lastRunAtOf(pages)).toBe("2026-08-25T06:00:00.000Z");
    expect(lastRunAtOf([makePage({ lastRunAt: undefined })])).toBeUndefined();
  });

  it("produces the same cases twice over the same state", () => {
    // A `new Date()` anywhere in the derivation would make the server render and
    // the client render disagree.
    const state = { recs: [makeRec(), makeRec({ key: "pricing:x", pageId: "pricing", id: "x" })], pages: [makePage()] };
    expect(issueCasesFrom(state)).toEqual(issueCasesFrom(state));
  });

  it("collapses one problem seen on two pages into one case", () => {
    const cases = issueCasesFrom({
      recs: [makeRec(), makeRec({ key: "pricing:unused-javascript", pageId: "pricing", pageTitle: "Pricing" })],
      pages: [makePage(), makePage({ id: "pricing", title: "Pricing" })],
    });
    expect(cases).toHaveLength(1);
    expect(cases[0].pageIds).toEqual(["home", "pricing"]);
  });
});

/* ── AC1, AC2 — one source for every count ──────────────────────────────── */

describe("queueCountsOf", () => {
  const cases = [
    makeCase({ id: "1", cause: "1", state: "new" }),
    makeCase({ id: "2", cause: "2", state: "reopened" }),
    makeCase({ id: "3", cause: "3", state: "todo" }),
    makeCase({ id: "4", cause: "4", state: "fixed" }),
    makeCase({ id: "5", cause: "5", state: "resolved" }),
    makeCase({ id: "6", cause: "6", state: "dismissed" }),
  ];

  it("counts every counted queue and nothing else", () => {
    const counts = queueCountsOf(cases);
    expect(Object.keys(counts).sort()).toEqual([...COUNTED_QUEUES].sort());
    expect(counts).toEqual({ decide: 2, fix: 1, watch: 1 });
  });

  it("never produces a count for Show all", () => {
    // Not "hides the badge" — there is no number to render, so a badge cannot
    // appear on it by mistake.
    expect(queueCountsOf(cases).show_all).toBeUndefined();
    expect(queueCountsOf([]).show_all).toBeUndefined();
  });

  it("agrees with the rows in that queue, because both come from queueOf", () => {
    const counts = queueCountsOf(cases);
    for (const queue of COUNTED_QUEUES) {
      expect(counts[queue]).toBe(casesInQueue(cases, queue).length);
    }
  });

  it("puts no case in two queues", () => {
    const seen = QUEUES.filter((queue) => queue !== "show_all").flatMap((queue) =>
      casesInQueue(cases, queue).map((item) => item.id),
    );
    expect(new Set(seen).size).toBe(seen.length);
  });
});

/* ── AC5, AC6 — the fold is a partition ─────────────────────────────────── */

describe("partitionByImpact", () => {
  const small = makeCase({ id: "small", cause: "small", impactMs: 120 });
  const large = makeCase({ id: "large", cause: "large", impactMs: 2400 });
  const unmeasured = makeCase({ id: "unmeasured", cause: "unmeasured", impactMs: 0 });
  const cases = [small, large, unmeasured];

  it("folds every case with a measured saving under the threshold", () => {
    const { inline, tail } = partitionByImpact(cases, 250);
    expect(tail.map((item) => item.id)).toEqual(["small"]);
    expect(inline.map((item) => item.id)).toEqual(["large", "unmeasured"]);
  });

  it("leaves a case with no measured time out of the fold", () => {
    // Rule 18: an absent measurement is not a small measurement, so it is never
    // folded as though its value were zero. The same call
    // `recommendationMeetsEvidenceThresholds` makes when it lets an unmeasured
    // finding past the savings gate.
    const { tail } = partitionByImpact([unmeasured], 250);
    expect(tail).toEqual([]);
    expect(hasMeasuredImpact(unmeasured.impactMs)).toBe(false);
  });

  it("empties the fold when the threshold is zero", () => {
    const { inline, tail } = partitionByImpact(cases, 0);
    expect(tail).toEqual([]);
    expect(inline).toHaveLength(cases.length);
  });

  it("puts every case on exactly one side", () => {
    for (const threshold of [0, 100, 250, 5000]) {
      const { inline, tail } = partitionByImpact(cases, threshold);
      expect(inline.length + tail.length).toBe(cases.length);
      const ids = [...inline, ...tail].map((item) => item.id).sort();
      expect(ids).toEqual(cases.map((item) => item.id).sort());
    }
  });

  it("drops nothing at the boundary", () => {
    // Exactly at the threshold is not under it.
    expect(partitionByImpact([makeCase({ impactMs: 250 })], 250).tail).toEqual([]);
    expect(partitionByImpact([makeCase({ impactMs: 249 })], 250).tail).toHaveLength(1);
  });
});

/* ── AC8 — every sort is a permutation ──────────────────────────────────── */

describe("sortRemediationGroups", () => {
  const cases = [
    makeCase({ id: "slow", cause: "slow", impactMs: 2400, effort: "days", detectedAt: "2026-08-10T00:00:00.000Z" }),
    makeCase({ id: "quick", cause: "quick", impactMs: 600, effort: "minutes", detectedAt: "2026-08-25T00:00:00.000Z" }),
    makeCase({ id: "mid", cause: "mid", impactMs: 1200, effort: "hours", detectedAt: "2026-08-18T00:00:00.000Z" }),
    makeCase({ id: "vague", cause: "vague", impactMs: 0, effort: "unknown", detectedAt: "2026-08-25T00:00:00.000Z" }),
  ];
  const groups = groupByRemediation(cases, { at: "2026-08-25T06:00:00.000Z" });
  const lastRun = "2026-08-25T06:00:00.000Z";

  it("shows the same groups whichever sort is chosen", () => {
    const baseline = groups.map((group) => group.key).sort();
    for (const sort of ISSUE_SORTS) {
      const sorted = sortRemediationGroups(groups, sort, lastRun);
      expect(sorted).toHaveLength(groups.length);
      expect(sorted.map((group) => group.key).sort()).toEqual(baseline);
    }
  });

  it("ranks by impact descending by default", () => {
    expect(parseIssueSort(undefined)).toBe(DEFAULT_ISSUE_SORT);
    expect(parseIssueSort("nonsense")).toBe("impact");
    expect(sortRemediationGroups(groups, "impact", lastRun).map((group) => group.primary.id))
      .toEqual(["slow", "mid", "quick", "vague"]);
  });

  it("ranks by detection date for newest", () => {
    const order = sortRemediationGroups(groups, "newest", lastRun).map((group) => group.primary.id);
    expect(order.slice(0, 2).sort()).toEqual(["quick", "vague"]);
    expect(order.slice(2)).toEqual(["mid", "slow"]);
  });

  it("puts the last run first for what changed, and keeps the rest below it", () => {
    const order = sortRemediationGroups(groups, "changed", lastRun).map((group) => group.primary.id);
    expect(order.slice(0, 2).sort()).toEqual(["quick", "vague"]);
    // A filter would have stopped there. This is a sort.
    expect(order.slice(2)).toEqual(["mid", "slow"]);
  });

  it("ranks by least work first for effort, with no band last", () => {
    expect(sortRemediationGroups(groups, "effort", lastRun).map((group) => group.primary.id))
      .toEqual(["quick", "mid", "slow", "vague"]);
  });

  it("never lets an unmeasured finding outrank a measured one on impact", () => {
    // Rule 18. "vague" was detected in the last run and has no reading; it must
    // not sit above a 2,400 ms finding on an empty cell.
    const order = sortRemediationGroups(groups, "impact", lastRun).map((group) => group.primary.id);
    expect(order.at(-1)).toBe("vague");
    const measured = order.map((id) => groups.find((group) => group.primary.id === id)!)
      .map((group) => hasMeasuredImpact(group.impactMs));
    // Every measured group comes before every unmeasured one.
    expect(measured).toEqual([...measured].sort((a, b) => Number(b) - Number(a)));
  });

  it("keeps unmeasured last inside an effort band rather than ranking it as zero", () => {
    const sameBand = groupByRemediation([
      makeCase({ id: "blank", cause: "blank", impactMs: 0, effort: "hours" }),
      makeCase({ id: "big", cause: "big", impactMs: 1900, effort: "hours" }),
    ], { at: "2026-08-25T06:00:00.000Z" });
    expect(sortRemediationGroups(sameBand, "effort", lastRun).map((group) => group.primary.id))
      .toEqual(["big", "blank"]);
  });

  it("ranks Newest and What changed on the date, which every case carries", () => {
    // Rule 18 bites where a measurement is the ranking key. These two rank on a
    // date, so an unmeasured finding is not pushed down — that would hide what
    // changed, and these are sorts, not filters.
    const changed = sortRemediationGroups(groups, "changed", lastRun).map((group) => group.primary.id);
    expect(changed.slice(0, 2).sort()).toEqual(["quick", "vague"]);
  });

  /* ── The four column sorts ──────────────────────────────────────────── */

  it("ranks state down the registry's lifecycle, not alphabetically", () => {
    // The two orders disagree, which is the point: alphabetically this is
    // dismissed, in_progress, new — exactly backwards for a triage list.
    const groups = groupByRemediation([
      makeCase({ id: "gone", cause: "gone", state: "dismissed" }),
      makeCase({ id: "fresh", cause: "fresh", state: "new" }),
      makeCase({ id: "doing", cause: "doing", state: "in_progress" }),
    ], { at: "2026-08-25T06:00:00.000Z" });
    expect(sortRemediationGroups(groups, "state", lastRun).map((group) => group.primary.id))
      .toEqual(["fresh", "doing", "gone"]);
  });

  it("ranks confidence strongest first", () => {
    // The registry's order happens to coincide with alphabetical here, so this
    // pins the intent — confirmed at the top — rather than the mechanism.
    const groups = groupByRemediation([
      makeCase({ id: "vague", cause: "vague", confidence: "unclear" }),
      makeCase({ id: "sure", cause: "sure", confidence: "confirmed" }),
      makeCase({ id: "likely", cause: "likely", confidence: "probable" }),
    ], { at: "2026-08-25T06:00:00.000Z" });
    expect(sortRemediationGroups(groups, "confidence", lastRun).map((group) => group.primary.id))
      .toEqual(["sure", "likely", "vague"]);
  });

  it("ranks pages broadest first, because breadth is the reason to look", () => {
    const groups = groupByRemediation([
      makeCase({ id: "one", cause: "one", pageIds: ["home"] }),
      makeCase({ id: "six", cause: "six", scope: "pages", pageIds: ["home", "pricing", "docs", "blog", "about", "help"] }),
      makeCase({ id: "two", cause: "two", scope: "pages", pageIds: ["home", "pricing"] }),
    ], { at: "2026-08-25T06:00:00.000Z" });
    expect(sortRemediationGroups(groups, "pages", lastRun).map((group) => group.primary.id))
      .toEqual(["six", "two", "one"]);
  });

  it("ranks cause by the label the row shows, not by the audit id behind it", () => {
    // The ids sort as bootup-time, dom-size, unused-javascript. The labels they
    // classify to sort differently, and the labels are what is on screen.
    const groups = groupByRemediation([
      makeCase({ id: "nested", cause: "dom-size" }),           // Deeply nested elements
      makeCase({ id: "startup", cause: "bootup-time" }),       // Code running at startup
      makeCase({ id: "dead", cause: "unused-javascript" }),    // Code the site never runs
    ], { at: "2026-08-25T06:00:00.000Z" });
    expect(sortRemediationGroups(groups, "cause", lastRun).map((group) => group.primary.id))
      .toEqual(["startup", "dead", "nested"]);
  });

  /* ── Direction ────────────────────────────────────────────────────────── */

  it("opens each sort in its own direction rather than a uniform descending", () => {
    expect(parseSortDirection(undefined, "effort")).toBe("asc");
    expect(parseSortDirection(undefined, "impact")).toBe("desc");
    expect(parseSortDirection("nonsense", "state")).toBe("asc");
    expect(parseSortDirection("desc", "state")).toBe("desc");
  });

  it("reverses when the same column is asked a second time", () => {
    const stateGroups = groupByRemediation([
      makeCase({ id: "gone", cause: "gone", state: "dismissed" }),
      makeCase({ id: "fresh", cause: "fresh", state: "new" }),
      makeCase({ id: "doing", cause: "doing", state: "in_progress" }),
    ], { at: "2026-08-25T06:00:00.000Z" });
    expect(sortRemediationGroups(stateGroups, "state", lastRun, "asc").map((group) => group.primary.id))
      .toEqual(["fresh", "doing", "gone"]);
    expect(sortRemediationGroups(stateGroups, "state", lastRun, "desc").map((group) => group.primary.id))
      .toEqual(["gone", "doing", "fresh"]);
  });

  it("keeps rule 18 when impact is reversed: smallest MEASURED first, never the unmeasured", () => {
    // The whole point of splitting rule 18 out of the sign. Reversing "largest
    // saving first" asks for the smallest reading, not for the row that has no
    // reading at all — an absent number is not a small one.
    const order = sortRemediationGroups(groups, "impact", lastRun, "asc").map((group) => group.primary.id);
    expect(order).toEqual(["quick", "mid", "slow", "vague"]);
    expect(order.at(-1)).toBe("vague");
  });

  it("keeps rule 18 when effort is reversed, inside each band", () => {
    const sameBand = groupByRemediation([
      makeCase({ id: "blank", cause: "blank", impactMs: 0, effort: "hours" }),
      makeCase({ id: "big", cause: "big", impactMs: 1900, effort: "hours" }),
    ], { at: "2026-08-25T06:00:00.000Z" });
    // Hardest first still does not float the unmeasured finding above the
    // measured one it shares a band with.
    expect(sortRemediationGroups(sameBand, "effort", lastRun, "desc").map((group) => group.primary.id))
      .toEqual(["big", "blank"]);
  });

  it("shows the same groups in either direction", () => {
    const baseline = groups.map((group) => group.key).sort();
    for (const sort of ISSUE_SORTS) {
      for (const direction of ["asc", "desc"] as const) {
        const sorted = sortRemediationGroups(groups, sort, lastRun, direction);
        expect(sorted.map((group) => group.key).sort(), `${sort} ${direction}`).toEqual(baseline);
      }
    }
  });

  it("declares a direction for every sort", () => {
    for (const sort of ISSUE_SORTS) expect(DEFAULT_SORT_DIRECTION[sort]).toMatch(/^(asc|desc)$/);
  });

  it("does not mutate its input", () => {
    const before = groups.map((group) => group.key);
    sortRemediationGroups(groups, "effort", lastRun);
    expect(groups.map((group) => group.key)).toEqual(before);
  });

  it("orders the same input identically every time", () => {
    const once = sortRemediationGroups(groups, "impact", lastRun).map((group) => group.key);
    const twice = sortRemediationGroups(groups, "impact", lastRun).map((group) => group.key);
    expect(once).toEqual(twice);
  });
});

/* ── Rule 18, rule 19 — what the cells actually say ─────────────────────── */

describe("what a reading reads as", () => {
  it("says a missing reading in words, never as 0 and never as a blank", () => {
    const none = formatImpact(0);
    expect(none.measured).toBe(false);
    expect(none.text).toBe("Not measured");
    expect(none.text).not.toMatch(/^\s*$/);
    expect(none.text).not.toMatch(/0/);
  });

  it("keeps a measured reading in the unit it was measured in", () => {
    expect(formatImpact(620).text).toBe("620 ms");
    expect(formatImpact(1900).text).toBe("1.9 s");
    expect(formatImpact(12400).text).toBe("12 s");
  });

  it("labels a group's number as a worst-of, in the members' own units", () => {
    // Rule 19: the group's number is one of the numbers on the rows beneath it,
    // so the reader can find it there. "up to" is what a worst-of is.
    expect(formatGroupImpact(1900).text).toBe(`up to ${formatImpact(1900).text}`);
    expect(formatGroupImpact(1900).text).toBe("up to 1.9 s");
  });

  it("does not say up to nothing", () => {
    expect(formatGroupImpact(0).text).toBe("Not measured");
  });
});
