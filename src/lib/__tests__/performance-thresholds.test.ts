import { describe, expect, it } from "vitest";
import {
  DEFAULT_PERFORMANCE_THRESHOLDS,
  normalizePerformanceThresholds,
  performanceThresholdsAreValid,
} from "../performanceThresholds";

describe("performance thresholds", () => {
  it("normalizes missing and out-of-range persisted values", () => {
    expect(normalizePerformanceThresholds()).toEqual(DEFAULT_PERFORMANCE_THRESHOLDS);
    expect(normalizePerformanceThresholds({
      lowPerformance: 120,
      regression: -2,
      improvement: 99,
      confirmationRuns: 8,
      devicePolicy: "both",
      accessibility: 0,
      bestPractices: 101,
      seo: 72,
      regressionFloor: 0,
      agentReadiness: 101,
      newPageGraceRuns: -1,
    })).toEqual({
      lowPerformance: 100,
      regression: 1,
      improvement: 50,
      confirmationRuns: 5,
      devicePolicy: "both",
      accessibility: 1,
      bestPractices: 100,
      seo: 72,
      regressionFloor: 1,
      agentReadiness: 100,
      newPageGraceRuns: 0,
    });
  });

  it("accepts only supported whole-number settings", () => {
    expect(performanceThresholdsAreValid(DEFAULT_PERFORMANCE_THRESHOLDS)).toBe(true);
    expect(performanceThresholdsAreValid({ ...DEFAULT_PERFORMANCE_THRESHOLDS, lowPerformance: 70.5 })).toBe(false);
    expect(performanceThresholdsAreValid({ ...DEFAULT_PERFORMANCE_THRESHOLDS, confirmationRuns: 0 })).toBe(false);
    expect(performanceThresholdsAreValid({ ...DEFAULT_PERFORMANCE_THRESHOLDS, devicePolicy: "unexpected" as "either" })).toBe(false);
    expect(performanceThresholdsAreValid({ lowPerformance: 70, regression: 5 })).toBe(false);
  });
});
