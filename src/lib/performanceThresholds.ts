import type { PagePerformanceThresholdOverrides, PerformanceThresholds, WatchPage } from "./types";

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
  minimumFindingRuns: 1,
  minimumSavingsMs: 0,
  minimumSavingsKilobytes: 0,
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
  minimumFindingRuns: { min: 1, max: 5 },
  minimumSavingsMs: { min: 0, max: 5000 },
  minimumSavingsKilobytes: { min: 0, max: 5000 },
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
    minimumFindingRuns: normalizeField(settings, "minimumFindingRuns"),
    minimumSavingsMs: normalizeField(settings, "minimumSavingsMs"),
    minimumSavingsKilobytes: normalizeField(settings, "minimumSavingsKilobytes"),
  };
}

export function normalizePerformanceThresholdOverrides(
  settings?: PagePerformanceThresholdOverrides,
): PagePerformanceThresholdOverrides {
  if (!settings) return {};
  const normalized: PagePerformanceThresholdOverrides = {};
  for (const key of Object.keys(PERFORMANCE_THRESHOLD_LIMITS) as Array<keyof typeof PERFORMANCE_THRESHOLD_LIMITS>) {
    const value = settings[key];
    const limits = PERFORMANCE_THRESHOLD_LIMITS[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      normalized[key] = Math.max(limits.min, Math.min(limits.max, Math.round(value)));
    }
  }
  if (settings.devicePolicy === "either" || settings.devicePolicy === "both" || settings.devicePolicy === "preferred") {
    normalized.devicePolicy = settings.devicePolicy;
  }
  return normalized;
}

export function effectivePerformanceThresholds(
  teamSettings?: Partial<PerformanceThresholds>,
  pageOrOverrides?: Pick<WatchPage, "performanceThresholdOverrides"> | PagePerformanceThresholdOverrides,
): PerformanceThresholds {
  const overrides: PagePerformanceThresholdOverrides | undefined = pageOrOverrides
    && Object.prototype.hasOwnProperty.call(pageOrOverrides, "performanceThresholdOverrides")
    ? (pageOrOverrides as Pick<WatchPage, "performanceThresholdOverrides">).performanceThresholdOverrides
    : pageOrOverrides as PagePerformanceThresholdOverrides | undefined;
  return normalizePerformanceThresholds({
    ...normalizePerformanceThresholds(teamSettings),
    ...normalizePerformanceThresholdOverrides(overrides),
  });
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

export function performanceThresholdOverridesAreValid(settings: unknown): settings is PagePerformanceThresholdOverrides {
  if (!settings || typeof settings !== "object" || Array.isArray(settings)) return false;
  const values = settings as Record<string, unknown>;
  const supported = new Set<string>([...Object.keys(PERFORMANCE_THRESHOLD_LIMITS), "devicePolicy"]);
  if (Object.keys(values).some((key) => !supported.has(key))) return false;
  for (const key of Object.keys(PERFORMANCE_THRESHOLD_LIMITS) as Array<keyof typeof PERFORMANCE_THRESHOLD_LIMITS>) {
    if (!(key in values)) continue;
    const value = values[key];
    const limits = PERFORMANCE_THRESHOLD_LIMITS[key];
    if (!Number.isInteger(value) || (value as number) < limits.min || (value as number) > limits.max) return false;
  }
  return !("devicePolicy" in values)
    || values.devicePolicy === "either"
    || values.devicePolicy === "both"
    || values.devicePolicy === "preferred";
}

export function recommendationMeetsEvidenceThresholds(
  finding: { savingsMs: number; savingsBytes?: number; observedRuns?: number; category?: string },
  thresholds: PerformanceThresholds,
): boolean {
  if (finding.category === "Native elements") return true;
  if (finding.observedRuns !== undefined && finding.observedRuns < thresholds.minimumFindingRuns) return false;
  const savingsBytes = finding.savingsBytes ?? 0;
  if (finding.savingsMs <= 0 && savingsBytes <= 0) return true;
  const timeGateEnabled = thresholds.minimumSavingsMs > 0;
  const transferGateEnabled = thresholds.minimumSavingsKilobytes > 0;
  if (!timeGateEnabled && !transferGateEnabled) return true;
  return (timeGateEnabled && finding.savingsMs >= thresholds.minimumSavingsMs)
    || (transferGateEnabled && savingsBytes >= thresholds.minimumSavingsKilobytes * 1024);
}
