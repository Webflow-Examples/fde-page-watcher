import type { AppState, CulpritEvidence, NativeElementFinding } from "./types";
import type { Project } from "./projects";
import { isWebflowGenerated } from "./nativeElements";
import { isKnownWebflowIssue, webflowClassificationFor } from "./webflowPerformance";

const WEBFLOW_ASSET_HOSTS = new Set([
  "assets.website-files.com",
  "cdn.prod.website-files.com",
]);

export interface KnownWebflowIssueSummary {
  key: string;
  title: string;
  customerCount: number;
  projectCount: number;
  pageCount: number;
  detections: number;
  optimizeAffectedDetections: number;
  lastSeen: string;
}

interface SummaryInput {
  project: Project;
  state: AppState;
}

interface MutableSummary {
  key: string;
  title: string;
  customers: Set<string>;
  projects: Set<string>;
  pages: Set<string>;
  detections: number;
  optimizeAffectedDetections: number;
  lastSeen: string;
}

function webflowOwnedEvidence(evidence: CulpritEvidence[] | undefined, auditId: string): boolean {
  return (evidence ?? []).some((item) => item.auditId === auditId
    && (item.sources ?? []).some((source) => WEBFLOW_ASSET_HOSTS.has(source.host)));
}

/**
 * Build an app-admin-only rollup from retained collection evidence. One
 * detection is one issue on one page/run, regardless of device count.
 */
export function summarizeKnownWebflowIssues(
  inputs: SummaryInput[],
  now: Date = new Date(),
  days = 30,
): KnownWebflowIssueSummary[] {
  const cutoff = now.getTime() - days * 24 * 60 * 60 * 1000;
  const summaries = new Map<string, MutableSummary>();

  for (const { project, state } of inputs) {
    const customerKey = project.customer?.trim().toLowerCase() || project.id;
    for (const page of state.pages) {
      for (const night of page.history) {
        if (!night.iso || Date.parse(night.iso) < cutoff || !isWebflowGenerated(night.nativeElements)) continue;
        const detected = new Map<string, { title: string; native?: NativeElementFinding }>();
        for (const finding of night.nativeElements?.findings ?? []) {
          if (finding.id.startsWith("webflow-")) detected.set(finding.id, { title: finding.title, native: finding });
        }
        for (const strategy of ["mobile", "desktop"] as const) {
          for (const finding of night.diagnostics?.[strategy] ?? []) {
            if (!isKnownWebflowIssue(finding)) continue;
            if (!webflowOwnedEvidence(night.culpritEvidence?.[strategy], finding.id)) continue;
            detected.set(finding.id, { title: finding.title });
          }
        }

        for (const [key, issue] of detected) {
          const title = issue.native?.title ?? webflowClassificationFor({ id: key, title: issue.title }).culpritLabel;
          const summary = summaries.get(key) ?? {
            key,
            title,
            customers: new Set<string>(),
            projects: new Set<string>(),
            pages: new Set<string>(),
            detections: 0,
            optimizeAffectedDetections: 0,
            lastSeen: night.iso,
          };
          summary.customers.add(customerKey);
          summary.projects.add(project.id);
          summary.pages.add(`${project.id}:${page.id}`);
          summary.detections += 1;
          if (night.nativeElements?.variationRisk?.source === "webflow-optimize") {
            summary.optimizeAffectedDetections += 1;
          }
          if (night.iso > summary.lastSeen) summary.lastSeen = night.iso;
          summaries.set(key, summary);
        }
      }
    }
  }

  return [...summaries.values()].map((summary) => ({
    key: summary.key,
    title: summary.title,
    customerCount: summary.customers.size,
    projectCount: summary.projects.size,
    pageCount: summary.pages.size,
    detections: summary.detections,
    optimizeAffectedDetections: summary.optimizeAffectedDetections,
    lastSeen: summary.lastSeen,
  })).sort((left, right) => right.pageCount - left.pageCount
    || right.detections - left.detections
    || left.title.localeCompare(right.title));
}
