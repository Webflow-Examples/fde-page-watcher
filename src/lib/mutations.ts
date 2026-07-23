import { randomUUID } from "node:crypto";
import { agentCheckKey, updateAgentIgnoreSettings } from "./agentScoring";
import { getStore } from "./store";
import type { DataStore } from "./store";
import { shortDate } from "./ui";
import type { AgentIgnoreScope, AppState, Flag, RecStatus, ScoreByCategory, TaskStatus, WatchPage } from "./types";

/**
 * Server-side domain mutations. Each executes inside the store's atomic
 * update primitive so independent client, collector, and follow-up commits are
 * serialized per tenant instead of overwriting one another.
 *
 * Every mutation returns the fresh authoritative AppState.
 */

async function withState(mutate: (state: AppState) => void | Promise<void>, dataStore: DataStore = getStore()): Promise<AppState> {
  return dataStore.updateState(mutate);
}

export function setPageFlag(id: string, flag: Flag, dataStore: DataStore = getStore()): Promise<AppState> {
  return withState((state) => {
    const page = state.pages.find((p) => p.id === id);
    if (!page) throw new Error(`setPageFlag: page ${id} not found`);
    page.flag = flag;
  }, dataStore);
}

export function setAgentIgnore(
  id: string,
  scope: AgentIgnoreScope,
  value: string,
  ignored: boolean,
  dataStore: DataStore = getStore(),
): Promise<AppState> {
  return withState((state) => {
    const page = state.pages.find((p) => p.id === id);
    if (!page) throw new Error(`setAgentIgnore: page ${id} not found`);
    const exists = scope === "group"
      ? page.agent.some((check) => check.group === value)
      : page.agent.some((check) => agentCheckKey(check) === value);
    if (!exists) throw new Error(`setAgentIgnore: ${scope} does not exist on page ${id}`);
    page.agentIgnores = updateAgentIgnoreSettings(page.agentIgnores, scope, value, ignored);
  }, dataStore);
}

export function removePage(id: string, dataStore: DataStore = getStore()): Promise<AppState> {
  return withState((state) => {
    state.pages = state.pages.filter((p) => p.id !== id);
    state.recs = state.recs.filter((r) => r.pageId !== id);
    state.followUps = (state.followUps ?? []).filter((f) => f.pageId !== id);
  }, dataStore);
}

export function setRecStatus(key: string, status: RecStatus, dataStore: DataStore = getStore()): Promise<AppState> {
  return withState((state) => {
    const rec = state.recs.find((r) => r.key === key);
    if (!rec) throw new Error(`setRecStatus: rec ${key} not found`);
    rec.status = status;
    // Saving to Tasks resets the board lifecycle to "todo", matching the UI.
    if (status === "task") rec.taskStatus = "todo";
  }, dataStore);
}

export function advanceTask(key: string, to: TaskStatus, dataStore: DataStore = getStore()): Promise<AppState> {
  return withState((state) => {
    const rec = state.recs.find((r) => r.key === key);
    if (!rec) throw new Error(`advanceTask: rec ${key} not found`);
    rec.taskStatus = to;
    if (to === "done") rec.doneDate = rec.doneDate ?? shortDate();
    if (to !== "done") rec.doneDate = null;
  }, dataStore);
}

export const RUN_STALE_AFTER_MS = 15 * 60 * 1000;

export interface RunRequest {
  state: AppState;
  runId: string;
  queued: boolean;
  coalesced: boolean;
  recoveredStale: boolean;
}

/**
 * Atomically reserve a page for one stable run id. A duplicate request
 * coalesces onto a live run; an abandoned run is failed and replaced.
 */
