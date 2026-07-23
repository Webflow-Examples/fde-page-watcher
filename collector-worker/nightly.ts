import { createFdeStore, type FdeStoreBindings } from "./dataStore";
import type { CollectionJob, CollectionJobState } from "../src/lib/types";
import { isPageActivelyMonitored } from "../src/lib/watchCapacity";

const ACTIVE = new Set<CollectionJobState>(["queued", "dispatching", "running"]);
const STALE_AFTER_MS = 30 * 60 * 1000;

export interface NightlyEnvironment extends FdeStoreBindings {
  COLLECTION_WORKFLOW: Workflow<DispatchPayload>;
  NIGHTLY_TENANT: string;
  PSI_RUNS?: string;
}

export interface DispatchPayload {
  jobId: string;
  runId: string;
  pageId: string;
  url: string;
  runs: number;
  tenant?: string;
}

export interface NightlyResult {
  ok: true;
  tenant: string;
  queued: number;
  coalesced: number;
  failed: string[];
}

function trimJobs(jobs: CollectionJob[]): CollectionJob[] {
  const active = jobs.filter((job) => ACTIVE.has(job.state));
  const settled = jobs.filter((job) => !ACTIVE.has(job.state)).slice(-100);
  return [...settled, ...active];
}

/** Reserve and dispatch the watchlist entirely inside the FDE account. */
export async function dispatchFdeNightly(env: NightlyEnvironment): Promise<NightlyResult> {
  const tenant = env.NIGHTLY_TENANT || "brand-studio:live";
  const store = createFdeStore(tenant, env);
  const now = new Date();
  const queued: CollectionJob[] = [];
  let coalesced = 0;
  const state = await store.updateState((draft) => {
    draft.jobs = draft.jobs ?? [];
    const pages = draft.pages
      .filter(isPageActivelyMonitored)
      .sort((a, b) => (a.flag === "priority" ? 0 : 1) - (b.flag === "priority" ? 0 : 1));
    for (const page of pages) {
      const active = draft.jobs.find((job) => job.pageId === page.id && ACTIVE.has(job.state));
      if (active) {
        const age = now.getTime() - Date.parse(active.updatedAt);
        if (Number.isFinite(age) && age <= STALE_AFTER_MS) {
          coalesced += 1;
          continue;
        }
        active.state = "failed";
        active.error = "Job exceeded the 30 minute stale limit";
        active.updatedAt = now.toISOString();
        active.completedAt = now.toISOString();
      }
      const id = crypto.randomUUID();
      const job: CollectionJob = {
        id,
        runId: id,
        pageId: page.id,
        kind: "nightly",
        state: "dispatching",
        attempts: 0,
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
      };
      draft.jobs.push(job);
      page.runId = id;
      page.runState = "dispatching";
      page.startedAt = now.toISOString();
      delete page.lastError;
      queued.push(structuredClone(job));
    }
    draft.jobs = trimJobs(draft.jobs);
  });

  if (queued.length === 0) return { ok: true, tenant, queued: 0, coalesced, failed: [] };
  const runs = Math.max(1, Math.min(5, Number(env.PSI_RUNS) || 5));
  const payloads: DispatchPayload[] = queued.map((job) => {
    const page = state.pages.find((item) => item.id === job.pageId);
    if (!page) throw new Error(`Nightly page ${job.pageId} disappeared during reservation`);
    return { jobId: job.id, runId: job.runId, pageId: page.id, url: page.url, runs, tenant };
  });

  try {
    const instances = payloads.length === 1
      ? [await env.COLLECTION_WORKFLOW.create({
        id: payloads[0].jobId,
        params: payloads[0],
        retention: { successRetention: "30 days", errorRetention: "30 days" },
      })]
      : await env.COLLECTION_WORKFLOW.createBatch(payloads.map((payload) => ({
        id: payload.jobId,
        params: payload,
        retention: { successRetention: "30 days", errorRetention: "30 days" },
      })));
    await store.updateState((draft) => {
      for (let index = 0; index < queued.length; index += 1) {
        const job = (draft.jobs ?? []).find((item) => item.id === queued[index].id);
        if (!job || !ACTIVE.has(job.state)) continue;
        job.workflowId = instances[index].id;
        job.updatedAt = new Date().toISOString();
      }
    });
    return { ok: true, tenant, queued: queued.length, coalesced, failed: [] };
  } catch (error) {
    const message = (error instanceof Error ? error.message : String(error)).slice(0, 500);
    await store.updateState((draft) => {
      const failedAt = new Date().toISOString();
      for (const reserved of queued) {
        const job = (draft.jobs ?? []).find((item) => item.id === reserved.id);
        const page = draft.pages.find((item) => item.id === reserved.pageId);
        if (job) {
          job.state = "failed";
          job.error = message;
          job.updatedAt = failedAt;
          job.completedAt = failedAt;
        }
        if (page?.runId === reserved.runId) {
          page.runState = "failed";
          page.lastError = message;
          page.lastRunAt = failedAt;
        }
      }
    });
    throw error;
  }
}
