import type { Audit, LighthouseOpportunity } from "./types";
import { C } from "./ui";

/**
 * Convert the latest real Lighthouse opportunities into the page-detail model.
 */
export function auditsFor(opportunities: LighthouseOpportunity[] = []): Audit[] {
  return opportunities.map((opportunity) => ({
    title: opportunity.title,
    desc: opportunity.description?.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1") ?? "Lighthouse identified a measurable load-time opportunity in the representative run.",
    category: opportunity.category,
    savings: opportunity.savingsMs > 0 ? `${(opportunity.savingsMs / 1000).toFixed(1)} s` : "—",
    dot: opportunity.savingsMs >= 1500 ? C.red : C.amber,
  }));
}
