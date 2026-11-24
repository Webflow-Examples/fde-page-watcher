import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_ISSUE_SORT,
  DEFAULT_SORT_DIRECTION,
  ISSUE_SORTS,
  caseRank,
  decideCountOf,
  parseIssueSort,
  parseSortDirection,
  queueCountsOf,
  sortRemediationGroups,
  startHereCases,
  START_HERE_LIMIT,
} from "../issue-list";
import { issueCasesFrom, lastRunAtOf } from "../issue-cases";
import { partitionByImpact } from "../impact-format";
import { accept, casesInQueue, groupByRemediation, hasMeasuredImpact, remediationKey, type IssueCase } from "../issue-case";
import { formatGroupImpact, formatImpact } from "@/components/issue-row";
import { caseImpactReading, groupImpactReading, impactOriginLabel } from "../impact-format";
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

  it("never produces a count for Show all or Settled", () => {
    // Not "hides the badge" — there is no number to render, so a badge cannot
    // appear on either by mistake.
    expect(queueCountsOf(cases).show_all).toBeUndefined();
    expect(queueCountsOf(cases).settled).toBeUndefined();
    expect(queueCountsOf([]).show_all).toBeUndefined();
    expect(queueCountsOf([]).settled).toBeUndefined();
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

  it("shows the same groups whichever sort is chosen", () => {
    const baseline = groups.map((group) => group.key).sort();
    for (const sort of ISSUE_SORTS) {
      const sorted = sortRemediationGroups(groups, sort);
      expect(sorted).toHaveLength(groups.length);
      expect(sorted.map((group) => group.key).sort()).toEqual(baseline);
    }
  });

  it("ranks by impact descending by default", () => {
    expect(parseIssueSort(undefined)).toBe(DEFAULT_ISSUE_SORT);
    expect(parseIssueSort("nonsense")).toBe("impact");
    expect(sortRemediationGroups(groups, "impact").map((group) => group.primary.id))
      .toEqual(["slow", "mid", "quick", "vague"]);
  });

  it("ranks by detection date", () => {
    const order = sortRemediationGroups(groups, "date").map((group) => group.primary.id);
    expect(order.slice(0, 2).sort()).toEqual(["quick", "vague"]);
    expect(order.slice(2)).toEqual(["mid", "slow"]);
  });

  it("ranks by least work first for effort, with no band last", () => {
    expect(sortRemediationGroups(groups, "effort").map((group) => group.primary.id))
      .toEqual(["quick", "mid", "slow", "vague"]);
  });

  it("never lets an unmeasured finding outrank a measured one on impact", () => {
    // Rule 18. "vague" was detected in the last run and has no reading; it must
    // not sit above a 2,400 ms finding on an empty cell.
    const order = sortRemediationGroups(groups, "impact").map((group) => group.primary.id);
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
    expect(sortRemediationGroups(sameBand, "effort").map((group) => group.primary.id))
      .toEqual(["big", "blank"]);
  });

  /* ── The column sorts ──────────────────────────────────────────────── */

  it("ranks confidence strongest first", () => {
    // The registry's order happens to coincide with alphabetical here, so this
    // pins the intent — confirmed at the top — rather than the mechanism.
    const groups = groupByRemediation([
      makeCase({ id: "vague", cause: "vague", confidence: "unclear" }),
      makeCase({ id: "sure", cause: "sure", confidence: "confirmed" }),
      makeCase({ id: "likely", cause: "likely", confidence: "probable" }),
    ], { at: "2026-08-25T06:00:00.000Z" });
    expect(sortRemediationGroups(groups, "confidence").map((group) => group.primary.id))
      .toEqual(["sure", "likely", "vague"]);
  });

  it("ranks pages broadest first, because breadth is the reason to look", () => {
    const groups = groupByRemediation([
      makeCase({ id: "one", cause: "one", pageIds: ["home"] }),
      makeCase({ id: "six", cause: "six", scope: "pages", pageIds: ["home", "pricing", "docs", "blog", "about", "help"] }),
      makeCase({ id: "two", cause: "two", scope: "pages", pageIds: ["home", "pricing"] }),
    ], { at: "2026-08-25T06:00:00.000Z" });
    expect(sortRemediationGroups(groups, "pages").map((group) => group.primary.id))
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
    expect(sortRemediationGroups(groups, "cause").map((group) => group.primary.id))
      .toEqual(["startup", "dead", "nested"]);
  });

  /* ── Direction ────────────────────────────────────────────────────────── */

  it("opens each sort in its own direction rather than a uniform descending", () => {
    expect(parseSortDirection(undefined, "effort")).toBe("asc");
    expect(parseSortDirection(undefined, "impact")).toBe("desc");
    expect(parseSortDirection("nonsense", "date")).toBe("desc");
    expect(parseSortDirection("desc", "date")).toBe("desc");
  });


  it("reverses when the same column is asked a second time", () => {
    expect(sortRemediationGroups(groups, "date", "asc").map((group) => group.primary.id))
      .toEqual(["slow", "mid", "quick", "vague"]);
    expect(sortRemediationGroups(groups, "date", "desc").map((group) => group.primary.id))
      .toEqual(["quick", "vague", "mid", "slow"]);
  });

  it("keeps rule 18 when impact is reversed: smallest MEASURED first, never the unmeasured", () => {
    // The whole point of splitting rule 18 out of the sign. Reversing "largest
    // saving first" asks for the smallest reading, not for the row that has no
    // reading at all — an absent number is not a small one.
    const order = sortRemediationGroups(groups, "impact", "asc").map((group) => group.primary.id);
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
    expect(sortRemediationGroups(sameBand, "effort", "desc").map((group) => group.primary.id))
      .toEqual(["big", "blank"]);
  });

  it("shows the same groups in either direction", () => {
    const baseline = groups.map((group) => group.key).sort();
    for (const sort of ISSUE_SORTS) {
      for (const direction of ["asc", "desc"] as const) {
        const sorted = sortRemediationGroups(groups, sort, direction);
        expect(sorted.map((group) => group.key).sort(), `${sort} ${direction}`).toEqual(baseline);
      }
    }
  });

  it("declares a direction for every sort", () => {
    for (const sort of ISSUE_SORTS) expect(DEFAULT_SORT_DIRECTION[sort]).toMatch(/^(asc|desc)$/);
  });

  it("does not mutate its input", () => {
    const before = groups.map((group) => group.key);
    sortRemediationGroups(groups, "effort");
    expect(groups.map((group) => group.key)).toEqual(before);
  });

  it("orders the same input identically every time", () => {
    const once = sortRemediationGroups(groups, "impact").map((group) => group.key);
    const twice = sortRemediationGroups(groups, "impact").map((group) => group.key);
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

/* ── T1 — the cell says what was measured, and who measured it ─────────── */

describe("impact text on a row", () => {
  it("shows a byte-only case in bytes, never an empty cell", () => {
    const reading = caseImpactReading(makeCase({ impactMs: 0, impactBytes: 579 * 1024, impactOrigin: "observed" }));
    expect(reading.text).toBe("579 KB");
    expect(reading.measured).toBe(true);
    expect(reading.unit).toBe("bytes");
    expect(impactOriginLabel(reading.origin)).toBe("Real users");
  });

  it("shows milliseconds first when both were measured", () => {
    const reading = caseImpactReading(makeCase({ impactMs: 10_800, impactBytes: 579 * 1024, impactOrigin: "observed" }));
    expect(reading.text).toBe("11 s");
    expect(reading.unit).toBe("time");
  });

  it("says Not measured only when neither unit was measured", () => {
    const reading = caseImpactReading(makeCase({ impactMs: 0 }));
    expect(reading.text).toBe("Not measured");
    expect(reading.measured).toBe(false);
    expect(impactOriginLabel(reading.origin)).toBeNull();
  });

  it("labels a simulated reading, and words a group's bytes as a worst-of", () => {
    expect(impactOriginLabel("simulated")).toBe("Simulated");
    const group = groupImpactReading({ impactMs: 0, impactBytes: 1.2 * 1024 ** 2, impactOrigin: "simulated" });
    expect(group.text).toBe("up to 1.2 MB");
    expect(group.origin).toBe("simulated");
  });

  it("keeps the table's Impact sort measured-first in either unit", () => {
    const groups = groupByRemediation([
      makeCase({ id: "x:none", cause: "none", impactMs: 0 }),
      makeCase({ id: "x:bytes", cause: "bytes", impactMs: 0, impactBytes: 579 * 1024 }),
      makeCase({ id: "x:time", cause: "time", impactMs: 900 }),
    ], { at: "2026-08-25T06:00:00.000Z" });
    const order = sortRemediationGroups(groups, "impact").map((group) => group.primary.id);
    expect(order).toEqual(["x:time", "x:bytes", "x:none"]);
    // Reversing ranks the smallest MEASURED first; an absent reading stays last.
    expect(sortRemediationGroups(groups, "impact", "asc").at(-1)?.primary.id).toBe("x:none");
  });
});

/* ── T3 will read this order; T1 owns it ───────────────────────────────── */

describe("caseRank — observed, then measured, then oldest", () => {
  const cases = () => [
    makeCase({ id: "sim-12s", cause: "sim-12s", impactMs: 12_400, impactOrigin: "simulated", detectedAt: "2026-08-01T00:00:00.000Z" }),
    makeCase({ id: "obs-bytes", cause: "obs-bytes", impactMs: 0, impactBytes: 579 * 1024, impactOrigin: "observed", detectedAt: "2026-08-10T00:00:00.000Z" }),
    makeCase({ id: "obs-time", cause: "obs-time", impactMs: 10_800, impactOrigin: "observed", detectedAt: "2026-08-05T00:00:00.000Z" }),
    makeCase({ id: "unmeasured", cause: "unmeasured", impactMs: 0, detectedAt: "2026-07-20T00:00:00.000Z" }),
  ];

  it("never lets a simulated aggregate outrank an observed case", () => {
    const ranked = [...cases()].sort(caseRank).map((item) => item.id);
    expect(ranked.slice(0, 3)).toEqual(["obs-time", "obs-bytes", "sim-12s"]);
    // Both are simulated, and the one nobody measured still sorts after the
    // simulated 12 s rather than standing in for a small reading.
    expect(ranked.at(-1)).toBe("unmeasured");
  });

  it("puts an absent measurement last within its band and breaks ties on the oldest", () => {
    const sim = [
      makeCase({ id: "sim-b", cause: "b", impactMs: 0, impactOrigin: "simulated", detectedAt: "2026-08-02T00:00:00.000Z" }),
      makeCase({ id: "sim-a", cause: "a", impactMs: 0, impactOrigin: "simulated", detectedAt: "2026-08-01T00:00:00.000Z" }),
      makeCase({ id: "sim-c", cause: "c", impactMs: 2_000, impactOrigin: "simulated", detectedAt: "2026-08-20T00:00:00.000Z" }),
    ];
    expect([...sim].sort(caseRank).map((item) => item.id)).toEqual(["sim-c", "sim-a", "sim-b"]);
  });

  it("is a total order: the same input reads the same way twice", () => {
    const once = [...cases()].sort(caseRank).map((item) => item.id);
    const twice = [...cases()].sort(caseRank).map((item) => item.id);
    expect(once).toEqual(twice);
  });
});

/* ── T3 — Start Here: three decisions, not sixteen rows ────────────────── */

describe("Start Here", () => {
  const plan = (name: string) => ({ steps: [`Fix ${name}.`], actionability: "direct" as const });

  /** Four decisions and one that is not one: a settled case and a platform case. */
  const decideCases = () => [
    makeCase({ id: "obs-time", cause: "obs-time", impactMs: 10_800, impactOrigin: "observed", detectedAt: "2026-08-10T00:00:00.000Z", remediation: plan("obs-time") }),
    makeCase({ id: "obs-bytes", cause: "obs-bytes", impactMs: 0, impactBytes: 579 * 1024, impactOrigin: "observed", detectedAt: "2026-08-11T00:00:00.000Z", remediation: plan("obs-bytes") }),
    makeCase({ id: "sim-big", cause: "sim-big", impactMs: 12_400, impactOrigin: "simulated", detectedAt: "2026-08-01T00:00:00.000Z", remediation: plan("sim-big") }),
    makeCase({ id: "sim-small", cause: "sim-small", impactMs: 400, impactOrigin: "simulated", detectedAt: "2026-08-02T00:00:00.000Z", remediation: plan("sim-small") }),
    makeCase({ id: "settled", cause: "settled", state: "resolved", impactMs: 20_000, impactOrigin: "observed" }),
    makeCase({ id: "platform", cause: "platform", impactMs: 30_000, impactOrigin: "observed", remediation: { steps: [], actionability: "platform" } }),
  ];

  it("asks for three decisions, ranked observed first and never platform-owned", () => {
    const chosen = startHereCases(decideCases());
    expect(chosen).toHaveLength(START_HERE_LIMIT);
    expect(chosen.map((item) => item.id)).toEqual(["obs-time", "obs-bytes", "sim-big"]);
  });

  it("shows fewer than three when Decide holds fewer", () => {
    const one = startHereCases([makeCase({ id: "only", cause: "only", remediation: plan("only") })]);
    expect(one.map((item) => item.id)).toEqual(["only"]);
    expect(startHereCases([])).toEqual([]);
  });

  it("asks once per remediation, and never duplicates a row", () => {
    const shared = { steps: ["One fix covers both."], actionability: "direct" as const };
    const chosen = startHereCases([
      makeCase({ id: "a", cause: "a", impactMs: 900, impactOrigin: "observed", remediation: shared }),
      makeCase({ id: "b", cause: "b", impactMs: 800, impactOrigin: "observed", remediation: shared }),
      makeCase({ id: "c", cause: "c", impactMs: 700, impactOrigin: "observed", remediation: plan("c") }),
    ]);
    expect(chosen.map((item) => item.id)).toEqual(["a", "c"]);
    // Every case in the block is exactly one row in the table below it.
    const tableIds = groupByRemediation(decideCases()).flatMap((group) => group.cases.map((item) => item.id));
    for (const item of startHereCases(decideCases())) {
      expect(tableIds.filter((id) => id === item.id)).toHaveLength(1);
    }
    expect(new Set(chosen.map((item) => item.id)).size).toBe(chosen.length);
  });

  it("refills after an action, because the block is a view of the queue", () => {
    // Accept the first: the decision is stored against its remediation, and the
    // case leaves Decide on the same derivation the block reads.
    const before = startHereCases(decideCases());
    const key = remediationKey(before[0]);
    const afterCases = decideCases().map((issue) =>
      remediationKey(issue) === key ? accept(issue, { by: { kind: "person", userId: "rae@webflow.com" }, at: "2026-08-24T00:00:00.000Z" }) : issue);
    const after = startHereCases(afterCases);
    expect(after.map((item) => item.id)).not.toContain(before[0].id);
    expect(after.map((item) => item.id)).toEqual(["obs-bytes", "sim-big", "sim-small"]);
    // The accepted case is still in the table, in Fix where it now belongs.
    expect(casesInQueue(afterCases, "fix").map((item) => item.id)).toEqual([before[0].id]);
  });
});

/* ── T6 — the Webflow-owned lane does not change the Decide count ───────── */

describe("a platform-owned case in the list", () => {
  it("never adds to a counted queue", () => {
    const work = [
      makeCase({ id: "a", cause: "a", impactMs: 900 }),
      makeCase({ id: "b", cause: "b", impactMs: 400 }),
    ];
    const platform = makeCase({
      id: "rb",
      cause: "render-blocking-resources",
      impactMs: 981,
      impactOrigin: "simulated",
      remediation: { steps: [], actionability: "platform" },
    });
    expect(queueCountsOf([...work, platform])).toEqual(queueCountsOf(work));
    expect(queueCountsOf([...work, platform]).decide).toBe(work.length);
    // And Start Here does not offer it as a decision.
    expect(startHereCases([...work, platform]).map((item) => item.id)).toEqual(["a", "b"]);
  });

  it("gives the sidebar badge the same number as the Decide tab and the table", () => {
    const work = [
      makeCase({ id: "a", cause: "a", impactMs: 900 }),
      makeCase({ id: "b", cause: "b", impactMs: 400 }),
    ];
    const platform = makeCase({
      id: "rb",
      cause: "render-blocking-resources",
      impactMs: 981,
      impactOrigin: "simulated",
      remediation: { steps: [], actionability: "platform" },
    });
    const cases = [...work, platform];
    // The badge is the counted queue, not raw membership: the platform case is
    // present and changes nothing.
    expect(decideCountOf(cases)).toBe(decideCountOf(work));
    expect(decideCountOf(cases)).toBe(queueCountsOf(cases).decide);
    // The table's Decide rows are exactly that many, so badge, tab and rows agree.
    expect(decideCountOf(cases)).toBe(casesInQueue(cases.filter((item) => item.remediation.actionability !== "platform"), "decide").length);
  });
});

/* ── One Decide count, across src ───────────────────────────────────────── */

describe("one Decide count, across src", () => {
  const moduleDir = path.dirname(fileURLToPath(import.meta.url));

  it("reads the sidebar badge from the shared count, not raw queue membership", () => {
    /**
     * The badge and the Decide tab drifted once: the sidebar counted
     * `casesInQueue(..., "decide").length`, which includes a Webflow-owned
     * reading, and said 8 while the page said 7. `decideCountOf` is the shared
     * answer; a surface that counts Decide by hand is the defect.
     */
    const sidebar = readFileSync(path.resolve(moduleDir, "../../components/Sidebar.tsx"), "utf8");
    expect(sidebar).not.toMatch(/casesInQueue/);
    expect(sidebar).toMatch(/decideCountOf\(/);
  });
});
