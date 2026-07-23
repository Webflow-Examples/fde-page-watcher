import { randomUUID } from "node:crypto";
import { collect } from "./psi";
import { scan } from "./agentReadiness";
import {
  enrichRecommendations,
  generateWatcherNote,
  insertRecommendations,
  notifyCollectionJob,
  processFollowUps,
} from "./collector";
import { getEnv } from "./env";
import { getStore, type DataStore } from "./store";
import { shortDate } from "./ui";
import { STRATEGIES } from "./types";
import type {
  AppState,
  CollectionJob,
  CollectionJobKind,
  CollectionJobState,
  CollectionResult,
  LighthouseOpportunity,
  Strategy,
  StrategyScores,
} from "./types";
import { isPageActivelyMonitored } from "./watchCapacity";

export const JOB_STALE_AFTER_MS = 30 * 60 * 1000;
const ACTIVE_STATES = new Set<CollectionJobState>(["queued", "dispatching", "running"]);

export interface EnqueueResult {
  state: AppState;
  job: CollectionJob;
  queued: boolean;
  coalesced: boolean;
  recoveredStale: boolean;
}

function errorText(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 500);
}

function trimJobs(state: AppState): void {
  const jobs = state.jobs ?? [];
  const active = jobs.filter((job) => ACTIVE_STATES.has(job.state));
  const settled = jobs.filter((job) => !ACTIVE_STATES.has(job.state)).slice(-100);
  state.jobs = [...settled, ...active];
}

/** Atomically reserve a durable collection job; live duplicates coalesce. */
export async function enqueueCollectionJob(
  pageId: string,
  kind: CollectionJobKind,
  options: { dataStore?: DataStore; id?: string; now?: Date } = {},
): Promise<EnqueueResult> {
  const dataStore = options.dataStore ?? getStore();
  const now = options.now ?? new Date();
  const id = options.id ?? randomUUID();
  let job!: CollectionJob;
  let queued = true;
  let recoveredStale = false;
  const state = await dataStore.updateState((draft) => {
    draft.jobs = draft.jobs ?? [];
    const page = draft.pages.find((item) => item.id === pageId);
    if (!page) throw new Error(`enqueueCollectionJob: page ${pageId} not found`);
    if (!isPageActivelyMonitored(page)) throw new Error(`enqueueCollectionJob: page ${pageId} is paused`);
    const active = draft.jobs.find((item) => item.pageId === pageId && ACTIVE_STATES.has(item.state));
    if (active) {
      const age = now.getTime() - Date.parse(active.updatedAt);
      if (Number.isFinite(age) && age <= JOB_STALE_AFTER_MS) {
        job = active;
        queued = false;
        return;
      }
      active.state = "failed";
      active.error = `Job exceeded the ${Math.round(JOB_STALE_AFTER_MS / 60_000)} minute stale limit`;
      active.updatedAt = now.toISOString();
      active.completedAt = now.toISOString();
      recoveredStale = true;
    }
    job = {
      id,
      runId: id,
      pageId,
      kind,
      state: "queued",
      attempts: 0,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    };
    draft.jobs.push(job);
    page.runId = job.runId;
    page.runState = "queued";
    page.startedAt = now.toISOString();
    delete page.lastError;
    trimJobs(draft);
  });
  return { state, job: structuredClone(job), queued, coalesced: !queued, recoveredStale };
}

export async function markCollectionJob(
  jobId: string,
  state: "dispatching" | "running",
  options: { dataStore?: DataStore; workflowId?: string; now?: Date } = {},
): Promise<AppState> {
  const dataStore = options.dataStore ?? getStore();
  const now = options.now ?? new Date();
  return dataStore.updateState((draft) => {
    const job = (draft.jobs ?? []).find((item) => item.id === jobId);
    if (!job || !ACTIVE_STATES.has(job.state)) return;
    const page = draft.pages.find((item) => item.id === job.pageId);
    if (!page || page.runId !== job.runId) return;
    job.state = state;
    job.updatedAt = now.toISOString();
    job.workflowId = options.workflowId ?? job.workflowId;
    if (state === "running") {
      job.startedAt = job.startedAt ?? now.toISOString();
      job.attempts += 1;
    }
    page.runState = state;
    page.startedAt = page.startedAt ?? now.toISOString();
  });
}

