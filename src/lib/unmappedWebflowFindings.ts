import type { AppState } from "./types";
import type { Project } from "./projects";
import { isDocumentedWebflowAudit } from "./webflowPerformance";

export interface UnmappedWebflowFindingSummary {
  key: string;
  title: string;
  category: string;
  customerCount: number;
  projectCount: number;
  pageCount: number;
  detections: number;
  lastSeen: string;
}

interface SummaryInput {
  project: Project;
  state: AppState;
}

interface MutableSummary {
  key: string;
  title: string;
  category: string;
  customers: Set<string>;
  projects: Set<string>;
  pages: Set<string>;
  detections: number;
  lastSeen: string;
}

/**
 * Build an app-admin-only rollup of Lighthouse audit IDs the remediation
 * catalog in `webflowPerformance.ts` doesn't recognize yet (an audit ID
 * with no `CATALOG` entry and no exact `TITLE_ALIASES` match). Findings
 * like this still stay visible to customers — `recommendationIsCustomerActionable`
 * treats an unmapped/"review" finding as actionable rather than hiding it,
 * and it renders with a "Needs review" effort label — but nobody is
 * notified that the catalog itself has a gap. This view is how an
 * operator notices one exists so it can be added to `CATALOG` (or
 * `TITLE_ALIASES`) in `webflowPerformance.ts`.
 */
export function summarizeUnmappedWebflowFindings(
  inputs: SummaryInput[],
  now: Date = new Date(),
  days = 30,
): UnmappedWebflowFindingSummary[] {
  const cutoff = now.getTime() - days * 24 * 60 * 60 * 1000;
  const summaries = new Map<string, MutableSummary>();

  for (const { project, state } of inputs) {
    const customerKey = project.customer?.trim().toLowerCase() || project.id;
    for (const page of state.pages) {
      for (const night of page.history) {
        if (!night.iso || Date.parse(night.iso) < cutoff) continue;
        const detected = new Map<string, { title: string; category: string }>();
        for (const strategy of ["mobile", "desktop"] as const) {
          for (const finding of night.diagnostics?.[strategy] ?? []) {
            if (isDocumentedWebflowAudit(finding.id, finding.title)) continue;
            detected.set(finding.id, { title: finding.title, category: finding.category });
          }
        }

        for (const [key, issue] of detected) {
          const summary = summaries.get(key) ?? {
            key,
            title: issue.title,
            category: issue.category,
            customers: new Set<string>(),
            projects: new Set<string>(),
            pages: new Set<string>(),
            detections: 0,
            lastSeen: night.iso,
          };
          summary.customers.add(customerKey);
          summary.projects.add(project.id);
          summary.pages.add(`${project.id}:${page.id}`);
          summary.detections += 1;
          if (night.iso > summary.lastSeen) summary.lastSeen = night.iso;
          summaries.set(key, summary);
        }
      }
    }
  }

  return [...summaries.values()].map((summary) => ({
    key: summary.key,
    title: summary.title,
    category: summary.category,
    customerCount: summary.customers.size,
    projectCount: summary.projects.size,
    pageCount: summary.pages.size,
    detections: summary.detections,
    lastSeen: summary.lastSeen,
  })).sort((left, right) => right.pageCount - left.pageCount
    || right.detections - left.detections
    || left.title.localeCompare(right.title));
}
