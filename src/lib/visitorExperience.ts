import type { CruxPageEvidence, CruxSnapshot } from "./crux";
import type { PageStatus, Strategy } from "./types";

export type VisitorExperienceTrend = "stable" | "worsening" | "improving" | "insufficient";
export type VisitorMetricKey = "lcpP75Ms" | "inpP75Ms" | "clsP75" | "ttfbP75Ms";
export type VisitorMetricRating = "Good" | "Needs improvement" | "Poor";

export const VISITOR_METRICS: ReadonlyArray<{
  key: VisitorMetricKey;
  label: string;
  technicalName: string;
  good: number;
  poor: number;
}> = [
  { key: "lcpP75Ms", label: "Main content load", technicalName: "Largest contentful paint", good: 2_500, poor: 4_000 },
  { key: "inpP75Ms", label: "Interaction responsiveness", technicalName: "Interaction to next paint", good: 200, poor: 500 },
  { key: "clsP75", label: "Visual stability", technicalName: "Cumulative layout shift", good: 0.1, poor: 0.25 },
  { key: "ttfbP75Ms", label: "Server response time", technicalName: "Time to first byte", good: 800, poor: 1_800 },
];

export function evidenceForPage(
  evidence: CruxPageEvidence[],
  pageId: string,
  strategy: Strategy,
): CruxPageEvidence | null {
  const formFactor = strategy === "mobile" ? "PHONE" : "DESKTOP";
  return evidence.find((item) => item.pageId === pageId && item.formFactor === formFactor) ?? null;
}

export function metricRating(key: VisitorMetricKey, value: number): VisitorMetricRating {
  const metric = VISITOR_METRICS.find((item) => item.key === key)!;
  if (value <= metric.good) return "Good";
  return value <= metric.poor ? "Needs improvement" : "Poor";
}

function ratingRank(rating: VisitorMetricRating): number {
  return rating === "Good" ? 0 : rating === "Needs improvement" ? 1 : 2;
}

export function visitorExperienceTrend(item: CruxPageEvidence | null): VisitorExperienceTrend {
  const snapshots = item?.snapshots ?? [];
  if (snapshots.length < 2) return "insufficient";
  const previous = snapshots.at(-2)!;
  const latest = snapshots.at(-1)!;
  const deltas: number[] = [];
  let worseCrossings = 0;
  let betterCrossings = 0;
  for (const metric of VISITOR_METRICS) {
    const before = previous[metric.key];
    const after = latest[metric.key];
    if (before === null || after === null) continue;
    deltas.push((after - before) / metric.good);
    const rankChange = ratingRank(metricRating(metric.key, after)) - ratingRank(metricRating(metric.key, before));
    if (rankChange > 0) worseCrossings += 1;
    if (rankChange < 0) betterCrossings += 1;
  }
  if (deltas.length < 2) return "insufficient";
  const average = deltas.reduce((sum, value) => sum + value, 0) / deltas.length;
  if (worseCrossings > betterCrossings || average >= 0.08) return "worsening";
  if (betterCrossings > worseCrossings || average <= -0.08) return "improving";
  return "stable";
}

export function visitorConfidenceLabel(
  labTrend: PageStatus,
  visitorTrend: VisitorExperienceTrend,
): string {
  if (visitorTrend === "insufficient") return "Visitor experience unavailable";
  if (labTrend === "regressing" && visitorTrend === "worsening") return "Lighthouse and visitor experience worsening";
  if (labTrend === "regressing" && visitorTrend === "stable") return "Lighthouse worsening; visitor experience stable";
  if (labTrend === "improving" && visitorTrend === "stable") return "Lighthouse improving; visitor experience stable";
  if (visitorTrend === "worsening") return "Visitor experience worsening";
  if (visitorTrend === "improving") return "Visitor experience improving";
  return "Visitor experience stable";
}

export function formatVisitorMetric(key: VisitorMetricKey, value: number | null): string {
  if (value === null) return "—";
  if (key === "clsP75") return value.toFixed(2);
  if (key === "lcpP75Ms") return `${(value / 1_000).toFixed(value >= 1_000 ? 1 : 2)} s`;
  return `${Math.round(value)} ms`;
}

export function visitorSnapshotValues(
  snapshots: CruxSnapshot[],
  key: VisitorMetricKey,
): number[] {
  return snapshots.flatMap((snapshot) => snapshot[key] === null ? [] : [snapshot[key] as number]);
}

export function formatCollectionWindow(snapshot: CruxSnapshot): string {
  const format = (value: string) => new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${value}T00:00:00.000Z`));
  return `${format(snapshot.collectionStart)}–${format(snapshot.collectionEnd)}`;
}
