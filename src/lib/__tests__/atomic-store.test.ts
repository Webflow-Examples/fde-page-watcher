import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createFsStore, type DataStore } from "../store/fsStore";
import { advanceTask, pendingPage, setPageFlag } from "../mutations";
import { captureBaseline, runPage } from "../collector";
import type { AppState, CategoryScore, NightScores, Rec, Strategy } from "../types";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

const score = (m: number): CategoryScore => ({ m, lo: m - 1, hi: m + 1 });
const scores = (perf = 75): NightScores => ({ perf: score(perf), a11y: score(90), bp: score(95), seo: score(98) });

function rec(): Rec {
  return {
    key: "page:rec",
    pageId: "page",
    pageTitle: "Page",
    url: "https://example.com",
    id: "rec",
    title: "Fix it",
    category: "Performance",
    savings: "1.0 s",
    estTime: "1 day",
    status: "task",
    taskStatus: "todo",
    added: "Jul 20",
    doneDate: null,
  };
}

async function storeWithState(): Promise<DataStore> {
  const root = await mkdtemp(path.join(tmpdir(), "fde-atomic-"));
  roots.push(root);
  const dataStore = createFsStore("test", root);
  await dataStore.updateState((state) => {
    const initial: AppState = {
      pages: [pendingPage("page", "Page", "https://example.com", "priority")],
      recs: [rec()],
      followUps: [],
    };
    state.pages = initial.pages;
    state.recs = initial.recs;
    state.followUps = initial.followUps;
  });
  return dataStore;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

function collection(perf = 75) {
  return {
    scores: scores(perf),
    opportunities: [],
    sampleSize: 5,
    raws: [{ ok: true }],
  };
}

describe("atomic tenant updates", () => {
  it("serializes independent mutations without losing either update", async () => {
    const dataStore = await storeWithState();
    await Promise.all([
      dataStore.updateState(async (state) => {
        await new Promise((resolve) => setTimeout(resolve, 20));
        state.pages[0].flag = "watching";
      }),
      dataStore.updateState((state) => {
        state.recs[0].taskStatus = "in-progress";
      }),
    ]);
    const state = await dataStore.getState();
    expect(state.pages[0].flag).toBe("watching");
    expect(state.recs[0].taskStatus).toBe("in-progress");
  });

  it("preserves a flag mutation while collector network work is in flight", async () => {
    const dataStore = await storeWithState();
    const gate = deferred<ReturnType<typeof collection>>();
    let started = 0;
    const running = runPage("page", {
      dataStore,
      collectFn: async (_url: string, _strategy: Strategy) => {
        started += 1;
        return gate.promise;
      },
      scanFn: async () => [],
      runIdFactory: () => "run-collector-race",
    });
    while (started < 2) await new Promise((resolve) => setTimeout(resolve, 0));
    await setPageFlag("page", "watching", dataStore);
    gate.resolve(collection());
    const state = await running;
    expect(state.pages[0].flag).toBe("watching");
    expect(state.pages[0].history).toHaveLength(1);
  });

  it("preserves a task mutation while baseline collection is in flight", async () => {
    const dataStore = await storeWithState();
    const gate = deferred<ReturnType<typeof collection>>();
    let started = 0;
    const capturing = captureBaseline("page", {
      dataStore,
      collectFn: async () => {
        started += 1;
        return gate.promise;
      },
      now: () => new Date("2026-07-20T12:00:00.000Z"),
    });
    while (started < 2) await new Promise((resolve) => setTimeout(resolve, 0));
    await advanceTask("page:rec", "in-progress", dataStore);
    gate.resolve(collection(82));
    const state = await capturing;
    expect(state.recs[0].taskStatus).toBe("in-progress");
    expect(state.pages[0].baseline?.mobile.perf.m).toBe(82);
    expect(state.pages[0].baselineCapturedAt).toBe("2026-07-20T12:00:00.000Z");
  });
});
