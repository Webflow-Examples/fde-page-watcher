import { randomUUID } from "node:crypto";
import { isKnownAgentIgnoreTarget } from "./agentChecks";
import { updateAgentIgnoreOverride, updateAgentIgnoreSettings } from "./agentScoring";
import { normalizePerformanceThresholds } from "./performanceThresholds";
import { isSensitivity, thresholdsFor, type Sensitivity } from "./sensitivity";
import { isDigestCadence, type DigestCadence } from "./digestCadence";
import { normalizeDigestRecipients } from "./digestRecipients";
import { collectionScheduleIsValid, ensureCollectionOffsets } from "./collectionSchedule";
import { pageTrend } from "./scoring";
import { getStore } from "./store";
import type { DataStore } from "./store";
import { shortDate } from "./ui";
import type { AgentIgnoreOverrideMode, AgentIgnoreScope, AppState, CollectionSchedule, Flag, RecStatus, ScoreByCategory, TaskStatus, WatchPage } from "./types";
import { defaultNewPageFlag, flagCapacityError } from "./watchCapacity";
import { applyWatchlistPageOrder, changePageFlagOrder, sortWatchlistPages } from "./watchlistOrder";
import { removeTaskMarker } from "./taskMarkers";
import { appendConsentEntry } from "./agentConsent";
import { isKnownNativeElementId, normalizeNativeElementControls } from "./nativeElements";
import { narrowNativeElementExclusionReason } from "./nativeElements";
import { narrowAgentCheckExclusionReason } from "./settings-exclusions";
import { type ExclusionReason } from "./vocabulary";
import { caseDecisionFrom, type CaseDecisionInput } from "./case-decisions";
import type { Caller } from "./caller";
import { alertWebhookUrlIsValid } from "./webhook";
import { COLLECTION_JOB_STALE_AFTER_MS, collectionJobIsStale } from "./collectionRetry";

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

/**
 * Set a check or a category aside for this site, or count it again.
 *
 * The reason is required to exclude, because applicability requires one — the
 * control that used to write this never asked, and S8's Excluded list does. An
 * unlabelled exclusion is still accepted so an older client is not broken by a
 * 500; it reads as `UNLABELLED_EXCLUSION_REASON` on the way out, which is what
 * that record has always meant.
 */
export function setDefaultAgentIgnore(
  scope: AgentIgnoreScope,
  value: string,
  ignored: boolean,
  dataStore: DataStore = getStore(),
  reason?: ExclusionReason,
): Promise<AppState> {
  return withState((state) => {
    if (!isKnownAgentIgnoreTarget(scope, value)) {
      throw new Error(`setDefaultAgentIgnore: ${scope} does not exist`);
    }
    if (reason !== undefined && narrowAgentCheckExclusionReason(reason) === null) {
      throw new Error(`setDefaultAgentIgnore: "${reason}" is not an exclusion reason`);
    }
    state.agentIgnoreDefaults = updateAgentIgnoreSettings(state.agentIgnoreDefaults, scope, value, ignored, reason);
  }, dataStore);
}

/**
 * Exclude a native-element finding from this site's results, or put it back.
 *
 * Applicability, and only applicability. It says whether the finding counts for
 * this site, never how far along anybody is with it — so it deliberately does
 * NOT touch the record's status. The retired control did both at once, which is
 * how one button came to mean "this does not apply here" and "I have seen this
 * and I am not acting" at the same time.
 *
 * A reason is required to exclude and must be one the registry blesses; `null`
 * is Include, which needs none. Excluding is not deleting: the finding keeps its
 * last reading, and the reader who comes back to it is told why it is set aside.
 */
export function setNativeElementApplicability(
  id: string,
  findingId: string,
  reason: ExclusionReason | null,
  dataStore: DataStore = getStore(),
  now: Date = new Date(),
): Promise<AppState> {
  return withState((state) => {
    const page = state.pages.find((item) => item.id === id);
    if (!page) throw new Error(`setNativeElementApplicability: page ${id} not found`);
    if (!isKnownNativeElementId(findingId)) {
      throw new Error(`setNativeElementApplicability: finding ${findingId} does not exist`);
    }
    if (reason !== null && narrowNativeElementExclusionReason(reason) === null) {
      throw new Error(`setNativeElementApplicability: "${reason}" is not an exclusion reason`);
    }
    // Normalised first, so a retired record is migrated rather than half-edited.
    const controls = normalizeNativeElementControls(page.nativeElementControls);
    const existing = controls[findingId];
    const updatedAt = now.toISOString();
    if (reason === null) {
      // Include drops the applicability half and leaves the other alone: a
      // finding that also carries a dismissal is still dismissed.
      if (existing?.dismissed) controls[findingId] = { dismissed: true, updatedAt };
      else delete controls[findingId];
    } else {
      controls[findingId] = {
        ...(existing?.dismissed ? { dismissed: true } : {}),
        excluded: { reason },
        updatedAt,
      };
    }
    page.nativeElementControls = controls;
    delete state.watcherNote;
  }, dataStore);
}

/**
 * Append one decision to the log.
 *
 * The only writer, and it only ever appends: an entry is never edited and never
 * removed, so the log is the history the case panel renders rather than a
 * summary that has to be kept in step with one. Reversing a decision is another
 * entry saying so, which is also how the panel can show that somebody changed
 * their mind.
 *
 * Nothing here touches `recs`. The collector rewrites those nightly and how it
 * merges them is not this app's property, so a decision written onto one is a
 * decision the next run may quietly drop.
 *
 * The stamp is the server's. When a decision was taken and who took it are
 * facts about the request, and a body that could name its own author could name
 * somebody else — so `by` is resolved from the verified identity by the route
 * and passed in, never read out of the body.
 */
