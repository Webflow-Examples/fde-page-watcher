import { afterEach, describe, expect, it, vi } from "vitest";
import { RemoteDataStore } from "../store/remoteStore";
import type { AppState } from "../types";

afterEach(() => vi.unstubAllEnvs());

function state(): AppState {
  return { pages: [], recs: [], jobs: [], followUps: [] };
}

describe("FDE remote store", () => {
  it("retries a version conflict and reapplies the mutation", async () => {
    vi.stubEnv("COLLECTOR_URL", "https://collector.example.test/jobs");
    vi.stubEnv("CRON_SECRET", "shared-secret");
    let reads = 0;
    let writes = 0;
    const fetchFn = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      expect(new Headers(init?.headers).get("authorization")).toBe("Bearer shared-secret");
      expect(String(input)).toBe("https://collector.example.test/data/brand-studio%3Alive/state");
      if (!init?.method || init.method === "GET") {
        reads += 1;
        return Response.json({ state: state(), version: reads - 1, updatedAt: "2026-07-22T00:00:00Z" });
      }
      const body = JSON.parse(String(init.body)) as { state: AppState; expectedVersion: number };
      writes += 1;
      if (writes === 1) return Response.json({ error: "state version conflict" }, { status: 409 });
      expect(body.expectedVersion).toBe(1);
      expect(body.state.watcherNote?.text).toBe("remote mutation");
      return Response.json({ state: body.state, version: 2, updatedAt: "2026-07-22T00:00:01Z" });
    }) as typeof fetch;

    const store = new RemoteDataStore("brand-studio:live", fetchFn);
    const result = await store.updateState((draft) => {
      draft.watcherNote = { text: "remote mutation", generatedAt: "2026-07-22T00:00:00Z" };
    });
    expect(result.watcherNote?.text).toBe("remote mutation");
    expect(reads).toBe(2);
    expect(writes).toBe(2);
  });

  it("stores and reads raw reports through authenticated FDE endpoints", async () => {
    vi.stubEnv("FDE_DATA_URL", "https://collector.example.test");
    vi.stubEnv("CRON_SECRET", "shared-secret");
    const fetchFn = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      expect(String(input)).toBe("https://collector.example.test/data/tenant/reports/page/run-1");
      if (init?.method === "PUT") {
        expect(JSON.parse(String(init.body))).toEqual({ payload: { raw: true } });
        return Response.json({ ok: true });
      }
      return Response.json({ payload: { raw: true } });
    }) as typeof fetch;
    const store = new RemoteDataStore("tenant", fetchFn);
    await store.putReport("page", "run-1", { raw: true });
    await expect(store.getReport("page", "run-1")).resolves.toEqual({ raw: true });
  });
});
