import { describe, it, expect } from "vitest";
import { buildWatcher, buildWatcherCards, deviceChangeMeta } from "../watcher";
import { pageRangeComparison, pageRangeTrend, rangeComparison } from "../scoring";
import { normalizePerformanceThresholds } from "../performanceThresholds";
import { agentCheckKey } from "../agentScoring";
import type { CruxPageEvidence } from "../crux";
import type { CategoryScore, Night, NightScores, Rec, ScoreByCategory, Strategy, StrategyScores, WatchPage } from "../types";

const cat = (m: number): CategoryScore => ({ m, lo: m - 1, hi: m + 1 });
const ns = (s: ScoreByCategory): NightScores => ({ perf: cat(s.perf), a11y: cat(s.a11y), bp: cat(s.bp), seo: cat(s.seo) });
const strat = (s: ScoreByCategory): StrategyScores => ({ mobile: ns(s), desktop: ns(s) });

/**
 * Both devices must report before a page may carry a verdict.
 *
 * A team setting now, not a page one. These cases used to reach it through
 * `performanceThresholdOverrides`, which S8 deleted along with the panel that
 * edited it — the behaviour under test is unchanged, only where the policy is
 * set.
 */
const BOTH_DEVICES = { devicePolicy: "both" } as const;

function page(id: string, baseline: ScoreByCategory, current: ScoreByCategory): WatchPage {
  return {
    id,
    title: id,
    url: `${id}.com`,
    flag: "priority",
    status: "stable",
    baseline: strat(baseline),
    current: { mobile: current, desktop: current },
    history: [
      { i: 0, date: "Jul 20", scores: strat(baseline) },
      { i: 1, date: "Jul 21", scores: strat(current) },
    ],
    markers: [],
    agent: [],
    baselineCapturedAt: "2026-07-21T12:00:00.000Z",
  };
}

const good: ScoreByCategory = { perf: 80, a11y: 95, bp: 95, seo: 95 };

describe("buildWatcher — concise Performance changes", () => {
  it("moves page-level Performance changes into the dashboard cards", () => {
    const regression = page("customers", good, { ...good, perf: 60 });
    regression.markers = [{ id: "launch", i: 1, date: "Jul 21", text: "CMS launch" }];
    const improvement = page("homepage", good, { ...good, perf: 92 });

    const w = buildWatcher([regression, improvement], [], "desktop", 3);
    const cards = buildWatcherCards([regression, improvement], 3);

    expect(w.changed).toHaveLength(0);
    expect(cards.regressions).toEqual([
      expect.objectContaining({ pageId: "customers", meta: "D −20 · M −20" }),
    ]);
    expect(cards.improvements).toEqual([
      expect.objectContaining({ pageId: "homepage", meta: "D +12 · M +12" }),
    ]);

    const mobileFirstCards = buildWatcherCards([regression, improvement], 3, undefined, "mobile");
    expect(mobileFirstCards.regressions[0].meta).toBe("M −20 · D −20");
    expect(mobileFirstCards.improvements[0].meta).toBe("M +12 · D +12");
  });
});

/* ── R1 F3 — rule 18 in the Watcher's copy ──────────────────────────────── */

describe("buildWatcher — a category nobody measured", () => {
  /**
   * `availableStrategies` lets a night report desktop and not mobile. Under
   * `devicePolicy: "both"` a single pending device no longer makes the page
   * pending, so a page with no mobile readings at all is still ranked — and the
   * stability check then asked for its mobile comparison, got `null`, and read
   * it as `?? 0` movement from a `?? 100` score.
   *
   * The result was "Accessibility and SEO are stable across the board." printed
   * over a device that was never measured. Registry rule 18: an absent
   * measurement is never treated as a value.
   */
  function desktopOnly(id: string, scores: ScoreByCategory = good): WatchPage {
    return {
      ...page(id, scores, scores),
      history: [0, 1, 2].map((i) => ({
        i,
        date: `Jul 2${i}`,
        scores: strat(scores),
        availableStrategies: ["desktop"] as Strategy[],
      })),
    };
  }

  it("does not claim stability for a device that never reported", () => {
    const w = buildWatcher([desktopOnly("home")], [], "mobile", 30, undefined, BOTH_DEVICES);
    expect(w.winning, "claimed stability over a device with no readings").toBeNull();
  });

  it("still claims stability for the device that did report", () => {
    // The withholding must be about the missing reading, not about the page.
    const w = buildWatcher([desktopOnly("home")], [], "desktop", 30, undefined, BOTH_DEVICES);
    expect(w.winning).toBe("Accessibility and SEO are stable across the board.");
  });

  it("withholds the claim for the whole board when one page is unmeasured", () => {
    // "Across the board" means every page on the board. A measured page that
    // held does not cover for an unmeasured neighbour.
    const measured = page("pricing", good, good);
    const w = buildWatcher([measured, desktopOnly("home")], [], "mobile", 30, undefined, BOTH_DEVICES);
    expect(w.winning).toBeNull();
  });

  it("still reports a real drop rather than going quiet", () => {
    // Withholding the good news must not also swallow the bad news.
    const dropped = page("pricing", good, { ...good, a11y: 40 });
    const w = buildWatcher([dropped, desktopOnly("home")], [], "mobile", 30, undefined, BOTH_DEVICES);
    expect(w.changed.some((bullet) => bullet.text.includes("Accessibility"))).toBe(true);
  });
});

