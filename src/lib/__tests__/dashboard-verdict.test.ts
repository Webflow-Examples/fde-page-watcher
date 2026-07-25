import { describe, expect, it } from "vitest";
import { combinedDashboardSignals } from "../dashboardVerdict";

const base = {
  isMonitored: true,
  mobilePerformance: 90,
  desktopPerformance: 90,
  lowPerformanceThreshold: 70,
  mobileTrend: "stable" as const,
  desktopTrend: "stable" as const,
};

describe("combinedDashboardSignals", () => {
  it("flags low performance when either device is below the threshold", () => {
    expect(combinedDashboardSignals({ ...base, mobilePerformance: 62 })).toMatchObject({
      mobileLowPerformance: true,
      desktopLowPerformance: false,
      lowPerformance: true,
    });
    expect(combinedDashboardSignals({ ...base, desktopPerformance: 62 })).toMatchObject({
      mobileLowPerformance: false,
      desktopLowPerformance: true,
      lowPerformance: true,
    });
  });

  it("combines regression and improvement signals across both devices", () => {
    expect(combinedDashboardSignals({ ...base, mobileTrend: "regressing" })).toMatchObject({
      mobileRegression: true,
      desktopRegression: false,
      regressions: true,
    });
    expect(combinedDashboardSignals({ ...base, desktopTrend: "improving" })).toMatchObject({
      mobileImprovement: false,
      desktopImprovement: true,
      improvements: true,
    });
  });

  it("ignores unavailable device scores", () => {
    expect(combinedDashboardSignals({
      ...base,
      mobilePerformance: null,
      desktopPerformance: 90,
    }).lowPerformance).toBe(false);
  });

  it("suppresses every condition for pages that are not actively monitored", () => {
    expect(combinedDashboardSignals({
      ...base,
      isMonitored: false,
      mobilePerformance: 40,
      desktopTrend: "regressing",
    })).toEqual({
      mobileLowPerformance: false,
      desktopLowPerformance: false,
      mobileRegression: false,
      desktopRegression: false,
      mobileImprovement: false,
      desktopImprovement: false,
      lowPerformance: false,
      regressions: false,
      improvements: false,
    });
  });
});
