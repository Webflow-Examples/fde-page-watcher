import type { Night, PsiMeasurementContext, Strategy } from "./types";

export type LabMetricKey = Exclude<
  keyof PsiMeasurementContext,
  "lighthouseVersion" | "medianBenchmarkIndex" | "medianServerResponseTime"
>;

export const LAB_METRICS: ReadonlyArray<{
  key: LabMetricKey;
  label: string;
  short: string;
  good: number;
  poor: number;
}> = [
  { key: "medianFirstContentfulPaint", label: "First content", short: "FCP", good: 1_800, poor: 3_000 },
  { key: "medianSpeedIndex", label: "Visual progress", short: "Speed Index", good: 3_400, poor: 5_800 },
  { key: "medianLargestContentfulPaint", label: "Main content", short: "LCP", good: 2_500, poor: 4_000 },
  { key: "medianTotalBlockingTime", label: "Unable to respond", short: "TBT", good: 200, poor: 600 },
  { key: "medianCumulativeLayoutShift", label: "Layout stability", short: "CLS", good: 0.1, poor: 0.25 },
];

export type LabMetricRating = "Good" | "Needs improvement" | "Poor";

export function labMetricRating(key: LabMetricKey, value: number): LabMetricRating {
  const metric = LAB_METRICS.find((item) => item.key === key)!;
  if (value <= metric.good) return "Good";
  return value <= metric.poor ? "Needs improvement" : "Poor";
}

export function formatLabMetric(key: LabMetricKey, value: number | undefined): string {
  if (value === undefined) return "—";
  if (key === "medianCumulativeLayoutShift") return value.toFixed(2);
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)} s`;
  return `${Math.round(value)} ms`;
}

export function labMetricSeries(
  history: Night[],
  strategy: Strategy,
  key: LabMetricKey,
): number[] {
  return history.flatMap((night) => {
    if (night.evidenceStatus === "provider-anomaly") return [];
    const value = night.measurementContext?.[strategy]?.[key];
    return typeof value === "number" && Number.isFinite(value) ? [value] : [];
  });
}
