import { randomUUID } from "node:crypto";
import { isKnownAgentIgnoreTarget } from "./agentChecks";
import { updateAgentIgnoreOverride, updateAgentIgnoreSettings } from "./agentScoring";
import { effectivePerformanceThresholds, normalizePerformanceThresholdOverrides, normalizePerformanceThresholds, performanceThresholdOverridesAreValid, performanceThresholdsAreValid } from "./performanceThresholds";
import { collectionScheduleIsValid, ensureCollectionOffsets } from "./collectionSchedule";
import { pageTrend } from "./scoring";
import { getStore } from "./store";
import type { DataStore } from "./store";
import { shortDate } from "./ui";
import type { AgentIgnoreOverrideMode, AgentIgnoreScope, AppState, CollectionSchedule, Flag, PagePerformanceThresholdOverrides, PerformanceThresholds, RecStatus, ScoreByCategory, TaskStatus, WatchPage } from "./types";
import { defaultNewPageFlag, flagCapacityError } from "./watchCapacity";
import { applyWatchlistPageOrder, changePageFlagOrder, sortWatchlistPages } from "./watchlistOrder";
import { removeTaskMarker } from "./taskMarkers";
import { isKnownNativeElementId } from "./nativeElements";
import type { NativeElementDisposition } from "./types";
import type { ProductEscalationStatus } from "./types";
import { buildProductEscalation, createEscalationEvidence, isProductEscalationStatus } from "./escalations";
import { alertWebhookUrlIsValid } from "./webhook";

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
    if (flag === "paused" && page.runState && page.runState !== "failed") {
      throw new Error("setPageFlag: wait for the current collection to finish before pausing this page");
    }
    const capacityError = flagCapacityError(state.pages, id, flag);
    if (capacityError) throw new Error(`setPageFlag: ${capacityError}`);
    state.pages = changePageFlagOrder(state.pages, id, flag);
    ensureCollectionOffsets(state.pages);
    delete state.watcherNote;
  }, dataStore);
}

export function setPageOrder(pageIds: ReadonlyArray<string>, dataStore: DataStore = getStore()): Promise<AppState> {
  return withState((state) => {
    state.pages = applyWatchlistPageOrder(state.pages, pageIds);
    delete state.watcherNote;
  }, dataStore);
}

export function setPageTitle(id: string, value: string, dataStore: DataStore = getStore()): Promise<AppState> {
  return withState((state) => {
    const title = value.trim();
    if (!title) throw new Error("setPageTitle: title is required");
    const page = state.pages.find((item) => item.id === id);
    if (!page) throw new Error(`setPageTitle: page ${id} not found`);
    page.title = title;
    for (const rec of state.recs) {
      if (rec.pageId === id) rec.pageTitle = title;
    }
    delete state.watcherNote;
  }, dataStore);
}

export function setAgentIgnore(
  id: string,
  scope: AgentIgnoreScope,
  value: string,
  ignoredOrMode: boolean | AgentIgnoreOverrideMode,
  dataStore: DataStore = getStore(),
): Promise<AppState> {
  return withState((state) => {
    const page = state.pages.find((p) => p.id === id);
    if (!page) throw new Error(`setAgentIgnore: page ${id} not found`);
    if (!isKnownAgentIgnoreTarget(scope, value)) {
      throw new Error(`setAgentIgnore: ${scope} does not exist`);
    }
    // Boolean calls are retained for compatibility with older clients:
    // false clears a local ignore and returns to the global default.
    const mode = typeof ignoredOrMode === "boolean"
      ? ignoredOrMode ? "ignore" : "inherit"
      : ignoredOrMode;
    const next = updateAgentIgnoreOverride(page.agentIgnores, page.agentIgnoreRestores, scope, value, mode);
    page.agentIgnores = next.ignores;
    page.agentIgnoreRestores = next.restores;
  }, dataStore);
}

export function setDefaultAgentIgnore(
  scope: AgentIgnoreScope,
  value: string,
  ignored: boolean,
  dataStore: DataStore = getStore(),
): Promise<AppState> {
  return withState((state) => {
    if (!isKnownAgentIgnoreTarget(scope, value)) {
      throw new Error(`setDefaultAgentIgnore: ${scope} does not exist`);
    }
    state.agentIgnoreDefaults = updateAgentIgnoreSettings(state.agentIgnoreDefaults, scope, value, ignored);
  }, dataStore);
}

