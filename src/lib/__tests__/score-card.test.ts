import { describe, expect, it } from "vitest";
import {
  bandColor,
  bucketSeries,
  deltaColor,
  deltaFromStart,
  domain,
  hatchLineWidth,
  segmentLine,
  segmentRangeBand,
  seriesPaths,
  shownIndex,
  trustedIndexSegments,
  xFor,
  xsmallBounds,
  xsmallTargetPointCount,
  yFor,
} from "../scoreCard";

describe("domain", () => {
  it("pads only below the minimum, so the peak touches the top", () => {
    // lo=50, up=90 -> pad = (90-50)*0.14 = 5.6
    const [lo, up] = domain([50, 90]);
    expect(up).toBe(90);
    expect(lo).toBeCloseTo(44.4, 5);
  });

  it("widens to a 20-point span centered on the data when every value is identical", () => {
    const [lo, up] = domain([70, 70, 70]);
    expect(lo).toBe(60);
    expect(up).toBe(80);
  });

  it("considers desktop and mobile together as one shared domain", () => {
    const [lo, up] = domain([60, 95, 40, 88]);
    expect(up).toBe(95);
    // pad = (95-40)*0.14 = 7.7
    expect(lo).toBeCloseTo(32.3, 5);
  });

  it("widens a tight real spread to the 20-point floor, centered on the data", () => {
    // lo=95, up=97, span=2 < 20 -> mid=96, [86,106] -> clamp up to 100, shift lo by 6
    const [lo, up] = domain([95, 97]);
    expect(up).toBe(100);
    expect(lo).toBe(80);
  });

  it("clamps the widened floor to the valid 0-100 score range at the low end", () => {
    // lo=1, up=2, span=1 < 20 -> mid=1.5, [-8.5, 11.5] -> shift up by 8.5, clamp lo to 0
    const [lo, up] = domain([1, 2]);
    expect(lo).toBe(0);
    expect(up).toBe(20);
  });

  it("leaves a real spread of exactly 20 or more untouched by the floor", () => {
    const [lo, up] = domain([40, 60]);
    expect(up).toBe(60);
    // pad = (60-40)*0.14 = 2.8
    expect(lo).toBeCloseTo(37.2, 5);
  });
});

describe("xsmallBounds", () => {
  it("uses the fixed 32-point visible span (16px slot / 0.5 px-per-point), centered on the data", () => {
    // span=4, well under the 32-point visible span -> fixed-span branch: mid=89 +/- 16
    const [lo, up] = xsmallBounds([87, 91]);
    expect(lo).toBe(73);
    expect(up).toBe(105);
  });

  it("draws the same fixed span regardless of how tight the real spread is", () => {
    // a near-flat series still gets the full 32-point span, not a tighter per-series fit
    const [lo, up] = xsmallBounds([95, 97]);
    expect(lo).toBe(80);
    expect(up).toBe(112);
  });

  it("leaves a spread exactly at the visible span on the fixed-span branch (not overflow)", () => {
    const [lo, up] = xsmallBounds([50, 82]); // actual spread is exactly 32
    expect(lo).toBe(50);
    expect(up).toBe(82);
  });

  it("only falls back to fitting the series when its spread genuinely exceeds the visible span", () => {
    // actual spread 50 > 32 -> overflow branch, padded 8% of that spread (4) on each side
    const [lo, up] = xsmallBounds([40, 90]);
    expect(lo).toBe(36);
    expect(up).toBe(94);
  });
});

describe("xsmallTargetPointCount", () => {
  it("targets roughly one point per 3px of slot width", () => {
    expect(xsmallTargetPointCount(90)).toBe(30);
  });

  it("floors at 2 so a sparkline never collapses to a single point", () => {
    expect(xsmallTargetPointCount(3)).toBe(2);
    expect(xsmallTargetPointCount(0)).toBe(2);
  });
});

describe("bucketSeries", () => {
  it("is a no-op when the series already fits the target", () => {
    expect(bucketSeries([1, 2, 3], 5)).toEqual([1, 2, 3]);
  });

  it("collapses each bucket to its median, not its mean", () => {
    const values = [1, 2, 3, 10, 10, 99, 7, 8, 9];
    const result = bucketSeries(values, 3);
    // middle bucket is [10,10,99]; median 10, a mean would be ~39.7
    expect(result[1]).toBe(10);
  });

  it("always preserves the true first and last value, even after bucketing", () => {
    const values = [5, 40, 41, 42, 43, 44, 45, 46, 47, 99];
    const result = bucketSeries(values, 3);
    expect(result[0]).toBe(5);
    expect(result[result.length - 1]).toBe(99);
  });

  it("excludes untrusted nights from their bucket's median", () => {
    const values = [10, 10, 10, 90, 10, 10];
    const trusted = [true, true, true, false, true, true];
    const result = bucketSeries(values, 3, trusted);
    // middle bucket is indices [2,3]; index 3 (value 90) is untrusted and excluded,
    // leaving only [10] — a median including the 90 would be 50
    expect(result[1]).toBe(10);
  });

  it("an all-untrusted bucket inherits the previous bucket's computed value", () => {
    const values = [5, 15, 99, 99, 20, 30];
    const trusted = [true, true, false, false, true, true];
    const result = bucketSeries(values, 3, trusted);
    // bucket0 = [5,15] -> median 10; bucket1 has nothing trusted -> inherits 10
    expect(result[1]).toBe(10);
  });
});

describe("yFor", () => {
  it("maps the domain max to y=0 and the domain min to y=39", () => {
    const bounds: [number, number] = [40, 90];
    expect(yFor(90, bounds)).toBeCloseTo(0, 10);
    expect(yFor(40, bounds)).toBeCloseTo(39, 10);
  });

  it("maps the midpoint to half of the 0..39 span", () => {
    const bounds: [number, number] = [0, 100];
    expect(yFor(50, bounds)).toBeCloseTo(19.5, 10);
  });
});

