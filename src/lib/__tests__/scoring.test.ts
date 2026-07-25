import { describe, it, expect } from "vitest";
import { median, range, noiseBand, classifyStatus, categoryTrendSeries, hasPersistentRegression, historyForPreviousRange, historyForRange, pagePreviousPeriodMedian, pageRangeTrend, previousPeriodMedian, rangeComparison, DROP_THRESHOLD } from "../scoring";
import type { CategoryScore, Night, NightScores, ScoreByCategory, StrategyScores, WatchPage } from "../types";

const cat = (m: number): CategoryScore => ({ m, lo: m - 2, hi: m + 2 });
const nightScores = (perf: number): NightScores => ({ perf: cat(perf), a11y: cat(95), bp: cat(95), seo: cat(95) });
const strat = (perf: number): StrategyScores => ({ mobile: nightScores(perf), desktop: nightScores(perf) });
const dualStrat = (mobile: number, desktop: number): StrategyScores => ({ mobile: nightScores(mobile), desktop: nightScores(desktop) });
const night = (i: number, perf: number): Night => ({ i, date: `d${i}`, scores: strat(perf) });

describe("median / range", () => {
  it("returns the middle value for odd counts", () => {
    expect(median([70, 60, 80])).toBe(70);
  });
  it("averages the two middle values for even counts", () => {
    expect(median([60, 70, 80, 90])).toBe(75);
  });
  it("returns 0 for an empty array", () => {
    expect(median([])).toBe(0);
  });
  it("range reports lo and hi", () => {
    expect(range([70, 60, 80])).toEqual({ lo: 60, hi: 80 });
  });
});

describe("noiseBand", () => {
  it("floors at 4 for a flat history", () => {
    const hist = [night(0, 70), night(1, 70), night(2, 70)];
    expect(noiseBand(hist, "mobile", "perf")).toBe(4);
  });
  it("returns 5 with fewer than two nights", () => {
    expect(noiseBand([night(0, 70)], "mobile", "perf")).toBe(5);
  });
  it("is 2x the mean night-to-night movement when that exceeds the floor", () => {
    // moves: 10, 10 -> mean 10 -> 2x = 20
    const hist = [night(0, 50), night(1, 60), night(2, 70)];
    expect(noiseBand(hist, "mobile", "perf")).toBe(20);
  });
});

describe("categoryTrendSeries", () => {
  it("starts live status charts at the explicit baseline", () => {
    const history = [
      { ...night(0, 30), iso: "2026-07-21T22:00:00.000Z" },
      { ...night(1, 42), iso: "2026-07-21T22:10:00.000Z" },
      { ...night(2, 40), iso: "2026-07-22T22:10:00.000Z" },
    ];
    expect(categoryTrendSeries(history, "mobile", "perf", 7, 42, "2026-07-21T22:10:00.000Z")).toEqual([42, 40]);
  });

  it("returns only the baseline when no later collection exists", () => {
    const history = [{ ...night(0, 42), iso: "2026-07-21T22:10:00.000Z" }];
    expect(categoryTrendSeries(history, "mobile", "perf", 7, 42, "2026-07-21T22:10:00.000Z")).toEqual([42]);
  });

  it("keeps the baseline anchor when the compact chart reaches its point limit", () => {
    const history = Array.from({ length: 9 }, (_, index) => ({
      ...night(index, 40 + index),
      iso: `2026-07-${String(21 + index).padStart(2, "0")}T22:10:00.000Z`,
    }));
    expect(categoryTrendSeries(history, "mobile", "perf", 3, 42, "2026-07-21T22:10:00.000Z")).toEqual([42, 47, 48]);
  });

  it("retains undated demo history", () => {
    const history = [night(0, 30), night(1, 42)];
    expect(categoryTrendSeries(history, "mobile", "perf", 7, 42, "Jun 17")).toEqual([30, 42]);
  });
});