export function setNativeElementDisposition(
  id: string,
  findingId: string,
  disposition: NativeElementDisposition | null,
  dataStore: DataStore = getStore(),
  now: Date = new Date(),
): Promise<AppState> {
  return withState((state) => {
    const page = state.pages.find((item) => item.id === id);
    if (!page) throw new Error(`setNativeElementDisposition: page ${id} not found`);
    if (!isKnownNativeElementId(findingId)) {
      throw new Error(`setNativeElementDisposition: finding ${findingId} does not exist`);
    }
    const controls = { ...(page.nativeElementControls ?? {}) };
    if (disposition === null) delete controls[findingId];
    else controls[findingId] = { disposition, updatedAt: now.toISOString() };
    page.nativeElementControls = controls;

    // Triage matching Inbox noise without disrupting work already committed
    // to Tasks. Clearing the disposition deliberately does not recreate it.
    if (disposition) {
      const rec = state.recs.find((item) => item.key === `${id}:${findingId}`);
      if (rec?.status === "inbox") rec.status = "ignored";
    }
    delete state.watcherNote;
  }, dataStore);
}

export function setPerformanceThresholds(
  thresholds: PerformanceThresholds,
  dataStore: DataStore = getStore(),
): Promise<AppState> {
  if (!performanceThresholdsAreValid(thresholds)) {
    throw new Error("setPerformanceThresholds: values are outside the supported range");
  }
  return withState((state) => {
    state.performanceThresholds = normalizePerformanceThresholds(thresholds);
    for (const page of state.pages) {
      page.status = pageTrend(page, "mobile", effectivePerformanceThresholds(state.performanceThresholds, page));
    }
    delete state.watcherNote;
  }, dataStore);
}

export function setPagePerformanceThresholdOverrides(
  id: string,
  overrides: PagePerformanceThresholdOverrides,
  dataStore: DataStore = getStore(),
): Promise<AppState> {
  if (!performanceThresholdOverridesAreValid(overrides)) {
    throw new Error("setPagePerformanceThresholdOverrides: values are outside the supported range");
  }
  return withState((state) => {
    const page = state.pages.find((item) => item.id === id);
    if (!page) throw new Error(`setPagePerformanceThresholdOverrides: page ${id} not found`);
    page.performanceThresholdOverrides = normalizePerformanceThresholdOverrides(overrides);
    page.status = pageTrend(page, "mobile", effectivePerformanceThresholds(state.performanceThresholds, page));
    delete state.watcherNote;
  }, dataStore);
}

export function setCollectionSchedule(
  schedule: CollectionSchedule,
  dataStore: DataStore = getStore(),
): Promise<AppState> {
  if (!collectionScheduleIsValid(schedule)) {
    throw new Error("setCollectionSchedule: enter a valid local time and IANA timezone");
  }
  return withState((state) => {
    state.collectionSchedule = schedule;
    ensureCollectionOffsets(state.pages);
    const changedAt = new Date().toISOString();
    for (const page of state.pages) page.lastScheduledAt = changedAt;
  }, dataStore);
}

export function setVisitorExperienceVisible(
  visible: boolean,
  dataStore: DataStore = getStore(),
): Promise<AppState> {
  return withState((state) => {
    state.visitorExperienceVisible = visible;
  }, dataStore);
}

export function setAlertWebhookUrl(
  value: string,
  dataStore: DataStore = getStore(),
): Promise<AppState> {
  const url = value.trim();
  if (url && !alertWebhookUrlIsValid(url)) {
    throw new Error("setAlertWebhookUrl: enter a valid HTTPS URL without embedded credentials");
  }
  return withState((state) => {
    if (url) state.alertWebhookUrl = url;
    else state.alertWebhookUrl = null;
  }, dataStore);
}

export function removePage(id: string, dataStore: DataStore = getStore()): Promise<AppState> {
  return withState((state) => {
    state.pages = state.pages.filter((p) => p.id !== id);
    state.recs = state.recs.filter((r) => r.pageId !== id);
    state.followUps = (state.followUps ?? []).filter((f) => f.pageId !== id);
    state.productEscalations = (state.productEscalations ?? []).filter((item) => item.pageId !== id);
    delete state.watcherNote;
  }, dataStore);
}

