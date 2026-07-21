import { describe, expect, it } from "vitest";
import { plottedSparklineSeries } from "../charting";

describe("plottedSparklineSeries", () => {
  it("turns one unchanged observation into a flat two-point line", () => {
    expect(plottedSparklineSeries([42])).toEqual([42, 42]);
  });

  it("preserves real multi-collection movement", () => {
    expect(plottedSparklineSeries([42, 40, 44])).toEqual([42, 40, 44]);
  });
});
