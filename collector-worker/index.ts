import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import {
  aggregatePsiRuns,
  classifyPsiFailure,
  runPsiOnce,
  summarizePsiMeasurements,
} from "../src/lib/psiCore";
import type { CompactRunResult, PsiFailureKind } from "../src/lib/psiCore";
import { scanPageContent } from "../src/lib/agentReadiness";
import { captureAgentReadiness } from "../src/lib/agentScoring";
import { costBand } from "../src/lib/cost";
import { mediansOf, nightHasStrategy, pageTrend } from "../src/lib/scoring";
import { shortDate } from "../src/lib/ui";
import type {
  CollectionResult,
  AggregatedLighthouseFinding,
  AppState,
  AgentCheck,
  CollectionJob,
  KitesurfEvidence,
  LighthouseCollectionQuality,
  LighthouseOpportunity,
  Night,
  NightScores,
  Rec,
  Strategy,
  StrategyScores,
  PsiMeasurementContext,
  CulpritEvidence,
  NativeElementScan,
  WatchPage,
} from "../src/lib/types";
import { mergeStrategyOpportunities, promotedDiagnostics } from "../src/lib/diagnostics";
import { formatDiagnosticImpact, webflowClassificationFor } from "../src/lib/webflowPerformance";
import { mergeNativeElementScans, nativeRecommendationOpportunities } from "../src/lib/nativeElements";
import { summarizeCulpritEvidence } from "../src/lib/culpritEvidence";
import { CATEGORIES, STRATEGIES } from "../src/lib/types";
import {
  EVIDENCE_RETRY_DELAY,
  EVIDENCE_RETRY_MAX_CYCLES,
  PSI_ATTEMPT_SPACING,
  evidenceRetryAt,
} from "../src/lib/collectionRetry";
import { createFdeStore } from "./dataStore";
import { handleDataPlaneRequest } from "./dataPlane";
import {
  oraScheduleLogEvent,
  ORA_REFRESH_CRON,
  ORA_SCHEDULER_STATUS_KEY,
  runScheduledOraRefresh,
} from "./oraSchedule";
import { dispatchFdeNightly, type DispatchPayload } from "./nightly";
import {
  runWeeklyDataAudit,
  tenantWeeklyAuditLatestKey,
  WEEKLY_AUDIT_CRON,
} from "./weeklyAudit";
import { evaluateCohortAnomaly } from "../src/lib/cohortAnomaly";
import { reconcileFieldOnlyRecommendationsInState } from "../src/lib/fieldOnlyRecommendations";
import {
  collectCruxEvidence,
  CRUX_COLLECTION_CRON,
  CRUX_SCHEDULER_STATUS_KEY,
  type CruxCollectionResult,
} from "./crux";
import { syncConfiguredWebflowSite } from "./webflow";
import { ensureScheduledDailyDigest, processDailyDigests } from "../src/lib/dailyDigest";
import {
  KITESURF_WORKFLOW_STEP_CONFIG,
  unavailableKitesurfEvidence,
  withUnavailableKitesurfFallback,
} from "../src/lib/kitesurfEvidence";
import { captureAndStoreKitesurfEvidence, type KitesurfCaptureResult } from "./kitesurf";
import {
  activeProjectTenants,
  runTenantTasks,
  tenantAllowed,
  tenantSchedulerStatusKey,
  type TenantTaskResult,
} from "./tenants";

const NIGHTLY_COLLECTION_CRON = "*/15 * * * *";
const NIGHTLY_SCHEDULER_STATUS_KEY = "scheduler/latest.json";
const AUDIT_SCHEDULER_STATUS_KEY = "scheduler/audit-latest.json";

type SchedulerKind = "nightly" | "crux" | "audit";

interface SchedulerBatch<T> {
  ok: boolean;
  tenants: number;
  projects: Array<TenantTaskResult<T>>;
}

interface StrategySummary {
  strategy: Strategy;
  capturedAt: string;
  scores: CollectionResult["scores"][Strategy];
  sampleSize: number;
  opportunities: LighthouseOpportunity[];
  diagnostics: AggregatedLighthouseFinding[];
  quality: LighthouseCollectionQuality;
  measurementContext: PsiMeasurementContext;
  culpritEvidence: CulpritEvidence[];
}

interface AgentSummary {
  checks: AgentCheck[];
  nativeElements: NativeElementScan;
  kitesurf: KitesurfEvidence;
  capturedAt: string;
}

interface CruxSummary {
  capturedAt: string;
}

type PsiAttemptOutcome =
  | { ok: true; run: CompactRunResult }
  | { ok: false; kind: PsiFailureKind; error: string };

function reportKey(tenant: string, jobId: string, strategy: Strategy): string {
  return `collector-jobs/${tenant}/${jobId}/${strategy}.json`;
}

function attemptReportKey(tenant: string, jobId: string, strategy: Strategy, attempt: number): string {
  return `collector-jobs/${tenant}/${jobId}/${strategy}-attempt-${attempt}.json`;
}

function legacyReportKey(jobId: string, strategy: Strategy): string {
  return `collector-jobs/${jobId}/${strategy}.json`;
}

function legacyAttemptReportKey(jobId: string, strategy: Strategy, attempt: number): string {
  return `collector-jobs/${jobId}/${strategy}-attempt-${attempt}.json`;
}

async function sameValue(left: string, right: string): Promise<boolean> {
  const encoder = new TextEncoder();
  const [leftHash, rightHash] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(left)),
    crypto.subtle.digest("SHA-256", encoder.encode(right)),
  ]);
  const leftBytes = new Uint8Array(leftHash);
  const rightBytes = new Uint8Array(rightHash);
  let difference = 0;
  for (let index = 0; index < leftBytes.length; index += 1) difference |= leftBytes[index] ^ rightBytes[index];
  return difference === 0;
}

async function markWorkflowRunning(env: Env, payload: DispatchPayload): Promise<void> {
  const store = createFdeStore(payload.tenant, env);
  await store.updateState((draft) => {
    if (draft.projectArchivedAt) throw new Error("Project archived");
    const job = (draft.jobs ?? []).find((item) => item.id === payload.jobId);
    const page = draft.pages.find((item) => item.id === payload.pageId);
    if (!job || !page || job.runId !== payload.runId || page.runId !== payload.runId) {
      throw new Error("Collection job no longer matches FDE state");
    }
    if (job.state === "succeeded") return;
    if (job.state === "failed") throw new Error(job.error ?? "Collection job was cancelled");
    if (job.state !== "running") {
      job.state = "running";
      job.attempts += 1;
      job.startedAt = job.startedAt ?? new Date().toISOString();
    }
    job.updatedAt = new Date().toISOString();
    page.runState = "running";
    page.startedAt = page.startedAt ?? job.startedAt;
  });
}

