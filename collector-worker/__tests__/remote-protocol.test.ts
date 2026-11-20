import { afterEach, describe, expect, it, vi } from "vitest";
import { buildInitialState } from "../../src/lib/seed";
import { RemoteDataStore } from "../../src/lib/store/remoteStore";
import type { AppState, Night } from "../../src/lib/types";
import { handleDataPlaneRequest } from "../dataPlane";
import { createFdeStore } from "../dataStore";
import { stateWithoutEmbeddedHistory } from "../../src/lib/store/historyState";

afterEach(() => vi.unstubAllEnvs());

function collector(original: AppState) {
  let stateRow = {
    json: JSON.stringify(stateWithoutEmbeddedHistory(original)),
    version: 0,
    updated_at: "2026-11-19T00:00:00.000Z",
  };
  const history = new Map<string, { page_id: string; i: number; night_json: string }>();
  for (const page of original.pages) {
    for (const night of page.history) {
      history.set(`${page.id}:${night.i}`, { page_id: page.id, i: night.i, night_json: JSON.stringify(night) });
    }
  }

  const statement = (sql: string, values: unknown[] = []) => ({
    sql,
    values,
    bind: (...next: unknown[]) => statement(sql, next),
    first: async () => sql.startsWith("SELECT json, version, updated_at FROM state") ? stateRow : null,
    all: async () => {
      if (sql.startsWith("SELECT DISTINCT page_id")) {
        return { results: [...new Set([...history.values()].map((row) => row.page_id))].map((page_id) => ({ page_id })) };
      }
      if (sql.startsWith("SELECT page_id, i, night_json")) return { results: [...history.values()] };
      return { results: [] };
    },
    run: async () => {
      if (sql.startsWith("UPDATE state SET json")) {
        stateRow = { json: String(values[0]), version: stateRow.version + 1, updated_at: String(values[1]) };
      }
      return { success: true, meta: { rows_written: 1 } };
    },
  });
  const DB = {
    prepare: (sql: string) => statement(sql),
    batch: async (statements: Array<{ sql: string; values: unknown[] }>) => {
      for (const item of statements) {
        if (item.sql.startsWith("INSERT INTO history")) {
          history.set(`${item.values[1]}:${item.values[2]}`, {
            page_id: String(item.values[1]),
            i: Number(item.values[2]),
            night_json: String(item.values[3]),
          });
        } else if (item.sql.startsWith("DELETE FROM history") && item.sql.includes("AND i = ?")) {
          history.delete(`${item.values[1]}:${item.values[2]}`);
        } else if (item.sql.startsWith("DELETE FROM history")) {
          for (const [key, row] of [...history]) {
            if (row.page_id === item.values[1]) history.delete(key);
          }
        }
      }
      return statements.map(() => ({ success: true, meta: { rows_written: 1 } }));
    },
  };
  const bindings = { DB, REPORTS: {} } as never;
  const requests: Array<{ body?: string }> = [];

  const fetchFn = (async (input: string | URL | Request, init?: RequestInit) => {
    requests.push(init?.body === undefined ? {} : { body: String(init.body) });
    const request = new Request(new URL(String(input)), init);
    const response = await handleDataPlaneRequest(request, bindings);
    if (!response) throw new Error(`no data-plane route for ${request.url}`);
    return response;
  }) as typeof fetch;

  return {
    store: new RemoteDataStore("customer:live", fetchFn),
    fde: createFdeStore("customer:live", bindings),
    history,
    requests,
  };
}

function onePage(): AppState {
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

describe("remote state protocol end to end", () => {
  it("keeps history when a mutation crosses the data plane", async () => {
    vi.stubEnv("FDE_DATA_URL", "https://collector.example.test");
    vi.stubEnv("CRON_SECRET", "shared-secret");
    const original = onePage();
    const { store, history, requests } = collector(original);
    const before = [...history.keys()].sort();

    const result = await store.updateState((draft) => {
      draft.watcherNote = { text: "crossed the wire", generatedAt: "2026-11-19T00:00:00Z" };
    });

    const body = JSON.parse(requests.at(-1)!.body!) as {
      state: AppState;
      history: unknown;
    };
    expect(body.history).toBe("unchanged");
    expect(body.state.pages[0].history).toEqual([]);
    expect(body.state.watcherNote?.text).toBe("crossed the wire");
    // The write no longer carries the nights, which are most of the snapshot.
    expect(requests.at(-1)!.body!.length).toBeLessThan(JSON.stringify(original).length / 2);
    expect([...history.keys()].sort()).toEqual(before);
    expect(result.pages[0].history).toEqual(original.pages[0].history);
  });

  it("writes an appended night through the data plane and returns it", async () => {
    vi.stubEnv("FDE_DATA_URL", "https://collector.example.test");
    vi.stubEnv("CRON_SECRET", "shared-secret");
    const original = onePage();
    const page = original.pages[0];
    const last = page.history.at(-1)!;
    page.runState = "running";
    page.runId = "run-wire";
    const { store, history, requests } = collector(original);

    const appended = await store.appendNight(page.id, "run-wire", nightInput(last));

    const body = JSON.parse(requests.at(-1)!.body!) as {
      history: { upserts: Array<{ pageId: string; night: Night }> };
    };
    expect(body.history.upserts).toHaveLength(1);
    expect(body.history.upserts[0].night.runId).toBe("run-wire");
    expect(history.has(`${page.id}:${last.i + 1}`)).toBe(true);
    expect(appended.state.pages[0].history.some((night) => night.i === last.i + 1)).toBe(true);
  });
});
