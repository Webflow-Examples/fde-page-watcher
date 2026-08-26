import type { CruxPageEvidence } from "./crux";
import type { LabFieldMetricComparison } from "./labFieldComparison";
import type { Rec, Strategy, WatchPage, WebflowPerformanceMetric } from "./types";
import { compareLabAndField } from "./labFieldComparison";
import { evidenceForPage } from "./visitorExperience";
import { webflowClassificationFor } from "./webflowPerformance";

export type RecommendationEvidencePriority = "corroborated" | "field-only" | "origin-context" | "unavailable" | "lab-only" | "aligned-good";

export interface RecommendationEvidenceSignal {
  priority: RecommendationEvidencePriority;
  rank: number;
  label: string;
  detail: string;
  strategy?: Strategy;
  metric?: LabFieldMetricComparison;
  scope?: "url" | "origin";
  collectionStart?: string;
  collectionEnd?: string;
}

const PRIORITY_META: Record<RecommendationEvidencePriority, Pick<RecommendationEvidenceSignal, "rank" | "label">> = {
  corroborated: { rank: 4, label: "Visitor corroborated" },
  "field-only": { rank: 3, label: "Field-only signal" },
  "origin-context": { rank: 2, label: "Origin context" },
  unavailable: { rank: 2, label: "Field evidence unavailable" },
  "lab-only": { rank: 1, label: "Lab-only signal" },
  "aligned-good": { rank: 0, label: "Visitor p75 good" },
};

function comparisonKey(metric: WebflowPerformanceMetric): LabFieldMetricComparison["key"] | null {
  if (metric === "LCP") return "lcp";
  if (metric === "TBT") return "responsiveness";
  if (metric === "CLS") return "cls";
  return null;
}

function priorityForVerdict(verdict: LabFieldMetricComparison["verdict"]): RecommendationEvidencePriority {
  if (verdict === "corroborated-issue") return "corroborated";
  if (verdict === "field-only-risk") return "field-only";
  if (verdict === "lab-only-risk") return "lab-only";
  if (verdict === "aligned-good") return "aligned-good";
  return "unavailable";
}

/** Resolve the strongest visitor-evidence signal for one recommendation. */
export function recommendationEvidenceSignal(
  rec: Pick<Rec, "id" | "title" | "strategies" | "webflow" | "fieldSignals">,
  page: WatchPage | undefined,
  evidence: CruxPageEvidence[],
): RecommendationEvidenceSignal {
  const classifiedMetricKey = comparisonKey(webflowClassificationFor(rec).metric);
  if (!page || (!classifiedMetricKey && !rec.fieldSignals)) return { priority: "unavailable", ...PRIORITY_META.unavailable, detail: "No comparable CrUX metric is available for this recommendation." };
  const strategies = rec.strategies?.length ? rec.strategies : ["mobile", "desktop"] as Strategy[];
  const candidates = strategies.map((strategy) => {
    const retainedFieldSignal = rec.fieldSignals?.[strategy];
    const metricKey = retainedFieldSignal?.metricKey ?? classifiedMetricKey;
    if (!metricKey) return {
      priority: "unavailable",
      ...PRIORITY_META.unavailable,
      detail: "No comparable CrUX metric is available for this recommendation.",
      strategy,
    } satisfies RecommendationEvidenceSignal;
    const field = evidenceForPage(evidence, page.id, strategy);
    const comparison = compareLabAndField(page.history, strategy, field);
    const metric = comparison.metrics.find((item) => item.key === metricKey);
    const rawPriority = metric ? priorityForVerdict(metric.verdict) : "unavailable";
    if (rawPriority === "unavailable" && retainedFieldSignal) {
      return {
        priority: "field-only",
        ...PRIORITY_META["field-only"],
        detail: `Recorded exact-URL ${retainedFieldSignal.fieldLabel} was ${retainedFieldSignal.fieldFormatted} (${retainedFieldSignal.fieldRating.toLowerCase()}) for the ${retainedFieldSignal.collectionStart} to ${retainedFieldSignal.collectionEnd} window; a current comparison is unavailable.`,
        strategy,
        scope: retainedFieldSignal.scope,
        collectionStart: retainedFieldSignal.collectionStart,
        collectionEnd: retainedFieldSignal.collectionEnd,
      } satisfies RecommendationEvidenceSignal;
    }
    const priority = comparison.fieldWindow?.scope === "origin" && rawPriority !== "unavailable"
      ? "origin-context"
      : rawPriority;
    return {
      priority,
      ...PRIORITY_META[priority],
      detail: metric?.guidance ?? "No comparable lab and visitor measurements are available.",
      strategy,
      metric,
      scope: comparison.fieldWindow?.scope,
      collectionStart: comparison.fieldWindow?.start,
      collectionEnd: comparison.fieldWindow?.end,
    } satisfies RecommendationEvidenceSignal;
  });
  return candidates.sort((left, right) => right.rank - left.rank)[0];
}

