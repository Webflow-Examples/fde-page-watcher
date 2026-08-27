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

/**
 * The four things measured both ways, and what each side's reading is called.
 *
 * `label` is what the row is about and carries no jargon. The two side labels
 * name where the reading came from first and which measurement it is second —
 * "Nightly test (LCP)", not "Lab LCP". "Lab" and "Visitor" were doing the work
 * of saying which side, in a word that only means that to us; "our nightly
 * test" and "real visitors" say it in the reader's terms.
 *
 * The acronyms stay, and they have to: the responsiveness row deliberately
 * compares two DIFFERENT measurements — how long the page could not respond
 * during our test against how long real visitors waited for it to answer —
 * which is what `relationship: "proxy"` records. Strip the names and that
 * mismatch becomes invisible, and a reader would read the two numbers as the
 * same measurement disagreeing with itself.
 */
export const COMPARABLE_METRICS: readonly MetricDefinition[] = [
  { key: "lcp", label: "Main content load", relationship: "direct", labKey: "medianLargestContentfulPaint", labLabel: "Nightly test (LCP)", fieldKey: "lcpP75Ms", fieldLabel: "Real visitors (LCP)" },
  { key: "responsiveness", label: "Responsiveness", relationship: "proxy", labKey: "medianTotalBlockingTime", labLabel: "Nightly test (TBT)", fieldKey: "inpP75Ms", fieldLabel: "Real visitors (INP)" },
  { key: "cls", label: "Layout stability", relationship: "direct", labKey: "medianCumulativeLayoutShift", labLabel: "Nightly test (CLS)", fieldKey: "clsP75", fieldLabel: "Real visitors (CLS)" },
  { key: "ttfb", label: "Server response", relationship: "direct", labKey: "medianServerResponseTime", labLabel: "Nightly test (TTFB)", fieldKey: "ttfbP75Ms", fieldLabel: "Real visitors (TTFB)" },
];

/**
 * The five things this comparison can conclude, in words.
 *
 * Named and exported rather than written inline, for two reasons. One is rule
 * 20: they used to sit as five literals inside one if/else and were asserted by
 * five more literals in the test, so a rewording had to be made in two places
 * and agreed in neither. The other is that all five said "lab" and "field" —
 * our words for the two sides, not the reader's. What a reader has is a nightly
 * test and some real visitors, and every one of these now says so.
 */
export const LAB_FIELD_HEADLINE = {
  nothing_to_compare: "Nothing to compare yet",
  disagree: "The nightly test and real visitors disagree",
  both_found_it: "The nightly test found what visitors are meeting",
  agree: "The nightly test and real visitors agree",
  partly_compared: "Only part of this could be compared",
  whole_site_only: "These visitor figures are for the whole site",
} as const;

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
  if (!lab || !field) return { verdict: "unavailable", verdictLabel: "Nothing to compare", guidance: "This needs a reading from both the nightly test and real visitors." };
  const labRisk = lab !== "Good";
  const fieldRisk = field !== "Good";
  if (!labRisk && !fieldRisk) return { verdict: "aligned-good", verdictLabel: "Both good", guidance: "The nightly test and real visitors are both inside the good range." };
  if (labRisk && fieldRisk) return { verdict: "corroborated-issue", verdictLabel: "Both found it", guidance: "The nightly test reproduces a problem real visitors are meeting too." };
  if (!labRisk && fieldRisk) return { verdict: "field-only-risk", verdictLabel: "Only real visitors see it", guidance: "Real visitors are meeting a problem the nightly test cannot reproduce." };
  return { verdict: "lab-only-risk", verdictLabel: "Only the nightly test sees it", guidance: "The nightly test finds a problem that is not showing up for real visitors yet." };
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
    headline = LAB_FIELD_HEADLINE.nothing_to_compare;
    detail = "This needs both a kept reading from the nightly test and figures from real visitors.";
  } else if (fieldOnly.length || labOnly.length) {
    status = "divergent";
    headline = LAB_FIELD_HEADLINE.disagree;
    detail = fieldOnly.length
      ? `${fieldOnly.map((metric) => metric.label).join(" and ")} ${fieldOnly.length === 1 ? "is" : "are"} worse for real visitors than in the nightly test.`
      : `${labOnly.map((metric) => metric.label).join(" and ")} ${labOnly.length === 1 ? "is" : "are"} worse in the nightly test than for real visitors.`;
  } else if (corroborated.length) {
    status = "corroborated";
    headline = LAB_FIELD_HEADLINE.both_found_it;
    detail = `${corroborated.map((metric) => metric.label).join(" and ")} ${corroborated.length === 1 ? "is" : "are"} outside the good range on both sides.`;
  } else if (available.length === metrics.length && alignedGood.length === metrics.length) {
    status = "aligned";
    headline = LAB_FIELD_HEADLINE.agree;
    detail = "Everything measurable both ways is inside the good range on both sides.";
  } else {
    status = "partial";
    headline = LAB_FIELD_HEADLINE.partly_compared;
    detail = `${available.length} of ${metrics.length} measurements have a reading on both sides.`;
  }
  if (fieldSnapshot?.scope === "origin" && available.length > 0) {
    status = "partial";
    headline = LAB_FIELD_HEADLINE.whole_site_only;
    detail = `${detail} Too few people visited this exact page for it to be reported on its own (the Chrome UX Report), so the visitor figures describe the whole site and do not prove anything about this page.`;
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
