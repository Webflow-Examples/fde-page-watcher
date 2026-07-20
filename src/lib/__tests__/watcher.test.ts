import { describe, it, expect } from "vitest";
import { buildWatcher } from "../watcher";
import type { CategoryScore, NightScores, Rec, ScoreByCategory, StrategyScores, WatchPage } from "../types";

const cat = (m: number): CategoryScore => ({ m, lo: m - 1, hi: m + 1 });
const ns = (s: ScoreByCategory): NightScores => ({ perf: cat(s.perf), a11y: cat(s.a11y), bp: cat(s.bp), seo: cat(s.seo) });
const strat = (s: ScoreByCategory): StrategyScores => ({ mobile: ns(s), desktop: ns(s) });

function page(id: string, baseline: ScoreByCategory, current: ScoreByCategory, status: WatchPage["status"] = "healthy"): WatchPage {
  return {
    id,
    title: id,
    url: `${id}.com`,
    flag: "priority",
    status,
    baseline: strat(baseline),
    current: { mobile: current, desktop: current },
    history: [],
    markers: [],
    agent: [],
  };
}

const good: ScoreByCategory = { perf: 80, a11y: 95, bp: 95, seo: 95 };

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
  const focus = page("pricing", good, { ...good, perf: 50 }, "degraded");
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
