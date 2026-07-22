import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import { collectPsi } from "../src/lib/psiCore";
import { scan } from "../src/lib/agentReadiness";
import type { CollectionResult, LighthouseOpportunity, Strategy, StrategyScores } from "../src/lib/types";
import { dispatchScheduledNightly, schedulerError, SCHEDULER_STATUS_KEY } from "./scheduler";

interface DispatchPayload {
  jobId: string;
  runId: string;
  pageId: string;
  url: string;
  runs: number;
}

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

export class CollectorWorkflow extends WorkflowEntrypoint<Env, DispatchPayload> {
  async run(event: Readonly<WorkflowEvent<DispatchPayload>>, step: WorkflowStep): Promise<CollectionResult> {
    const payload = event.payload;
    const collectStrategy = (strategy: Strategy) => step.do(
      `collect and stage ${strategy}`,
      { retries: { limit: 3, delay: "15 seconds", backoff: "exponential" }, timeout: "10 minutes" },
      async () => {
        const result = await collectPsi(payload.url, strategy, {
          apiKey: this.env.PAGESPEED_API_KEY,
          runs: payload.runs,
        });
        await this.env.RESULTS.put(reportKey(payload.jobId, strategy), JSON.stringify(result), {
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
    return {
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
  }
}

function validPayload(value: unknown): value is DispatchPayload {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<DispatchPayload>;
  if (!item.jobId || !item.runId || !item.pageId || !item.url) return false;
  if (!Number.isInteger(item.runs) || item.runs! < 1 || item.runs! > 5) return false;
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
      return noStore(Response.json({ ok: true, service: "fde-page-collector", workflow: "fde-page-collection", resultTransport: "polling" }));
    }
    const route = jobRoute(pathname);
    const isDispatch = request.method === "POST" && (pathname === "/jobs" || pathname === "/jobs/batch");
    if (!isDispatch && !route) {
      return Response.json({ error: "not found" }, { status: 404 });
    }
    if (!(await sameValue(request.headers.get("authorization") ?? "", `Bearer ${env.CRON_SECRET}`))) {
      return Response.json({ error: "unauthorized" }, { status: 401 });
    }

    if (route && request.method === "GET" && !route.strategy) {
      const instance = await env.COLLECTION_WORKFLOW.get(route.jobId);
      return noStore(Response.json(await instance.status()));
    }
    if (route && request.method === "GET" && route.strategy) {
      const report = await env.RESULTS.get(reportKey(route.jobId, route.strategy));
      if (!report) return Response.json({ error: "report not found" }, { status: 404 });
      const headers = new Headers({ "content-type": "application/json", "cache-control": "no-store" });
      report.writeHttpMetadata(headers);
      headers.set("etag", report.httpEtag);
      return new Response(report.body, { headers });
    }
    if (route && request.method === "DELETE" && !route.strategy && pathname.endsWith("/reports")) {
      await env.RESULTS.delete([reportKey(route.jobId, "mobile"), reportKey(route.jobId, "desktop")]);
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
      const result = await dispatchScheduledNightly(controller, env);
      const record = { ...result, observedAt };
      await env.RESULTS.put(SCHEDULER_STATUS_KEY, JSON.stringify(record), {
        httpMetadata: { contentType: "application/json" },
      });
      console.log(JSON.stringify({ message: "nightly scheduler completed", ...record }));
    } catch (error) {
      const detail = schedulerError(error);
      const record = {
        status: "failed",
        cron: controller.cron,
        scheduledAt: new Date(controller.scheduledTime).toISOString(),
        observedAt,
        ...detail,
      };
      try {
        await env.RESULTS.put(SCHEDULER_STATUS_KEY, JSON.stringify(record), {
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
