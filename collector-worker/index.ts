import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import { collectPsi } from "../src/lib/psiCore";
import { scan } from "../src/lib/agentReadiness";
import type { CollectionResult, LighthouseOpportunity, Strategy, StrategyScores } from "../src/lib/types";

interface DispatchPayload {
  jobId: string;
  runId: string;
  pageId: string;
  url: string;
  runs: number;
  callbackUrl: string;
}

interface Env {
  COLLECTION_WORKFLOW: Workflow<DispatchPayload>;
  PAGESPEED_API_KEY: string;
  CRON_SECRET: string;
}

interface StrategySummary {
  strategy: Strategy;
  scores: CollectionResult["scores"][Strategy];
  sampleSize: number;
  opportunities: LighthouseOpportunity[];
}

function sameValue(left: string, right: string): boolean {
  const length = Math.max(left.length, right.length);
  let difference = left.length ^ right.length;
  for (let index = 0; index < length; index += 1) {
    difference |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0);
  }
  return difference === 0;
}

async function callback(env: Env, payload: DispatchPayload, path: string, body: unknown): Promise<void> {
  const response = await fetch(`${payload.callbackUrl}/api/internal/jobs/${payload.jobId}/${path}`, {
    method: "POST",
    headers: { authorization: `Bearer ${env.CRON_SECRET}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`App callback ${path} failed (${response.status}): ${(await response.text()).slice(0, 200)}`);
}

export class CollectorWorkflow extends WorkflowEntrypoint<Env, DispatchPayload> {
  async run(event: Readonly<WorkflowEvent<DispatchPayload>>, step: WorkflowStep): Promise<CollectionResult> {
    const payload = event.payload;
    try {
      await step.do("mark job running", { retries: { limit: 5, delay: "5 seconds", backoff: "exponential" } }, async () => {
        await callback(this.env, payload, "start", { runId: payload.runId });
        return { ok: true };
      });

      const collectStrategy = (strategy: Strategy) => step.do(
        `collect and upload ${strategy}`,
        { retries: { limit: 3, delay: "15 seconds", backoff: "exponential" }, timeout: "10 minutes" },
        async () => {
          const result = await collectPsi(payload.url, strategy, {
            apiKey: this.env.PAGESPEED_API_KEY,
            runs: payload.runs,
          });
          await callback(this.env, payload, "strategy", { runId: payload.runId, strategy, result });
          return {
            strategy,
            scores: result.scores,
            sampleSize: result.sampleSize,
            opportunities: result.opportunities,
          } satisfies StrategySummary;
        },
      );

      // Keep each strategy in an independent retryable step. Raw reports are
      // uploaded immediately, so multi-megabyte Lighthouse JSON is never saved
      // in Workflow step state.
      const mobile = await collectStrategy("mobile");
      const desktop = await collectStrategy("desktop");
      const agent = await step.do("scan agent readiness", { retries: { limit: 2, delay: "10 seconds" }, timeout: "2 minutes" }, async () => scan(payload.url));
      const capturedAt = new Date().toISOString();
      const scores = { mobile: mobile.scores, desktop: desktop.scores } satisfies StrategyScores;
      const result: CollectionResult = {
        schemaVersion: 1,
        jobId: payload.jobId,
        runId: payload.runId,
        pageId: payload.pageId,
        capturedAt,
        scores,
        samples: { mobile: mobile.sampleSize, desktop: desktop.sampleSize },
        agent,
        opportunities: mobile.opportunities,
      };
      await step.do("commit collection", { retries: { limit: 8, delay: "10 seconds", backoff: "exponential" } }, async () => {
        await callback(this.env, payload, "complete", { result });
        return { ok: true };
      });
      // Collection success is authoritative. Optional AI/Slack work gets its
      // own retries but cannot turn a committed run into a failed run.
      await step.do("enrich summaries", { retries: { limit: 2, delay: "20 seconds", backoff: "exponential" }, timeout: "2 minutes" }, async () => {
        await callback(this.env, payload, "enrich", {});
        return { ok: true };
      }).catch(() => undefined);
      await step.do("deliver notifications", { retries: { limit: 3, delay: "30 seconds", backoff: "exponential" }, timeout: "2 minutes" }, async () => {
        await callback(this.env, payload, "notify", {});
        return { ok: true };
      }).catch(() => undefined);
      return result;
    } catch (error) {
      await step.do("report terminal failure", { retries: { limit: 5, delay: "10 seconds", backoff: "exponential" } }, async () => {
        await callback(this.env, payload, "fail", {
          error: (error instanceof Error ? error.message : String(error)).slice(0, 500),
        });
        return { ok: true };
      }).catch(() => undefined);
      throw error;
    }
  }
}

function validPayload(value: unknown): value is DispatchPayload {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<DispatchPayload>;
  if (!item.jobId || !item.runId || !item.pageId || !item.url || !item.callbackUrl) return false;
  if (!Number.isInteger(item.runs) || item.runs! < 1 || item.runs! > 5) return false;
  try {
    const pageUrl = new URL(/^https?:\/\//i.test(item.url) ? item.url : `https://${item.url}`);
    const callbackUrl = new URL(item.callbackUrl);
    return ["http:", "https:"].includes(pageUrl.protocol) && callbackUrl.protocol === "https:";
  } catch {
    return false;
  }
}

const worker = {
  async fetch(request: Request, env: Env): Promise<Response> {
    const pathname = new URL(request.url).pathname;
    if (request.method === "GET" && pathname === "/health") {
      return Response.json({ ok: true, service: "fde-page-collector", workflow: "fde-page-collection" });
    }
    if (request.method !== "POST" || (pathname !== "/jobs" && pathname !== "/jobs/batch")) {
      return Response.json({ error: "not found" }, { status: 404 });
    }
    if (!sameValue(request.headers.get("authorization") ?? "", `Bearer ${env.CRON_SECRET}`)) {
      return Response.json({ error: "unauthorized" }, { status: 401 });
    }
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
  },
};

export default worker;