export async function failCollectionJob(
  jobId: string,
  error: unknown,
  dataStore: DataStore = getStore(),
  now = new Date(),
): Promise<AppState> {
  const message = errorText(error);
  return dataStore.updateState((draft) => {
    const job = (draft.jobs ?? []).find((item) => item.id === jobId);
    if (!job || job.state === "succeeded") return;
    job.state = "failed";
    job.error = message;
    job.updatedAt = now.toISOString();
    job.completedAt = now.toISOString();
    const page = draft.pages.find((item) => item.id === job.pageId);
    if (page?.runId === job.runId) {
      page.runState = "failed";
      page.lastError = message;
      page.lastRunAt = now.toISOString();
    }
    trimJobs(draft);
  });
}

function validateResult(result: CollectionResult, job: CollectionJob): void {
  if (result.schemaVersion !== 1) throw new Error("Unsupported collection result schema");
  if (result.jobId !== job.id || result.runId !== job.runId || result.pageId !== job.pageId) {
    throw new Error("Collection result identity does not match the job");
  }
  for (const strategy of STRATEGIES) {
    if (!result.scores[strategy] || !Number.isFinite(result.samples[strategy])) {
      throw new Error(`Collection result is missing ${strategy} scores`);
    }
  }
}

/** Idempotently commit one versioned collector result into history/read models. */
export async function commitCollectionResult(
  result: CollectionResult,
  rawReport: unknown,
  dataStore: DataStore = getStore(),
): Promise<AppState> {
  const snapshot = await dataStore.getState();
  const job = (snapshot.jobs ?? []).find((item) => item.id === result.jobId);
  if (!job) throw new Error(`Collection job ${result.jobId} not found`);
  if (job.state === "succeeded") return snapshot;
  validateResult(result, job);
  if (job.state !== "running") await markCollectionJob(job.id, "running", { dataStore });

  const completedAt = new Date(result.capturedAt);
  if (!Number.isFinite(completedAt.getTime())) throw new Error("Invalid capturedAt timestamp");
  const appended = await dataStore.appendNight(
    result.pageId,
    result.runId,
    {
      date: shortDate(completedAt),
      iso: completedAt.toISOString(),
      scores: result.scores,
      samples: result.samples,
      sampleSize: Math.min(result.samples.mobile, result.samples.desktop),
      agent: result.agent,
      opportunities: result.opportunities,
    },
    rawReport,
  );
  if (!appended.night) throw new Error("Collection result was superseded before commit");

  await dataStore.updateState((draft) => {
    const currentJob = (draft.jobs ?? []).find((item) => item.id === job.id);
    const page = draft.pages.find((item) => item.id === job.pageId);
    if (!currentJob || !page) return;
    if (currentJob.kind === "baseline") {
      page.baseline = result.scores;
      page.baselineCapturedAt = completedAt.toISOString();
      page.current = {
        mobile: Object.fromEntries(Object.entries(result.scores.mobile).map(([key, score]) => [key, score.m])) as typeof page.current.mobile,
        desktop: Object.fromEntries(Object.entries(result.scores.desktop).map(([key, score]) => [key, score.m])) as typeof page.current.desktop,
      };
      page.status = "stable";
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
    trimJobs(draft);
  });

  // Keep reconciliation fast: recommendations are real but optional AI prose
  // is deferred; it must never put the durable collection commit at risk.
  return insertRecommendations(dataStore, result.pageId, result.opportunities, completedAt, { summarize: false });
}

/** Local development executor. Production dispatches the same job to a Workflow. */
export async function executeLocalCollectionJob(jobId: string, dataStore: DataStore = getStore()): Promise<AppState> {
  const started = await markCollectionJob(jobId, "running", { dataStore });
  const job = (started.jobs ?? []).find((item) => item.id === jobId);
  if (!job) throw new Error(`Collection job ${jobId} not found`);
  const page = started.pages.find((item) => item.id === job.pageId);
  if (!page) throw new Error(`Collection page ${job.pageId} not found`);
  try {
    const [strategyResults, agent] = await Promise.all([
      Promise.all(STRATEGIES.map(async (strategy) => ({ strategy, result: await collect(page.url, strategy) }))),
      scan(page.url),
    ]);
    const scores = {} as StrategyScores;
    const samples = {} as Record<Strategy, number>;
    const strategies: Record<string, unknown> = {};
    let opportunities: LighthouseOpportunity[] = [];
    for (const item of strategyResults) {
      scores[item.strategy] = item.result.scores;
      samples[item.strategy] = item.result.sampleSize;
      strategies[item.strategy] = { ...item.result, opportunities: undefined, raws: item.result.raws };
      if (item.strategy === "mobile") opportunities = item.result.opportunities;
    }
    const capturedAt = new Date().toISOString();
    return await commitCollectionResult(
      { schemaVersion: 1, jobId, runId: job.runId, pageId: job.pageId, capturedAt, scores, samples, agent, opportunities },
      { strategies },
      dataStore,
    );
  } catch (error) {
    await failCollectionJob(jobId, error, dataStore);
    throw error;
  }
}

export interface DispatchPayload {
  jobId: string;
  runId: string;
  pageId: string;
  url: string;
  runs: number;
  tenant?: string;
}

interface CollectorConfig {
  collectorUrl: string;
  collectorSecret: string;
}

interface CollectorInstanceStatus {
  status: "queued" | "running" | "paused" | "errored" | "terminated" | "complete" | "waiting" | "waitingForPause" | "unknown";
  error?: { name?: string; message?: string };
  output?: unknown;
}

class TerminalCollectorError extends Error {}

function requireCollectorConfig(overrides: Partial<CollectorConfig> = {}): CollectorConfig {
  const collectorUrl = getEnv("COLLECTOR_URL");
  const collectorSecret = getEnv("CRON_SECRET");
  const resolved = {
    collectorUrl: overrides.collectorUrl ?? collectorUrl,
    collectorSecret: overrides.collectorSecret ?? collectorSecret,
  };
  if (!resolved.collectorUrl || !resolved.collectorSecret) {
    const missing = [
      !resolved.collectorUrl && "COLLECTOR_URL",
      !resolved.collectorSecret && "CRON_SECRET",
    ].filter(Boolean);
    throw new Error(`Collector is not configured; missing: ${missing.join(", ")}`);
  }
  return resolved as CollectorConfig;
}

function collectorBaseUrl(collectorUrl: string): string {
  return collectorUrl.replace(/\/jobs\/?$/, "").replace(/\/$/, "");
}

function collectorHeaders(secret: string): HeadersInit {
  return { authorization: `Bearer ${secret}`, "content-type": "application/json" };
}

function dispatchPayloads(state: AppState, jobIds: string[], tenant?: string): DispatchPayload[] {
  const runs = Math.max(1, Math.min(5, Number(getEnv("PSI_RUNS")) || 5));
  return jobIds.map((jobId) => {
    const job = (state.jobs ?? []).find((item) => item.id === jobId);
    const page = job && state.pages.find((item) => item.id === job.pageId);
    if (!job || !page) throw new Error(`Collection job ${jobId} not found`);
    return {
      jobId: job.id,
      runId: job.runId,
      pageId: page.id,
      url: page.url,
      runs,
      tenant,
    };
  });
}

/** Hand a short request to the durable Workflow and persist its workflow id. */
export async function dispatchCollectionJob(jobId: string, dataStore: DataStore = getStore()): Promise<AppState> {
  let config: ReturnType<typeof requireCollectorConfig>;
  try {
    config = requireCollectorConfig();
  } catch (error) {
    await failCollectionJob(jobId, error, dataStore);
    throw error;
  }

  const snapshot = await markCollectionJob(jobId, "dispatching", { dataStore });
  const payload = dispatchPayloads(snapshot, [jobId], dataStore.tenant)[0];
  try {
    const response = await fetch(config.collectorUrl, {
      method: "POST",
      headers: collectorHeaders(config.collectorSecret),
      body: JSON.stringify(payload),
    });
    if (!response.ok) throw new Error(`Collector dispatch ${response.status}: ${(await response.text()).slice(0, 200)}`);
    const body = (await response.json()) as { workflowId?: string };
    return markCollectionJob(jobId, "dispatching", { dataStore, workflowId: body.workflowId });
  } catch (error) {
    await failCollectionJob(jobId, error, dataStore);
    throw error;
  }
}

/** Dispatch a whole nightly watchlist with one outbound Webflow request. */
export async function dispatchCollectionJobs(jobIds: string[], dataStore: DataStore = getStore()): Promise<AppState> {
  if (jobIds.length === 0) return dataStore.getState();
  let config: ReturnType<typeof requireCollectorConfig>;
  try {
    config = requireCollectorConfig();
  } catch (error) {
    await Promise.all(jobIds.map((jobId) => failCollectionJob(jobId, error, dataStore)));
    throw error;
  }
  const dispatching = await dataStore.updateState((draft) => {
    const now = new Date().toISOString();
    for (const jobId of jobIds) {
      const job = (draft.jobs ?? []).find((item) => item.id === jobId);
      const page = job && draft.pages.find((item) => item.id === job.pageId);
      if (!job || !page || !ACTIVE_STATES.has(job.state) || page.runId !== job.runId) continue;
      job.state = "dispatching";
      job.updatedAt = now;
      page.runState = "dispatching";
    }
  });
  const payloads = dispatchPayloads(dispatching, jobIds, dataStore.tenant);
  const batchUrl = `${collectorBaseUrl(config.collectorUrl)}/jobs/batch`;
  try {
    const response = await fetch(batchUrl, {
      method: "POST",
      headers: collectorHeaders(config.collectorSecret),
      body: JSON.stringify({ jobs: payloads }),
    });
    if (!response.ok) throw new Error(`Collector batch dispatch ${response.status}: ${(await response.text()).slice(0, 200)}`);
    const body = (await response.json()) as { workflowIds?: string[] };
    return dataStore.updateState((draft) => {
      const now = new Date().toISOString();
      for (let index = 0; index < jobIds.length; index += 1) {
        const job = (draft.jobs ?? []).find((item) => item.id === jobIds[index]);
        if (!job || !ACTIVE_STATES.has(job.state)) continue;
        job.workflowId = body.workflowIds?.[index] ?? job.id;
        job.updatedAt = now;
      }
    });
  } catch (error) {
    await Promise.all(jobIds.map((jobId) => failCollectionJob(jobId, error, dataStore)));
    throw error;
  }
}

function isCollectorStatus(value: unknown): value is CollectorInstanceStatus {
  if (!value || typeof value !== "object") return false;
  const status = (value as { status?: unknown }).status;
  return typeof status === "string" && [
    "queued", "running", "paused", "errored", "terminated", "complete", "waiting", "waitingForPause", "unknown",
  ].includes(status);
}

function isCollectionResult(value: unknown): value is CollectionResult {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<CollectionResult>;
  return item.schemaVersion === 1
    && typeof item.jobId === "string"
    && typeof item.runId === "string"
    && typeof item.pageId === "string"
    && typeof item.capturedAt === "string"
    && STRATEGIES.every((strategy) => !!item.scores?.[strategy] && Number.isFinite(item.samples?.[strategy]))
    && Array.isArray(item.agent)
    && Array.isArray(item.opportunities);
}

async function collectorJson(fetchFn: typeof fetch, url: string, secret: string): Promise<unknown> {
  const response = await fetchFn(url, { headers: collectorHeaders(secret), cache: "no-store" });
  if (!response.ok) {
    const message = (await response.text()).slice(0, 200);
    const error = new Error(`Collector read ${response.status}: ${message}`);
    if (response.status >= 400 && response.status < 500) throw new TerminalCollectorError(error.message);
    throw error;
  }
  try {
    return await response.json();
  } catch {
    throw new TerminalCollectorError("Collector returned invalid JSON");
  }
}

export interface ReconcileCollectionOptions {
  dataStore?: DataStore;
  fetchFn?: typeof fetch;
  collectorUrl?: string;
  collectorSecret?: string;
  onCommitted?: (jobId: string) => void;
}

/**
 * Pull Workflow state and completed reports into the app's own D1/R2 store.
 * This keeps production independent of inbound callbacks blocked by site SSO.
 */
export async function reconcileCollectionJobs(options: ReconcileCollectionOptions = {}): Promise<AppState> {
  const dataStore = options.dataStore ?? getStore();
  const fetchFn = options.fetchFn ?? fetch;
  const snapshot = await dataStore.getState();
  const active = (snapshot.jobs ?? []).filter((job) => ACTIVE_STATES.has(job.state));
  if (active.length === 0) return snapshot;

  let config: CollectorConfig;
  try {
    config = requireCollectorConfig(options);
  } catch {
    return snapshot;
  }
  const baseUrl = collectorBaseUrl(config.collectorUrl);

  await Promise.all(active.map(async (job) => {
    const workflowId = job.workflowId ?? job.id;
    try {
      const statusValue = await collectorJson(
        fetchFn,
        `${baseUrl}/jobs/${encodeURIComponent(workflowId)}`,
        config.collectorSecret,
      );
      if (!isCollectorStatus(statusValue)) throw new TerminalCollectorError("Collector returned an invalid job status");

      if (statusValue.status === "queued") return;
      if (["running", "paused", "waiting", "waitingForPause"].includes(statusValue.status)) {
        if (job.state !== "running") await markCollectionJob(job.id, "running", { dataStore });
        return;
      }
      if (statusValue.status === "errored" || statusValue.status === "terminated" || statusValue.status === "unknown") {
        throw new TerminalCollectorError(statusValue.error?.message ?? `Collector workflow ${statusValue.status}`);
      }
      if (!isCollectionResult(statusValue.output)) throw new TerminalCollectorError("Collector completed without a valid result");
      if (statusValue.output.jobId !== job.id || statusValue.output.runId !== job.runId || statusValue.output.pageId !== job.pageId) {
        throw new TerminalCollectorError("Collector result identity does not match the requested job");
      }
      if (!Number.isFinite(Date.parse(statusValue.output.capturedAt))) {
        throw new TerminalCollectorError("Collector result has an invalid capture timestamp");
      }
      if (job.state !== "running") await markCollectionJob(job.id, "running", { dataStore });

      const [mobile, desktop] = await Promise.all(STRATEGIES.map((strategy) => collectorJson(
        fetchFn,
        `${baseUrl}/jobs/${encodeURIComponent(workflowId)}/reports/${strategy}`,
        config.collectorSecret,
      )));
      await commitCollectionResult(statusValue.output, { strategies: { mobile, desktop } }, dataStore);
      options.onCommitted?.(job.id);

      // The result now exists in the app's R2 bucket. Collector staging data is
      // best-effort cleanup; a cleanup outage must not undo a successful run.
      await fetchFn(`${baseUrl}/jobs/${encodeURIComponent(workflowId)}/reports`, {
        method: "DELETE",
        headers: collectorHeaders(config.collectorSecret),
      }).catch(() => undefined);
    } catch (error) {
      if (error instanceof TerminalCollectorError) {
        await failCollectionJob(job.id, error, dataStore);
        return;
      }
      console.error(JSON.stringify({
        message: "collector reconciliation deferred",
        jobId: job.id,
        error: errorText(error),
      }));
    }
  }));

  return dataStore.getState();
}

/** Run optional AI/Slack work only after one authoritative result is committed. */
export async function finalizeCollectionJob(jobId: string, dataStore: DataStore = getStore()): Promise<void> {
  const snapshot = await dataStore.getState();
  const job = (snapshot.jobs ?? []).find((item) => item.id === jobId);
  if (!job || job.state !== "succeeded") return;

  if (!job.enrichedAt) {
    try {
      await Promise.all([
        enrichRecommendations(dataStore, job.pageId),
        generateWatcherNote(dataStore, new Date()),
      ]);
      await dataStore.updateState((draft) => {
        const current = (draft.jobs ?? []).find((item) => item.id === job.id);
        if (current?.state === "succeeded") {
          current.enrichedAt = new Date().toISOString();
          delete current.enrichmentError;
        }
      });
    } catch (error) {
      await dataStore.updateState((draft) => {
        const current = (draft.jobs ?? []).find((item) => item.id === job.id);
        if (current) current.enrichmentError = errorText(error);
      });
    }
  }
  if (!job.notifiedAt) {
    try {
      await notifyCollectionJob(dataStore, job.id);
    } catch (error) {
      await dataStore.updateState((draft) => {
        const current = (draft.jobs ?? []).find((item) => item.id === job.id);
        if (current) current.notificationError = errorText(error);
      });
    }
  }

  await processFollowUps({ dataStore }).catch((error) => {
    console.error(JSON.stringify({ message: "follow-up delivery deferred", error: errorText(error) }));
  });
}
