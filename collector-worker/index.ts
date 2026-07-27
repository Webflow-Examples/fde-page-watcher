import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import {
  aggregatePsiRuns,
  runPsiOnce,
  summarizePsiMeasurements,
} from "../src/lib/psiCore";
import type { CompactRunResult } from "../src/lib/psiCore";
import { scan } from "../src/lib/agentReadiness";
import { costBand } from "../src/lib/cost";
import { mediansOf } from "../src/lib/scoring";
import { shortDate } from "../src/lib/ui";
import type {
  CollectionResult,
  LighthouseCollectionQuality,
  LighthouseOpportunity,
  Rec,
  Strategy,
  StrategyScores,
  PsiMeasurementContext,
} from "../src/lib/types";
import { createFdeStore } from "./dataStore";
import { handleDataPlaneRequest } from "./dataPlane";
import { dispatchFdeNightly, type DispatchPayload } from "./nightly";
import { runWeeklyDataAudit, WEEKLY_AUDIT_CRON, WEEKLY_AUDIT_LATEST_KEY } from "./weeklyAudit";
import { evaluateCohortAnomaly } from "../src/lib/cohortAnomaly";
import {
  collectCruxEvidence,
  CRUX_COLLECTION_CRON,
  CRUX_SCHEDULER_STATUS_KEY,
  type CruxCollectionResult,
} from "./crux";
import { syncConfiguredWebflowSite } from "./webflow";

const NIGHTLY_COLLECTION_CRON = "*/15 * * * *";
const NIGHTLY_SCHEDULER_STATUS_KEY = "scheduler/latest.json";
const AUDIT_SCHEDULER_STATUS_KEY = "scheduler/audit-latest.json";

interface StrategySummary {
  strategy: Strategy;
  scores: CollectionResult["scores"][Strategy];
  sampleSize: number;
  opportunities: LighthouseOpportunity[];
  quality: LighthouseCollectionQuality;
  measurementContext: PsiMeasurementContext;
}

function reportKey(jobId: string, strategy: Strategy): string {
  return `collector-jobs/${jobId}/${strategy}.json`;
}

