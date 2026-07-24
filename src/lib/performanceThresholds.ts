import type { PerformanceThresholds } from "./types";

export const DEFAULT_PERFORMANCE_THRESHOLDS: PerformanceThresholds = {
  lowPerformance: 60,
  regression: 8,
  improvement: 5,
  confirmationRuns: 1,
  devicePolicy: "either",
  accessibility: 90,
  bestPractices: 90,
  seo: 90,
  regressionFloor: 100,
  agentReadiness: 100,
  newPageGraceRuns: 2,
};

export const PERFORMANCE_THRESHOLD_LIMITS = {
  lowPerformance: { min: 1, max: 100 },
  regression: { min: 1, max: 50 },
  improvement: { min: 1, max: 50 },
  confirmationRuns: { min: 1, max: 5 },
  accessibility: { min: 1, max: 100 },
  bestPractices: { min: 1, max: 100 },
  seo: { min: 1, max: 100 },
  regressionFloor: { min: 1, max: 100 },
  agentReadiness: { min: 1, max: 100 },
  newPageGraceRuns: { min: 0, max: 10 },
} as const;

function normalizeInteger(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.round(value)));
}

function normalizeField<K extends keyof typeof PERFORMANCE_THRESHOLD_LIMITS>(
  settings: Partial<PerformanceThresholds> | undefined,
  key: K,
): number {
  const limits = PERFORMANCE_THRESHOLD_LIMITS[key];
  return normalizeInteger(
    settings?.[key],
    DEFAULT_PERFORMANCE_THRESHOLDS[key],
    limits.min,
    limits.max,
  );
}

export function normalizePerformanceThresholds(settings?: Partial<PerformanceThresholds>): PerformanceThresholds {
  return {
    lowPerformance: normalizeField(settings, "lowPerformance"),
    regression: normalizeField(settings, "regression"),
    improvement: normalizeField(settings, "improvement"),
    confirmationRuns: normalizeField(settings, "confirmationRuns"),
    devicePolicy: settings?.devicePolicy === "both" || settings?.devicePolicy === "preferred"
      ? settings.devicePolicy
      : DEFAULT_PERFORMANCE_THRESHOLDS.devicePolicy,
    accessibility: normalizeField(settings, "accessibility"),
    bestPractices: normalizeField(settings, "bestPractices"),
    seo: normalizeField(settings, "seo"),
    regressionFloor: normalizeField(settings, "regressionFloor"),
    agentReadiness: normalizeField(settings, "agentReadiness"),
    newPageGraceRuns: normalizeField(settings, "newPageGraceRuns"),
  };
}

function fieldIsValid<K extends keyof typeof PERFORMANCE_THRESHOLD_LIMITS>(
  settings: Partial<PerformanceThresholds>,
  key: K,
): boolean {
  const value = settings[key];
  const limits = PERFORMANCE_THRESHOLD_LIMITS[key];
  return Number.isInteger(value) && value! >= limits.min && value! <= limits.max;
}

export function performanceThresholdsAreValid(settings: Partial<PerformanceThresholds>): settings is PerformanceThresholds {
  return Object.keys(PERFORMANCE_THRESHOLD_LIMITS).every((key) =>
    fieldIsValid(settings, key as keyof typeof PERFORMANCE_THRESHOLD_LIMITS)
  )
    && (settings.devicePolicy === "either" || settings.devicePolicy === "both" || settings.devicePolicy === "preferred");
}
