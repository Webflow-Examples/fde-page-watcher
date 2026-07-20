import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createFsStore, type DataStore } from "../store/fsStore";
import { pendingPage, recoverStaleRuns, requestPageRun, RUN_STALE_AFTER_MS } from "../mutations";
import { captureBaseline, executePageRun, runNightly, runPage } from "../collector";
import type { AppState, CategoryScore, NightScores } from "../types";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

const score = (m: number): CategoryScore => ({ m, lo: m - 2, hi: m + 2 });
const scores = (perf: number): NightScores => ({ perf: score(perf), a11y: score(92), bp: score(96), seo: score(99) });
const result = (perf: number) => ({ scores: scores(perf), opportunities: [], sampleSize: 5, raws: [{ perf }] });

async function dataStore(pages = [pendingPage("page", "Page", "https://example.com/page", "priority")]): Promise<DataStore> {
  const root = await mkdtemp(path.join(tmpdir(), "fde-collector-"));
  roots.push(root);
  const store = createFsStore("test", root);
  await store.updateState((state) => {
    const initial: AppState = { pages, recs: [], followUps: [] };
    state.pages = initial.pages;
    state.recs = initial.recs;
    state.followUps = initial.followUps;
  });
  return store;
}

describe("pending pages and explicit baselines", () => {
  it("stores an on-demand snapshot but remains pending before baseline capture", async () => {
    const store = await dataStore();
    const state = await runPage("page", {
      dataStore: store,
      collectFn: async () => result(68),
      scanFn: async () => [],
      runIdFactory: () => "run-before-baseline",
      now: () => new Date("2026-07-20T03:00:00.000Z"),
    });
    expect(state.pages[0].history).toHaveLength(1);
    expect(state.pages[0].current.mobile.perf).toBe(68);
    expect(state.pages[0].baseline).toBeUndefined();
    expect(state.pages[0].status).toBe("pending");
  });

  it("stores a nightly snapshot but remains pending before baseline capture", async () => {
    const store = await dataStore();
    const summary = await runNightly({
      dataStore: store,
      collectFn: async () => result(70),
      scanFn: async () => [],
      followupFn: async () => ({ sent: false }),
      runIdFactory: () => "nightly-before-baseline",
      now: () => new Date("2026-07-21T03:00:00.000Z"),
    });
    const state = await store.getState();
    expect(summary.ran).toBe(1);
    expect(state.pages[0].history).toHaveLength(1);
    expect(state.pages[0].status).toBe("pending");
  });

  it("captures real baseline scores and enables later delta classification", async () => {
    const store = await dataStore();
    await runPage("page", {
      dataStore: store,
      collectFn: async () => result(65),
      scanFn: async () => [],
      runIdFactory: () => "pre-baseline-history",
    });
    const captured = await captureBaseline("page", {
      dataStore: store,
      collectFn: async () => result(80),
      now: () => new Date("2026-07-21T12:00:00.000Z"),
    });
    expect(captured.pages[0].baseline?.mobile.perf.m).toBe(80);
    expect(captured.pages[0].current.mobile.perf).toBe(80);
    expect(captured.pages[0].status).toBe("healthy");

    const classified = await runPage("page", {
      dataStore: store,
      collectFn: async () => result(65),
      scanFn: async () => [],
      runIdFactory: () => "post-baseline-history",
    });
    expect(classified.pages[0].history).toHaveLength(2);
    expect(classified.pages[0].current.mobile.perf - classified.pages[0].baseline!.mobile.perf.m).toBe(-15);
    expect(classified.pages[0].status).toBe("degraded");
  });
});

describe("run identity and recovery", () => {
  it("coalesces duplicate requests and commits a run id only once", async () => {
    const store = await dataStore();
    const first = await requestPageRun("page", { dataStore: store, runId: "run-one", now: new Date("2026-07-20T10:00:00Z") });
    const second = await requestPageRun("page", { dataStore: store, runId: "run-two", now: new Date("2026-07-20T10:00:01Z") });
    expect(first.queued).toBe(true);
    expect(second.coalesced).toBe(true);
    expect(second.runId).toBe("run-one");

    const options = { dataStore: store, collectFn: async () => result(72), scanFn: async () => [] };
    await Promise.all([executePageRun("page", first.runId, options), executePageRun("page", first.runId, options)]);
    const state = await store.getState();
    expect(state.pages[0].history.filter((night) => night.runId === "run-one")).toHaveLength(1);
    expect(state.pages[0].runState).toBeUndefined();
  });

  it("fails an abandoned run and permits a replacement", async () => {
    const store = await dataStore();
    const began = new Date("2026-07-20T10:00:00Z");
    await requestPageRun("page", { dataStore: store, runId: "stale-run", now: began });
    const recovered = await recoverStaleRuns(store, new Date(began.getTime() + RUN_STALE_AFTER_MS + 1));
    expect(recovered.pages[0].runState).toBe("failed");
    expect(recovered.pages[0].lastError).toContain("stale limit");
    const replacement = await requestPageRun("page", { dataStore: store, runId: "replacement", now: new Date(began.getTime() + RUN_STALE_AFTER_MS + 2) });
    expect(replacement.queued).toBe(true);
    expect(replacement.runId).toBe("replacement");
  });
});

describe("bounded nightly collection", () => {
  it("starts priority pages first and never exceeds the configured page concurrency", async () => {
    const pages = [
      pendingPage("watch-1", "Watch 1", "https://example.com/watch-1", "watching"),
      pendingPage("priority-1", "Priority 1", "https://example.com/priority-1", "priority"),
      pendingPage("watch-2", "Watch 2", "https://example.com/watch-2", "watching"),
      pendingPage("priority-2", "Priority 2", "https://example.com/priority-2", "priority"),
    ];
    const store = await dataStore(pages);
    const starts: string[] = [];
    let active = 0;
    let maxActive = 0;
    let nextRun = 0;
    await runNightly({
      dataStore: store,
      nightlyConcurrency: 2,
      runIdFactory: () => `night-${nextRun++}`,
      collectFn: async () => result(76),
      scanFn: async (url) => {
        starts.push(url.split("/").pop()!);
        active += 1;
        maxActive = Math.max(maxActive, active);
        await new Promise((resolve) => setTimeout(resolve, 15));
        active -= 1;
        return [];
      },
      followupFn: async () => ({ sent: false }),
    });
    expect(new Set(starts.slice(0, 2))).toEqual(new Set(["priority-1", "priority-2"]));
    expect(maxActive).toBeLessThanOrEqual(2);
  });
});