export function fieldPriorityRankForRec(
  rec: Rec,
  pages: WatchPage[],
  evidence: CruxPageEvidence[],
): number {
  return recommendationEvidenceSignal(rec, pages.find((page) => page.id === rec.pageId), evidence).rank;
}

export interface PageFieldPriority {
  comparison: ReturnType<typeof compareLabAndField>;
  corroborated: string[];
  fieldOnly: string[];
  labOnly: string[];
}

export function pageFieldPriority(page: WatchPage, strategy: Strategy, evidence: CruxPageEvidence[]): PageFieldPriority {
  const comparison = compareLabAndField(page.history, strategy, evidenceForPage(evidence, page.id, strategy));
  return {
    comparison,
    corroborated: comparison.metrics.filter((metric) => metric.verdict === "corroborated-issue").map((metric) => metric.label),
    fieldOnly: comparison.metrics.filter((metric) => metric.verdict === "field-only-risk").map((metric) => metric.label),
    labOnly: comparison.metrics.filter((metric) => metric.verdict === "lab-only-risk").map((metric) => metric.label),
  };
}

export function alertFieldContext(page: WatchPage, strategies: Strategy[], evidence: CruxPageEvidence[]): { signature: string; text?: string } {
  const priorities = strategies.map((strategy) => ({ strategy, ...pageFieldPriority(page, strategy, evidence) }));
  const corroborated = priorities.flatMap((item) => item.corroborated.map((metric) => `${item.strategy} ${metric}`));
  const fieldOnly = priorities.flatMap((item) => item.fieldOnly.map((metric) => `${item.strategy} ${metric}`));
  const labOnly = priorities.flatMap((item) => item.labOnly.map((metric) => `${item.strategy} ${metric}`));
  const scopes = new Set(priorities.flatMap((item) => item.comparison.fieldWindow?.scope ? [item.comparison.fieldWindow.scope] : []));
  const scopeNote = scopes.has("origin") ? " Origin-wide CrUX is contextual, not page-level proof." : "";
  if (corroborated.length) return {
    signature: `corroborated:${corroborated.sort().join("|")}:${[...scopes].sort().join(",")}`,
    text: `Real visitors confirm ${corroborated.join(", ")}.${scopeNote}`,
  };
  if (fieldOnly.length) return {
    signature: `field-only:${fieldOnly.sort().join("|")}:${[...scopes].sort().join(",")}`,
    text: `Real visitors are also seeing a problem on ${fieldOnly.join(", ")}.${scopeNote}`,
  };
  if (labOnly.length) return {
    signature: `lab-only:${labOnly.sort().join("|")}:${[...scopes].sort().join(",")}`,
    text: `The affected lab signal is not currently visible at the CrUX p75.${scopeNote}`,
  };
  return { signature: "field-unavailable" };
}
