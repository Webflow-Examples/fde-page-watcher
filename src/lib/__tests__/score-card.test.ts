import { describe, expect, it } from "vitest";
import {
  bandColor,
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
  yFor,
} from "../scoreCard";

describe("domain", () => {
  it("pads only below the minimum, so the peak touches the top", () => {
    // lo=50, up=90 -> pad = (90-50)*0.14 = 5.6
    const [lo, up] = domain([50, 90]);
    expect(up).toBe(90);
    expect(lo).toBeCloseTo(44.4, 5);
  });

  it("falls back to a pad of 1 when every value is identical (up - lo === 0)", () => {
    const [lo, up] = domain([70, 70, 70]);
    expect(up).toBe(70);
    expect(lo).toBe(69);
  });

  it("considers desktop and mobile together as one shared domain", () => {
    const [lo, up] = domain([60, 95, 40, 88]);
    expect(up).toBe(95);
    // pad = (95-40)*0.14 = 7.7
    expect(lo).toBeCloseTo(32.3, 5);
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
