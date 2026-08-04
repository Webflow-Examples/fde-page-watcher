import { describe, expect, it } from "vitest";
import { formatHistoryTooltipDate, placeMarkerLabelRows, plottedSparklineSeries, snappedHistoryIndex, trustedHistorySegments } from "../charting";
import type { Night } from "../types";

describe("plottedSparklineSeries", () => {
  it("turns one unchanged observation into a flat two-point line", () => {
    expect(plottedSparklineSeries([42])).toEqual([42, 42]);
  });

  it("preserves real multi-collection movement", () => {
    expect(plottedSparklineSeries([42, 40, 44])).toEqual([42, 40, 44]);
  });
});

describe("snappedHistoryIndex", () => {
  it("snaps across the chart's drawable width", () => {
    expect(snappedHistoryIndex(38, 900, 7)).toBe(0);
    expect(snappedHistoryIndex(459, 900, 7)).toBe(3);
    expect(snappedHistoryIndex(880, 900, 7)).toBe(6);
  });

  it("clamps pointers outside the plot", () => {
    expect(snappedHistoryIndex(-20, 900, 7)).toBe(0);
    expect(snappedHistoryIndex(940, 900, 7)).toBe(6);
  });
});

describe("formatHistoryTooltipDate", () => {
  it("expands compact dates and adds the ordinal suffix", () => {
    expect(formatHistoryTooltipDate("Jul 23")).toBe("July 23rd");
    expect(formatHistoryTooltipDate("Jul 11")).toBe("July 11th");
  });

  it("uses an ISO timestamp when the display label is not parseable", () => {
    expect(formatHistoryTooltipDate("collection 24", "2026-07-24T03:00:00.000Z")).toBe("July 24th");
  });
});

describe("placeMarkerLabelRows", () => {
  it("keeps marker labels in bounds and away from reference-label rows", () => {
    const rows = placeMarkerLabelRows(3, [29, 57], 29, 113);

    expect(rows).toHaveLength(3);
    expect(rows.every((row) => row >= 29 && row <= 113)).toBe(true);
    expect(new Set(rows).size).toBe(3);
    for (const row of rows) {
      expect(Math.abs(row - 29)).toBeGreaterThanOrEqual(14);
      expect(Math.abs(row - 57)).toBeGreaterThanOrEqual(14);
    }
  });
});

describe("trustedHistorySegments", () => {
  const score = (value: number) => ({ m: value, lo: value, hi: value });
  const night = (i: number, evidenceStatus?: Night["evidenceStatus"]): Night => ({
    i,
    date: `Aug ${i + 1}`,
    evidenceStatus,
    scores: {
      mobile: { perf: score(80), a11y: score(90), bp: score(90), seo: score(90) },
      desktop: { perf: score(80), a11y: score(90), bp: score(90), seo: score(90) },
    },
  });

  it("creates a visible line break around quarantined PSI measurements", () => {
    const segments = trustedHistorySegments([
      night(0),
      night(1, "provider-anomaly"),
      night(2, "provider-anomaly"),
      night(3),
    ]);

    expect(segments.map((segment) => segment.map((item) => item.i))).toEqual([[0], [3]]);
  });
});
