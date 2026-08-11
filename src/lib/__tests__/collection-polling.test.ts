import { afterEach, describe, expect, it, vi } from "vitest";
import { collectionRequestMessage, collectionSettlementMessage, hasActiveCollections, startCollectionPolling } from "../collectionPolling";
import { pendingPage } from "../mutations";
import type { AppState } from "../types";

function makeState(): AppState {
  return {
    pages: [pendingPage("page", "Homepage", "https://webflow.com", "priority")],
    recs: [],
    jobs: [],
  };
}

describe("collection polling recovery", () => {
  afterEach(() => vi.useRealTimers());

  it("detects persisted active jobs after a refresh", () => {
    const state = makeState();
    state.pages[0].runState = "running";
    expect(hasActiveCollections(state)).toBe(true);

    delete state.pages[0].runState;
    state.jobs = [{
      id: "job",
      runId: "job",
      pageId: state.pages[0].id,
      kind: "baseline",
      state: "dispatching",
      attempts: 1,
      createdAt: "2026-07-21T22:00:00.000Z",
      updatedAt: "2026-07-21T22:00:00.000Z",
    }];
    expect(hasActiveCollections(state)).toBe(true);
  });

  it("reports coalesced evidence retries without claiming a new run started", () => {
    const state = makeState();
    state.jobs = [{
      id: "job",
      runId: "job",
      pageId: state.pages[0].id,
      kind: "baseline",
      state: "waiting_for_evidence",
      attempts: 1,
      createdAt: "2026-08-03T09:00:00.000Z",
      updatedAt: "2026-08-03T09:20:00.000Z",
      nextRetryAt: "2026-08-03T12:20:00.000Z",
    }];

    expect(collectionRequestMessage("Homepage", "run", {
      state,
      queued: false,
      coalesced: true,
      jobId: "job",
    })).toBe("Collection for Homepage is waiting for evidence and will retry automatically");
  });

  it("stops polling and reports a recovered baseline", () => {
    const previous = makeState();
    previous.pages[0].runState = "running";
    previous.jobs = [{
      id: "job",
      runId: "job",
      pageId: previous.pages[0].id,
      kind: "baseline",
      state: "running",
      attempts: 1,
      createdAt: "2026-07-21T22:00:00.000Z",
      updatedAt: "2026-07-21T22:00:00.000Z",
    }];

    const next = structuredClone(previous);
    delete next.pages[0].runState;
    next.jobs![0].state = "succeeded";

    expect(hasActiveCollections(next)).toBe(false);
    expect(collectionSettlementMessage(previous, next)).toBe(`Baseline captured for ${next.pages[0].title}`);
  });

  it("reconciles persisted work immediately and stops after it settles", async () => {
    vi.useFakeTimers();
    let current = makeState();
    current.pages[0].runState = "running";
    const settled = structuredClone(current);
    delete settled.pages[0].runState;
    const fetchFn = vi.fn(async () => Response.json({ state: settled, visitorExperience: [] }));
    const onVisitorExperience = vi.fn();

    const stop = startCollectionPolling({
      url: "/api/state",
      fetchFn,
      getState: () => current,
      onState: (next) => { current = next; },
      onVisitorExperience,
    });
    await vi.waitFor(() => expect(fetchFn).toHaveBeenCalledTimes(1));
    expect(fetchFn).toHaveBeenCalledWith("/api/state", { cache: "no-store" });
    await vi.waitFor(() => expect(hasActiveCollections(current)).toBe(false));
    expect(onVisitorExperience).toHaveBeenCalledWith([]);

    await vi.advanceTimersByTimeAsync(6000);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    stop();
  });
});