async function markWorkflowEvidenceProgress(
  env: Env,
  payload: DispatchPayload,
  progress: {
    waiting?: boolean;
    completedStrategies: Strategy[];
    strategyAttempts: Partial<Record<Strategy, number>>;
    strategyErrors: Partial<Record<Strategy, string>>;
    cruxCompletedAt?: string;
    cruxError?: string;
    agentCompletedAt?: string;
    agentError?: string;
    nextRetryAt?: string;
  },
): Promise<void> {
  const store = createFdeStore(payload.tenant, env);
  await store.updateState((draft) => {
    if (draft.projectArchivedAt) throw new Error("Project archived");
    const job = (draft.jobs ?? []).find((item) => item.id === payload.jobId);
    const page = draft.pages.find((item) => item.id === payload.pageId);
    if (!job || !page || job.state === "succeeded" || job.state === "inconclusive") return;
    if (job.state === "failed") throw new Error(job.error ?? "Collection job was cancelled");
    if (progress.waiting !== undefined) {
      job.state = progress.waiting ? "waiting_for_evidence" : "running";
      if (page.runId === payload.runId) {
        page.runState = progress.waiting ? "waiting_for_evidence" : "running";
      }
    }
    job.completedStrategies = progress.completedStrategies;
    job.strategyAttempts = progress.strategyAttempts;
    job.strategyErrors = progress.strategyErrors;
    if (progress.cruxCompletedAt) job.cruxCompletedAt = progress.cruxCompletedAt;
    if (progress.cruxError) job.cruxError = progress.cruxError;
    else if (progress.cruxCompletedAt) delete job.cruxError;
    if (progress.agentCompletedAt) job.agentCompletedAt = progress.agentCompletedAt;
    if (progress.agentError) job.agentError = progress.agentError;
    else if (progress.agentCompletedAt) delete job.agentError;
    if (progress.nextRetryAt) job.nextRetryAt = progress.nextRetryAt;
    else if (progress.waiting === false) delete job.nextRetryAt;
    job.updatedAt = new Date().toISOString();
  });
}

async function stagedReport(env: Env, tenant: string, jobId: string, strategy: Strategy): Promise<unknown> {
  const report = await env.REPORTS.get(reportKey(tenant, jobId, strategy))
    ?? await env.REPORTS.get(legacyReportKey(jobId, strategy));
  if (!report) throw new Error(`Staged ${strategy} report is missing`);
  return report.json();
}

function fallbackScores(page: WatchPage, strategy: Strategy): NightScores {
  const latest = [...page.history].reverse().find((night) => nightHasStrategy(night, strategy));
  if (latest) return structuredClone(latest.scores[strategy]);
  if (page.baseline?.[strategy]) return structuredClone(page.baseline[strategy]);
  return Object.fromEntries(CATEGORIES.map(({ key }) => {
    const value = page.current[strategy][key];
    return [key, { m: value, lo: value, hi: value }];
  })) as NightScores;
}

function ensureWorkflowNight(
  page: WatchPage,
  payload: DispatchPayload,
  capturedAt: string,
): Night {
  const existing = page.history.find((night) => night.runId === payload.runId);
  if (existing) return existing;
  const completedAt = new Date(capturedAt);
  const night: Night = {
    i: page.history.reduce((max, item) => Math.max(max, item.i), -1) + 1,
    runId: payload.runId,
    date: shortDate(completedAt),
    iso: completedAt.toISOString(),
    scores: {
      mobile: fallbackScores(page, "mobile"),
      desktop: fallbackScores(page, "desktop"),
    },
    availableStrategies: [],
    strategyCapturedAt: {},
    samples: {},
    rawReportKey: `run-${payload.runId}`,
    opportunities: [],
    collectionQuality: {},
    cohortId: payload.cohortId,
    measurementContext: {},
  };
  page.history.push(night);
  if (page.history.length > 180) page.history = page.history.slice(-180);
  return night;
}

function insertRecommendations(
  draft: AppState,
  page: WatchPage,
  job: CollectionJob,
  opportunities: LighthouseOpportunity[],
  capturedAt: string,
): void {
  const added = shortDate(new Date(capturedAt));
  for (const opportunity of opportunities.slice(0, 6)) {
    const title = opportunity.title.trim().toLowerCase();
    if (draft.recs.some((item) =>
      item.key === `${page.id}:${opportunity.id}`
      || (item.pageId === page.id && item.title.trim().toLowerCase() === title))) continue;
    const rec: Rec = {
      key: `${page.id}:${opportunity.id}`,
      pageId: page.id,
      pageTitle: page.title,
      url: page.url,
      id: opportunity.id,
      sourceRunId: job.runId,
      title: opportunity.title,
      category: opportunity.category ?? "Performance",
      savings: `${(opportunity.savingsMs / 1000).toFixed(1)} s`,
      estTime: costBand(`${opportunity.id} ${opportunity.title}`),
      status: "inbox",
      taskStatus: "todo",
      added,
      doneDate: null,
    };
    draft.recs.push(rec);
  }
}

async function commitWorkflowStrategy(
  env: Env,
  payload: DispatchPayload,
  summary: StrategySummary,
): Promise<void> {
  const store = createFdeStore(payload.tenant, env);
  const strategyReportKey = `run-${payload.runId}-${summary.strategy}`;
  const snapshot = await store.getState();
  if (snapshot.projectArchivedAt) throw new Error("Project archived");
  await store.putReport(payload.pageId, strategyReportKey, await stagedReport(env, payload.tenant, payload.jobId, summary.strategy));
  await store.updateState((draft) => {
    if (draft.projectArchivedAt) throw new Error("Project archived");
    const job = (draft.jobs ?? []).find((item) => item.id === payload.jobId);
    const page = draft.pages.find((item) => item.id === payload.pageId);
    if (!job || !page || job.runId !== payload.runId || page.runId !== payload.runId) {
      throw new Error("Collection strategy no longer matches FDE state");
    }
    if (job.state === "failed" || job.state === "inconclusive") {
      throw new Error(job.error ?? "Collection job was cancelled");
    }
    const night = ensureWorkflowNight(page, payload, summary.capturedAt);
    night.scores[summary.strategy] = summary.scores;
    night.availableStrategies = [...new Set([...(night.availableStrategies ?? STRATEGIES), summary.strategy])];
    night.strategyCapturedAt = { ...night.strategyCapturedAt, [summary.strategy]: summary.capturedAt };
    night.strategyReportKeys = { ...night.strategyReportKeys, [summary.strategy]: strategyReportKey };
    night.samples = { ...night.samples, [summary.strategy]: summary.sampleSize };
    night.sampleSize = Math.min(...Object.values(night.samples).filter((value): value is number => typeof value === "number"));
    night.collectionQuality = { ...night.collectionQuality, [summary.strategy]: summary.quality };
    night.measurementContext = { ...night.measurementContext, [summary.strategy]: summary.measurementContext };
    night.opportunitiesByStrategy = { ...night.opportunitiesByStrategy, [summary.strategy]: summary.opportunities };
    night.diagnostics = { ...night.diagnostics, [summary.strategy]: summary.diagnostics };
    night.culpritEvidence = { ...night.culpritEvidence, [summary.strategy]: summary.culpritEvidence };
    if (summary.strategy === "mobile") {
      night.opportunities = summary.opportunities;
      insertRecommendations(draft, page, job, summary.opportunities, summary.capturedAt);
    }
    page.current = { ...page.current, [summary.strategy]: mediansOf(summary.scores) };
    page.lastPsiRunAt = { ...page.lastPsiRunAt, [summary.strategy]: summary.capturedAt };
    page.lastRunAt = summary.capturedAt;
    page.status = pageTrend(page, "mobile");
    job.completedStrategies = [...new Set([...(job.completedStrategies ?? []), summary.strategy])];
    job.updatedAt = summary.capturedAt;
  });
}