/* ── P35 — a change nobody measured is not a change of zero ──────────── */

describe("buildWatcherCards — a device the trend flagged but nothing could compare", () => {
  /**
   * `deviceChangeMeta` read `pageRangeComparison(...)?.delta ?? 0` and rendered
   * "M +0" — a measured change of nothing, which is the one thing it certainly
   * was not. The window was narrow: both readings defaulted `now` to
   * `Date.now()` on consecutive lines, so a day boundary crossing between them
   * left the trend answering from one range and the comparison from another.
   *
   * Two things are asserted, because there were two bugs. The label is never a
   * zero — rule 18, an absent reading withholds the claim it would have
   * supported. And the page it belongs to is still on the card, because
   * withholding the size of a regression must not withhold the regression.
   */
  const NOW = Date.parse("2026-07-21T12:00:00.000Z");
  const thresholds = normalizePerformanceThresholds({});

  /** A page whose nights only ever reported desktop. Its mobile readings are absent. */
  const desktopOnly = (id: string): WatchPage => ({
    ...page(id, good, { ...good, perf: 60 }),
    history: [0, 1, 2].map((i) => ({
      i,
      date: `Jul 2${i}`,
      scores: strat({ ...good, perf: 80 - i * 10 }),
      availableStrategies: ["desktop"] as Strategy[],
    })),
  });

  it("is asked for a size only when there is a reading to give one", () => {
    /**
     * The invariant that made the old `?? 0` dead code everywhere except the
     * race, and the reason one shared instant is a complete fix rather than a
     * mitigation: a device with no comparison is always `pending`, and a pending
     * device is never a trend the card asks about. Read at one instant, the two
     * functions cannot disagree.
     *
     * If this ever stops holding, the fallback below becomes reachable again and
     * the withhold is doing real work — which is exactly when someone needs to
     * know, so it is asserted rather than assumed.
     */
    for (const subject of [desktopOnly("quiet"), page("customers", good, { ...good, perf: 60 })]) {
      for (const device of ["mobile", "desktop"] as Strategy[]) {
        const comparison = pageRangeComparison(subject, device, "perf", 3, NOW);
        if (comparison !== null) continue;
        expect(
          pageRangeTrend(subject, device, 3, thresholds, NOW),
          `${subject.id}/${device} has no comparison but is not pending`,
        ).toBe("pending");
      }
    }
  });

  it("contributes no label rather than a change of zero", () => {
    // The withhold itself, asserted where it lives. `deviceChangeMeta` is
    // exported for this: driven from `buildWatcherCards` the branch is
    // unreachable, so a test from there would pass with or without the fallback
    // and prove nothing (rule 21).
    const quiet = desktopOnly("quiet");
    const change = deviceChangeMeta(quiet, 3, "regressing", ["mobile"], thresholds, NOW);
    // Not "M +0", and not "M −0". Nothing was measured, so nothing is claimed.
    expect(change.meta).toBe("");
    expect(change.sortValue).toBe(0);
  });

  it("still reports the size for the device that did report", () => {
    // The withholding must be about the missing reading, not about the page.
    const change = deviceChangeMeta(desktopOnly("quiet"), 3, "regressing", ["desktop"], thresholds, NOW);
    expect(change.meta).toBe("D −20");
    expect(change.sortValue).toBe(20);
  });

  it("never claims a change of zero anywhere on a card", () => {
    const cards = buildWatcherCards(
      [page("customers", good, { ...good, perf: 60 }), page("homepage", good, { ...good, perf: 92 }), desktopOnly("quiet")],
      3,
    );
    for (const card of [...cards.regressions, ...cards.improvements]) {
      expect(card.meta, `${card.pageId} claims a measured change of nothing`).not.toMatch(/[+−-]0\b/);
    }
  });
});

