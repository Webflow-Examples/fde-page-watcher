import type {
  AppState,
  EscalationEvidenceSnapshot,
  EscalationStrategyEvidence,
  ProductEscalation,
  ProductEscalationStatus,
  PsiMeasurementContext,
  Rec,
  Strategy,
} from "./types";
import { performanceIssuesForPage } from "./performanceIssues";
import { nativeElementIssuesForPage } from "./nativeElements";
import { classifyWebflowPerformance, webflowClassificationFor } from "./webflowPerformance";
import { formatEvidenceValue } from "./culpritEvidence";
import type { CruxPageEvidence } from "./crux";
import { recommendationEvidenceSignal } from "./fieldPrioritization";

export const PRODUCT_ESCALATION_STATUSES: ProductEscalationStatus[] = ["draft", "ready", "submitted", "resolved"];

export function isProductEscalationStatus(value: unknown): value is ProductEscalationStatus {
  return typeof value === "string" && PRODUCT_ESCALATION_STATUSES.includes(value as ProductEscalationStatus);
}

export function recommendationNeedsEscalation(rec: Pick<Rec, "id" | "title" | "webflow">): boolean {
  const remediation = webflowClassificationFor(rec).remediation;
  return remediation === "blocked" || remediation === "partial";
}

function metricValue(context: PsiMeasurementContext | undefined, metric: string): { value?: number; unit?: "milliseconds" | "score" } {
  if (metric === "TBT") return { value: context?.medianTotalBlockingTime, unit: "milliseconds" };
  if (metric === "LCP") return { value: context?.medianLargestContentfulPaint, unit: "milliseconds" };
  if (metric === "CLS") return { value: context?.medianCumulativeLayoutShift, unit: "score" };
  return {};
}

export function createEscalationEvidence(state: AppState, rec: Rec, capturedAt: string, visitorEvidence: CruxPageEvidence[] = []): EscalationEvidenceSnapshot {
  const page = state.pages.find((item) => item.id === rec.pageId);
  if (!page) throw new Error(`createEscalationEvidence: page ${rec.pageId} not found`);
  const classification = webflowClassificationFor(rec);
  const strategies = (rec.strategies?.length ? rec.strategies : ["mobile", "desktop"] as Strategy[])
    .map((strategy): EscalationStrategyEvidence => {
      const latest = [...page.history].reverse().find((night) =>
        night.measurementContext?.[strategy]
        || night.diagnostics?.[strategy]
        || night.culpritEvidence?.[strategy]);
      const diagnostic = latest?.diagnostics?.[strategy]?.find((item) =>
        item.id === rec.id || webflowClassificationFor(item).culprit === classification.culprit);
      const lifecycle = performanceIssuesForPage(page.history, strategy).find((item) =>
        item.id === rec.id || webflowClassificationFor(item).culprit === classification.culprit);
      const relatedEvidence = (latest?.culpritEvidence?.[strategy] ?? []).filter((item) =>
        item.auditId === rec.id
        || classifyWebflowPerformance(item.auditId).culprit === classification.culprit);
      const metric = metricValue(latest?.measurementContext?.[strategy], classification.metric);
      const fieldSignal = recommendationEvidenceSignal({ ...rec, strategies: [strategy] }, page, visitorEvidence);
      return {
        strategy,
        performanceScore: latest?.scores[strategy].perf.m,
        metricValue: metric.value,
        metricUnit: metric.unit,
        diagnostic: diagnostic ? {
          observedRuns: diagnostic.observedRuns,
          eligibleRuns: diagnostic.eligibleRuns,
          confidence: diagnostic.confidence,
          savingsMs: diagnostic.savingsMs,
          savingsBytes: diagnostic.savingsBytes,
        } : undefined,
        lifecycle: lifecycle ? {
          status: lifecycle.status,
          firstDetected: lifecycle.firstDetected.iso ?? lifecycle.firstDetected.date,
          lastDetected: lifecycle.lastDetected.iso ?? lifecycle.lastDetected.date,
        } : undefined,
        culpritEvidence: relatedEvidence,
        fieldEvidence: fieldSignal.metric ? {
          relationship: fieldSignal.metric.relationship,
          verdict: fieldSignal.metric.verdict,
          verdictLabel: fieldSignal.metric.verdictLabel,
          metricLabel: fieldSignal.metric.field?.label ?? fieldSignal.metric.label,
          value: fieldSignal.metric.field?.formatted,
          rating: fieldSignal.metric.field?.rating,
          scope: fieldSignal.scope,
          collectionStart: fieldSignal.collectionStart,
          collectionEnd: fieldSignal.collectionEnd,
        } : undefined,
      };
    });
  const nativeIssue = nativeElementIssuesForPage(page.history).find((item) => item.id === rec.id);
  return {
    capturedAt,
    page: { id: page.id, title: page.title, url: page.url },
    recommendation: {
      id: rec.id,
      title: rec.title,
      category: rec.category,
      impact: rec.savings,
      strategies: strategies.map((item) => item.strategy),
    },
    classification,
    strategies,
    nativeFinding: nativeIssue ? {
      count: nativeIssue.count,
      confidence: nativeIssue.confidence,
      signals: [...nativeIssue.signals],
      detail: nativeIssue.detail,
    } : undefined,
  };
}