async function commitWorkflowAgent(
  env: Env,
  payload: DispatchPayload,
  summary: AgentSummary,
): Promise<void> {
  const store = createFdeStore(payload.tenant, env);
  await store.updateState((draft) => {
    if (draft.projectArchivedAt) throw new Error("Project archived");
    const job = (draft.jobs ?? []).find((item) => item.id === payload.jobId);
    const page = draft.pages.find((item) => item.id === payload.pageId);
    if (!job || !page || job.runId !== payload.runId || page.runId !== payload.runId) {
      throw new Error("Agent collection no longer matches FDE state");
    }
    if (job.state === "failed" || job.state === "inconclusive") {
      throw new Error(job.error ?? "Collection job was cancelled");
    }
    const agent = summary.checks.map((check) => {
      const before = page.agent.find((prior) => prior.name === check.name);
      return { ...check, regressed: !!before && before.pass && !check.pass };
    });
    const night = ensureWorkflowNight(page, payload, summary.capturedAt);
    night.agent = agent;
    night.nativeElements = summary.nativeElements;
    night.kitesurf = summary.kitesurf;
    night.agentCapturedAt = summary.capturedAt;
    night.agentReadiness = captureAgentReadiness(
      agent,
      page.agentIgnores,
      draft.agentIgnoreDefaults,
      page.agentIgnoreRestores,
    );
    page.agent = agent;
    page.lastAgentRunAt = summary.capturedAt;
    page.lastRunAt = summary.capturedAt;
    job.agentCompletedAt = summary.capturedAt;
    delete job.agentError;
    job.updatedAt = summary.capturedAt;
  });
}

async function commitWorkflowResult(
  env: Env,
  payload: DispatchPayload,
  result: CollectionResult,
  auxiliary: { cruxError?: string; agentError?: string } = {},
): Promise<void> {
  const store = createFdeStore(payload.tenant, env);
  const snapshot = await store.getState();
  if (snapshot.projectArchivedAt) throw new Error("Project archived");
  const job = (snapshot.jobs ?? []).find((item) => item.id === payload.jobId);
  if (!job) throw new Error(`Collection job ${payload.jobId} not found in FDE state`);
  if (job.state === "succeeded") return;
  if (job.runId !== payload.runId || job.pageId !== payload.pageId) throw new Error("Collection result identity mismatch");

  const [mobile, desktop] = await Promise.all([
    stagedReport(env, payload.tenant, payload.jobId, "mobile"),
    stagedReport(env, payload.tenant, payload.jobId, "desktop"),
  ]);
  const completedAt = new Date(result.capturedAt);
  const visitorEvidence = await store.getCruxEvidence().catch(() => []);
  await store.putReport(payload.pageId, `run-${payload.runId}`, { strategies: { mobile, desktop } });

  await store.updateState((draft) => {
    if (draft.projectArchivedAt) throw new Error("Project archived");
    const currentJob = (draft.jobs ?? []).find((item) => item.id === payload.jobId);
    const page = draft.pages.find((item) => item.id === payload.pageId);
    if (!currentJob || !page) throw new Error("Collection target disappeared during FDE commit");
    const night = page.history.find((item) => item.runId === payload.runId);
    if (!night) throw new Error("Independent collection results disappeared before finalization");
    night.scores = result.scores;
    night.availableStrategies = [...STRATEGIES];
    night.samples = result.samples;
    night.sampleSize = Math.min(result.samples.mobile, result.samples.desktop);
    night.opportunities = result.opportunities;
    night.opportunitiesByStrategy = result.opportunitiesByStrategy;
    night.diagnostics = result.diagnostics;
    night.culpritEvidence = result.culpritEvidence;
    night.nativeElements = result.nativeElements;
    night.kitesurf = result.kitesurf;
    night.collectionQuality = result.collectionQuality;
    night.cohortId = result.cohortId;
    night.measurementContext = result.measurementContext;
    night.rawReportKey = `run-${payload.runId}`;
    if (currentJob.kind === "baseline") {
      page.baseline = result.scores;
      page.baselineCapturedAt = completedAt.toISOString();
      page.current = {
        mobile: mediansOf(result.scores.mobile),
        desktop: mediansOf(result.scores.desktop),
      };
      page.status = "stable";
    }
    const added = shortDate(completedAt);
    const recommendationOpportunities = [
      ...mergeStrategyOpportunities(
        result.opportunitiesByStrategy ?? { mobile: result.opportunities },
        result.diagnostics,
      ),
      ...nativeRecommendationOpportunities(result.nativeElements, page.nativeElementControls),
    ];
    for (const opportunity of recommendationOpportunities.slice(0, 12)) {
      const title = opportunity.title.trim().toLowerCase();
      const existing = draft.recs.find((item) =>
        item.key === `${page.id}:${opportunity.id}`
        || (item.pageId === page.id && item.title.trim().toLowerCase() === title));
      if (existing) {
        existing.strategies = [...new Set([...(existing.strategies ?? []), ...opportunity.strategies])];
        existing.webflow = webflowClassificationFor(opportunity);
        continue;
      }
      const rec: Rec = {
        key: `${page.id}:${opportunity.id}`,
        pageId: page.id,
        pageTitle: page.title,
        url: page.url,
        id: opportunity.id,
        strategies: opportunity.strategies,
        sourceRunId: currentJob.runId,
        title: opportunity.title,
        category: opportunity.category ?? "Performance",
        webflow: webflowClassificationFor(opportunity),
        savings: formatDiagnosticImpact(opportunity),
        estTime: costBand(`${opportunity.id} ${opportunity.title}`),
        status: "inbox",
        taskStatus: "todo",
        added,
        doneDate: null,
      };
      draft.recs.push(rec);
    }
    reconcileFieldOnlyRecommendationsInState(
      draft,
      visitorEvidence,
      completedAt,
      [page.id],
      currentJob.runId,
    );
    currentJob.state = "succeeded";
    currentJob.completedStrategies = [...STRATEGIES];
    delete currentJob.nextRetryAt;
    delete currentJob.strategyErrors;
    if (auxiliary.cruxError) currentJob.cruxError = auxiliary.cruxError;
    else delete currentJob.cruxError;
    if (auxiliary.agentError) currentJob.agentError = auxiliary.agentError;
    else delete currentJob.agentError;
    currentJob.updatedAt = completedAt.toISOString();
    currentJob.completedAt = completedAt.toISOString();
    delete currentJob.error;
    if (page.runId === currentJob.runId) {
      page.runState = undefined;
      page.lastRunAt = completedAt.toISOString();
      page.lastCollectionStatus = auxiliary.cruxError || auxiliary.agentError ? "partial" : "trusted";
      delete page.lastError;
    }
    if (result.cohortId) evaluateCohortAnomaly(draft, result.cohortId, completedAt);
  });
}