export async function requestPageRun(
  id: string,
  options: { dataStore?: DataStore; runId?: string; now?: Date } = {},
): Promise<RunRequest> {
  const dataStore = options.dataStore ?? getStore();
  const requestedRunId = options.runId ?? randomUUID();
  const now = options.now ?? new Date();
  let runId = requestedRunId;
  let queued = true;
  let recoveredStale = false;
  const state = await withState((draft) => {
    const page = draft.pages.find((p) => p.id === id);
    if (!page) throw new Error(`requestPageRun: page ${id} not found`);
    if (page.runState === "running" && page.runId) {
      const age = page.startedAt ? now.getTime() - Date.parse(page.startedAt) : Number.POSITIVE_INFINITY;
      if (Number.isFinite(age) && age <= RUN_STALE_AFTER_MS) {
        runId = page.runId;
        queued = false;
        return;
      }
      recoveredStale = true;
      page.runState = "failed";
      page.lastRunAt = now.toISOString();
      page.lastError = `Run ${page.runId} exceeded the ${Math.round(RUN_STALE_AFTER_MS / 60_000)} minute stale limit`;
    }
    page.runId = requestedRunId;
    page.runState = "running";
    page.startedAt = now.toISOString();
    delete page.lastError;
  }, dataStore);
  return { state, runId, queued, coalesced: !queued, recoveredStale };
}

/** Settle only the matching active run; superseded jobs cannot change state. */
export function markRunFinished(id: string, runId: string, error?: string, dataStore: DataStore = getStore()): Promise<AppState> {
  return withState((state) => {
    const page = state.pages.find((p) => p.id === id);
    if (!page) return; // page removed mid-run — nothing to settle
    if (page.runId !== runId || page.runState !== "running") return;
    page.runState = error ? "failed" : undefined;
    page.lastRunAt = new Date().toISOString();
    if (error) page.lastError = error;
    else delete page.lastError;
  }, dataStore);
}

/** Convert abandoned active runs into an observable failed state for polling. */
export function recoverStaleRuns(dataStore: DataStore = getStore(), now: Date = new Date()): Promise<AppState> {
  return withState((state) => {
    for (const page of state.pages) {
      if (!page.runState || page.runState === "failed") continue;
      const age = page.startedAt ? now.getTime() - Date.parse(page.startedAt) : Number.POSITIVE_INFINITY;
      const durableJob = (state.jobs ?? []).some((item) => item.runId === page.runId && item.state === "running");
      const staleAfter = durableJob ? 30 * 60 * 1000 : RUN_STALE_AFTER_MS;
      if (!Number.isFinite(age) || age > staleAfter) {
        page.runState = "failed";
        page.lastRunAt = now.toISOString();
        page.lastError = `Run ${page.runId ?? "unknown"} exceeded the ${Math.round(staleAfter / 60_000)} minute stale limit`;
        const job = (state.jobs ?? []).find((item) => item.runId === page.runId);
        if (job && (job.state === "queued" || job.state === "dispatching" || job.state === "running")) {
          job.state = "failed";
          job.error = page.lastError;
          job.updatedAt = now.toISOString();
          job.completedAt = now.toISOString();
        }
      }
    }
  }, dataStore);
}

export interface NewPageInput {
  title: string;
  url: string;
  flag: Flag;
}

/** A brand-new page starts pending: no baseline, no history, no scan. */
export function pendingPage(id: string, title: string, url: string, flag: Flag): WatchPage {
  const zeroScores: ScoreByCategory = { perf: 0, a11y: 0, bp: 0, seo: 0 };
  return {
    id,
    title,
    url,
    flag,
    status: "pending",
    current: { mobile: zeroScores, desktop: zeroScores },
    history: [],
    markers: [],
    agent: [],
    agentIgnores: { checks: [], groups: [] },
    acted: {},
  };
}

export function addPage(input: NewPageInput, dataStore: DataStore = getStore()): Promise<AppState> {
  return withState((state) => {
    const title = input.title.trim();
    const url = input.url.trim();
    if (!title || !url) throw new Error("addPage: title and url are required");
    // No fabricated provenance (audit): the page begins pending and gets a
    // real baseline/history once a baseline is captured or a run completes.
    state.pages.push(pendingPage(`p-${randomUUID()}`, title, url, input.flag));
  }, dataStore);
}