export async function recordCaseDecision(
  input: CaseDecisionInput,
  by: Caller,
  dataStore: DataStore = getStore(),
  now: Date = new Date(),
): Promise<AppState> {
  const decision = caseDecisionFrom(input, { at: now.toISOString(), by });
  return withState((state) => {
    state.caseDecisions = [...(state.caseDecisions ?? []), decision];
  }, dataStore);
}

/**
 * Move the one sensitivity control, and resolve the limits behind it.
 *
 * Both halves in one mutation, because they are one fact. The position is what
 * the reader chose; the limits are what it means; storing the first without
 * rewriting the second would leave a screen saying "Normal" over yesterday's
 * numbers, which is precisely the opacity option 10b was chosen to avoid.
 *
 * A malformed position fails loudly rather than falling back to Normal. Rule 18
 * draws that line: an absent value is withheld, but a value that should have
 * been one of three and is not is a shape that should have been impossible, and
 * quietly resetting a reader's sensitivity to the default is a worse outcome
 * than a 400.
 */
export function setSensitivity(
  sensitivity: Sensitivity,
  dataStore: DataStore = getStore(),
): Promise<AppState> {
  if (!isSensitivity(sensitivity)) {
    throw new Error(`setSensitivity: "${sensitivity}" is not a sensitivity position`);
  }
  return withState((state) => {
    state.sensitivity = sensitivity;
    state.performanceThresholds = thresholdsFor(sensitivity);
    // A reader who has just set this by hand has been told everything the
    // migration notice would have said, so it is no longer owed.
    delete state.sensitivityNotice;
    for (const page of state.pages) {
      page.status = pageTrend(page, "mobile", normalizePerformanceThresholds(state.performanceThresholds));
    }
    delete state.watcherNote;
  }, dataStore);
}

/**
 * How often the digest arrives and who it goes to. One site, one answer to
 * each — there is no other granularity, by decision.
 */
export function setDigestSettings(
  settings: { cadence: DigestCadence; recipients: readonly string[] },
  dataStore: DataStore = getStore(),
): Promise<AppState> {
  if (!isDigestCadence(settings.cadence)) {
    throw new Error(`setDigestSettings: "${settings.cadence}" is not a digest cadence`);
  }
  return withState((state) => {
    state.digestCadence = settings.cadence;
    state.digestRecipients = normalizeDigestRecipients([...settings.recipients]);
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

/**
 * Record or withdraw project-level consent for public external agent audits.
 * Withdrawing consent stops future requests; evidence already stored is
 * retained, since it is a historical reading rather than a live permission.
 */
/**
 * Change the project's consent, and record who changed it. *
 * The boolean is the live answer the gate reads; the history is the record of
 * how it got there. They are written in one `withState` and there is no path
 * that writes either alone — a flipped boolean with no entry would leave the
 * project unable to say who permitted a scan, and an entry with no flip would
 * describe a decision that never took effect.
 *
 * A call that does not change the value appends nothing. An entry says what was
 * decided, and re-selecting the position a project is already in is not a
 * decision; recording one would put a change in the history that never happened.
 */
export function setExternalAgentAuditEnabled(
  enabled: boolean,
  by: Caller,
  dataStore: DataStore = getStore(),
  now: Date = new Date(),
): Promise<AppState> {
  return withState((state) => {
    if (state.externalAgentAuditEnabled === enabled) return;
    state.externalAgentAuditEnabled = enabled;
    state.externalAgentAuditConsentHistory = appendConsentEntry(
      state.externalAgentAuditConsentHistory,
      enabled,
      by,
      now.toISOString(),
    );
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
      const job = (state.jobs ?? []).find((item) =>
        item.runId === page.runId
        && (item.state === "queued"
          || item.state === "dispatching"
          || item.state === "running"
          || item.state === "waiting_for_evidence"));
      if (job && !collectionJobIsStale(job, now)) {
        // The durable job is authoritative. This also repairs page records
        // incorrectly failed by the legacy 15-minute page-only timeout while
        // a Workflow was sleeping until its next PSI evidence retry.
        page.runState = job.state as Exclude<WatchPage["runState"], "failed" | undefined>;
        page.startedAt = page.startedAt ?? job.startedAt ?? job.createdAt;
        delete page.lastError;
        continue;
      }
      if (job) {
        page.runState = "failed";
        page.lastRunAt = now.toISOString();
        page.lastError = job.nextRetryAt
          ? "Job did not resume after its scheduled PSI evidence retry"
          : `Run ${page.runId ?? "unknown"} exceeded the ${Math.round(COLLECTION_JOB_STALE_AFTER_MS / 60_000)} minute stale limit`;
        job.state = "failed";
        job.error = page.lastError;
        job.updatedAt = now.toISOString();
        job.completedAt = now.toISOString();
        continue;
      }
      if (!page.runState || page.runState === "failed") continue;
      const age = page.startedAt ? now.getTime() - Date.parse(page.startedAt) : Number.POSITIVE_INFINITY;
      if (!Number.isFinite(age) || age > RUN_STALE_AFTER_MS) {
        page.runState = "failed";
        page.lastRunAt = now.toISOString();
        page.lastError = `Run ${page.runId ?? "unknown"} exceeded the ${Math.round(RUN_STALE_AFTER_MS / 60_000)} minute stale limit`;
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