/* ── P36 — an unmeasured page is not a perfect page ─────────────────── */

describe("buildWatcher — the page it falls back to", () => {
  /**
   * The focus fallback sorted on `latestScore(...) ?? 100`, which is not the
   * harmless tiebreak it looks like: 100 is a real, attainable Performance
   * score, so a page nobody had measured was ranked as though it were the best
   * page on the board and tied with any page that genuinely scored 100.
   *
   * Rule 18 says an absent measurement is not a value. Substituting a perfect
   * one is the most flattering value available, which is the opposite of
   * withholding.
   */
  const rec = (pageId: string): Rec => ({
    key: `${pageId}:unused-js`,
    id: "unused-javascript",
    pageId,
    title: "Remove unused JavaScript",
    category: "Performance",
    savings: "1.8 s",
    status: "inbox",
    taskStatus: "todo",
  } as Rec);

  /**
   * A page that IS ranked and yet has no reading on the strategy being asked
   * about.
   *
   * This is the only shape that reaches the fallback's comparator with a null
   * score, and finding it is most of the test. `ranked` already drops a page
   * with no baseline, so a page with no history at all never gets that far —
   * which is why an obvious "unmeasured page" fixture passes against the old
   * code and proves nothing. Under `devicePolicy: "both"` a page whose nights
   * only ever reported desktop is still ranked, and its mobile score is null.
   */
  const desktopOnly = (id: string, perf: number): WatchPage => ({
    ...page(id, { ...good, perf }, { ...good, perf }),
    history: [0, 1, 2].map((i) => ({
      i,
      date: `Jul 2${i}`,
      scores: strat({ ...good, perf }),
      availableStrategies: ["desktop"] as Strategy[],
    })),
  });

  it("recommends nothing when no page produced a reading on this device", () => {
    // Withholding, not failing: the summary is still built, it simply does not
    // name a page no run has read. The old comparator scored this page 100 and
    // recommended something about it.
    const w = buildWatcher([desktopOnly("home", 40)], [rec("home")], "mobile", 3, undefined, BOTH_DEVICES);
    expect(w.topRec).toBeNull();
  });

  it("prefers a page that genuinely scored 100 over one nobody measured", () => {
    /**
     * The exact tie the old comparator produced: an unmeasured page and a
     * perfect one both read as 100, so the winner was whichever came first in
     * the array. The measured page must win outright — it is the only one with a
     * reading, and 100 is a score rather than a stand-in for the absence of one.
     */
    const perfect = page("perfect", { ...good, perf: 100 }, { ...good, perf: 100 });
    const w = buildWatcher(
      [desktopOnly("unknown", 40), perfect],
      [rec("perfect"), rec("unknown")],
      "mobile",
      3,
      undefined,
      BOTH_DEVICES,
    );
    expect(w.topRec?.pageId).toBe("perfect");
  });

  it("still falls back to the worst page anyone did measure", () => {
    // The withholding is about the unmeasured page, not about the fallback.
    const worst = page("worst", good, good);
    const better = page("better", { ...good, perf: 95 }, { ...good, perf: 95 });
    const w = buildWatcher([better, worst], [rec("worst"), rec("better")], "mobile", 3);
    expect(w.topRec?.pageId).toBe("worst");
  });
});

describe("rangeComparison — a malformed night", () => {
  it("names the invariant instead of reading the gap as a score", () => {
    // A Night carries all four categories for every strategy it reports. One
    // that does not is malformed, and the cast is the only way to build it —
    // which is the point: the throw is what a later partial NightScores meets.
    const partial = {
      i: 0,
      date: "Jul 20",
      scores: { mobile: { perf: cat(80), bp: cat(95), seo: cat(95) }, desktop: ns(good) },
    } as unknown as Night;
    const history = [partial, { ...partial, i: 1 }];
    expect(() => rangeComparison(history, "mobile", "a11y")).toThrow(/carries no a11y score/);
    // The categories it does carry still compare.
    expect(rangeComparison(history, "mobile", "perf")).toMatchObject({ delta: 0 });
  });
});