describe("selected range comparisons", () => {
  it("filters live history to the requested calendar range", () => {
    const history = [
      { ...night(0, 60), iso: "2026-07-01T00:00:00.000Z" },
      { ...night(1, 70), iso: "2026-07-18T00:00:00.000Z" },
      { ...night(2, 75), iso: "2026-07-20T00:00:00.000Z" },
    ];
    expect(historyForRange(history, 3, Date.parse("2026-07-21T00:00:00.000Z")).map((item) => item.i)).toEqual([1, 2]);
  });

  it("compares non-overlapping medians at the beginning and end", () => {
    const history = [night(0, 80), night(1, 81), night(2, 79), night(3, 70), night(4, 69), night(5, 71)];
    expect(rangeComparison(history, "mobile", "perf")).toMatchObject({ from: 80, to: 70, delta: -10, windowSize: 3 });
  });

  it("calculates mobile and desktop trends independently", () => {
    const history: Night[] = [
      { i: 0, date: "d0", scores: dualStrat(50, 80) },
      { i: 1, date: "d1", scores: dualStrat(50, 78) },
      { i: 2, date: "d2", scores: dualStrat(50, 70) },
      { i: 3, date: "d3", scores: dualStrat(50, 65) },
    ];
    const page: WatchPage = {
      id: "devices",
      title: "Devices",
      url: "https://example.com",
      flag: "priority",
      status: "stable",
      baseline: dualStrat(50, 80),
      baselineCapturedAt: "Jun 17",
      current: { mobile: { perf: 50, a11y: 95, bp: 95, seo: 95 }, desktop: { perf: 65, a11y: 95, bp: 95, seo: 95 } },
      history,
      markers: [],
      agent: [],
    };
    expect(pageRangeTrend(page, "mobile", 3)).toBe("stable");
    expect(pageRangeTrend(page, "desktop", 3)).toBe("regressing");
  });
});

describe("previous period medians", () => {
  it("uses the immediately preceding non-overlapping live range", () => {
    const history = Array.from({ length: 7 }, (_, index) => ({
      ...night(index, 60 + index),
      iso: `2026-07-${String(14 + index).padStart(2, "0")}T00:00:00.000Z`,
    }));
    const now = Date.parse("2026-07-21T00:00:00.000Z");

    expect(historyForPreviousRange(history, 3, now).map((item) => item.i)).toEqual([1, 2, 3]);
    expect(previousPeriodMedian(history, "mobile", "perf", 3, now)).toEqual({
      value: 62,
      sampleCount: 3,
      days: 3,
    });
  });

  it("requires at least one successful scan for every day in the selected range", () => {
    const history = [
      { ...night(0, 70), iso: "2026-07-15T00:00:00.000Z" },
      { ...night(1, 72), iso: "2026-07-16T00:00:00.000Z" },
      { ...night(2, 80), iso: "2026-07-19T00:00:00.000Z" },
    ];

    expect(previousPeriodMedian(history, "mobile", "perf", 3, Date.parse("2026-07-21T00:00:00.000Z"))).toBeNull();
  });

  it("uses preceding scans for undated demo history", () => {
    const history = Array.from({ length: 8 }, (_, index) => night(index, 50 + index));
    expect(previousPeriodMedian(history, "mobile", "perf", 3)).toEqual({
      value: 53,
      sampleCount: 3,
      days: 3,
    });
  });

  it("calculates mobile and desktop references independently", () => {
    const history: Night[] = Array.from({ length: 6 }, (_, index) => ({
      i: index,
      date: `d${index}`,
      scores: dualStrat(50 + index, 80 + index),
    }));
    const page: WatchPage = {
      id: "devices",
      title: "Devices",
      url: "https://example.com",
      flag: "watching",
      status: "stable",
      baseline: dualStrat(50, 80),
      baselineCapturedAt: "Jun 17",
      current: { mobile: { perf: 55, a11y: 95, bp: 95, seo: 95 }, desktop: { perf: 85, a11y: 95, bp: 95, seo: 95 } },
      history,
      markers: [],
      agent: [],
    };

    expect(pagePreviousPeriodMedian(page, "mobile", "perf", 3)?.value).toBe(51);
    expect(pagePreviousPeriodMedian(page, "desktop", "perf", 3)?.value).toBe(81);
  });
});

