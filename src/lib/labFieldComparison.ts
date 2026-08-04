import type { CruxPageEvidence, CruxSnapshot } from "./crux";
import type { Night, Strategy } from "./types";
import { latestCruxSnapshot } from "./crux";
import { formatLabMetric, labMetricRating, type LabMetricKey } from "./labMetrics";
import { formatVisitorMetric, metricRating, type VisitorMetricKey } from "./visitorExperience";

export type SignalRating = "Good" | "Needs improvement" | "Poor";
export type LabFieldVerdict = "aligned-good" | "corroborated-issue" | "field-only-risk" | "lab-only-risk" | "unavailable";
export type LabFieldComparisonStatus = "aligned" | "corroborated" | "divergent" | "partial" | "unavailable";

export interface LabFieldMetricComparison {
  key: "lcp" | "responsiveness" | "cls" | "ttfb";
  label: string;
  relationship: "direct" | "proxy";
  lab: { label: string; value: number; formatted: string; rating: SignalRating } | null;
  field: { label: string; value: number; formatted: string; rating: SignalRating } | null;
  verdict: LabFieldVerdict;
  verdictLabel: string;
  guidance: string;
}

export interface LabFieldComparison {
  status: LabFieldComparisonStatus;
  headline: string;
  detail: string;
  labCapturedAt: string | null;
  fieldWindow: { start: string; end: string; scope: "url" | "origin" } | null;
  metrics: LabFieldMetricComparison[];
}

interface MetricDefinition {
  key: LabFieldMetricComparison["key"];
  label: string;
  relationship: LabFieldMetricComparison["relationship"];
  labKey: LabMetricKey | "medianServerResponseTime";
  labLabel: string;
  fieldKey: VisitorMetricKey;
  fieldLabel: string;
}

const COMPARABLE_METRICS: readonly MetricDefinition[] = [
  { key: "lcp", label: "Main content load", relationship: "direct", labKey: "medianLargestContentfulPaint", labLabel: "Lab LCP", fieldKey: "lcpP75Ms", fieldLabel: "Visitor LCP p75" },
  { key: "responsiveness", label: "Responsiveness", relationship: "proxy", labKey: "medianTotalBlockingTime", labLabel: "Lab TBT", fieldKey: "inpP75Ms", fieldLabel: "Visitor INP p75" },
  { key: "cls", label: "Layout stability", relationship: "direct", labKey: "medianCumulativeLayoutShift", labLabel: "Lab CLS", fieldKey: "clsP75", fieldLabel: "Visitor CLS p75" },
  { key: "ttfb", label: "Server response", relationship: "direct", labKey: "medianServerResponseTime", labLabel: "Lab TTFB", fieldKey: "ttfbP75Ms", fieldLabel: "Visitor TTFB p75" },
];

function latestTrustedLabNight(history: Night[], strategy: Strategy): Night | null {
  return [...history].reverse().find((night) => {
    if (night.evidenceStatus === "provider-anomaly") return false;
    const context = night.measurementContext?.[strategy];
    return !!context && COMPARABLE_METRICS.some(({ labKey }) => {
      const value = context[labKey];
      return typeof value === "number" && Number.isFinite(value);
    });
  }) ?? null;
}