describe("buildWatcher — Accessibility/SEO truthfulness", () => {
  it("claims stability only when both categories actually held", () => {
    const pages = [page("home", good, good)];
    const w = buildWatcher(pages, [], "mobile");
    expect(w.winning).toBe("Accessibility and SEO are stable across the board.");
  });

  it("names a category that dropped instead of asserting stability", () => {
    const dropped: ScoreByCategory = { ...good, a11y: 80 }; // 95 -> 80, well past the threshold
    const pages = [page("home", good, dropped)];
    const w = buildWatcher(pages, [], "mobile");
    expect(w.changed.some((b) => /dropped on Accessibility/.test(b.text))).toBe(true);
    // SEO held, so it is still reported stable on its own
    expect(w.winning).toBe("SEO is stable across the board.");
  });
});

describe("buildWatcherCards — selected range", () => {
  it("applies custom low-Performance and regression tolerances", () => {
    const watched = page("home", good, { ...good, perf: 74 });

    const defaults = buildWatcherCards([watched], 3);
    expect(defaults.lowPerformance).toHaveLength(0);
    expect(defaults.regressions).toHaveLength(0);

    const sensitive = buildWatcherCards(
      [watched],
      3,
      undefined,
      "desktop",
      { lowPerformance: 75, regression: 5 },
    );
    expect(sensitive.lowPerformance).toEqual([
      expect.objectContaining({ pageId: "home", meta: "D 74 · M 74" }),
    ]);
    expect(sensitive.regressions).toEqual([
      expect.objectContaining({ pageId: "home", meta: "D −6 · M −6" }),
    ]);
  });

  it("recomputes card membership when the selected range changes", () => {
    const watched = page("home", good, good);
    const perf = [60, 60, 60, 90, 90, 90, 90];
    watched.history = perf.map((score, i) => ({
      i,
      date: `Jul ${i + 1}`,
      scores: strat({ ...good, perf: score }),
    }));

    expect(buildWatcherCards([watched], 3).improvements).toHaveLength(0);
    expect(buildWatcherCards([watched], 7).improvements).toEqual([
      expect.objectContaining({ pageId: "home" }),
    ]);
  });

  it("uses the latest agent scan inside the selected range", () => {
    const watched = page("home", good, good);
    watched.agent = [];
    watched.history = Array.from({ length: 7 }, (_, i) => ({
      i,
      date: `Jul ${i + 1}`,
      scores: strat(good),
      ...(i === 1 ? { agent: [
        { name: "WebMCP", group: "API / Auth / MCP", pass: false },
        { name: "robots.txt", group: "Discoverability", pass: true },
      ] } : {}),
    }));

    expect(buildWatcherCards([watched], 3).agentGaps).toHaveLength(0);
    expect(buildWatcherCards([watched], 7).agentGaps).toEqual([
      expect.objectContaining({ pageId: "home", meta: "50%" }),
    ]);
  });

  it("applies the configured device policy", () => {
    const watched = page("devices", good, good);
    watched.history = [
      { i: 0, date: "Jul 20", scores: strat(good) },
      {
        i: 1,
        date: "Jul 21",
        scores: {
          mobile: ns(good),
          desktop: ns({ ...good, perf: 60 }),
        },
      },
    ];

    expect(buildWatcherCards([watched], 3, undefined, "desktop", { devicePolicy: "either" }).regressions).toHaveLength(1);
    expect(buildWatcherCards([watched], 3, undefined, "desktop", { devicePolicy: "both" }).regressions).toHaveLength(0);
    expect(buildWatcherCards([watched], 3, undefined, "desktop", { devicePolicy: "preferred" }).regressions).toHaveLength(1);
    expect(buildWatcherCards([watched], 3, undefined, "mobile", { devicePolicy: "preferred" }).regressions).toHaveLength(0);
  });

  it("uses the agent-readiness cutoff for Agent gaps", () => {
    const watched = page("agent", good, good);
    watched.agent = [
      { name: "robots.txt", group: "Discoverability", pass: true },
      { name: "WebMCP", group: "API / Auth / MCP", pass: false },
    ];

    expect(buildWatcherCards([watched], 3, undefined, "desktop", { agentReadiness: 100 }).agentGaps).toHaveLength(1);
    expect(buildWatcherCards([watched], 3, undefined, "desktop", { agentReadiness: 50 }).agentGaps).toHaveLength(0);
  });

  it("keeps pages out of trend cards during the configured grace period", () => {
    const watched = page("new", good, { ...good, perf: 60 });
    expect(buildWatcherCards([watched], 3, undefined, "desktop", { newPageGraceRuns: 3 }).regressions).toHaveLength(0);
    expect(buildWatcherCards([watched], 3, undefined, "desktop", { newPageGraceRuns: 2 }).regressions).toHaveLength(1);
  });
});

