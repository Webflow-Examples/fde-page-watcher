import type {
  AggregatedLighthouseFinding,
  LighthouseOpportunity,
  Night,
  Strategy,
  WatchPage,
  WebflowPerformanceClassification,
  WebflowPerformanceCulprit,
  WebflowRemediationLevel,
} from "./types";
import { classificationForPage, culpritGroupLabel, recommendationIsCustomerActionable, webflowClassificationFor } from "./webflowPerformance";
import { isWebflowGenerated } from "./nativeElements";

export type PerformanceIssueStatus = "active" | "verifying" | "resolved" | "regressed";

export interface PerformanceIssueCapture {
  i: number;
  date: string;
  iso?: string;
}

export interface PerformanceIssueLifecycle {
  key: string;
  id: string;
  title: string;
  category: string;
  strategy: Strategy;
  status: PerformanceIssueStatus;
  firstDetected: PerformanceIssueCapture;
  lastDetected: PerformanceIssueCapture;
  resolvedAt?: PerformanceIssueCapture;
  returnedAt?: PerformanceIssueCapture;
  observedCaptures: number;
  eligibleCaptures: number;
  consecutiveDetections: number;
  trailingAbsences: number;
  resolutionCount: number;
  savingsMs: number;
  savingsBytes: number;
  webflow: WebflowPerformanceClassification;
}

export interface SitePerformanceIssue extends PerformanceIssueLifecycle {
  pageId: string;
  pageTitle: string;
  pageUrl: string;
}

export interface SiteCulpritRollup {
  culprit: WebflowPerformanceCulprit;
  label: string;
  metrics: {
    metric: WebflowPerformanceClassification["metric"];
    metricWeight: WebflowPerformanceClassification["metricWeight"];
    issueCount: number;
  }[];
  issueCount: number;
  pageCount: number;
  regressedCount: number;
  oldestDetection: PerformanceIssueCapture;
  pages: { id: string; title: string; url: string }[];
  remediationCounts: Record<WebflowRemediationLevel, number>;
}

interface DiagnosticCapture {
  night: Night;
  findings: Map<string, LighthouseOpportunity | AggregatedLighthouseFinding>;
}

function owns(value: object | undefined, key: PropertyKey): boolean {
  return !!value && Object.prototype.hasOwnProperty.call(value, key);
}

/**
 * Return only captures that can prove both presence and absence. Legacy nights
 * without a stored finding list are skipped instead of being treated as clean.
 */
function diagnosticCapture(night: Night, strategy: Strategy): DiagnosticCapture | null {
  let findings: Array<LighthouseOpportunity | AggregatedLighthouseFinding> | null = null;
  if (owns(night.diagnostics, strategy)) {
    findings = (night.diagnostics?.[strategy] ?? []).filter((finding) => finding.promoted);
  } else if (owns(night.opportunitiesByStrategy, strategy)) {
    findings = night.opportunitiesByStrategy?.[strategy] ?? [];
  } else if (strategy === "mobile" && owns(night, "opportunities")) {
    findings = night.opportunities ?? [];
  }
  if (!findings) return null;
  return {
    night,
    findings: new Map(findings.map((finding) => [finding.id, finding])),
  };
}

function captureOf(night: Night): PerformanceIssueCapture {
  return { i: night.i, date: night.date, iso: night.iso };
}

function confirmedResolutionStarts(presence: boolean[], firstDetection: number): number[] {
  const starts: number[] = [];
  for (let index = firstDetection + 1; index < presence.length; index += 1) {
    if (presence[index] || presence[index - 1] === false) continue;
    if (presence[index + 1] === false) starts.push(index);
  }
  return starts;
}