async function markWorkflowInconclusive(env: Env, payload: DispatchPayload, error: unknown): Promise<void> {
  const store = createFdeStore(payload.tenant, env);
  const message = (error instanceof Error ? error.message : String(error)).slice(0, 500);
  await store.updateState((draft) => {
    const job = (draft.jobs ?? []).find((item) => item.id === payload.jobId);
    const page = draft.pages.find((item) => item.id === payload.pageId);
    if (!job || job.state === "succeeded" || job.state === "failed") return;
    const completedAt = new Date().toISOString();
    job.state = "inconclusive";
    delete job.nextRetryAt;
    job.error = message;
    job.updatedAt = completedAt;
    job.completedAt = completedAt;
    if (page?.runId === payload.runId) {
      page.runState = undefined;
      page.lastRunAt = completedAt;
      page.lastCollectionStatus = (job.completedStrategies?.length ?? 0) > 0 || !!job.cruxCompletedAt || !!job.agentCompletedAt
        ? "partial"
        : "inconclusive";
      page.lastError = message;
    }
    if (payload.cohortId) evaluateCohortAnomaly(draft, payload.cohortId, new Date(completedAt));
  });
}

class InconclusiveEvidenceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InconclusiveEvidenceError";
  }
}

async function stagedAttemptRaws(
  env: Env,
  tenant: string,
  jobId: string,
  strategy: Strategy,
  attempts: number,
): Promise<unknown[]> {
  const raws: unknown[] = [];
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const object = await env.REPORTS.get(attemptReportKey(tenant, jobId, strategy, attempt))
      ?? await env.REPORTS.get(legacyAttemptReportKey(jobId, strategy, attempt));
    if (object) raws.push(await object.json());
  }
  return raws;
}

async function failWorkflowJob(env: Env, payload: DispatchPayload, error: unknown): Promise<void> {
  const store = createFdeStore(payload.tenant, env);
  const message = (error instanceof Error ? error.message : String(error)).slice(0, 500);
  await store.updateState((draft) => {
    const job = (draft.jobs ?? []).find((item) => item.id === payload.jobId);
    const page = draft.pages.find((item) => item.id === payload.pageId);
    if (!job || job.state === "succeeded" || job.state === "failed") return;
    const completedAt = new Date().toISOString();
    job.state = "failed";
    delete job.nextRetryAt;
    job.error = message;
    job.updatedAt = completedAt;
    job.completedAt = completedAt;
    if (page?.runId === payload.runId) {
      page.runState = "failed";
      page.lastError = message;
      page.lastRunAt = completedAt;
    }
    if (payload.cohortId) evaluateCohortAnomaly(draft, payload.cohortId, new Date(completedAt));
  });
}

