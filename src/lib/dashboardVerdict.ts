import type { PageStatus } from "./types";

export interface CombinedDashboardSignals {
  mobileLowPerformance: boolean;
  desktopLowPerformance: boolean;
  mobileRegression: boolean;
  desktopRegression: boolean;
  mobileImprovement: boolean;
  desktopImprovement: boolean;
  lowPerformance: boolean;
  regressions: boolean;
  improvements: boolean;
}

export function combinedDashboardSignals({
  isMonitored,
  mobilePerformance,
  desktopPerformance,
  lowPerformanceThreshold,
  mobileTrend,
  desktopTrend,
}: {
  isMonitored: boolean;
  mobilePerformance: number | null;
  desktopPerformance: number | null;
  lowPerformanceThreshold: number;
  mobileTrend: PageStatus;
  desktopTrend: PageStatus;
}): CombinedDashboardSignals {
  if (!isMonitored) {
    return {
      mobileLowPerformance: false,
      desktopLowPerformance: false,
      mobileRegression: false,
      desktopRegression: false,
      mobileImprovement: false,
      desktopImprovement: false,
      lowPerformance: false,
      regressions: false,
      improvements: false,
    };
  }

  const mobileLowPerformance = mobilePerformance !== null
    && mobilePerformance < lowPerformanceThreshold;
  const desktopLowPerformance = desktopPerformance !== null
    && desktopPerformance < lowPerformanceThreshold;
  const mobileRegression = mobileTrend === "regressing";
  const desktopRegression = desktopTrend === "regressing";
  const mobileImprovement = mobileTrend === "improving";
  const desktopImprovement = desktopTrend === "improving";

  return {
    mobileLowPerformance,
    desktopLowPerformance,
    mobileRegression,
    desktopRegression,
    mobileImprovement,
    desktopImprovement,
    lowPerformance: mobileLowPerformance || desktopLowPerformance,
    regressions: mobileRegression || desktopRegression,
    improvements: mobileImprovement || desktopImprovement,
  };
}
