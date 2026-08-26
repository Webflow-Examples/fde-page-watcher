import { DEFAULT_SENSITIVITY, SENSITIVITY_THRESHOLDS } from "./sensitivity";
import type { PerformanceThresholds } from "./types";

/**
 * The limits a site runs on when it has not said otherwise.
 *
 * These are the Normal position's limits, read from `sensitivity.ts` rather
 * than restated here. A default threshold set and a default sensitivity
 * position are one fact; two literals would agree today and drift the first
 * time either was tuned (rule 20).
 *
 * Nothing writes a partial set any more. The twelve per-metric fields had a
 * control until S8 deleted it, and this module is now a normaliser for stored
 * state rather than a set of independently editable knobs — which is why the
 * per-page override machinery went with the panel that edited it.
 */
export const DEFAULT_PERFORMANCE_THRESHOLDS: PerformanceThresholds = SENSITIVITY_THRESHOLDS[DEFAULT_SENSITIVITY];

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
