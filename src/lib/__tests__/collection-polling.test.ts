import { afterEach, describe, expect, it, vi } from "vitest";
import { collectionSettlementMessage, hasActiveCollections, startCollectionPolling } from "../collectionPolling";
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
    const fetchFn = vi.fn(async () => Response.json({ state: settled }));

    const stop = startCollectionPolling({
      url: "/api/state",
      fetchFn,
      getState: () => current,
      onState: (next) => { current = next; },
    });
    await vi.waitFor(() => expect(fetchFn).toHaveBeenCalledTimes(1));
    expect(fetchFn).toHaveBeenCalledWith("/api/state", { cache: "no-store" });
    await vi.waitFor(() => expect(hasActiveCollections(current)).toBe(false));

    await vi.advanceTimersByTimeAsync(6000);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    stop();
  });
});