export class CollectorWorkflow extends WorkflowEntrypoint<Env, DispatchPayload> {
  async run(event: Readonly<WorkflowEvent<DispatchPayload>>, step: WorkflowStep): Promise<CollectionResult> {
    const payload = event.payload;
    try {
      if (payload.startDelayMinutes && payload.startDelayMinutes > 0) {
        await step.sleep("stagger collection start", `${payload.startDelayMinutes} minutes`);
      }
      await step.do("mark FDE job running", async () => markWorkflowRunning(this.env, payload));
      const compactRuns: Record<Strategy, CompactRunResult[]> = { mobile: [], desktop: [] };
      const attempts: Record<Strategy, number> = { mobile: 0, desktop: 0 };
      const retained: Partial<Record<Strategy, StrategySummary>> = {};
      const lastErrors: Partial<Record<Strategy, string>> = {};
      let crux: CruxSummary | undefined;
      let cruxError: string | undefined;
      let agent: AgentSummary | undefined;
      let agentError: string | undefined;
      let kitesurf: KitesurfCaptureResult | undefined;

      for (let cycle = 0; cycle < EVIDENCE_RETRY_MAX_CYCLES; cycle += 1) {
        if (!crux) {
          try {
            crux = await step.do(
              `collect CrUX cycle ${cycle + 1}`,
              { retries: { limit: 2, delay: "10 seconds" }, timeout: "3 minutes" },
              async (): Promise<CruxSummary> => {
                const result = await collectCruxEvidence(this.env, {
                  tenant: payload.tenant,
                  pageIds: [payload.pageId],
                });
                if (result.pages !== 1) throw new Error("CrUX page target is unavailable");
                if (!result.ok) throw new Error(`${result.errors} CrUX target${result.errors === 1 ? "" : "s"} failed`);
                return { capturedAt: new Date().toISOString() };
              },
            );
            cruxError = undefined;
          } catch (error) {
            cruxError = (error instanceof Error ? error.message : String(error)).slice(0, 200);
          }
        }

        if (!kitesurf) {
          kitesurf = await withUnavailableKitesurfFallback(
            () => step.do(
              "capture Kitesurf rendered evidence",
              KITESURF_WORKFLOW_STEP_CONFIG,
              async (): Promise<KitesurfCaptureResult> => {
                return await captureAndStoreKitesurfEvidence(this.env, {
                  tenant: payload.tenant,
                  pageId: payload.pageId,
                  runId: payload.runId,
                  url: payload.url,
                });
              },
            ),
            (unavailable) => console.warn(JSON.stringify({
              message: "Kitesurf rendered probe unavailable",
              jobId: payload.jobId,
              pageId: payload.pageId,
              error: unavailable.reason,
            })),
          );
        }

        if (!agent) {
          try {
            const collectedAgent = await step.do(
              `scan agent readiness cycle ${cycle + 1}`,
              { retries: { limit: 2, delay: "10 seconds" }, timeout: "2 minutes" },
              async (): Promise<AgentSummary> => {
                const pageScan = await scanPageContent(payload.url);
                return {
                  checks: pageScan.agent,
                  nativeElements: mergeNativeElementScans(pageScan.nativeElements, kitesurf?.nativeElements),
                  kitesurf: kitesurf?.evidence ?? unavailableKitesurfEvidence("probe not attempted"),
                  capturedAt: new Date().toISOString(),
                };
              },
            );
            await step.do(
              `commit agent readiness cycle ${cycle + 1}`,
              { retries: { limit: 5, delay: "5 seconds", backoff: "exponential" }, timeout: "2 minutes" },
              async () => commitWorkflowAgent(this.env, payload, collectedAgent),
            );
            agent = collectedAgent;
            agentError = undefined;
          } catch (error) {
            agentError = (error instanceof Error ? error.message : String(error)).slice(0, 200);
          }
        }

        for (const strategy of STRATEGIES) {
          if (retained[strategy]) continue;

          for (let slot = 0; slot < payload.runs; slot += 1) {
            const currentRuns = compactRuns[strategy];
            if (
              currentRuns.length > 0
              && aggregatePsiRuns(currentRuns, payload.runs).quality.status === "reliable"
            ) break;
            if (attempts[strategy] > 0 && slot > 0) {
              await step.sleep(`space ${strategy} attempt ${attempts[strategy] + 1}`, PSI_ATTEMPT_SPACING);
            }
            attempts[strategy] += 1;
            const attempt = attempts[strategy];
            try {
              const outcome = await step.do(
                `collect ${strategy} attempt ${attempt}`,
                { retries: { limit: 0, delay: "1 second" }, timeout: "2 minutes" },
                async (): Promise<PsiAttemptOutcome> => {
                  const controller = new AbortController();
                  const timeout = setTimeout(() => controller.abort(), 105_000);
                  try {
                    const result = await runPsiOnce(payload.url, strategy, {
                      apiKey: this.env.PAGESPEED_API_KEY,
                      signal: controller.signal,
                    });
                    await this.env.REPORTS.put(
                      attemptReportKey(payload.tenant, payload.jobId, strategy, attempt),
                      JSON.stringify(result.raw),
                      {
                        httpMetadata: { contentType: "application/json" },
                        customMetadata: {
                          tenant: payload.tenant,
                          jobId: payload.jobId,
                          runId: payload.runId,
                          pageId: payload.pageId,
                          strategy,
                          attempt: String(attempt),
                        },
                      },
                    );
                    return {
                      ok: true,
                      run: {
                        scores: result.scores,
                        evidence: { ...result.evidence, run: attempt },
                        sampleKey: result.sampleKey,
                      },
                    };
                  } catch (error) {
                    return {
                      ok: false,
                      kind: classifyPsiFailure(error),
                      error: (error instanceof Error ? error.message : String(error)).slice(0, 200),
                    };
                  } finally {
                    clearTimeout(timeout);
                  }
                },
              );
              if (outcome.ok) {
                currentRuns.push(outcome.run);
                delete lastErrors[strategy];
              } else {
                lastErrors[strategy] = `${outcome.kind}: ${outcome.error}`;
                // Quota and target failures cannot be repaired by another
                // immediate request. The durable evidence cycle retries later.
                if (outcome.kind !== "transient") break;
              }
            } catch (error) {
              lastErrors[strategy] = (error instanceof Error ? error.message : String(error)).slice(0, 200);
            }
          }

          if (compactRuns[strategy].length === 0) continue;
          const summary = await step.do(
            `aggregate and stage ${strategy} cycle ${cycle + 1}`,
            { retries: { limit: 3, delay: "5 seconds", backoff: "exponential" }, timeout: "2 minutes" },
            async () => {
              const raws = await stagedAttemptRaws(this.env, payload.tenant, payload.jobId, strategy, attempts[strategy]);
              const result = aggregatePsiRuns(compactRuns[strategy], payload.runs, raws);
              const uniqueRaws = result.raws.filter((_, index) =>
                compactRuns[strategy].findIndex((candidate) =>
                  candidate.sampleKey === compactRuns[strategy][index]?.sampleKey) === index);
              await this.env.REPORTS.put(reportKey(payload.tenant, payload.jobId, strategy), JSON.stringify(result), {
                httpMetadata: { contentType: "application/json" },
                customMetadata: { tenant: payload.tenant, jobId: payload.jobId, runId: payload.runId, pageId: payload.pageId, strategy },
              });
              return {
                strategy,
                capturedAt: new Date().toISOString(),
                scores: result.scores,
                sampleSize: result.sampleSize,
                opportunities: result.opportunities,
                diagnostics: promotedDiagnostics(result.findings),
                quality: result.quality,
                measurementContext: summarizePsiMeasurements(uniqueRaws),
                culpritEvidence: summarizeCulpritEvidence(uniqueRaws),
              } satisfies StrategySummary;
            },
          );
          if (summary.quality.status === "reliable") {
            await step.do(
              `commit ${strategy} cycle ${cycle + 1}`,
              { retries: { limit: 5, delay: "5 seconds", backoff: "exponential" }, timeout: "2 minutes" },
              async () => commitWorkflowStrategy(this.env, payload, summary),
            );
            retained[strategy] = summary;
          }
        }

        const completedStrategies = STRATEGIES.filter((strategy) => !!retained[strategy]);
        await step.do(`record evidence progress cycle ${cycle + 1}`, async () =>
          markWorkflowEvidenceProgress(this.env, payload, {
            completedStrategies,
            strategyAttempts: { ...attempts },
            strategyErrors: { ...lastErrors },
            cruxCompletedAt: crux?.capturedAt,
            cruxError,
            agentCompletedAt: agent?.capturedAt,
            agentError,
          }));
        if (completedStrategies.length === STRATEGIES.length) break;

        if (cycle < EVIDENCE_RETRY_MAX_CYCLES - 1) {
          const nextRetryAt = await step.do(`schedule evidence retry ${cycle + 1}`, async () => evidenceRetryAt());
          await step.do(`mark evidence wait ${cycle + 1}`, async () =>
            markWorkflowEvidenceProgress(this.env, payload, {
              waiting: true,
              completedStrategies,
              strategyAttempts: { ...attempts },
              strategyErrors: { ...lastErrors },
              cruxCompletedAt: crux?.capturedAt,
              cruxError,
              agentCompletedAt: agent?.capturedAt,
              agentError,
              nextRetryAt,
            }));
          await step.sleep(`wait for collection evidence cycle ${cycle + 1}`, EVIDENCE_RETRY_DELAY);
          await step.do(`resume evidence cycle ${cycle + 1}`, async () =>
            markWorkflowEvidenceProgress(this.env, payload, {
              waiting: false,
              completedStrategies,
              strategyAttempts: { ...attempts },
              strategyErrors: { ...lastErrors },
              cruxCompletedAt: crux?.capturedAt,
              cruxError,
              agentCompletedAt: agent?.capturedAt,
              agentError,
            }));
        }
      }

      const missing = STRATEGIES.filter((strategy) => !retained[strategy]);
      if (missing.length > 0) {
        throw new InconclusiveEvidenceError(missing.map((strategy) => {
          const eligible = compactRuns[strategy].length > 0
            ? aggregatePsiRuns(compactRuns[strategy], payload.runs).quality.eligibleRuns
            : 0;
          const detail = lastErrors[strategy] ? `; latest error: ${lastErrors[strategy]}` : "";
          return `${strategy} measurement inconclusive after ${attempts[strategy]} attempts: `
            + `${eligible} unique warning-free measurements${detail}`;
        }).join("; "));
      }
      // Only compact summaries cross the Workflow persistence boundary. Full
      // Lighthouse payloads are staged in R2 as soon as each device is reliable.
      const mobile = retained.mobile!;
      const desktop = retained.desktop!;
      const capturedAt = await step.do("record capture time", async () =>
        [mobile.capturedAt, desktop.capturedAt, crux?.capturedAt, agent?.capturedAt]
          .filter((value): value is string => !!value)
          .sort()
          .at(-1)!,
      );
      const scores = { mobile: mobile.scores, desktop: desktop.scores } satisfies StrategyScores;
      const result = {
        schemaVersion: 2,
        jobId: payload.jobId,
        runId: payload.runId,
        pageId: payload.pageId,
        capturedAt,
        scores,
        samples: { mobile: mobile.sampleSize, desktop: desktop.sampleSize },
        agent: agent?.checks ?? [],
        nativeElements: agent?.nativeElements,
        kitesurf: agent?.kitesurf,
        opportunities: mobile.opportunities,
        opportunitiesByStrategy: {
          mobile: mobile.opportunities,
          desktop: desktop.opportunities,
        },
        diagnostics: {
          mobile: mobile.diagnostics,
          desktop: desktop.diagnostics,
        },
        culpritEvidence: {
          mobile: mobile.culpritEvidence,
          desktop: desktop.culpritEvidence,
        },
        collectionQuality: { mobile: mobile.quality, desktop: desktop.quality },
        cohortId: payload.cohortId,
        measurementContext: {
          mobile: mobile.measurementContext,
          desktop: desktop.measurementContext,
        },
      } satisfies CollectionResult;
      await step.do(
        "commit result to FDE storage",
        { retries: { limit: 5, delay: "5 seconds", backoff: "exponential" }, timeout: "2 minutes" },
        async () => commitWorkflowResult(this.env, payload, result, { cruxError, agentError }),
      );
      return result;
    } catch (error) {
      if (error instanceof InconclusiveEvidenceError) {
        await step.do("record FDE job inconclusive", async () =>
          markWorkflowInconclusive(this.env, payload, error));
      } else {
        await step.do("record FDE job failure", async () => failWorkflowJob(this.env, payload, error));
      }
      throw error;
    }
  }
}