export function buildProductEscalation(state: AppState, rec: Rec, now: Date = new Date(), visitorEvidence: CruxPageEvidence[] = []): ProductEscalation {
  if (!recommendationNeedsEscalation(rec)) {
    throw new Error("buildProductEscalation: recommendation is fixable without a product escalation");
  }
  const timestamp = now.toISOString();
  return {
    id: `product:${rec.key}`,
    recKey: rec.key,
    pageId: rec.pageId,
    title: rec.title,
    status: "draft",
    owner: "",
    notes: "",
    createdAt: timestamp,
    updatedAt: timestamp,
    evidence: createEscalationEvidence(state, rec, timestamp, visitorEvidence),
  };
}

export function normalizeProductEscalations(value: ProductEscalation[] | undefined): ProductEscalation[] {
  return (value ?? []).filter((item) =>
    !!item
    && typeof item.id === "string"
    && typeof item.recKey === "string"
    && isProductEscalationStatus(item.status)
    && !!item.evidence);
}

function metricText(value: number | undefined, unit: "milliseconds" | "score" | undefined): string {
  if (value === undefined) return "Not retained";
  if (unit === "milliseconds") return formatEvidenceValue(value, "milliseconds");
  return value.toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
}

function evidenceLines(strategy: EscalationStrategyEvidence): string[] {
  const lines = [
    `### ${strategy.strategy[0].toUpperCase()}${strategy.strategy.slice(1)}`,
    `- Performance score: ${strategy.performanceScore ?? "Not retained"}`,
    `- Weighted metric: ${metricText(strategy.metricValue, strategy.metricUnit)}`,
  ];
  if (strategy.diagnostic) {
    lines.push(`- Lighthouse evidence: ${strategy.diagnostic.observedRuns}/${strategy.diagnostic.eligibleRuns} trusted runs, ${strategy.diagnostic.confidence} confidence`);
  }
  if (strategy.lifecycle) {
    lines.push(`- Lifecycle: ${strategy.lifecycle.status}; first ${strategy.lifecycle.firstDetected}; last ${strategy.lifecycle.lastDetected}`);
  }
  if (strategy.fieldEvidence) {
    const field = strategy.fieldEvidence;
    lines.push(`- Lab/field verdict: ${field.verdictLabel}${field.relationship === "proxy" ? " (diagnostic proxy)" : ""}`);
    lines.push(`- ${field.metricLabel}: ${field.value ?? "Not available"}${field.rating ? ` · ${field.rating}` : ""}`);
    if (field.collectionStart && field.collectionEnd) {
      lines.push(`- CrUX evidence: ${field.scope === "origin" ? "origin-wide context" : "exact URL"}; ${field.collectionStart} to ${field.collectionEnd}`);
    }
  }
  for (const item of strategy.culpritEvidence) {
    const facts = item.facts.map((entry) => `${entry.label}: ${formatEvidenceValue(entry.value, entry.unit)}`).join(", ");
    lines.push(`- ${item.title}: ${facts || "detected"}`);
    if (item.sources?.length) lines.push(`- Top hosts: ${item.sources.map((source) => source.host).join(", ")}`);
  }
  return lines;
}

export function escalationMarkdown(escalation: ProductEscalation): string {
  const packet = escalation.evidence;
  return [
    `# Product escalation: ${escalation.title}`,
    "",
    `- Status: ${escalation.status}`,
    `- Owner: ${escalation.owner || "Unassigned"}`,
    `- Page: ${packet.page.title} (${packet.page.url})`,
    `- Captured: ${packet.capturedAt}`,
    `- Recommendation: ${packet.recommendation.title}`,
    `- Measured impact: ${packet.recommendation.impact}`,
    `- Weighted metric: ${packet.classification.metric} (${packet.classification.metricWeight}%)`,
    `- Culprit: ${packet.classification.culpritLabel}`,
    `- Remediation: ${packet.classification.remediationLabel}`,
    "",
    "## Product gap",
    "",
    packet.classification.guidance,
    "",
    ...(escalation.notes ? ["## Notes", "", escalation.notes, ""] : []),
    "## Supporting evidence",
    "",
    ...packet.strategies.flatMap((strategy) => [...evidenceLines(strategy), ""]),
    ...(packet.nativeFinding ? [
      "### Published-page element scan",
      `- Instances: ${packet.nativeFinding.count}`,
      `- Confidence: ${packet.nativeFinding.confidence}`,
      `- Signals: ${packet.nativeFinding.signals.join(", ")}`,
      `- Detail: ${packet.nativeFinding.detail}`,
      "",
    ] : []),
  ].join("\n").trimEnd() + "\n";
}
