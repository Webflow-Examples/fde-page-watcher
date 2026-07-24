import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createFsStore, type DataStore } from "../store/fsStore";
import { addPage, advanceTask, pendingPage, setAgentIgnore, setDefaultAgentIgnore, setPageFlag, setPageTitle, setPerformanceThresholds } from "../mutations";
import { DEFAULT_PERFORMANCE_THRESHOLDS } from "../performanceThresholds";
import { agentCheckKey } from "../agentScoring";
import { captureBaseline, runPage } from "../collector";
import type { AppState, CategoryScore, NightScores, Rec } from "../types";

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
      collectFn: async () => {
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

  it("renames a page and its recommendation labels without changing the URL", async () => {
    const dataStore = await storeWithState();
    const before = await dataStore.getState();

    const state = await setPageTitle("page", "  Renamed page  ", dataStore);

    expect(state.pages[0].title).toBe("Renamed page");
    expect(state.pages[0].url).toBe(before.pages[0].url);
    expect(state.recs[0].pageTitle).toBe("Renamed page");
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

  it("persists page-specific agent-readiness ignores", async () => {
    const dataStore = await storeWithState();
    const check = { group: "API / Auth / MCP", name: "WebMCP", pass: false };
    await dataStore.updateState((state) => {
      state.pages[0].agent = [check];
    });

    await setAgentIgnore("page", "check", agentCheckKey(check), true, dataStore);
    const ignored = await dataStore.getState();
    expect(ignored.pages[0].agentIgnores?.checks).toEqual([agentCheckKey(check)]);

    await setAgentIgnore("page", "check", agentCheckKey(check), false, dataStore);
    const restored = await dataStore.getState();
    expect(restored.pages[0].agentIgnores?.checks).toEqual([]);
  });

  it("persists global ignores and page-specific restore overrides independently", async () => {
    const dataStore = await storeWithState();
    const check = { group: "API / Auth / MCP", name: "WebMCP", pass: false };
    const checkKey = agentCheckKey(check);

    await setDefaultAgentIgnore("check", checkKey, true, dataStore);
    await setAgentIgnore("page", "check", checkKey, "restore", dataStore);

    const state = await dataStore.getState();
    expect(state.agentIgnoreDefaults?.checks).toEqual([checkKey]);
    expect(state.pages[0].agentIgnores?.checks).toEqual([]);
    expect(state.pages[0].agentIgnoreRestores?.checks).toEqual([checkKey]);
  });

  it("persists team-wide performance tolerances", async () => {
    const dataStore = await storeWithState();

    const state = await setPerformanceThresholds(
      {
        ...DEFAULT_PERFORMANCE_THRESHOLDS,
        lowPerformance: 72,
        regression: 5,
        confirmationRuns: 2,
        devicePolicy: "both",
      },
      dataStore,
    );

    expect(state.performanceThresholds).toEqual({
      ...DEFAULT_PERFORMANCE_THRESHOLDS,
      lowPerformance: 72,
      regression: 5,
      confirmationRuns: 2,
      devicePolicy: "both",
    });
  });

  it("defaults newly added pages to Watching", async () => {
    const dataStore = await storeWithState();

    const state = await addPage({ title: "New page", url: "https://example.com/new" }, dataStore);

    expect(state.pages.find((page) => page.title === "New page")?.flag).toBe("watching");
  });

  it("adds new pages as Paused when all active monitoring slots are in use", async () => {
    const dataStore = await storeWithState();
    await dataStore.updateState((state) => {
      state.pages = [
        ...Array.from({ length: 3 }, (_, index) => pendingPage(`priority-${index}`, `Priority ${index}`, `https://example.com/p${index}`, "priority")),
        ...Array.from({ length: 7 }, (_, index) => pendingPage(`watching-${index}`, `Watching ${index}`, `https://example.com/w${index}`, "watching")),
      ];
    });

    const state = await addPage({ title: "Waiting page", url: "https://example.com/waiting" }, dataStore);

    expect(state.pages).toHaveLength(11);
    expect(state.pages.find((page) => page.title === "Waiting page")?.flag).toBe("paused");
  });

  it("enforces Priority and active monitoring limits atomically", async () => {
    const dataStore = await storeWithState();
    await dataStore.updateState((state) => {
      state.pages = [
        ...Array.from({ length: 3 }, (_, index) => pendingPage(`priority-${index}`, `Priority ${index}`, `https://example.com/p${index}`, "priority")),
        ...Array.from({ length: 7 }, (_, index) => pendingPage(`watching-${index}`, `Watching ${index}`, `https://example.com/w${index}`, "watching")),
        pendingPage("paused", "Paused", "https://example.com/paused", "paused"),
      ];
    });

    await expect(setPageFlag("watching-0", "priority", dataStore)).rejects.toThrow("Only 3 pages");
    await expect(setPageFlag("paused", "watching", dataStore)).rejects.toThrow("Only 10 pages");
  });

  it("preserves history and baseline through pause and resume", async () => {
    const dataStore = await storeWithState();
    await dataStore.updateState((state) => {
      const target = state.pages[0];
      const nightScores = { mobile: scores(72), desktop: scores(88) };
      target.history = [{ i: 0, date: "Jul 20", scores: nightScores }];
      target.baseline = nightScores;
      target.baselineCapturedAt = "2026-07-20T12:00:00.000Z";
    });
    const before = await dataStore.getState();

    await setPageFlag("page", "paused", dataStore);
    await setPageFlag("page", "watching", dataStore);
    const after = await dataStore.getState();

    expect(after.pages[0].history).toEqual(before.pages[0].history);
    expect(after.pages[0].baseline).toEqual(before.pages[0].baseline);
    expect(after.pages[0].flag).toBe("watching");
  });
});
