import { afterEach, describe, expect, it, vi } from "vitest";
import { RemoteDataStore } from "../store/remoteStore";
import { buildInitialState } from "../seed";
import type { AppState, Night } from "../types";

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

  it("reads external agent audits from the authenticated data plane", async () => {
    vi.stubEnv("FDE_DATA_URL", "https://collector.example.test");
    vi.stubEnv("CRON_SECRET", "shared-secret");
    const fetchFn = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      expect(new Headers(init?.headers).get("authorization")).toBe("Bearer shared-secret");
      expect(String(input)).toBe("https://collector.example.test/data/tenant/agent-audits");
      expect(init?.method ?? "GET").toBe("GET");
      return Response.json({
        audits: [{
          provider: "ora",
          origin: "https://example.com",
          status: { provider: "ora", origin: "https://example.com", status: "available", lastAttemptedAt: "2026-08-24T06:00:00.000Z" },
          snapshots: [],
        }],
      });
    }) as typeof fetch;
    const store = new RemoteDataStore("tenant", fetchFn);
    const audits = await store.getExternalAgentAudits();
    expect(audits).toHaveLength(1);
    expect(audits[0].origin).toBe("https://example.com");
  });

  it("treats a collector without the external-audit route as no evidence", async () => {
    vi.stubEnv("FDE_DATA_URL", "https://collector.example.test");
    vi.stubEnv("CRON_SECRET", "shared-secret");
    // An older collector answers 200 with an unrelated body rather than `audits`.
    const fetchFn = vi.fn(async () => Response.json({})) as typeof fetch;
    await expect(new RemoteDataStore("tenant", fetchFn).getExternalAgentAudits()).resolves.toEqual([]);
  });

  it("surfaces an external-audit read failure instead of reporting empty evidence", async () => {
    vi.stubEnv("FDE_DATA_URL", "https://collector.example.test");
    vi.stubEnv("CRON_SECRET", "shared-secret");
    const fetchFn = vi.fn(async () =>
      Response.json({ error: "unauthorized" }, { status: 401 })) as typeof fetch;
    await expect(new RemoteDataStore("tenant", fetchFn).getExternalAgentAudits())
      .rejects.toThrow(/FDE agent audit read 401/);
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

function stateWithHistory(): AppState {
  const state = buildInitialState("demo");
  state.pages = [state.pages[0]];
  return state;
}

function nightInput(night: Night): Omit<Night, "i" | "runId" | "rawReportKey"> {
  const copy = { ...night } as Partial<Night>;
  delete copy.i;
  delete copy.runId;
  delete copy.rawReportKey;
  return copy as Omit<Night, "i" | "runId" | "rawReportKey">;
}

describe("FDE remote state writes", () => {
  it("sends a history-free state once the collector advertises delta writes", async () => {
    vi.stubEnv("FDE_DATA_URL", "https://collector.example.test");
    vi.stubEnv("CRON_SECRET", "shared-secret");
    const original = stateWithHistory();
    const page = original.pages[0];
    const seen: { body?: { state: AppState; expectedVersion: number; history?: unknown } } = {};
    const fetchFn = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      if (!init?.method || init.method === "GET") {
        return Response.json(
          { state: original, version: 0, updatedAt: "2026-11-19T00:00:00Z" },
          { headers: { "x-fde-history-write": "delta" } },
        );
      }
      seen.body = JSON.parse(String(init.body)) as typeof seen.body;
      return Response.json({ state: original, version: 1, updatedAt: "2026-11-19T00:00:01Z" });
    }) as typeof fetch;

    const store = new RemoteDataStore("tenant", fetchFn);
    const result = await store.updateState((draft) => {
      draft.watcherNote = { text: "small write", generatedAt: "2026-11-19T00:00:00Z" };
    });

    expect(seen.body?.history).toBe("unchanged");
    expect(seen.body?.state.watcherNote?.text).toBe("small write");
    expect(seen.body?.state.pages[0].history).toEqual([]);
    expect(result.pages[0].history).toEqual(page.history);
  });

  it("keeps the full snapshot for a collector that has not advertised delta writes", async () => {
    vi.stubEnv("FDE_DATA_URL", "https://collector.example.test");
    vi.stubEnv("CRON_SECRET", "shared-secret");
    const original = stateWithHistory();
    const page = original.pages[0];
    const seen: { body?: { state: AppState; history?: unknown } } = {};
    const fetchFn = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      if (!init?.method || init.method === "GET") {
        return Response.json({ state: original, version: 0, updatedAt: "2026-11-19T00:00:00Z" });
      }
      seen.body = JSON.parse(String(init.body)) as typeof seen.body;
      return Response.json({ state: original, version: 1, updatedAt: "2026-11-19T00:00:01Z" });
    }) as typeof fetch;

    const store = new RemoteDataStore("tenant", fetchFn);
    await store.updateState((draft) => {
      draft.watcherNote = { text: "legacy write", generatedAt: "2026-11-19T00:00:00Z" };
    });

    expect(seen.body?.history).toBeUndefined();
    expect(seen.body?.state.pages[0].history).toEqual(page.history);
  });

  it("names the appended night in a history delta", async () => {
    vi.stubEnv("FDE_DATA_URL", "https://collector.example.test");
    vi.stubEnv("CRON_SECRET", "shared-secret");
    const original = stateWithHistory();
    const page = original.pages[0];
    const last = page.history.at(-1)!;
    page.runState = "running";
    page.runId = "run-new";
    const seen: {
      body?: {
        state: AppState;
        history?: { upserts: Array<{ pageId: string; night: Night }>; deletes: Array<{ pageId: string; i: number }> };
      };
    } = {};
    const fetchFn = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      if (!init?.method || init.method === "GET") {
        return Response.json(
          { state: original, version: 0, updatedAt: "2026-11-19T00:00:00Z" },
          { headers: { "x-fde-history-write": "delta" } },
        );
      }
      seen.body = JSON.parse(String(init.body)) as typeof seen.body;
      return Response.json({ state: original, version: 1, updatedAt: "2026-11-19T00:00:01Z" });
    }) as typeof fetch;

    const store = new RemoteDataStore("tenant", fetchFn);
    await store.appendNight(page.id, "run-new", nightInput(last));

    expect(seen.body?.state.pages[0].history).toEqual([]);
    expect(seen.body?.history?.upserts).toHaveLength(1);
    expect(seen.body?.history?.upserts[0].pageId).toBe(page.id);
    expect(seen.body?.history?.upserts[0].night.runId).toBe("run-new");
    expect(seen.body?.history?.upserts[0].night.i).toBe(last.i + 1);
    expect(seen.body?.history?.deletes).toEqual([]);
  });
});