function validPayload(value: unknown): value is DispatchPayload {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<DispatchPayload>;
  if (!item.jobId || !item.runId || !item.pageId || !item.url) return false;
  if (!Number.isInteger(item.runs) || item.runs! < 1 || item.runs! > 5) return false;
  if (
    item.startDelayMinutes !== undefined
    && (!Number.isInteger(item.startDelayMinutes) || item.startDelayMinutes < 0 || item.startDelayMinutes > 240)
  ) return false;
  if (!item.tenant || item.tenant.length > 160 || !/^[A-Za-z0-9:._-]+$/.test(item.tenant)) return false;
  try {
    const pageUrl = new URL(/^https?:\/\//i.test(item.url) ? item.url : `https://${item.url}`);
    return ["http:", "https:"].includes(pageUrl.protocol);
  } catch {
    return false;
  }
}

function jobRoute(pathname: string): { jobId: string; strategy?: Strategy } | null {
  const match = pathname.match(/^\/jobs\/([^/]+)(?:\/reports(?:\/(mobile|desktop))?)?$/);
  if (!match) return null;
  let jobId: string;
  try {
    jobId = decodeURIComponent(match[1]);
  } catch {
    return null;
  }
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(jobId)) return null;
  return { jobId, strategy: match[2] as Strategy | undefined };
}

function noStore(response: Response): Response {
  response.headers.set("cache-control", "no-store");
  return response;
}

function taskValueOk(value: unknown): boolean {
  if (!value || typeof value !== "object" || !("ok" in value)) return true;
  return (value as { ok?: unknown }).ok !== false;
}

function schedulerBatch<T>(projects: Array<TenantTaskResult<T>>): SchedulerBatch<T> {
  return {
    ok: projects.every((result) => result.status === "succeeded" && taskValueOk(result.value)),
    tenants: projects.length,
    projects,
  };
}

async function requestedProjectTenants(request: Request, env: Env): Promise<string[] | null> {
  const active = await activeProjectTenants(env);
  const requested = new URL(request.url).searchParams.get("tenant");
  if (!requested) return active;
  return tenantAllowed(requested, active) ? [requested] : null;
}

async function runNightlyAcrossProjects(
  env: Env,
  tenants: readonly string[],
  options: { scheduled: boolean; scheduledAt?: Date },
) {
  const projects = await runTenantTasks(tenants, async (tenant) => {
    const store = createFdeStore(tenant, env);
    const state = await store.getState();
    if (state.projectArchivedAt) return { skipped: "project-archived", archivedAt: state.projectArchivedAt };

    let webflow: unknown = null;
    if (options.scheduled) {
      try {
        webflow = await syncConfiguredWebflowSite(env, tenant);
      } catch (error) {
        webflow = { ok: false, error: error instanceof Error ? error.message : String(error) };
        console.error(JSON.stringify({ message: "Webflow activity sync failed", tenant, error: webflow }));
      }
    }

    const confirmation = options.scheduled
      ? await dispatchFdeNightly(env, { confirmationOnly: true, tenant })
      : null;
    const nightly = await dispatchFdeNightly(env, {
      tenant,
      ...(options.scheduled ? { dueOnly: true } : {}),
    });
    if (options.scheduled) await ensureScheduledDailyDigest(store, options.scheduledAt);
    // The digest links out of the app, so it needs the app's own address. Read
    // off a var rather than guessed from the request: the collector runs on a
    // cron with no request to guess from.
    const digests = await processDailyDigests(store, options.scheduledAt, undefined, {
      appUrl: (env as { PUBLIC_APP_URL?: string }).PUBLIC_APP_URL ?? "",
    });
    return { webflow, confirmation, nightly, digests };
  });
  return schedulerBatch(projects);
}

async function runCruxAcrossProjects(env: Env, tenants: readonly string[]) {
  const projects = await runTenantTasks(tenants, async (tenant) =>
    collectCruxEvidence(env, { tenant }));
  return schedulerBatch(projects);
}

async function runAuditAcrossProjects(env: Env, tenants: readonly string[], scheduledAt: Date) {
  const projects = await runTenantTasks(tenants, async (tenant) => {
    const archivedAt = (await createFdeStore(tenant, env).getState()).projectArchivedAt;
    if (archivedAt) return { skipped: "project-archived", archivedAt };
    const audit = await runWeeklyDataAudit(env, scheduledAt, { tenant });
    return { auditId: audit.auditId, health: audit.health, totals: audit.totals };
  });
  return schedulerBatch(projects);
}

async function writeTenantSchedulerStatuses(
  env: Env,
  kind: SchedulerKind,
  scheduledAt: string,
  observedAt: string,
  projects: Array<TenantTaskResult<unknown>>,
): Promise<void> {
  for (const project of projects) {
    const status = project.status === "failed"
      ? "failed"
      : taskValueOk(project.value) ? "succeeded" : "partial";
    const record = {
      status,
      scheduledAt,
      observedAt,
      tenant: project.tenant,
      ...(project.status === "succeeded" ? { response: project.value } : { message: project.error }),
    };
    try {
      await env.REPORTS.put(tenantSchedulerStatusKey(project.tenant, kind), JSON.stringify(record), {
        httpMetadata: { contentType: "application/json" },
      });
    } catch (error) {
      console.error(JSON.stringify({
        message: "tenant scheduler status write failed",
        tenant: project.tenant,
        kind,
        error: error instanceof Error ? error.message : String(error),
      }));
    }
  }
}

function cruxBatchTotals(batch: SchedulerBatch<CruxCollectionResult>) {
  const successful = batch.projects.flatMap((project) => project.status === "succeeded" ? [project.value] : []);
  return successful.reduce((totals, result) => ({
    available: totals.available + result.available,
    partial: totals.partial + result.partial,
    insufficient: totals.insufficient + result.insufficient,
    errors: totals.errors + result.errors,
  }), { available: 0, partial: 0, insufficient: 0, errors: 0 });
}