describe("xFor", () => {
  it("spans the full 0..100 width across the last index", () => {
    expect(xFor(0, 23)).toBe(0);
    expect(xFor(23, 23)).toBe(100);
    expect(xFor(11.5, 23)).toBeCloseTo(50, 10);
  });

  it("anchors a single-point series at the left edge instead of producing NaN", () => {
    expect(xFor(0, 0)).toBe(0);
  });
});

describe("bandColor", () => {
  it("classifies score bands at their exact boundaries", () => {
    expect(bandColor(90)).toBe("#35D07F");
    expect(bandColor(89)).toBe("#FF9A3D");
    expect(bandColor(50)).toBe("#FF9A3D");
    expect(bandColor(49)).toBe("#FF5C6C");
    expect(bandColor(100)).toBe("#35D07F");
    expect(bandColor(0)).toBe("#FF5C6C");
  });
});

describe("deltaColor", () => {
  it("classifies delta chip colors independent of the score band", () => {
    expect(deltaColor(1)).toBe("#35D07F");
    expect(deltaColor(0)).toBe("#8A8A90");
    expect(deltaColor(-1)).toBe("#FF9A3D");
    expect(deltaColor(-7)).toBe("#FF9A3D");
    expect(deltaColor(-8)).toBe("#FF5C6C");
    expect(deltaColor(-20)).toBe("#FF5C6C");
  });
});

describe("hatchLineWidth", () => {
  it("matches the reference's spread-of-4 -> 1px line width", () => {
    expect(hatchLineWidth(4)).toBe(1);
  });

  it("floors spread at 3px before computing the line width", () => {
    expect(hatchLineWidth(1)).toBe(hatchLineWidth(3));
  });
});

describe("seriesPaths", () => {
  it("builds a line, closed area, and objectBoundingBox clip path", () => {
    const bounds = domain([50, 60, 90]);
    const paths = seriesPaths([50, 60, 90], bounds);
    expect(paths.line.startsWith("M ")).toBe(true);
    expect(paths.line).toContain(" L ");
    expect(paths.area.endsWith("L 100 40 L 0 40 Z")).toBe(true);
    expect(paths.clip.startsWith("M ")).toBe(true);
    expect(paths.clip.endsWith("L 1 1 L 0 1 Z")).toBe(true);
  });

  it("yPct reports the peak at 0% and the domain floor at 100%", () => {
    const bounds: [number, number] = [0, 100];
    const paths = seriesPaths([0, 100], bounds);
    expect(paths.yPct(100)).toBe("0%");
    expect(paths.yPct(0)).toBe("97.5%");
  });

  it("handles a single-point series (e.g. one collection in a short date range) without NaN", () => {
    const bounds = domain([72]);
    const paths = seriesPaths([72], bounds);
    expect(paths.line).not.toContain("NaN");
    expect(paths.area).not.toContain("NaN");
    expect(paths.clip).not.toContain("NaN");
  });
});

describe("shownIndex", () => {
  it("defaults to the last index when nothing is hovered", () => {
    expect(shownIndex(null, 23)).toBe(23);
  });

  it("uses the hovered index otherwise, including index 0", () => {
    expect(shownIndex(5, 23)).toBe(5);
    expect(shownIndex(0, 23)).toBe(0);
  });
});

describe("deltaFromStart", () => {
  it("is relative to the window start, not a fixed period", () => {
    const values = [80, 82, 84, 90];
    expect(deltaFromStart(values, 3)).toBe(10);
    expect(deltaFromStart(values, 1)).toBe(2);
    expect(deltaFromStart(values, 0)).toBe(0);
  });
});

describe("trustedIndexSegments", () => {
  it("treats every index as trusted when no flags are supplied", () => {
    expect(trustedIndexSegments(undefined, 4)).toEqual([[0, 1, 2, 3]]);
  });

  it("breaks into separate runs around a quarantined anomaly", () => {
    expect(trustedIndexSegments([true, true, false, true], 4)).toEqual([[0, 1], [3]]);
  });

  it("drops a leading or trailing anomaly run entirely rather than an empty segment", () => {
    expect(trustedIndexSegments([false, true, true], 3)).toEqual([[1, 2]]);
    expect(trustedIndexSegments([true, true, false], 3)).toEqual([[0, 1]]);
  });
});

describe("segmentLine", () => {
  it("plots only the given indices at their real x position in the shared domain", () => {
    const values = [50, 60, 999, 90];
    const bounds = domain([50, 60, 90]);
    const d = segmentLine(values, [0, 1], 3, bounds);
    expect(d.startsWith("M ")).toBe(true);
    // index 1 of 3 sits at x=100/3, not x=100 (which would imply it were the last of a 2-point segment).
    expect(d).toContain("33.33");
  });
});

describe("segmentRangeBand", () => {
  it("returns null when the segment has no real spread (near-flat single-run categories)", () => {
    const range = [{ lo: 95, hi: 95 }, { lo: 96, hi: 96 }];
    const bounds = domain([95, 96]);
    expect(segmentRangeBand(range, [0, 1], 1, bounds)).toBeNull();
  });

  it("draws a closed high-then-low polygon when at least one point has real spread", () => {
    const range = [{ lo: 55, hi: 65 }, { lo: 58, hi: 62 }];
    const bounds = domain([55, 65]);
    const d = segmentRangeBand(range, [0, 1], 1, bounds);
    expect(d).not.toBeNull();
    expect(d!.startsWith("M ")).toBe(true);
    expect(d!.endsWith("Z")).toBe(true);
  });
});
