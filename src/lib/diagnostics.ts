import type {
  AggregatedLighthouseFinding,
  LighthouseOpportunity,
  Night,
  Strategy,
} from "./types";
import { classifyWebflowPerformance } from "./webflowPerformance";

export interface RecommendationOpportunity extends LighthouseOpportunity {
  strategies: Strategy[];
}

/** Keep the compact, repeatable findings that are safe to show as diagnostics. */
export function promotedDiagnostics(
  findings: AggregatedLighthouseFinding[] = [],
): AggregatedLighthouseFinding[] {
  return findings.filter((finding) => finding.promoted);
}

/** Read device-correct opportunities while remaining compatible with legacy mobile history. */
export function opportunitiesForNight(
  night: Night | null | undefined,
  strategy: Strategy,
): LighthouseOpportunity[] {
  if (!night) return [];
  const byStrategy = night.opportunitiesByStrategy?.[strategy];
  if (byStrategy) return byStrategy;
  return strategy === "mobile" ? night.opportunities ?? [] : [];
}

/** Merge independently promoted device findings into one actionable recommendation. */
export function mergeStrategyOpportunities(
  byStrategy: Partial<Record<Strategy, LighthouseOpportunity[]>>,
  diagnosticsByStrategy: Partial<Record<Strategy, AggregatedLighthouseFinding[]>> = {},
): RecommendationOpportunity[] {
  const merged = new Map<string, RecommendationOpportunity>();
  for (const strategy of ["mobile", "desktop"] as const) {
    const candidates = new Map<string, LighthouseOpportunity>();
    for (const opportunity of byStrategy[strategy] ?? []) candidates.set(opportunity.id, opportunity);
    for (const diagnostic of diagnosticsByStrategy[strategy] ?? []) {
      if (!diagnostic.promoted || candidates.has(diagnostic.id)) continue;
      candidates.set(diagnostic.id, {
        id: diagnostic.id,
        title: diagnostic.title,
        description: diagnostic.description,
        category: diagnostic.category,
        savingsMs: diagnostic.savingsMs,
        savingsBytes: diagnostic.savingsBytes,
        observedRuns: diagnostic.observedRuns,
        eligibleRuns: diagnostic.eligibleRuns,
        confidence: diagnostic.confidence === "high" ? "high" : "medium",
        savingsLowMs: diagnostic.savingsLowMs,
        savingsHighMs: diagnostic.savingsHighMs,
        webflow: diagnostic.webflow ?? classifyWebflowPerformance(diagnostic.id),
      });
    }
    for (const rawOpportunity of candidates.values()) {
      const opportunity = {
        ...rawOpportunity,
        webflow: rawOpportunity.webflow ?? classifyWebflowPerformance(rawOpportunity.id),
      };
      const current = merged.get(opportunity.id);
      if (!current) {
        merged.set(opportunity.id, { ...opportunity, strategies: [strategy] });
        continue;
      }
      if (!current.strategies.includes(strategy)) current.strategies.push(strategy);
      if (opportunity.savingsMs > current.savingsMs) {
        merged.set(opportunity.id, {
          ...opportunity,
          strategies: current.strategies,
        });
      }
    }
  }
  return [...merged.values()].sort((left, right) =>
    right.savingsMs - left.savingsMs || left.id.localeCompare(right.id));
}