function auditBatchHealth(batch: SchedulerBatch<unknown>): "healthy" | "degraded" | "failed" {
  if (batch.projects.some((project) => project.status === "failed")) return "failed";
  const health = batch.projects.flatMap((project) => {
    if (project.status !== "succeeded" || !project.value || typeof project.value !== "object") return [];
    const value = (project.value as { health?: unknown }).health;
    return value === "healthy" || value === "degraded" || value === "failed" ? [value] : [];
  });
  if (health.includes("failed")) return "failed";
  return health.includes("degraded") ? "degraded" : "healthy";
}

async function handleRequest(request: Request, env: Env): Promise<Response> {
    const pathname = new URL(request.url).pathname;
    if (request.method === "GET" && pathname === "/health") {
      const [latestAudit, latestCrux] = await Promise.all([
        env.REPORTS.head(AUDIT_SCHEDULER_STATUS_KEY).catch(() => null),
        env.REPORTS.head(CRUX_SCHEDULER_STATUS_KEY).catch(() => null),
      ]);
      return noStore(Response.json({
        ok: true,
        service: "fde-page-collector",
        workflow: "fde-page-collection",
        storage: { d1: true, r2: true },
        resultTransport: "direct-fde-commit",
        dataAudit: latestAudit
          ? {
              status: latestAudit.customMetadata?.health ?? latestAudit.customMetadata?.status ?? "unknown",
              updatedAt: latestAudit.uploaded.toISOString(),
              projects: Number(latestAudit.customMetadata?.projects ?? 0),
              failed: Number(latestAudit.customMetadata?.failed ?? 0),
            }
          : { status: "pending" },
        crux: latestCrux
          ? {
              status: latestCrux.customMetadata?.status ?? "unknown",
              updatedAt: latestCrux.uploaded.toISOString(),
              available: Number(latestCrux.customMetadata?.available ?? 0),
              partial: Number(latestCrux.customMetadata?.partial ?? 0),
              insufficient: Number(latestCrux.customMetadata?.insufficient ?? 0),
              errors: Number(latestCrux.customMetadata?.errors ?? 0),
            }
          : { status: "pending" },
      }));
    }
    const route = jobRoute(pathname);
    const isDispatch = request.method === "POST" && (pathname === "/jobs" || pathname === "/jobs/batch");
    const isNightly = request.method === "POST" && pathname === "/nightly";
    const isCruxCollection = request.method === "POST" && pathname === "/crux/collect";
    const isAuditLatest = request.method === "GET" && pathname === "/audits/weekly/latest";
    const isDataPlane = pathname.startsWith("/data/");
    if (!isDispatch && !route && !isNightly && !isCruxCollection && !isAuditLatest && !isDataPlane) {
      return Response.json({ error: "not found" }, { status: 404 });
    }
    if (!(await sameValue(request.headers.get("authorization") ?? "", `Bearer ${env.CRON_SECRET}`))) {
      return Response.json({ error: "unauthorized" }, { status: 401 });
    }

    if (isNightly) {
      const tenants = await requestedProjectTenants(request, env);
      if (!tenants) return Response.json({ error: "unknown or archived tenant" }, { status: 404 });
      return noStore(Response.json(await runNightlyAcrossProjects(env, tenants, { scheduled: false }), { status: 202 }));
    }
    if (isCruxCollection) {
      const observedAt = new Date().toISOString();
      const tenants = await requestedProjectTenants(request, env);
      if (!tenants) return Response.json({ error: "unknown or archived tenant" }, { status: 404 });
      const result = await runCruxAcrossProjects(env, tenants);
      await writeTenantSchedulerStatuses(env, "crux", observedAt, observedAt, result.projects);
      const totals = cruxBatchTotals(result);
      const status = result.ok ? "succeeded" : "partial";
      await env.REPORTS.put(CRUX_SCHEDULER_STATUS_KEY, JSON.stringify({
        status,
        trigger: "manual",
        observedAt,
        response: result,
      }), {
        httpMetadata: { contentType: "application/json" },
        customMetadata: {
          status,
          projects: String(result.tenants),
          available: String(totals.available),
          partial: String(totals.partial),
          insufficient: String(totals.insufficient),
          errors: String(totals.errors),
        },
      });
      return noStore(Response.json(result));
    }
    if (isAuditLatest) {
      const active = await activeProjectTenants(env);
      const tenant = new URL(request.url).searchParams.get("tenant")
        ?? (env.NIGHTLY_TENANT || "brand-studio:live");
      if (!tenantAllowed(tenant, active)) return Response.json({ error: "unknown or archived tenant" }, { status: 404 });
      const audit = await env.REPORTS.get(tenantWeeklyAuditLatestKey(tenant));
      if (!audit) return Response.json({ error: "audit not found" }, { status: 404 });
      const headers = new Headers({ "content-type": "application/json", "cache-control": "no-store" });
      audit.writeHttpMetadata(headers);
      headers.set("etag", audit.httpEtag);
      return new Response(audit.body, { headers });
    }
    if (isDataPlane) {
      return await handleDataPlaneRequest(request, env) ?? Response.json({ error: "not found" }, { status: 404 });
    }

    if (route && request.method === "GET" && !route.strategy) {
      const instance = await env.COLLECTION_WORKFLOW.get(route.jobId);
      return noStore(Response.json(await instance.status()));
    }
    if (route && request.method === "GET" && route.strategy) {
      const tenants = await requestedProjectTenants(request, env);
      if (!tenants || tenants.length !== 1) return Response.json({ error: "tenant query parameter is required" }, { status: 400 });
      const report = await env.REPORTS.get(reportKey(tenants[0], route.jobId, route.strategy))
        ?? await env.REPORTS.get(legacyReportKey(route.jobId, route.strategy));
      if (!report) return Response.json({ error: "report not found" }, { status: 404 });
      const headers = new Headers({ "content-type": "application/json", "cache-control": "no-store" });
      report.writeHttpMetadata(headers);
      headers.set("etag", report.httpEtag);
      return new Response(report.body, { headers });
    }
    if (route && request.method === "DELETE" && !route.strategy && pathname.endsWith("/reports")) {
      const tenants = await requestedProjectTenants(request, env);
      if (!tenants || tenants.length !== 1) return Response.json({ error: "tenant query parameter is required" }, { status: 400 });
      await env.REPORTS.delete([
        reportKey(tenants[0], route.jobId, "mobile"),
        reportKey(tenants[0], route.jobId, "desktop"),
        legacyReportKey(route.jobId, "mobile"),
        legacyReportKey(route.jobId, "desktop"),
      ]);
      return noStore(Response.json({ ok: true }));
    }
    if (!isDispatch) return Response.json({ error: "method not allowed" }, { status: 405 });

    const body = await request.json().catch(() => null);
    const payloads = pathname === "/jobs/batch"
      ? ((body as { jobs?: unknown[] } | null)?.jobs ?? [])
      : [body];
    if (payloads.length < 1 || payloads.length > 100 || !payloads.every(validPayload)) {
      return Response.json({ error: "invalid job payload" }, { status: 400 });
    }
    const activeTenants = await activeProjectTenants(env);
    if (!payloads.every((payload) => tenantAllowed(payload.tenant, activeTenants))) {
      return Response.json({ error: "unknown or archived tenant" }, { status: 404 });
    }
    try {
      const options = payloads.map((payload) => ({
        id: payload.jobId,
        params: payload,
        retention: { successRetention: "30 days", errorRetention: "30 days" },
      } as const));
      const instances = options.length === 1
        ? [await env.COLLECTION_WORKFLOW.create(options[0])]
        : await env.COLLECTION_WORKFLOW.createBatch(options);
      return Response.json(
        options.length === 1
          ? { accepted: true, workflowId: instances[0].id }
          : { accepted: true, workflowIds: instances.map((instance) => instance.id) },
        { status: 202 },
      );
    } catch (error) {
      const instances = await Promise.all(payloads.map((payload) => env.COLLECTION_WORKFLOW.get(payload.jobId)));
      const statuses = await Promise.all(instances.map((instance) => instance.status()));
      if (statuses.every((status) => status.status !== "unknown")) {
        return Response.json(
          instances.length === 1
            ? { accepted: true, workflowId: instances[0].id, coalesced: true }
            : { accepted: true, workflowIds: instances.map((instance) => instance.id), coalesced: true },
          { status: 202 },
        );
      }
      return Response.json({ error: String(error) }, { status: 500 });
    }
}

