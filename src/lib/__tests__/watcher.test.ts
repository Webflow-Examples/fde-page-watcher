import { describe, it, expect } from "vitest";
import { buildWatcher } from "../watcher";
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
  it("omits filter context already shown elsewhere in the summary", () => {
    const regression = page("customers", good, { ...good, perf: 60 });
    regression.markers = [{ id: "launch", i: 1, date: "Jul 21", text: "CMS launch" }];
    const improvement = page("homepage", good, { ...good, perf: 92 });

    const w = buildWatcher([regression, improvement], [], "desktop", 3);

    expect(w.changed.find((bullet) => bullet.lead === "customers")?.text).toBe("fell 20 points.");
    expect(w.changed.find((bullet) => bullet.lead === "homepage")?.text).toBe("gained 12 points.");
  });
});

describe("buildWatcher — Accessibility/SEO truthfulness", () => {
  it("claims stability only when both categories actually held", () => {
    const pages = [page("home", good, good)];
    const w = buildWatcher(pages, [], "mobile");
    expect(w.changed.some((b) => /Accessibility and SEO are stable/.test(b.text))).toBe(true);
  });

  it("names a category that dropped instead of asserting stability", () => {
    const dropped: ScoreByCategory = { ...good, a11y: 80 }; // 95 -> 80, well past the threshold
    const pages = [page("home", good, dropped)];
    const w = buildWatcher(pages, [], "mobile");
    expect(w.changed.some((b) => /dropped on Accessibility/.test(b.text))).toBe(true);
    // SEO held, so it is still reported stable on its own
    expect(w.changed.some((b) => /SEO is stable/.test(b.text))).toBe(true);
    expect(w.changed.some((b) => /Accessibility and SEO are stable/.test(b.text))).toBe(false);
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