export async function createProductEscalation(
  recKey: string,
  dataStore: DataStore = getStore(),
  now: Date = new Date(),
): Promise<AppState> {
  const visitorEvidence = await dataStore.getCruxEvidence().catch(() => []);
  return withState((state) => {
    const rec = state.recs.find((item) => item.key === recKey);
    if (!rec) throw new Error(`createProductEscalation: recommendation ${recKey} not found`);
    state.productEscalations = state.productEscalations ?? [];
    if (state.productEscalations.some((item) => item.recKey === recKey)) return;
    state.productEscalations.push(buildProductEscalation(state, rec, now, visitorEvidence));
    rec.status = "task";
    if (rec.taskStatus === "done") {
      rec.taskStatus = "todo";
      rec.doneDate = null;
      removeTaskMarker(state, rec);
    }
    delete state.watcherNote;
  }, dataStore);
}

export async function updateProductEscalation(
  id: string,
  patch: { status?: ProductEscalationStatus; owner?: string; notes?: string; refreshEvidence?: boolean },
  dataStore: DataStore = getStore(),
  now: Date = new Date(),
): Promise<AppState> {
  if (patch.status !== undefined && !isProductEscalationStatus(patch.status)) {
    throw new Error("updateProductEscalation: invalid status");
  }
  if (patch.owner !== undefined && patch.owner.trim().length > 100) throw new Error("updateProductEscalation: owner is too long");
  if (patch.notes !== undefined && patch.notes.trim().length > 4_000) throw new Error("updateProductEscalation: notes are too long");
  const visitorEvidence = patch.refreshEvidence ? await dataStore.getCruxEvidence().catch(() => []) : [];
  return withState((state) => {
    const escalation = (state.productEscalations ?? []).find((item) => item.id === id);
    if (!escalation) throw new Error(`updateProductEscalation: escalation ${id} not found`);
    const timestamp = now.toISOString();
    const nextOwner = patch.owner !== undefined ? patch.owner.trim() : escalation.owner;
    if ((patch.status === "ready" || patch.status === "submitted") && !nextOwner) {
      throw new Error("updateProductEscalation: assign an owner before review or submission");
    }
    if (patch.owner !== undefined) escalation.owner = patch.owner.trim();
    if (patch.notes !== undefined) escalation.notes = patch.notes.trim();
    if (patch.status !== undefined) {
      escalation.status = patch.status;
      if (patch.status === "submitted") escalation.submittedAt = escalation.submittedAt ?? timestamp;
      if (patch.status === "resolved") escalation.resolvedAt = timestamp;
      else delete escalation.resolvedAt;
    }
    if (patch.refreshEvidence) {
      const rec = state.recs.find((item) => item.key === escalation.recKey);
      if (!rec) throw new Error(`updateProductEscalation: recommendation ${escalation.recKey} not found`);
      escalation.evidence = createEscalationEvidence(state, rec, timestamp, visitorEvidence);
    }
    escalation.updatedAt = timestamp;
    delete state.watcherNote;
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
    if (to !== "done") {
      rec.doneDate = null;
      removeTaskMarker(state, rec);
    }
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
    if (page.flag === "paused") throw new Error(`requestPageRun: page ${id} is paused`);
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
  flag?: Flag;
  timeZone?: string;
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
    agentIgnoreRestores: { checks: [], groups: [] },
    acted: {},
  };
}

export function addPage(input: NewPageInput, dataStore: DataStore = getStore()): Promise<AppState> {
  return withState((state) => {
    const title = input.title.trim();
    const url = input.url.trim();
    if (!title || !url) throw new Error("addPage: title and url are required");
    if (!state.collectionSchedule && input.timeZone) {
      const initialSchedule: CollectionSchedule = {
        localTime: "00:00",
        timeZone: input.timeZone,
        overridden: false,
      };
      if (!collectionScheduleIsValid(initialSchedule)) {
        throw new Error("addPage: browser timezone is invalid");
      }
      state.collectionSchedule = initialSchedule;
    }
    // Explicit flags remain supported for API compatibility. The normal add
    // flow omits one so capacity is decided atomically with the persisted
    // state, including when two clients add at the same time.
    const flag = input.flag ?? defaultNewPageFlag(state.pages);
    const capacityError = flagCapacityError(state.pages, null, flag);
    if (capacityError) throw new Error(`addPage: ${capacityError}`);
    // No fabricated provenance (audit): the page begins pending and gets a
    // real baseline/history once a baseline is captured or a run completes.
    state.pages = sortWatchlistPages([
      ...state.pages,
      pendingPage(`p-${randomUUID()}`, title, url, flag),
    ]);
    ensureCollectionOffsets(state.pages);
    delete state.watcherNote;
  }, dataStore);
}
