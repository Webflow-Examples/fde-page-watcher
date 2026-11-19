import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildInitialState } from "@/lib/seed";
import type { AppState } from "@/lib/types";
import type { DataStore } from "@/lib/store";

const { projectStore, reconcileCollectionJobs, recoverStaleRuns } = vi.hoisted(() => ({
  projectStore: vi.fn(),
  reconcileCollectionJobs: vi.fn(),
  recoverStaleRuns: vi.fn(),
}));

// The route's own error mapping and response shape stay real; only the three
// collaborators that read or write storage are swapped.
vi.mock("@/lib/projects", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/projects")>();
  return { ...actual, projectStore };
});
vi.mock("@/lib/collectionJobs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/collectionJobs")>();
  return { ...actual, reconcileCollectionJobs };
});
vi.mock("@/lib/mutations", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/mutations")>();
  return { ...actual, recoverStaleRuns };
});

function store(state: AppState | null): DataStore {
  return {
    tenant: "project-example:live",
    getState: async () => {
      if (!state) throw new Error("storage unavailable");
      return state;
    },
    getCruxEvidence: async () => [],
    getExternalAgentAudits: async () => [],
    updateState: async () => {
      if (!state) throw new Error("storage unavailable");
      return state;
    },
  } as unknown as DataStore;
}

function request(): Request {
  return new Request("https://example.test/api/state?project=project-example");
}

beforeEach(() => {
  projectStore.mockReset();
  reconcileCollectionJobs.mockReset();
  recoverStaleRuns.mockReset();
});

describe("GET /api/state", () => {
  it("serves the project when its collection reconciliation fails", async () => {
    const state = buildInitialState("live");
    projectStore.mockResolvedValue(store(state));
    reconcileCollectionJobs.mockRejectedValue(new Error("collector unavailable"));
    recoverStaleRuns.mockResolvedValue(state);

    const { GET } = await import("../route");
    const response = await GET(request());

    expect(response.status).toBe(200);
    expect((await response.json() as { state: AppState }).state.pages).toHaveLength(state.pages.length);
  });

  it("serves the project when stale-run recovery cannot write", async () => {
    const state = buildInitialState("live");
    projectStore.mockResolvedValue(store(state));
    reconcileCollectionJobs.mockResolvedValue(state);
    recoverStaleRuns.mockRejectedValue(new Error("state update retry exhausted"));

    const { GET } = await import("../route");
    const response = await GET(request());

    expect(response.status).toBe(200);
    expect((await response.json() as { state: AppState }).state.pages).toHaveLength(state.pages.length);
  });

  it("still fails when the state itself cannot be read", async () => {
    projectStore.mockResolvedValue(store(null));
    reconcileCollectionJobs.mockRejectedValue(new Error("storage unavailable"));
    recoverStaleRuns.mockRejectedValue(new Error("storage unavailable"));

    const { GET } = await import("../route");

    await expect(GET(request())).rejects.toThrow("storage unavailable");
  });
});
