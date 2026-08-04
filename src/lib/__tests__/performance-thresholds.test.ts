import { describe, expect, it } from "vitest";
import {
  DEFAULT_PERFORMANCE_THRESHOLDS,
  effectivePerformanceThresholds,
  normalizePerformanceThresholds,
  performanceThresholdOverridesAreValid,
  performanceThresholdsAreValid,
  recommendationMeetsEvidenceThresholds,
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
      minimumFindingRuns: 0,
      minimumSavingsMs: 9000,
      minimumSavingsKilobytes: -10,
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
      minimumFindingRuns: 1,
      minimumSavingsMs: 5000,
      minimumSavingsKilobytes: 0,
    });
  });

  it("accepts only supported whole-number settings", () => {
    expect(performanceThresholdsAreValid(DEFAULT_PERFORMANCE_THRESHOLDS)).toBe(true);
    expect(performanceThresholdsAreValid({ ...DEFAULT_PERFORMANCE_THRESHOLDS, lowPerformance: 70.5 })).toBe(false);
    expect(performanceThresholdsAreValid({ ...DEFAULT_PERFORMANCE_THRESHOLDS, confirmationRuns: 0 })).toBe(false);
    expect(performanceThresholdsAreValid({ ...DEFAULT_PERFORMANCE_THRESHOLDS, devicePolicy: "unexpected" as "either" })).toBe(false);
    expect(performanceThresholdsAreValid({ lowPerformance: 70, regression: 5 })).toBe(false);
  });

  it("layers sparse page calibration over normalized team defaults", () => {
    expect(effectivePerformanceThresholds(
      { ...DEFAULT_PERFORMANCE_THRESHOLDS, regression: 8, confirmationRuns: 2 },
      { regression: 14, devicePolicy: "both" },
    )).toMatchObject({ regression: 14, confirmationRuns: 2, devicePolicy: "both" });
    expect(performanceThresholdOverridesAreValid({ regression: 14, minimumFindingRuns: 3 })).toBe(true);
    expect(performanceThresholdOverridesAreValid({ regression: 0 })).toBe(false);
    expect(performanceThresholdOverridesAreValid({ mystery: 2 })).toBe(false);
  });

  it("gates only quantified recommendations and preserves structural findings", () => {
    const thresholds = { ...DEFAULT_PERFORMANCE_THRESHOLDS, minimumFindingRuns: 3, minimumSavingsMs: 250, minimumSavingsKilobytes: 50 };
    expect(recommendationMeetsEvidenceThresholds({ savingsMs: 500, observedRuns: 3 }, thresholds)).toBe(true);
    expect(recommendationMeetsEvidenceThresholds({ savingsMs: 120, savingsBytes: 80 * 1024, observedRuns: 3 }, thresholds)).toBe(true);
    expect(recommendationMeetsEvidenceThresholds({ savingsMs: 120, savingsBytes: 20 * 1024, observedRuns: 3 }, thresholds)).toBe(false);
    expect(recommendationMeetsEvidenceThresholds({ savingsMs: 500, observedRuns: 2 }, thresholds)).toBe(false);
    expect(recommendationMeetsEvidenceThresholds({ savingsMs: 0, savingsBytes: 0, observedRuns: 3 }, thresholds)).toBe(true);
    expect(recommendationMeetsEvidenceThresholds({ savingsMs: 1, observedRuns: 1, category: "Native elements" }, thresholds)).toBe(true);
  });
});
