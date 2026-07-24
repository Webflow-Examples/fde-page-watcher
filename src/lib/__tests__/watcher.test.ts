import { describe, it, expect } from "vitest";
import { buildWatcher, buildWatcherCards } from "../watcher";
import { agentCheckKey } from "../agentScoring";
import type { CategoryScore, NightScores, Rec, ScoreByCategory, StrategyScores, WatchPage } from "../types";

const cat = (m: number): CategoryScore => ({ m, lo: m - 1, hi: m + 1 });
const ns = (s: ScoreByCategory): NightScores => ({ perf: cat(s.perf), a11y: cat(s.a11y), bp: cat(s.bp), seo: cat(s.seo) });
const strat = (s: ScoreByCategory): StrategyScores => ({ mobile: ns(s), desktop: ns(s) });

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