/** Build one issue lifecycle per stable Lighthouse audit id for a device. */
export function performanceIssuesForPage(
  history: Night[],
  strategy: Strategy,
): PerformanceIssueLifecycle[] {
  const captures = [...history]
    .sort((left, right) => left.i - right.i)
    .flatMap((night) => {
      const capture = diagnosticCapture(night, strategy);
      return capture ? [capture] : [];
    });
  const ids = new Set(captures.flatMap((capture) => [...capture.findings.keys()]));

  return [...ids].map((id): PerformanceIssueLifecycle => {
    const presence = captures.map((capture) => capture.findings.has(id));
    const firstIndex = presence.indexOf(true);
    const lastIndex = presence.lastIndexOf(true);
    const latestPresent = presence.at(-1) === true;
    let trailingAbsences = 0;
    for (let index = presence.length - 1; index >= 0 && !presence[index]; index -= 1) trailingAbsences += 1;
    let consecutiveDetections = 0;
    for (let index = presence.length - 1; index >= 0 && presence[index]; index -= 1) consecutiveDetections += 1;

    const resolutionStarts = confirmedResolutionStarts(presence, firstIndex);
    const confirmedBeforeLatest = resolutionStarts.some((start) => start < lastIndex);
    const status: PerformanceIssueStatus = latestPresent
      ? confirmedBeforeLatest ? "regressed" : "active"
      : trailingAbsences >= 2 ? "resolved" : "verifying";
    const currentResolutionStart = !latestPresent && trailingAbsences >= 2
      ? presence.length - trailingAbsences
      : undefined;
    const returnedIndex = status === "regressed"
      ? presence.length - consecutiveDetections
      : undefined;
    const source = captures[lastIndex].findings.get(id)!;

    return {
      key: `${strategy}:${id}`,
      id,
      title: source.title,
      category: source.category,
      strategy,
      status,
      firstDetected: captureOf(captures[firstIndex].night),
      lastDetected: captureOf(captures[lastIndex].night),
      resolvedAt: currentResolutionStart === undefined ? undefined : captureOf(captures[currentResolutionStart].night),
      returnedAt: returnedIndex === undefined ? undefined : captureOf(captures[returnedIndex].night),
      observedCaptures: presence.slice(firstIndex).filter(Boolean).length,
      eligibleCaptures: presence.length - firstIndex,
      consecutiveDetections,
      trailingAbsences,
      resolutionCount: resolutionStarts.length,
      savingsMs: source.savingsMs,
      savingsBytes: source.savingsBytes ?? 0,
      webflow: webflowClassificationFor(source),
    };
  }).sort((left, right) => {
    const order: Record<PerformanceIssueStatus, number> = { regressed: 0, active: 1, verifying: 2, resolved: 3 };
    return order[left.status] - order[right.status]
      || right.consecutiveDetections - left.consecutiveDetections
      || right.savingsMs - left.savingsMs
      || left.id.localeCompare(right.id);
  });
}

export function sitePerformanceIssues(pages: WatchPage[], strategy: Strategy): SitePerformanceIssue[] {
  return pages.flatMap((page) => {
    const webflowGenerated = [...page.history].reverse().some((night) => isWebflowGenerated(night.nativeElements));
    return performanceIssuesForPage(page.history, strategy).map((issue) => ({
      ...issue,
      webflow: classificationForPage(issue, webflowGenerated),
      pageId: page.id,
      pageTitle: page.title,
      pageUrl: page.url,
    }));
  });
}

/** Group currently-present issues across monitored pages by Webflow culprit. */
export function siteCulpritRollups(pages: WatchPage[], strategy: Strategy): SiteCulpritRollup[] {
  const issues = sitePerformanceIssues(pages, strategy)
    .filter((issue) => (issue.status === "active" || issue.status === "regressed")
      && recommendationIsCustomerActionable(issue));
  const groups = new Map<WebflowPerformanceCulprit, SitePerformanceIssue[]>();
  for (const issue of issues) groups.set(issue.webflow.culprit, [...(groups.get(issue.webflow.culprit) ?? []), issue]);

  return [...groups.entries()].map(([culprit, grouped]): SiteCulpritRollup => {
    const pageMap = new Map(grouped.map((issue) => [issue.pageId, {
      id: issue.pageId,
      title: issue.pageTitle,
      url: issue.pageUrl,
    }]));
    const captureOrder = (capture: PerformanceIssueCapture) => {
      const parsed = capture.iso ? Date.parse(capture.iso) : Number.NaN;
      return Number.isFinite(parsed) ? parsed : capture.i;
    };
    const oldest = grouped.reduce((candidate, issue) =>
      captureOrder(issue.firstDetected) < captureOrder(candidate.firstDetected) ? issue : candidate);
    const remediationCounts: Record<WebflowRemediationLevel, number> = {
      blocked: 0,
      partial: 0,
      available: 0,
      unknown: 0,
    };
    for (const issue of grouped) remediationCounts[issue.webflow.remediation] += 1;
    const metricCounts = new Map<string, { metric: WebflowPerformanceClassification["metric"]; metricWeight: WebflowPerformanceClassification["metricWeight"]; issueCount: number }>();
    for (const issue of grouped) {
      const key = `${issue.webflow.metric}:${issue.webflow.metricWeight}`;
      const current = metricCounts.get(key);
      if (current) current.issueCount += 1;
      else metricCounts.set(key, { metric: issue.webflow.metric, metricWeight: issue.webflow.metricWeight, issueCount: 1 });
    }
    return {
      culprit,
      label: culpritGroupLabel(grouped[0]),
      metrics: [...metricCounts.values()].sort((left, right) => right.issueCount - left.issueCount),
      issueCount: grouped.length,
      pageCount: pageMap.size,
      regressedCount: grouped.filter((issue) => issue.status === "regressed").length,
      oldestDetection: oldest.firstDetected,
      pages: [...pageMap.values()].sort((left, right) => left.title.localeCompare(right.title)),
      remediationCounts,
    };
  }).sort((left, right) =>
    right.regressedCount - left.regressedCount
    || right.pageCount - left.pageCount
    || right.issueCount - left.issueCount
    || left.label.localeCompare(right.label));
}

export function performanceIssueCounts(issues: PerformanceIssueLifecycle[]): Record<PerformanceIssueStatus, number> {
  const counts: Record<PerformanceIssueStatus, number> = { active: 0, verifying: 0, resolved: 0, regressed: 0 };
  for (const issue of issues) counts[issue.status] += 1;
  return counts;
}
