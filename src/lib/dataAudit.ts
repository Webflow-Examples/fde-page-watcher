import { aggregateLighthouseRunEvidence, extractLighthouseRunEvidence, lighthouseRuntimeError, lighthouseScores } from "./lighthouseEvidence";
import { captureAgentReadiness } from "./agentScoring";
import { CATEGORIES, STRATEGIES } from "./types";
import type { CategoryKey, CollectionJob, Night, Strategy } from "./types";

export type DataAuditHealth = "healthy" | "degraded" | "failed";

export interface StoredAuditCapture {
  pageId: string;
  night: Night;
  report: unknown | null;
}

export interface WeeklyDataAuditInput {
  tenant: string;
  generatedAt: string;
  periodStart: string;
  periodEnd: string;
  monitoredPageIds: string[];
  captures: StoredAuditCapture[];
  jobs: CollectionJob[];
}

export interface InspectedStoredAuditCapture extends MutableMetrics {
  pageId: string;
  rawReportFound: boolean;
  missingRawReport: boolean;
  lighthouseVersions: Record<string, number>;
}

export interface WeeklyDataAuditFromInspectionsInput extends Omit<WeeklyDataAuditInput, "captures"> {
  inspections: InspectedStoredAuditCapture[];
}

export interface WeeklyPageAudit {
  pageRef: string;
  captures: number;
  rawReportsFound: number;
  missingRawReports: number;
  strategyReports: number;
  rawPsiRuns: number;
  warningRuns: number;
  runtimeErrorRuns: number;
  invalidScoreRuns: number;
  lowSampleStrategies: number;
  sampleCountMismatches: number;
  scoreCellMismatches: number;
  findingAggregationMismatches: number;
  agentScans: number;
  missingAgentScans: number;
  agentReadinessSnapshots: number;
  missingAgentReadinessSnapshots: number;
  agentReadinessSnapshotMismatches: number;
  health: DataAuditHealth;
}

export interface WeeklyDataAudit {
  schemaVersion: 1;
  auditType: "weekly-psi-data-accuracy";
  auditId: string;
  generatedAt: string;
  periodStart: string;
  periodEnd: string;
  tenantRef: string;
  privacy: {
    pageIdentifiers: "sha256-truncated";
    customerUrlsStored: false;
    customerPageNamesStored: false;
    rawLighthousePayloadsStored: false;
    rawErrorMessagesStored: false;
  };
  health: DataAuditHealth;
  totals: {
    monitoredPages: number;
    pagesAudited: number;
    pagesWithoutCaptures: number;
    captures: number;
    rawReportsFound: number;
    missingRawReports: number;
    strategyReports: number;
    rawPsiRuns: number;
    warningRuns: number;
    runtimeErrorRuns: number;
    invalidScoreRuns: number;
    lowSampleStrategies: number;
    sampleCountMismatches: number;
    scoreCellsChecked: number;
    scoreCellMismatches: number;
    findingsObserved: number;
    findingsPromoted: number;
    findingAggregationMismatches: number;
    agentScans: number;
    missingAgentScans: number;
    agentReadinessSnapshots: number;
    missingAgentReadinessSnapshots: number;
    agentReadinessSnapshotMismatches: number;
    mockRuns: number;
    jobsSucceeded: number;
    jobsFailed: number;
    jobsActive: number;
  };
  lighthouseVersions: Record<string, number>;
  pages: WeeklyPageAudit[];
}

interface StrategyReport {
  schemaVersion?: unknown;
  sampleSize?: unknown;
  scores?: unknown;
  raws?: unknown;
  runs?: unknown;
  findings?: unknown;
  quality?: unknown;
}

interface MutableMetrics {
  strategyReports: number;
  rawPsiRuns: number;
  warningRuns: number;
  runtimeErrorRuns: number;
  invalidScoreRuns: number;
  lowSampleStrategies: number;
  sampleCountMismatches: number;
  scoreCellsChecked: number;
  scoreCellMismatches: number;
  findingsObserved: number;
  findingsPromoted: number;
  findingAggregationMismatches: number;
  agentScans: number;
  missingAgentScans: number;
  agentReadinessSnapshots: number;
  missingAgentReadinessSnapshots: number;
  agentReadinessSnapshotMismatches: number;
  mockRuns: number;
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function numeric(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function median(values: number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : Math.round((sorted[middle - 1] + sorted[middle]) / 2);
}

function dateInPeriod(value: string | undefined, start: number, end: number): boolean {
  const time = value ? Date.parse(value) : Number.NaN;
  return Number.isFinite(time) && time >= start && time < end;
}

async function anonymousRef(kind: "tenant" | "page", tenant: string, value: string): Promise<string> {
  const input = new TextEncoder().encode(`fde-data-audit:v1:${kind}:${tenant}:${value}`);
  const digest = await crypto.subtle.digest("SHA-256", input);
  return [...new Uint8Array(digest)]
    .slice(0, 8)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function reportStrategies(value: unknown): Partial<Record<Strategy, StrategyReport>> | null {
  const payload = record(value);
  const strategies = record(payload?.strategies);
  if (!strategies) return null;
  const result: Partial<Record<Strategy, StrategyReport>> = {};
  for (const strategy of STRATEGIES) {
    const item = record(strategies[strategy]);
    if (item) result[strategy] = item;
  }
  return result;
}

function storedFindingIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const finding = record(item);
    return typeof finding?.id === "string" && finding.promoted === true ? [finding.id] : [];
  }).sort();
}

