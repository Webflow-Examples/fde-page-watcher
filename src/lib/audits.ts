import type { AggregatedLighthouseFinding, Audit, LighthouseOpportunity } from "./types";
import { C } from "./ui";
import { formatDiagnosticImpact, webflowClassificationFor } from "./webflowPerformance";

/**
 * Convert the latest real Lighthouse opportunities into the page-detail model.
 */
export function auditsFor(
  opportunities: LighthouseOpportunity[] = [],
  diagnostics: AggregatedLighthouseFinding[] = [],
): Audit[] {
  if (diagnostics.length > 0) {
    return diagnostics.map((diagnostic) => ({
      id: diagnostic.id,
      title: diagnostic.title,
      desc: diagnostic.description?.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
        ?? "Lighthouse repeatedly identified this diagnostic across trusted runs.",
      category: diagnostic.category,
      savings: formatDiagnosticImpact(diagnostic),
      dot: diagnostic.savingsMs >= 1500 || diagnostic.score === 0 ? C.red : C.amber,
      evidence: `${diagnostic.observedRuns}/${diagnostic.eligibleRuns} trusted runs`,
      confidence: diagnostic.confidence,
      webflow: webflowClassificationFor(diagnostic),
    }));
  }
  return opportunities.map((opportunity) => ({
    id: opportunity.id,
    title: opportunity.title,
    desc: opportunity.description?.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1") ?? "Lighthouse identified a measurable load-time opportunity in the representative run.",
    category: opportunity.category,
    savings: opportunity.savingsMs > 0 ? `${(opportunity.savingsMs / 1000).toFixed(1)} s` : "—",
    dot: opportunity.savingsMs >= 1500 ? C.red : C.amber,
    evidence: opportunity.observedRuns && opportunity.eligibleRuns
      ? `${opportunity.observedRuns}/${opportunity.eligibleRuns} trusted runs`
      : undefined,
    confidence: opportunity.confidence,
    webflow: webflowClassificationFor(opportunity),
  }));
}
