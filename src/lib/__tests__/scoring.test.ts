import { describe, it, expect } from "vitest";
import { median, range, noiseBand, classifyStatus, DROP_THRESHOLD } from "../scoring";
import type { CategoryScore, Night, NightScores, ScoreByCategory, StrategyScores } from "../types";

const cat = (m: number): CategoryScore => ({ m, lo: m - 2, hi: m + 2 });
const nightScores = (perf: number): NightScores => ({ perf: cat(perf), a11y: cat(95), bp: cat(95), seo: cat(95) });
const strat = (perf: number): StrategyScores => ({ mobile: nightScores(perf), desktop: nightScores(perf) });
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

describe("classifyStatus", () => {
  const base: ScoreByCategory = { perf: 80, a11y: 95, bp: 95, seo: 95 };
  it("is healthy when the latest night is within the noise band", () => {
    const hist = [night(0, 80), night(1, 79), night(2, 80)];
    expect(classifyStatus(base, hist, "mobile")).toBe("healthy");
  });
  it("is degraded when the drop persists across the last two nights", () => {
    const hist = [night(0, 80), night(1, 80 - DROP_THRESHOLD - 2), night(2, 80 - DROP_THRESHOLD - 3)];
    expect(classifyStatus(base, hist, "mobile")).toBe("degraded");
  });
  it("is improvable for a single-night dip beyond the band but not persistent", () => {
    // flat history => band floors at 4; last night drops 5 (> band) while the
    // prior night is still at baseline, so it isn't a persistent (degraded) drop
    const hist = [night(0, 80), night(1, 80), night(2, 80), night(3, 75)];
    expect(classifyStatus(base, hist, "mobile")).toBe("improvable");
  });
  it("is healthy with no history", () => {
    expect(classifyStatus(base, [], "mobile")).toBe("healthy");
  });
});
