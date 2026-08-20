import { describe, expect, it } from "vitest";
import { scoreCardDataForCategory, scoreCardScaledDataForCategory, scoreCardSeries } from "../scoreCardAdapter";
import type { CategoryScore, ChangeMarker, Night, NightScores, Strategy, StrategyScores, WatchPage } from "../types";

const cat = (m: number): CategoryScore => ({ m, lo: m - 2, hi: m + 2 });
const nightScores = (perf: number): NightScores => ({ perf: cat(perf), a11y: cat(95), bp: cat(95), seo: cat(95) });
const strat = (mobilePerf: number, desktopPerf: number): StrategyScores => ({
  mobile: nightScores(mobilePerf),
  desktop: nightScores(desktopPerf),
});
const night = (i: number, mobilePerf: number, desktopPerf: number, extra: Partial<Night> = {}): Night => ({
  i,
  date: `d${i}`,
  scores: strat(mobilePerf, desktopPerf),
  ...extra,
});

const NOW = Date.parse("2026-08-18T12:00:00.000Z");
const isoDaysAgo = (daysAgo: number) => new Date(NOW - daysAgo * 86_400_000).toISOString();

function page(history: Night[], overrides: Partial<WatchPage> = {}): WatchPage {
  return {
    history,
    markers: [],
    baseline: { mobile: { perf: cat(0), a11y: cat(0), bp: cat(0), seo: cat(0) }, desktop: { perf: cat(0), a11y: cat(0), bp: cat(0), seo: cat(0) } },
    baselineCapturedAt: isoDaysAgo(100),
    ...overrides,
  } as unknown as WatchPage;
}

describe("scoreCardSeries", () => {
  it("takes the median score per night for the requested strategy and category", () => {
    const history = [
      { ...night(0, 50, 80), iso: isoDaysAgo(2) },
      { ...night(1, 52, 82), iso: isoDaysAgo(1) },
      { ...night(2, 54, 84), iso: isoDaysAgo(0) },
    ];
    expect(scoreCardSeries(page(history), "desktop", "perf", 7, NOW)).toEqual([80, 82, 84]);
    expect(scoreCardSeries(page(history), "mobile", "perf", 7, NOW)).toEqual([50, 52, 54]);
  });

  it("responds to the selected date range, not a fixed point count", () => {
    // One collection per day; pageHistoryForRange's cutoff is inclusive, so a
    // `days`-day range covers `days + 1` daily points (today back through
    // `days` days ago) — the same boundary every other chart on this page
    // (Sparkline, HistoryChart) already relies on via pageHistoryForRange.
    const history = Array.from({ length: 30 }, (_, i) => ({
      ...night(i, i, i),
      iso: isoDaysAgo(29 - i),
    }));
    expect(scoreCardSeries(page(history), "desktop", "perf", 3, NOW)).toHaveLength(4);
    expect(scoreCardSeries(page(history), "desktop", "perf", 7, NOW)).toHaveLength(8);
    expect(scoreCardSeries(page(history), "desktop", "perf", 30, NOW)).toHaveLength(30);
  });

  it("excludes nights quarantined as PSI anomalies", () => {
    const history = [
      { ...night(0, 50, 80), iso: isoDaysAgo(2) },
      { ...night(1, 999, 999, { evidenceStatus: "provider-anomaly" }), iso: isoDaysAgo(1) },
      { ...night(2, 54, 84), iso: isoDaysAgo(0) },
    ];
    expect(scoreCardSeries(page(history), "desktop", "perf", 7, NOW)).toEqual([80, 84]);
  });

  it("excludes nights where the requested strategy did not run", () => {
    const history = [
      { ...night(0, 50, 80), iso: isoDaysAgo(2) },
      { ...night(1, 60, 90), iso: isoDaysAgo(1), availableStrategies: ["mobile"] as Strategy[] },
      { ...night(2, 54, 84), iso: isoDaysAgo(0) },
    ];
    expect(scoreCardSeries(page(history), "desktop", "perf", 7, NOW)).toEqual([80, 84]);
  });

  it("returns nothing before a baseline has been captured", () => {
    const history = [{ ...night(0, 50, 80), iso: isoDaysAgo(0) }];
    expect(scoreCardSeries(page(history, { baseline: undefined, baselineCapturedAt: undefined }), "desktop", "perf", 7, NOW)).toEqual([]);
  });
});

describe("scoreCardDataForCategory", () => {
  it("builds paired desktop/mobile series with the given title, scoped to the range", () => {
    const history = [
      { ...night(0, 50, 80), iso: isoDaysAgo(1) },
      { ...night(1, 52, 82), iso: isoDaysAgo(0) },
    ];
    const data = scoreCardDataForCategory(page(history), "perf", "Performance", 7, NOW);
    expect(data.title).toBe("Performance");
    expect(data.desktop).toEqual([80, 82]);
    expect(data.mobile).toEqual([50, 52]);
  });
});

describe("scoreCardScaledDataForCategory", () => {
  it("carries the real run-to-run range per plotted point (medium/large's range band)", () => {
    const history = [
      { ...night(0, 50, 80), iso: isoDaysAgo(1) },
      { ...night(1, 52, 82), iso: isoDaysAgo(0) },
    ];
    const data = scoreCardScaledDataForCategory(page(history), "perf", "Performance", 7, NOW);
    expect(data.desktopRange).toEqual([{ lo: 78, hi: 82 }, { lo: 80, hi: 84 }]);
    expect(data.mobileRange).toEqual([{ lo: 48, hi: 52 }, { lo: 50, hi: 54 }]);
  });

  it("includes quarantined nights in the series and flags them untrusted, instead of excluding them like the small/xsmall adapter", () => {
    const history = [
      { ...night(0, 50, 80), iso: isoDaysAgo(2) },
      { ...night(1, 999, 999, { evidenceStatus: "provider-anomaly" as const }), iso: isoDaysAgo(1) },
      { ...night(2, 54, 84), iso: isoDaysAgo(0) },
    ];
    const data = scoreCardScaledDataForCategory(page(history), "perf", "Performance", 7, NOW);
    expect(data.desktop).toEqual([80, 999, 84]);
    expect(data.desktopTrusted).toEqual([true, false, true]);
    expect(data.mobileTrusted).toEqual([true, false, true]);
  });

  it("resolves each page marker to its index in the rendered window and carries its task/custom kind", () => {
    const history = [
      { ...night(0, 50, 80), iso: isoDaysAgo(2) },
      { ...night(1, 52, 82), iso: isoDaysAgo(1) },
      { ...night(2, 54, 84), iso: isoDaysAgo(0) },
    ];
    const markers: ChangeMarker[] = [
      { id: "m1", i: 1, date: "d1", text: "Compressed hero imagery", source: "custom" },
      { id: "m2", i: 2, date: "d2", text: "Completed: Reduce unused JS", source: "task", recKey: "r1" },
    ];
    const data = scoreCardScaledDataForCategory(page(history, { markers }), "perf", "Performance", 7, NOW);
    expect(data.markers).toEqual([
      { index: 1, text: "Compressed hero imagery", isTask: false },
      { index: 2, text: "Completed: Reduce unused JS", isTask: true },
    ]);
  });

  it("drops a marker whose night fell outside the rendered window", () => {
    const history = [{ ...night(5, 50, 80), iso: isoDaysAgo(0) }];
    const markers: ChangeMarker[] = [{ id: "m1", i: 2, date: "d2", text: "Old marker", source: "custom" }];
    const data = scoreCardScaledDataForCategory(page(history, { markers }), "perf", "Performance", 7, NOW);
    expect(data.markers).toEqual([]);
  });
});
