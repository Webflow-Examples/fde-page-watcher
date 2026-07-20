import { getStore } from "./store";
import { shortDate } from "./ui";
import type { AppState, Flag, NightScores, RecStatus, ScoreByCategory, TaskStatus, WatchPage } from "./types";

/**
 * Server-side domain mutations. Each performs a read-modify-write against the
 * authoritative store (getState -> mutate one slice -> saveState) so a client
 * action can never overwrite unrelated data collected by a concurrent nightly
 * run. This replaces the old whole-state PUT (audit High #2).
 *
 * Every mutation returns the fresh authoritative AppState.
 */

async function withState(mutate: (state: AppState) => void): Promise<AppState> {
  const s = getStore();
  const state = await s.getState();
  mutate(state);
  await s.saveState(state);
  return state;
}

export function setPageFlag(id: string, flag: Flag): Promise<AppState> {
  return withState((state) => {
    const page = state.pages.find((p) => p.id === id);
    if (!page) throw new Error(`setPageFlag: page ${id} not found`);
    page.flag = flag;
  });
}

export function removePage(id: string): Promise<AppState> {
  return withState((state) => {
    state.pages = state.pages.filter((p) => p.id !== id);
    state.recs = state.recs.filter((r) => r.pageId !== id);
    state.followUps = (state.followUps ?? []).filter((f) => f.pageId !== id);
  });
}

export function setRecStatus(key: string, status: RecStatus): Promise<AppState> {
  return withState((state) => {
    const rec = state.recs.find((r) => r.key === key);
    if (!rec) throw new Error(`setRecStatus: rec ${key} not found`);
    rec.status = status;
    // Saving to Tasks resets the board lifecycle to "todo", matching the UI.
    if (status === "task") rec.taskStatus = "todo";
  });
}

export function advanceTask(key: string, to: TaskStatus): Promise<AppState> {
  return withState((state) => {
    const rec = state.recs.find((r) => r.key === key);
    if (!rec) throw new Error(`advanceTask: rec ${key} not found`);
    rec.taskStatus = to;
    if (to === "done") rec.doneDate = rec.doneDate ?? shortDate();
    if (to !== "done") rec.doneDate = null;
  });
}

/** Mark a page's collection run as in-flight (audit High #1: async runs). */
export function markRunning(id: string): Promise<AppState> {
  return withState((state) => {
    const page = state.pages.find((p) => p.id === id);
    if (!page) throw new Error(`markRunning: page ${id} not found`);
    page.runState = "running";
    delete page.lastError;
  });
}

/** Settle a page's run: clear the flag on success, record the error on failure. */
export function markRunFinished(id: string, error?: string): Promise<AppState> {
  return withState((state) => {
    const page = state.pages.find((p) => p.id === id);
    if (!page) return; // page removed mid-run — nothing to settle
    page.runState = error ? "failed" : undefined;
    page.lastRunAt = new Date().toISOString();
    if (error) page.lastError = error;
    else delete page.lastError;
  });
}

export interface NewPageInput {
  title: string;
  url: string;
  flag: Flag;
}

/** A brand-new page starts pending: no baseline, no history, no scan. */
export function pendingPage(id: string, title: string, url: string, flag: Flag): WatchPage {
  const zeroCat = { m: 0, lo: 0, hi: 0 };
  const zeroNight: NightScores = { perf: zeroCat, a11y: zeroCat, bp: zeroCat, seo: zeroCat };
  const zeroScores: ScoreByCategory = { perf: 0, a11y: 0, bp: 0, seo: 0 };
  return {
    id,
    title,
    url,
    flag,
    status: "pending",
    baseline: { mobile: zeroNight, desktop: zeroNight },
    current: { mobile: zeroScores, desktop: zeroScores },
    history: [],
    markers: [],
    agent: [],
    acted: {},
  };
}

export function addPage(input: NewPageInput): Promise<AppState> {
  return withState((state) => {
    const title = input.title.trim();
    const url = input.url.trim();
    if (!title || !url) throw new Error("addPage: title and url are required");
    // No fabricated provenance (audit): the page begins pending and gets a
    // real baseline/history once a baseline is captured or a run completes.
    state.pages.push(pendingPage(`p${Date.now()}`, title, url, input.flag));
  });
}