function sameIds(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function healthFor(metrics: {
  missingRawReports: number;
  runtimeErrorRuns: number;
  invalidScoreRuns: number;
  sampleCountMismatches: number;
  scoreCellMismatches: number;
  findingAggregationMismatches: number;
  missingAgentScans: number;
  missingAgentReadinessSnapshots: number;
  agentReadinessSnapshotMismatches: number;
  warningRuns: number;
  lowSampleStrategies: number;
  jobsFailed?: number;
  pagesWithoutCaptures?: number;
}): DataAuditHealth {
  if (
    metrics.missingRawReports > 0
    || metrics.runtimeErrorRuns > 0
    || metrics.invalidScoreRuns > 0
    || metrics.sampleCountMismatches > 0
    || metrics.scoreCellMismatches > 0
    || metrics.findingAggregationMismatches > 0
    || metrics.missingAgentScans > 0
    || metrics.missingAgentReadinessSnapshots > 0
    || metrics.agentReadinessSnapshotMismatches > 0
  ) return "failed";
  if (
    metrics.warningRuns > 0
    || metrics.lowSampleStrategies > 0
    || (metrics.jobsFailed ?? 0) > 0
    || (metrics.pagesWithoutCaptures ?? 0) > 0
  ) return "degraded";
  return "healthy";
}

function auditStrategy(
  strategy: Strategy,
  report: StrategyReport,
  night: Night,
  metrics: MutableMetrics,
  lighthouseVersions: Map<string, number>,
): void {
  metrics.strategyReports += 1;
  const raws = Array.isArray(report.raws)
    ? report.raws
    : Array.isArray(report.runs)
      ? report.runs
      : [];
  metrics.rawPsiRuns += raws.length;

  const validRuns = raws.flatMap((raw, index) => {
    const rawRecord = record(raw);
    if (rawRecord?.mock === true) metrics.mockRuns += 1;
    const lighthouse = record(rawRecord?.lighthouseResult);
    const version = typeof lighthouse?.lighthouseVersion === "string" ? lighthouse.lighthouseVersion : null;
    if (version) lighthouseVersions.set(version, (lighthouseVersions.get(version) ?? 0) + 1);
    if (lighthouseRuntimeError(raw)) {
      metrics.runtimeErrorRuns += 1;
      return [];
    }
    const scores = lighthouseScores(raw);
    if (!scores) {
      metrics.invalidScoreRuns += 1;
      return [];
    }
    const evidence = extractLighthouseRunEvidence(raw, index + 1);
    if (evidence.warnings.length > 0) metrics.warningRuns += 1;
    return [{ scores, evidence }];
  });

  const isEvidenceSchema = report.schemaVersion === 2;
  const scoringRuns = isEvidenceSchema
    ? validRuns.filter((item) => item.evidence.warnings.length === 0)
    : validRuns;
  if (scoringRuns.length < 3) metrics.lowSampleStrategies += 1;
  const reportedSamples = numeric(report.sampleSize) ?? numeric(night.samples?.[strategy]);
  if (reportedSamples !== null && reportedSamples !== scoringRuns.length) metrics.sampleCountMismatches += 1;

  if (scoringRuns.length > 0) {
    for (const category of CATEGORIES as { key: CategoryKey }[]) {
      const values = scoringRuns.map((item) => item.scores[category.key]);
      const expected = { m: median(values), lo: Math.min(...values), hi: Math.max(...values) };
      const actual = night.scores[strategy]?.[category.key];
      metrics.scoreCellsChecked += 1;
      if (!actual || actual.m !== expected.m || actual.lo !== expected.lo || actual.hi !== expected.hi) {
        metrics.scoreCellMismatches += 1;
      }
    }
  }

  const aggregated = aggregateLighthouseRunEvidence(
    validRuns.map((item) => item.evidence),
    Math.max(1, numeric(record(report.quality)?.requestedRuns) ?? raws.length),
  );
  metrics.findingsObserved += aggregated.findings.length;
  metrics.findingsPromoted += aggregated.findings.filter((finding) => finding.promoted).length;
  if (isEvidenceSchema) {
    const stored = storedFindingIds(report.findings);
    const expected = aggregated.findings.filter((finding) => finding.promoted).map((finding) => finding.id).sort();
    if (!sameIds(stored, expected)) metrics.findingAggregationMismatches += 1;
  }
}

function emptyMetrics(): MutableMetrics {
  return {
    strategyReports: 0,
    rawPsiRuns: 0,
    warningRuns: 0,
    runtimeErrorRuns: 0,
    invalidScoreRuns: 0,
    lowSampleStrategies: 0,
    sampleCountMismatches: 0,
    scoreCellsChecked: 0,
    scoreCellMismatches: 0,
    findingsObserved: 0,
    findingsPromoted: 0,
    findingAggregationMismatches: 0,
    agentScans: 0,
    missingAgentScans: 0,
    agentReadinessSnapshots: 0,
    missingAgentReadinessSnapshots: 0,
    agentReadinessSnapshotMismatches: 0,
    mockRuns: 0,
  };
}

function auditAgentReadiness(night: Night, metrics: MutableMetrics): void {
  const checks = Array.isArray(night.agent) ? night.agent : null;
  const snapshot = night.agentReadiness;
  if (checks) metrics.agentScans += 1;
  else metrics.missingAgentScans += 1;
  if (snapshot) metrics.agentReadinessSnapshots += 1;
  else metrics.missingAgentReadinessSnapshots += 1;
  if (!checks || !snapshot) return;

  const storedIgnoredCheckKeys = Array.isArray(snapshot.ignoredCheckKeys)
    ? [...snapshot.ignoredCheckKeys].sort()
    : [];
  const expected = captureAgentReadiness(checks, {
    checks: storedIgnoredCheckKeys,
    groups: [],
  });
  const fields = ["pass", "fail", "total", "unavailable", "ignored", "percent"] as const;
  if (
    fields.some((field) => snapshot[field] !== expected[field])
    || expected.ignoredCheckKeys.length !== storedIgnoredCheckKeys.length
    || expected.ignoredCheckKeys.some((key, index) => key !== storedIgnoredCheckKeys[index])
  ) {
    metrics.agentReadinessSnapshotMismatches += 1;
  }
}

/** Reduce one stored report to non-customer metrics so the raw payload can be released immediately. */
export function inspectStoredAuditCapture(capture: StoredAuditCapture): InspectedStoredAuditCapture {
  const metrics = emptyMetrics();
  const lighthouseVersions = new Map<string, number>();
  auditAgentReadiness(capture.night, metrics);
  if (capture.report !== null) {
    const strategies = reportStrategies(capture.report);
    if (!strategies) {
      metrics.invalidScoreRuns += 1;
    } else {
      for (const strategy of STRATEGIES) {
        const report = strategies[strategy];
        if (!report) {
          metrics.invalidScoreRuns += 1;
          continue;
        }
        auditStrategy(strategy, report, capture.night, metrics, lighthouseVersions);
      }
    }
  }
  return {
    pageId: capture.pageId,
    rawReportFound: capture.report !== null,
    missingRawReport: capture.report === null,
    ...metrics,
    lighthouseVersions: Object.fromEntries(lighthouseVersions),
  };
}

/** Build a privacy-safe audit from already-reduced per-capture observations. */
export async function buildWeeklyDataAuditFromInspections(
  input: WeeklyDataAuditFromInspectionsInput,
): Promise<WeeklyDataAudit> {
  const start = Date.parse(input.periodStart);
  const end = Date.parse(input.periodEnd);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start >= end) {
    throw new Error("Weekly audit period is invalid");
  }

  const periodJobs = input.jobs.filter((job) =>
    dateInPeriod(job.completedAt ?? job.updatedAt ?? job.createdAt, start, end));
  const pageIds = new Set([
    ...input.monitoredPageIds,
    ...input.inspections.map((capture) => capture.pageId),
    ...periodJobs.map((job) => job.pageId),
  ]);
  const pageRefs = new Map(await Promise.all([...pageIds].map(async (pageId) => [
    pageId,
    await anonymousRef("page", input.tenant, pageId),
  ] as const)));
  const lighthouseVersions = new Map<string, number>();
  const totalMetrics = emptyMetrics();
  let rawReportsFound = 0;
  let missingRawReports = 0;

  const pages = [...pageIds].map((pageId): WeeklyPageAudit => {
    const inspections = input.inspections.filter((capture) => capture.pageId === pageId);
    const metrics = emptyMetrics();
    const found = inspections.filter((capture) => capture.rawReportFound).length;
    const missing = inspections.filter((capture) => capture.missingRawReport).length;
    for (const inspection of inspections) {
      for (const key of Object.keys(metrics) as (keyof MutableMetrics)[]) {
        metrics[key] += inspection[key];
      }
      for (const [version, count] of Object.entries(inspection.lighthouseVersions)) {
        lighthouseVersions.set(version, (lighthouseVersions.get(version) ?? 0) + count);
      }
    }
    rawReportsFound += found;
    missingRawReports += missing;
    for (const key of Object.keys(metrics) as (keyof MutableMetrics)[]) totalMetrics[key] += metrics[key];
    const health = healthFor({
      ...metrics,
      missingRawReports: missing,
      pagesWithoutCaptures: input.monitoredPageIds.includes(pageId) && inspections.length === 0 ? 1 : 0,
    });
    return {
      pageRef: pageRefs.get(pageId)!,
      captures: inspections.length,
      rawReportsFound: found,
      missingRawReports: missing,
      strategyReports: metrics.strategyReports,
      rawPsiRuns: metrics.rawPsiRuns,
      warningRuns: metrics.warningRuns,
      runtimeErrorRuns: metrics.runtimeErrorRuns,
      invalidScoreRuns: metrics.invalidScoreRuns,
      lowSampleStrategies: metrics.lowSampleStrategies,
      sampleCountMismatches: metrics.sampleCountMismatches,
      scoreCellMismatches: metrics.scoreCellMismatches,
      findingAggregationMismatches: metrics.findingAggregationMismatches,
      agentScans: metrics.agentScans,
      missingAgentScans: metrics.missingAgentScans,
      agentReadinessSnapshots: metrics.agentReadinessSnapshots,
      missingAgentReadinessSnapshots: metrics.missingAgentReadinessSnapshots,
      agentReadinessSnapshotMismatches: metrics.agentReadinessSnapshotMismatches,
      health,
    };
  }).sort((left, right) => left.pageRef.localeCompare(right.pageRef));

  const jobsSucceeded = periodJobs.filter((job) => job.state === "succeeded").length;
  const jobsFailed = periodJobs.filter((job) => job.state === "failed").length;
  const jobsActive = periodJobs.length - jobsSucceeded - jobsFailed;
  const auditedPageIds = new Set(input.inspections.map((capture) => capture.pageId));
  const pagesWithoutCaptures = input.monitoredPageIds.filter((pageId) => !auditedPageIds.has(pageId)).length;
  const health = healthFor({
    ...totalMetrics,
    missingRawReports,
    jobsFailed,
    pagesWithoutCaptures,
  });

  return {
    schemaVersion: 1,
    auditType: "weekly-psi-data-accuracy",
    auditId: `weekly-${input.periodEnd.slice(0, 10)}`,
    generatedAt: input.generatedAt,
    periodStart: input.periodStart,
    periodEnd: input.periodEnd,
    tenantRef: await anonymousRef("tenant", input.tenant, input.tenant),
    privacy: {
      pageIdentifiers: "sha256-truncated",
      customerUrlsStored: false,
      customerPageNamesStored: false,
      rawLighthousePayloadsStored: false,
      rawErrorMessagesStored: false,
    },
    health,
    totals: {
      monitoredPages: input.monitoredPageIds.length,
      pagesAudited: auditedPageIds.size,
      pagesWithoutCaptures,
      captures: input.inspections.length,
      rawReportsFound,
      missingRawReports,
      ...totalMetrics,
      jobsSucceeded,
      jobsFailed,
      jobsActive,
    },
    lighthouseVersions: Object.fromEntries([...lighthouseVersions.entries()].sort(([left], [right]) => left.localeCompare(right))),
    pages,
  };
}

/** Convenience builder for tests and bounded callers; raw payloads are never copied into the output. */
export async function buildWeeklyDataAudit(input: WeeklyDataAuditInput): Promise<WeeklyDataAudit> {
  const start = Date.parse(input.periodStart);
  const end = Date.parse(input.periodEnd);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start >= end) {
    throw new Error("Weekly audit period is invalid");
  }
  const inspections = input.captures
    .filter((capture) => dateInPeriod(capture.night.iso, start, end))
    .map(inspectStoredAuditCapture);
  return buildWeeklyDataAuditFromInspections({
    tenant: input.tenant,
    generatedAt: input.generatedAt,
    periodStart: input.periodStart,
    periodEnd: input.periodEnd,
    monitoredPageIds: input.monitoredPageIds,
    jobs: input.jobs,
    inspections,
  });
}
