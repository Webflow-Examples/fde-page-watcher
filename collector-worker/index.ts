import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import { collectPsi } from "../src/lib/psiCore";
import { scan } from "../src/lib/agentReadiness";
import { costBand } from "../src/lib/cost";
import { mediansOf } from "../src/lib/scoring";
import { shortDate } from "../src/lib/ui";
import type { CollectionResult, LighthouseOpportunity, Rec, Strategy, StrategyScores } from "../src/lib/types";
import { createFdeStore } from "./dataStore";
import { handleDataPlaneRequest } from "./dataPlane";
import { dispatchFdeNightly, type DispatchPayload } from "./nightly";

const SCHEDULER_STATUS_KEY = "scheduler/latest.json";

interface StrategySummary {
  strategy: Strategy;
  scores: CollectionResult["scores"][Strategy];
  sampleSize: number;
  opportunities: LighthouseOpportunity[];
}

function reportKey(jobId: string, strategy: Strategy): string {
  return `collector-jobs/${jobId}/${strategy}.json`;
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
      delete page.lastError;
    }
  });
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
  });
}

export class CollectorWorkflow extends WorkflowEntrypoint<Env, DispatchPayload> {
  async run(event: Readonly<WorkflowEvent<DispatchPayload>>, step: WorkflowStep): Promise<CollectionResult> {
    const payload = event.payload;
    try {
      await step.do("mark FDE job running", async () => markWorkflowRunning(this.env, payload));
    const collectStrategy = (strategy: Strategy) => step.do(
      `collect and stage ${strategy}`,
      { retries: { limit: 3, delay: "15 seconds", backoff: "exponential" }, timeout: "10 minutes" },
      async () => {
        const result = await collectPsi(payload.url, strategy, {
          apiKey: this.env.PAGESPEED_API_KEY,
          runs: payload.runs,
        });
        await this.env.REPORTS.put(reportKey(payload.jobId, strategy), JSON.stringify(result), {
          httpMetadata: { contentType: "application/json" },
          customMetadata: { jobId: payload.jobId, runId: payload.runId, pageId: payload.pageId, strategy },
        });
        return {
          strategy,
          scores: result.scores,
          sampleSize: result.sampleSize,
          opportunities: result.opportunities,
        } satisfies StrategySummary;
      },
    );

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
      schemaVersion: 1,
      jobId: payload.jobId,
      runId: payload.runId,
      pageId: payload.pageId,
      capturedAt,
      scores,
      samples: { mobile: mobile.sampleSize, desktop: desktop.sampleSize },
      agent,
      opportunities: mobile.opportunities,
    } satisfies CollectionResult;
      await step.do(
        "commit result to FDE storage",
        { retries: { limit: 5, delay: "5 seconds", backoff: "exponential" }, timeout: "2 minutes" },
        async () => commitWorkflowResult(this.env, payload, result),
      );
      return result;
    } catch (error) {
      await step.do("record FDE job failure", async () => failWorkflowJob(this.env, payload, error));
      throw error;
    }
  }
}

function validPayload(value: unknown): value is DispatchPayload {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<DispatchPayload>;
  if (!item.jobId || !item.runId || !item.pageId || !item.url) return false;
  if (!Number.isInteger(item.runs) || item.runs! < 1 || item.runs! > 5) return false;
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
      return noStore(Response.json({ ok: true, service: "fde-page-collector", workflow: "fde-page-collection", storage: { d1: true, r2: true }, resultTransport: "direct-fde-commit" }));
    }
    const route = jobRoute(pathname);
    const isDispatch = request.method === "POST" && (pathname === "/jobs" || pathname === "/jobs/batch");
    const isNightly = request.method === "POST" && pathname === "/nightly";
    const isDataPlane = pathname.startsWith("/data/");
    if (!isDispatch && !route && !isNightly && !isDataPlane) {
      return Response.json({ error: "not found" }, { status: 404 });
    }
    if (!(await sameValue(request.headers.get("authorization") ?? "", `Bearer ${env.CRON_SECRET}`))) {
      return Response.json({ error: "unauthorized" }, { status: 401 });
    }

    if (isNightly) return noStore(Response.json(await dispatchFdeNightly(env), { status: 202 }));
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
    try {
      const result = await dispatchFdeNightly(env);
      const record = {
        status: "succeeded",
        cron: controller.cron,
        scheduledAt: new Date(controller.scheduledTime).toISOString(),
        observedAt,
        response: result,
      };
      await env.REPORTS.put(SCHEDULER_STATUS_KEY, JSON.stringify(record), {
        httpMetadata: { contentType: "application/json" },
      });
      console.log(JSON.stringify({ message: "nightly scheduler completed", ...record }));
    } catch (error) {
      const record = {
        status: "failed",
        cron: controller.cron,
        scheduledAt: new Date(controller.scheduledTime).toISOString(),
        observedAt,
        message: error instanceof Error ? error.message : String(error),
      };
      try {
        await env.REPORTS.put(SCHEDULER_STATUS_KEY, JSON.stringify(record), {
          httpMetadata: { contentType: "application/json" },
        });
      } catch (statusError) {
        console.error(JSON.stringify({
          message: "nightly scheduler status write failed",
          error: statusError instanceof Error ? statusError.message : String(statusError),
        }));
      }
      console.error(JSON.stringify({ event: "nightly scheduler failed", ...record }));
      throw error;
    }
  },
} satisfies ExportedHandler<Env>;

export default worker;