describe("buildWatcher — top recommendation", () => {
  const focus = page("pricing", good, { ...good, perf: 50 });
  const rec = (id: string, savings: string, status: Rec["status"], taskStatus: Rec["taskStatus"]): Rec => ({
    key: `pricing:${id}`,
    pageId: "pricing",
    pageTitle: "pricing",
    url: "pricing.com",
    id,
    title: `${id}-title`,
    category: "Performance",
    savings,
    estTime: "1 day",
    status,
    taskStatus,
    added: "Jul 1",
    doneDate: null,
  });

  it("skips ignored and completed recs and picks the top active one", () => {
    const recs = [
      rec("big", "5.0 s", "ignored", "todo"), // highest savings but ignored
      rec("done", "4.0 s", "task", "done"), // completed
      rec("active", "1.5 s", "inbox", "todo"), // the only actionable one
    ];
    const w = buildWatcher([focus], recs, "mobile");
    expect(w.topRec?.recTitle).toBe("active-title");
  });

  it("still surfaces the top pick when its audit ID isn't in the documented remediation table", () => {
    // "active" above is already unmapped, but this test makes that intent explicit
    // and would fail again if `recommendationIsCustomerActionable` regresses to
    // treating unmapped ("review") findings as hidden rather than actionable.
    const recs = [rec("brand-new-lighthouse-audit", "2.0 s", "inbox", "todo")];
    const w = buildWatcher([focus], recs, "mobile");
    expect(w.topRec?.recTitle).toBe("brand-new-lighthouse-audit-title");
  });

  it("prioritizes recommendations corroborated by exact-URL visitor evidence", () => {
    const watched = page("pricing", good, { ...good, perf: 50 });
    watched.history[1].measurementContext = {
      mobile: { medianLargestContentfulPaint: 4_500, medianCumulativeLayoutShift: 0.05 },
    };
    const lcp = { ...rec("unused-javascript", "0.5 s", "inbox", "todo"), title: "Fix LCP" };
    const cls = { ...rec("unsized-images", "3.0 s", "inbox", "todo"), title: "Fix CLS" };
    const visitorEvidence: CruxPageEvidence[] = [{
      pageId: "pricing",
      formFactor: "PHONE",
      status: null,
      snapshots: [{
        formFactor: "PHONE",
        scope: "url",
        requestedUrl: "https://pricing.com",
        effectiveUrl: "https://pricing.com",
        collectionStart: "2026-07-01",
        collectionEnd: "2026-07-28",
        fetchedAt: "2026-07-29T00:00:00.000Z",
        lcpP75Ms: 4_300,
        inpP75Ms: null,
        clsP75: 0.05,
        ttfbP75Ms: null,
        metrics: {},
      }],
    }];

    const w = buildWatcher([watched], [cls, lcp], "mobile", 30, undefined, undefined, visitorEvidence);
    expect(w).toMatchObject({ fieldCorroborated: 1, fieldOnly: 0 });
    expect(w.topRec).toMatchObject({ recTitle: "Fix LCP", evidenceLabel: "Visitor corroborated" });
    expect(w.changed.some((bullet) => bullet.text === "has visitor issues reproduced in Lighthouse.")).toBe(true);
  });

  it("does not count origin-wide evidence as a page-level Watcher issue", () => {
    const watched = page("pricing", good, { ...good, perf: 50 });
    watched.history[1].measurementContext = { mobile: { medianLargestContentfulPaint: 4_500 } };
    const originEvidence: CruxPageEvidence[] = [{
      pageId: "pricing",
      formFactor: "PHONE",
      status: null,
      snapshots: [{
        formFactor: "PHONE",
        scope: "origin",
        requestedUrl: "https://pricing.com",
        effectiveUrl: "https://pricing.com",
        collectionStart: "2026-07-01",
        collectionEnd: "2026-07-28",
        fetchedAt: "2026-07-29T00:00:00.000Z",
        lcpP75Ms: 4_300,
        inpP75Ms: null,
        clsP75: null,
        ttfbP75Ms: null,
        metrics: {},
      }],
    }];

    const w = buildWatcher([watched], [], "mobile", 30, undefined, undefined, originEvidence);
    expect(w).toMatchObject({ fieldCorroborated: 0, fieldOnly: 0 });
    expect(w.changed).not.toContainEqual(expect.objectContaining({ text: "has visitor issues reproduced in Lighthouse." }));
  });

  it("does not recommend a synthetic field investigation while recovery is verifying", () => {
    const inactive = {
      ...rec("crux-field-only-lcp", "Field signal", "inbox", "todo"),
      source: "crux-field-only" as const,
      fieldLifecycle: {
        mobile: {
          status: "verifying" as const,
          firstDetectedAt: "2026-07-28T00:00:00.000Z",
          lastDetectedAt: "2026-07-28T00:00:00.000Z",
          lastEvaluatedCollectionEnd: "2026-08-04",
          consecutiveGoodWindows: 1,
        },
      },
    };
    const fallback = { ...rec("uses-responsive-images", "0.4 s", "inbox", "todo"), title: "Resize images" };
    const w = buildWatcher([focus], [inactive, fallback], "mobile");
    expect(w.topRec?.recTitle).toBe("Resize images");
  });
});

