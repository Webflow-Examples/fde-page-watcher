import { describe, expect, it } from "vitest";
import { formatHistoryTooltipDate, plottedSparklineSeries, snappedHistoryIndex } from "../charting";

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