describe("classifyStatus", () => {
  const base: ScoreByCategory = { perf: 80, a11y: 95, bp: 95, seo: 95 };
  it("is stable when the latest night is within the noise band", () => {
    const hist = [night(0, 80), night(1, 79), night(2, 80)];
    expect(classifyStatus(base, hist, "mobile")).toBe("stable");
  });
  it("is improving when the latest night rises beyond the noise band", () => {
    const hist = [night(0, 80), night(1, 80), night(2, 80), night(3, 87)];
    expect(classifyStatus(base, hist, "mobile")).toBe("improving");
  });
  it("uses the default point tolerance for regressions", () => {
    const hist = [night(0, 80), night(1, 80), night(2, 80), night(3, 71)];
    expect(classifyStatus(base, hist, "mobile")).toBe("regressing");
    expect(classifyStatus(base, [night(0, 80), night(1, 75)], "mobile")).toBe("stable");
  });
  it("accepts a custom regression tolerance", () => {
    const hist = [night(0, 80), night(1, 75)];
    expect(classifyStatus(base, hist, "mobile", "perf", 5)).toBe("regressing");
  });
  it("requires the configured improvement threshold in addition to clearing noise", () => {
    const hist = [night(0, 80), night(1, 80), night(2, 87)];
    expect(classifyStatus(base, hist, "mobile", "perf", { improvement: 10 })).toBe("stable");
    expect(classifyStatus(base, hist, "mobile", "perf", { improvement: 7 })).toBe("improving");
  });
  it("requires consecutive regression confirmations", () => {
    const oneDrop = [night(0, 80), night(1, 70)];
    const twoDrops = [night(0, 80), night(1, 70), night(2, 69)];
    const tolerances = { regression: 8, confirmationRuns: 2 };
    expect(classifyStatus(base, oneDrop, "mobile", "perf", tolerances)).toBe("stable");
    expect(classifyStatus(base, twoDrops, "mobile", "perf", tolerances)).toBe("regressing");
  });
  it("suppresses regressions above the configured floor", () => {
    const highBase = { ...base, perf: 100 };
    const hist = [night(0, 100), night(1, 94)];
    expect(classifyStatus(highBase, hist, "mobile", "perf", { regression: 5, regressionFloor: 90 })).toBe("stable");
    expect(classifyStatus(highBase, hist, "mobile", "perf", { regression: 5, regressionFloor: 100 })).toBe("regressing");
  });
  it("keeps new pages pending during their grace period", () => {
    const oneDrop = [night(0, 70)];
    const twoDrops = [night(0, 70), night(1, 69)];
    const tolerances = { regression: 8, newPageGraceRuns: 2 };
    expect(classifyStatus(base, oneDrop, "mobile", "perf", tolerances)).toBe("pending");
    expect(classifyStatus(base, twoDrops, "mobile", "perf", tolerances)).toBe("regressing");
  });
  it("is stable with no history", () => {
    expect(classifyStatus(base, [], "mobile")).toBe("stable");
  });
  it("keeps the stricter consecutive-drop rule for alerts", () => {
    const hist = [night(0, 80), night(1, 80 - DROP_THRESHOLD - 2), night(2, 80 - DROP_THRESHOLD - 3)];
    expect(hasPersistentRegression(base, hist, "mobile")).toBe(true);
    expect(hasPersistentRegression(base, [night(0, 80), night(1, 80 - DROP_THRESHOLD - 2)], "mobile")).toBe(false);
  });
});