describe("buildWatcher — actionable counts", () => {
  it("separates regression trend from absolute quality and agent gaps", () => {
    const current: ScoreByCategory = { perf: 50, a11y: 95, bp: 80, seo: 95 };
    const watched = page("pricing", good, current);
    watched.agent = [
      { name: "robots.txt", group: "Discoverability", pass: true },
      { name: "WebMCP", group: "API / Auth / MCP", pass: false },
    ];

    const w = buildWatcher([watched], [], "mobile");
    expect(w).toMatchObject({
      total: 1,
      stable: 0,
      improving: 0,
      regressing: 1,
      lowPerformance: 1,
      agentGaps: 1,
      qualityIssues: 1,
    });
  });

  it("does not count an ignored failure as an agent gap", () => {
    const watched = page("pricing", good, good);
    watched.agent = [
      { name: "robots.txt", group: "Discoverability", pass: true },
      { name: "WebMCP", group: "API / Auth / MCP", pass: false },
    ];
    watched.agentIgnores = { checks: [], groups: ["API / Auth / MCP"] };

    expect(buildWatcher([watched], [], "mobile").agentGaps).toBe(0);
  });

  it("uses metric-specific cutoffs for Lighthouse quality issues", () => {
    const watched = page("quality", good, { ...good, bp: 80 });
    expect(buildWatcher([watched], [], "mobile").qualityIssues).toBe(1);
    expect(buildWatcher([watched], [], "mobile", 30, undefined, { bestPractices: 75 }).qualityIssues).toBe(0);
  });

  it("applies global ignores unless the page explicitly restores the check", () => {
    const watched = page("pricing", good, good);
    watched.agent = [{ name: "WebMCP", group: "API / Auth / MCP", pass: false }];
    const defaults = { checks: [], groups: ["API / Auth / MCP"] };

    expect(buildWatcher([watched], [], "mobile", 30, defaults).agentGaps).toBe(0);

    watched.agentIgnoreRestores = { checks: [agentCheckKey(watched.agent[0])], groups: [] };
    expect(buildWatcher([watched], [], "mobile", 30, defaults).agentGaps).toBe(1);
  });

  it("excludes paused pages without removing their stored history", () => {
    const active = page("active", good, good);
    const paused = page("paused", good, { ...good, perf: 40 });
    paused.flag = "paused";
    const storedNights = paused.history.length;

    const summary = buildWatcher([active, paused], [], "mobile");

    expect(summary.total).toBe(1);
    expect(summary.regressing).toBe(0);
    expect(paused.history).toHaveLength(storedNights);
  });
});