function labValue(night: Night | null, strategy: Strategy, key: MetricDefinition["labKey"]): number | null {
  const value = night?.measurementContext?.[strategy]?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function fieldValue(snapshot: CruxSnapshot | null, key: VisitorMetricKey): number | null {
  const value = snapshot?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function labRating(key: MetricDefinition["labKey"], value: number): SignalRating {
  if (key === "medianServerResponseTime") {
    if (value <= 800) return "Good";
    return value <= 1_800 ? "Needs improvement" : "Poor";
  }
  return labMetricRating(key, value);
}

function formattedLabValue(key: MetricDefinition["labKey"], value: number): string {
  return key === "medianServerResponseTime"
    ? value >= 1_000 ? `${(value / 1_000).toFixed(1)} s` : `${Math.round(value)} ms`
    : formatLabMetric(key, value);
}

function verdictFor(lab: SignalRating | null, field: SignalRating | null): Pick<LabFieldMetricComparison, "verdict" | "verdictLabel" | "guidance"> {
  if (!lab || !field) return { verdict: "unavailable", verdictLabel: "Comparison unavailable", guidance: "Both lab and visitor measurements are required." };
  const labRisk = lab !== "Good";
  const fieldRisk = field !== "Good";
  if (!labRisk && !fieldRisk) return { verdict: "aligned-good", verdictLabel: "Aligned · good", guidance: "Controlled tests and visitor evidence are both within the good range." };
  if (labRisk && fieldRisk) return { verdict: "corroborated-issue", verdictLabel: "Issue corroborated", guidance: "The controlled test reproduces a problem also visible to visitors." };
  if (!labRisk && fieldRisk) return { verdict: "field-only-risk", verdictLabel: "Field-only issue", guidance: "Visitors are seeing a problem that the controlled Lighthouse run does not reproduce." };
  return { verdict: "lab-only-risk", verdictLabel: "Lab-only issue", guidance: "The controlled run detects a problem that is not currently visible at the visitor p75." };
}

/** Pair only defensibly related Lighthouse and CrUX measurements for one device. */
export function compareLabAndField(
  history: Night[],
  strategy: Strategy,
  evidence: CruxPageEvidence | null,
): LabFieldComparison {
  const labNight = latestTrustedLabNight(history, strategy);
  const fieldSnapshot = latestCruxSnapshot(evidence?.snapshots ?? []);
  const metrics = COMPARABLE_METRICS.map((definition): LabFieldMetricComparison => {
    const rawLab = labValue(labNight, strategy, definition.labKey);
    const rawField = fieldValue(fieldSnapshot, definition.fieldKey);
    const lab = rawLab === null ? null : {
      label: definition.labLabel,
      value: rawLab,
      formatted: formattedLabValue(definition.labKey, rawLab),
      rating: labRating(definition.labKey, rawLab),
    };
    const field = rawField === null ? null : {
      label: definition.fieldLabel,
      value: rawField,
      formatted: formatVisitorMetric(definition.fieldKey, rawField),
      rating: metricRating(definition.fieldKey, rawField),
    };
    return { ...definition, lab, field, ...verdictFor(lab?.rating ?? null, field?.rating ?? null) };
  });
  const available = metrics.filter((metric) => metric.verdict !== "unavailable");
  const fieldOnly = available.filter((metric) => metric.verdict === "field-only-risk");
  const labOnly = available.filter((metric) => metric.verdict === "lab-only-risk");
  const corroborated = available.filter((metric) => metric.verdict === "corroborated-issue");
  const alignedGood = available.filter((metric) => metric.verdict === "aligned-good");

  let status: LabFieldComparisonStatus;
  let headline: string;
  let detail: string;
  if (available.length === 0) {
    status = "unavailable";
    headline = "Lab–field comparison unavailable";
    detail = "A retained Lighthouse measurement and Chrome visitor evidence are both required.";
  } else if (fieldOnly.length || labOnly.length) {
    status = "divergent";
    headline = "Lab and visitor evidence diverge";
    detail = fieldOnly.length
      ? `${fieldOnly.map((metric) => metric.label).join(" and ")} ${fieldOnly.length === 1 ? "is" : "are"} worse for visitors than in the controlled test.`
      : `${labOnly.map((metric) => metric.label).join(" and ")} ${labOnly.length === 1 ? "is" : "are"} worse in the controlled test than at the visitor p75.`;
  } else if (corroborated.length) {
    status = "corroborated";
    headline = "Visitor issues reproduced in Lighthouse";
    detail = `${corroborated.map((metric) => metric.label).join(" and ")} ${corroborated.length === 1 ? "is" : "are"} outside the good range in both sources.`;
  } else if (available.length === metrics.length && alignedGood.length === metrics.length) {
    status = "aligned";
    headline = "Lab and visitor signals align";
    detail = "All comparable measurements are within the good range in both sources.";
  } else {
    status = "partial";
    headline = "Lab and visitor signals partially align";
    detail = `${available.length} of ${metrics.length} comparisons have evidence in both sources.`;
  }
  if (fieldSnapshot?.scope === "origin" && available.length > 0) {
    status = "partial";
    headline = "Origin-level visitor context only";
    detail = `${detail} Exact-URL CrUX evidence is unavailable, so the visitor values describe the origin rather than proving conditions on this page.`;
  }

  return {
    status,
    headline,
    detail,
    labCapturedAt: labNight?.iso ?? null,
    fieldWindow: fieldSnapshot ? { start: fieldSnapshot.collectionStart, end: fieldSnapshot.collectionEnd, scope: fieldSnapshot.scope } : null,
    metrics,
  };
}
