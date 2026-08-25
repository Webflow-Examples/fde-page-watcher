import type { AggregatedLighthouseFinding, Audit, LighthouseOpportunity } from "./types";
import { formatDiagnosticImpact, webflowClassificationFor } from "./webflowPerformance";

/**
 * The retired `Audit.dot` field resolved two unrelated questions to one hue:
 * `savingsMs >= 1500 || score === 0 ? red : amber`. A large-but-passing
 * diagnostic and an outright Lighthouse failure came out the same colour, and
 * neither reading could be recovered from the result. R1 reserves hue for "is
 * this good right now?" and R3 puts size in weight, so the two readings are
 * split into two separately-answerable values below.
 */

/** Estimated impact at or above which a finding reads as large (ms). */
const LARGE_IMPACT_MS = 1500;

/**
 * SIZE (R3): how much is at stake. Carried to the reader by the weight of the
 * `savings` figure on the returned `Audit`, never by a colour.
 */
export function isLargeImpact(savingsMs: number): boolean {
  return savingsMs >= LARGE_IMPACT_MS;
}

/**
 * HEALTH (R1): Lighthouse scored this audit an outright fail. Only aggregated
 * diagnostics carry a score — a load-time opportunity has no verdict of its
 * own — so this reading exists on the diagnostic branch alone.
 */
export function isFailingDiagnostic(diagnostic: Pick<AggregatedLighthouseFinding, "score">): boolean {
  return diagnostic.score === 0;
}

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
    evidence: opportunity.observedRuns && opportunity.eligibleRuns
      ? `${opportunity.observedRuns}/${opportunity.eligibleRuns} trusted runs`
      : undefined,
    confidence: opportunity.confidence,
    webflow: webflowClassificationFor(opportunity),
  }));
}