function attemptReportKey(jobId: string, strategy: Strategy, attempt: number): string {
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
  if (!payload.tenant) return;
  const store = createFdeStore(payload.tenant, env);
  await store.updateState((draft) => {
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

async function markWorkflowEvidenceWait(env: Env, payload: DispatchPayload, waiting: boolean): Promise<void> {
  if (!payload.tenant) return;
  const store = createFdeStore(payload.tenant, env);
  await store.updateState((draft) => {
    const job = (draft.jobs ?? []).find((item) => item.id === payload.jobId);
    const page = draft.pages.find((item) => item.id === payload.pageId);
    if (!job || !page || job.state === "succeeded" || job.state === "inconclusive") return;
    job.state = waiting ? "waiting_for_evidence" : "running";
    job.updatedAt = new Date().toISOString();
    if (page.runId === payload.runId) page.runState = waiting ? "waiting_for_evidence" : "running";
  });
}

async function stagedReport(env: Env, jobId: string, strategy: Strategy): Promise<unknown> {
  const report = await env.REPORTS.get(reportKey(jobId, strategy));
  if (!report) throw new Error(`Staged ${strategy} report is missing`);
  return report.json();
}

async function commitWorkflowResult(env: Env, payload: DispatchPayload, result: CollectionResult): Promise<void> {
  if (!payload.tenant) return;
  const store = createFdeStore(payload.tenant, env);
  const snapshot = await store.getState();
  const job = (snapshot.jobs ?? []).find((item) => item.id === payload.jobId);
  if (!job) throw new Error(`Collection job ${payload.jobId} not found in FDE state`);
  if (job.state === "succeeded") return;
  if (job.runId !== payload.runId || job.pageId !== payload.pageId) throw new Error("Collection result identity mismatch");

  const [mobile, desktop] = await Promise.all([
    stagedReport(env, payload.jobId, "mobile"),
    stagedReport(env, payload.jobId, "desktop"),
  ]);
  const completedAt = new Date(result.capturedAt);
  const appended = await store.appendNight(payload.pageId, payload.runId, {
    date: shortDate(completedAt),
    iso: completedAt.toISOString(),
    scores: result.scores,
    samples: result.samples,
    sampleSize: Math.min(result.samples.mobile, result.samples.desktop),
    agent: result.agent,
    opportunities: result.opportunities,
    collectionQuality: result.collectionQuality,
    cohortId: result.cohortId,
    measurementContext: result.measurementContext,
  }, { strategies: { mobile, desktop } });
  if (!appended.night) throw new Error("Collection result was superseded before FDE commit");

  await store.updateState((draft) => {
    const currentJob = (draft.jobs ?? []).find((item) => item.id === payload.jobId);
    const page = draft.pages.find((item) => item.id === payload.pageId);
    if (!currentJob || !page) throw new Error("Collection target disappeared during FDE commit");
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
    for (const opportunity of result.opportunities.slice(0, 6)) {
      const title = opportunity.title.trim().toLowerCase();
      if (draft.recs.some((item) => item.key === `${page.id}:${opportunity.id}` || (item.pageId === page.id && item.title.trim().toLowerCase() === title))) continue;
      const rec: Rec = {
        key: `${page.id}:${opportunity.id}`,
        pageId: page.id,
        pageTitle: page.title,
        url: page.url,
        id: opportunity.id,
        sourceRunId: currentJob.runId,
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
    currentJob.state = "succeeded";
    currentJob.updatedAt = completedAt.toISOString();
    currentJob.completedAt = completedAt.toISOString();
    delete currentJob.error;
    if (page.runId === currentJob.runId) {
      page.runState = undefined;
      page.lastRunAt = completedAt.toISOString();
      page.lastCollectionStatus = "trusted";
      delete page.lastError;
    }
    if (result.cohortId) evaluateCohortAnomaly(draft, result.cohortId, completedAt);
  });
}

async function markWorkflowInconclusive(env: Env, payload: DispatchPayload, error: unknown): Promise<void> {
  if (!payload.tenant) return;
  const store = createFdeStore(payload.tenant, env);
  const message = (error instanceof Error ? error.message : String(error)).slice(0, 500);
  await store.updateState((draft) => {
    const job = (draft.jobs ?? []).find((item) => item.id === payload.jobId);
    const page = draft.pages.find((item) => item.id === payload.pageId);
    if (!job || job.state === "succeeded") return;
    const completedAt = new Date().toISOString();
    job.state = "inconclusive";
    job.error = message;
    job.updatedAt = completedAt;
    job.completedAt = completedAt;
    if (page?.runId === payload.runId) {
      page.runState = undefined;
      page.lastRunAt = completedAt;
      page.lastCollectionStatus = "inconclusive";
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
  jobId: string,
  strategy: Strategy,
  attempts: number,
): Promise<unknown[]> {
  const raws: unknown[] = [];
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const object = await env.REPORTS.get(attemptReportKey(jobId, strategy, attempt));
    if (object) raws.push(await object.json());
  }
  return raws;
}

async function failWorkflowJob(env: Env, payload: DispatchPayload, error: unknown): Promise<void> {
  if (!payload.tenant) return;
  const store = createFdeStore(payload.tenant, env);
  const message = (error instanceof Error ? error.message : String(error)).slice(0, 500);
  await store.updateState((draft) => {
    const job = (draft.jobs ?? []).find((item) => item.id === payload.jobId);
    const page = draft.pages.find((item) => item.id === payload.pageId);
    if (!job || job.state === "succeeded") return;
    const completedAt = new Date().toISOString();
    job.state = "failed";
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
    const collectStrategy = async (strategy: Strategy): Promise<StrategySummary> => {
      const compactRuns: CompactRunResult[] = [];
      let attempts = 0;
      const maxCycles = 3;

      for (let cycle = 0; cycle < maxCycles; cycle += 1) {
        for (let slot = 0; slot < payload.runs; slot += 1) {
          if (
            cycle > 0
            && compactRuns.length > 0
            && aggregatePsiRuns(compactRuns, payload.runs).quality.status === "reliable"
          ) break;
          if (attempts > 0 && !(cycle > 0 && slot === 0)) {
            await step.sleep(`space ${strategy} attempt ${attempts + 1}`, "1 minute");
          }
          attempts += 1;
          const attempt = attempts;
          const compact = await step.do(
            `collect ${strategy} attempt ${attempt}`,
            { retries: { limit: 2, delay: "15 seconds", backoff: "exponential" }, timeout: "2 minutes" },
            async (): Promise<CompactRunResult> => {
              const result = await runPsiOnce(payload.url, strategy, {
                apiKey: this.env.PAGESPEED_API_KEY,
              });
              await this.env.REPORTS.put(
                attemptReportKey(payload.jobId, strategy, attempt),
                JSON.stringify(result.raw),
                {
                  httpMetadata: { contentType: "application/json" },
                  customMetadata: {
                    jobId: payload.jobId,
                    runId: payload.runId,
                    pageId: payload.pageId,
                    strategy,
                    attempt: String(attempt),
                  },
                },
              );
              return {
                scores: result.scores,
                evidence: { ...result.evidence, run: attempt },
                sampleKey: result.sampleKey,
              };
            },
          );
          compactRuns.push(compact);
        }

        const current = aggregatePsiRuns(compactRuns, payload.runs);
        if (current.quality.status === "reliable") break;
        if (cycle < maxCycles - 1) {
          await step.do(`mark ${strategy} evidence wait ${cycle + 1}`, async () =>
            markWorkflowEvidenceWait(this.env, payload, true));
          await step.sleep(`wait one hour for ${strategy} evidence ${cycle + 1}`, "1 hour");
          await step.do(`resume ${strategy} evidence ${cycle + 1}`, async () =>
            markWorkflowEvidenceWait(this.env, payload, false));
        }
      }

      const summary = await step.do(
        `aggregate and stage ${strategy}`,
        { retries: { limit: 3, delay: "5 seconds", backoff: "exponential" }, timeout: "2 minutes" },
        async () => {
          const raws = await stagedAttemptRaws(this.env, payload.jobId, strategy, attempts);
          const result = aggregatePsiRuns(compactRuns, payload.runs, raws);
          await this.env.REPORTS.put(reportKey(payload.jobId, strategy), JSON.stringify(result), {
            httpMetadata: { contentType: "application/json" },
            customMetadata: { jobId: payload.jobId, runId: payload.runId, pageId: payload.pageId, strategy },
          });
          return {
            strategy,
            scores: result.scores,
            sampleSize: result.sampleSize,
            opportunities: result.opportunities,
            quality: result.quality,
            measurementContext: summarizePsiMeasurements(
              result.raws.filter((_, index) =>
                compactRuns.findIndex((candidate) => candidate.sampleKey === compactRuns[index]?.sampleKey) === index),
            ),
          } satisfies StrategySummary;
        },
      );
      if (summary.quality.status !== "reliable") {
        throw new InconclusiveEvidenceError(
          `${strategy} measurement inconclusive after ${attempts} attempts: `
          + `${summary.quality.eligibleRuns} unique warning-free measurements`,
        );
      }
      return summary;
    };

    // Only compact summaries cross the Workflow persistence boundary. Full
    // Lighthouse payloads are staged in R2 and streamed to the app on demand.
    const mobile = await collectStrategy("mobile");
    const desktop = await collectStrategy("desktop");
    const agent = await step.do("scan agent readiness", { retries: { limit: 2, delay: "10 seconds" }, timeout: "2 minutes" }, async () => scan(payload.url));
    const capturedAt = await step.do("record capture time", async () =>
      new Date().toISOString(),
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
      agent,
      opportunities: mobile.opportunities,
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
        async () => commitWorkflowResult(this.env, payload, result),
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
  if (item.tenant !== undefined && (item.tenant.length > 160 || !/^[A-Za-z0-9:._-]+$/.test(item.tenant))) return false;
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

async function handleRequest(request: Request, env: Env): Promise<Response> {
    const pathname = new URL(request.url).pathname;
    if (request.method === "GET" && pathname === "/health") {
      const [latestAudit, latestCrux] = await Promise.all([
        env.REPORTS.head(WEEKLY_AUDIT_LATEST_KEY).catch(() => null),
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
              status: latestAudit.customMetadata?.health ?? "unknown",
              auditId: latestAudit.customMetadata?.auditId,
              updatedAt: latestAudit.uploaded.toISOString(),
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

    if (isNightly) return noStore(Response.json(await dispatchFdeNightly(env), { status: 202 }));
    if (isCruxCollection) {
      const observedAt = new Date().toISOString();
      const result = await collectCruxEvidence(env);
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
          available: String(result.available),
          partial: String(result.partial),
          insufficient: String(result.insufficient),
          errors: String(result.errors),
        },
      });
      return noStore(Response.json(result));
    }
    if (isAuditLatest) {
      const audit = await env.REPORTS.get(WEEKLY_AUDIT_LATEST_KEY);
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
      const report = await env.REPORTS.get(reportKey(route.jobId, route.strategy));
      if (!report) return Response.json({ error: "report not found" }, { status: 404 });
      const headers = new Headers({ "content-type": "application/json", "cache-control": "no-store" });
      report.writeHttpMetadata(headers);
      headers.set("etag", report.httpEtag);
      return new Response(report.body, { headers });
    }
    if (route && request.method === "DELETE" && !route.strategy && pathname.endsWith("/reports")) {
      await env.REPORTS.delete([reportKey(route.jobId, "mobile"), reportKey(route.jobId, "desktop")]);
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
      let response: unknown;
      if (kind === "audit") {
        const audit = await runWeeklyDataAudit(env, new Date(controller.scheduledTime));
        response = { auditId: audit.auditId, health: audit.health, totals: audit.totals };
      } else if (kind === "crux") {
        response = await collectCruxEvidence(env);
      } else {
        let webflow: unknown = null;
        try {
          webflow = await syncConfiguredWebflowSite(env, env.NIGHTLY_TENANT || "brand-studio:live");
        } catch (error) {
          webflow = {
            ok: false,
            error: error instanceof Error ? error.message : String(error),
          };
          console.error(JSON.stringify({
            message: "Webflow activity sync failed",
            tenant: env.NIGHTLY_TENANT || "brand-studio:live",
            error: webflow,
          }));
        }
        const confirmation = await dispatchFdeNightly(env, { confirmationOnly: true });
        const nightly = await dispatchFdeNightly(env, { dueOnly: true });
        response = { webflow, confirmation, nightly };
      }
      const cruxResponse = kind === "crux" ? response as CruxCollectionResult : null;
      const record = {
        status: cruxResponse && !cruxResponse.ok ? "partial" : "succeeded",
        cron: controller.cron,
        scheduledAt: new Date(controller.scheduledTime).toISOString(),
        observedAt,
        response,
      };
      await env.REPORTS.put(statusKey, JSON.stringify(record), {
        httpMetadata: { contentType: "application/json" },
        ...(cruxResponse ? {
          customMetadata: {
            status: record.status,
            available: String(cruxResponse.available),
            partial: String(cruxResponse.partial),
            insufficient: String(cruxResponse.insufficient),
            errors: String(cruxResponse.errors),
          },
        } : {}),
      });
      console.log(JSON.stringify({ message: `${scheduler} scheduler completed`, ...record }));
    } catch (error) {
      const errorMessage = kind === "audit"
        ? "Weekly data audit execution failed"
        : kind === "crux"
          ? "Weekly CrUX collection failed"
        : error instanceof Error ? error.message : String(error);
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
          ...(kind === "crux" ? {
            customMetadata: {
              status: "failed",
              available: "0",
              partial: "0",
              insufficient: "0",
              errors: "1",
            },
          } : {}),
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
