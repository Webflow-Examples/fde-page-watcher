import { getStore } from "./store";
import { classifyStatus, mediansOf } from "./scoring";
import { shortDate } from "./ui";
import type {
  AppState,
  Flag,
  Night,
  NightScores,
  RecStatus,
  ScoreByCategory,
  StrategyScores,
  TaskStatus,
  WatchPage,
} from "./types";

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

export interface NewPageInput {
  title: string;
  url: string;
  flag: Flag;
}

/**
 * Flat NightScores at a fixed set of medians (used to seed a brand-new page so
 * the demo renders history immediately). Ported from the old client path; Phase
 * 2 replaces this with a genuine pending / no-baseline state.
 */
function flatScores(base: ScoreByCategory): StrategyScores {
  const cs = (v: number, spread: number) => ({ m: v, lo: Math.max(0, v - spread), hi: Math.min(100, v + spread) });
  const mobile: NightScores = { perf: cs(base.perf, 3), a11y: cs(base.a11y, 1), bp: cs(base.bp, 1), seo: cs(base.seo, 1) };
  const desktop: NightScores = {
    perf: cs(Math.min(100, base.perf + 18), 3),
    a11y: cs(base.a11y, 1),
    bp: cs(base.bp, 1),
    seo: cs(base.seo, 1),
  };
  return { mobile, desktop };
}

export function addPage(input: NewPageInput): Promise<AppState> {
  return withState((state) => {
    const title = input.title.trim();
    const url = input.url.trim();
    if (!title || !url) throw new Error("addPage: title and url are required");

    const id = `p${Date.now()}`;
    const base: ScoreByCategory = { perf: 70, a11y: 92, bp: 96, seo: 96 };
    const scores = flatScores(base);
    const template = state.pages[0]?.history ?? [];
    const history: Night[] =
      template.length > 0
        ? template.map((d) => ({ i: d.i, date: d.date, scores }))
        : Array.from({ length: 30 }, (_, i) => ({ i, date: "", scores }));

    const page: WatchPage = {
      id,
      title,
      url,
      flag: input.flag,
      status: "healthy",
      baseline: scores,
      current: { mobile: base, desktop: { ...base, perf: Math.min(100, base.perf + 18) } },
      history,
      markers: [],
      agent: [],
      acted: {},
    };
    page.status = classifyStatus(mediansOf(page.baseline.mobile), page.history, "mobile");
    state.pages.push(page);
  });
}