const worker = {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      return await handleRequest(request, env);
    } catch (error) {
      console.error(JSON.stringify({
        message: "collector request failed",
        path: new URL(request.url).pathname,
        error: error instanceof Error ? error.message : String(error),
      }));
      return Response.json({ error: "internal error" }, { status: 500 });
    }
  },
  async scheduled(controller: ScheduledController, env: Env): Promise<void> {
    const observedAt = new Date().toISOString();

    // The external agent-audit refresh is handled entirely here and returns
    // before the collection scheduler machinery is touched, so it can never
    // block, delay, or change the outcome of a Page Watch collection.
    if (controller.cron === ORA_REFRESH_CRON) {
      try {
        const result = await runScheduledOraRefresh(env, await activeProjectTenants(env), {
          now: new Date(controller.scheduledTime),
        });
        await env.REPORTS.put(ORA_SCHEDULER_STATUS_KEY, JSON.stringify({
          status: result.enabled ? (result.ok ? "succeeded" : "partial") : "disabled",
          cron: controller.cron,
          scheduledAt: new Date(controller.scheduledTime).toISOString(),
          observedAt,
          response: result,
        }), {
          httpMetadata: { contentType: "application/json" },
          customMetadata: {
            status: result.enabled ? (result.ok ? "succeeded" : "partial") : "disabled",
            originsRefreshed: String(result.originsRefreshed),
            originsDeferred: String(result.originsDeferred),
            keyed: String(result.keyed),
          },
        });
        console.log(oraScheduleLogEvent(result));
      } catch (error) {
        // A failed external refresh is logged and dropped. It has no bearing on
        // any other scheduler, and there is nothing to roll back.
        console.error(JSON.stringify({
          message: "External agent audit scheduled refresh failed",
          operation: "scheduled-refresh",
          provider: "ora",
          observedAt,
          error: error instanceof Error ? error.message.slice(0, 300) : "unknown",
        }));
      }
      return;
    }

    const kind = controller.cron === WEEKLY_AUDIT_CRON
      ? "audit"
      : controller.cron === CRUX_COLLECTION_CRON
        ? "crux"
        : controller.cron === NIGHTLY_COLLECTION_CRON
          ? "nightly"
          : null;
    if (!kind) throw new Error(`Unsupported scheduler cron: ${controller.cron}`);
    const scheduler = kind === "audit"
      ? "weekly data audit"
      : kind === "crux" ? "weekly CrUX collection" : "nightly collection";
    const statusKey = kind === "audit"
      ? AUDIT_SCHEDULER_STATUS_KEY
      : kind === "crux" ? CRUX_SCHEDULER_STATUS_KEY : NIGHTLY_SCHEDULER_STATUS_KEY;
    try {
      const scheduledAt = new Date(controller.scheduledTime).toISOString();
      const tenants = await activeProjectTenants(env);
      const response = kind === "audit"
        ? await runAuditAcrossProjects(env, tenants, new Date(controller.scheduledTime))
        : kind === "crux"
          ? await runCruxAcrossProjects(env, tenants)
          : await runNightlyAcrossProjects(env, tenants, {
            scheduled: true,
            scheduledAt: new Date(controller.scheduledTime),
          });
      await writeTenantSchedulerStatuses(env, kind, scheduledAt, observedAt, response.projects);
      const cruxTotals = kind === "crux"
        ? cruxBatchTotals(response as SchedulerBatch<CruxCollectionResult>)
        : null;
      const auditHealth = kind === "audit"
        ? auditBatchHealth(response as SchedulerBatch<unknown>)
        : null;
      const failedProjects = response.projects.filter((project) => project.status === "failed").length;
      const record = {
        status: response.ok ? "succeeded" : "partial",
        cron: controller.cron,
        scheduledAt,
        observedAt,
        response,
      };
      await env.REPORTS.put(statusKey, JSON.stringify(record), {
        httpMetadata: { contentType: "application/json" },
        customMetadata: {
          status: record.status,
          projects: String(response.tenants),
          failed: String(failedProjects),
          ...(auditHealth ? { health: auditHealth } : {}),
          ...(cruxTotals ? {
            available: String(cruxTotals.available),
            partial: String(cruxTotals.partial),
            insufficient: String(cruxTotals.insufficient),
            errors: String(cruxTotals.errors),
          } : {}),
        },
      });
      console.log(JSON.stringify({ message: `${scheduler} scheduler completed`, ...record }));
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      const errorMessage = kind === "audit"
        ? `Weekly data audit execution failed: ${detail}`
        : kind === "crux"
          ? `Weekly CrUX collection failed: ${detail}`
          : detail;
      const record = {
        status: "failed",
        cron: controller.cron,
        scheduledAt: new Date(controller.scheduledTime).toISOString(),
        observedAt,
        message: errorMessage,
      };
      try {
        await env.REPORTS.put(statusKey, JSON.stringify(record), {
          httpMetadata: { contentType: "application/json" },
          customMetadata: {
            status: "failed",
            failed: "1",
            ...(kind === "audit" ? { health: "failed" } : {}),
            ...(kind === "crux" ? {
              available: "0",
              partial: "0",
              insufficient: "0",
              errors: "1",
            } : {}),
          },
        });
      } catch (statusError) {
        console.error(JSON.stringify({
          message: `${scheduler} scheduler status write failed`,
          error: statusError instanceof Error ? statusError.message : String(statusError),
        }));
      }
      console.error(JSON.stringify({ event: `${scheduler} scheduler failed`, ...record }));
      throw error;
    }
  },
} satisfies ExportedHandler<Env>;

export default worker;
