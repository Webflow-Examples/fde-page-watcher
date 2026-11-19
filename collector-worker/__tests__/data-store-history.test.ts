import { describe, expect, it } from "vitest";
import { buildInitialState } from "../../src/lib/seed";
import { stateWithoutEmbeddedHistory } from "../../src/lib/store/historyState";
import type { AppState } from "../../src/lib/types";
import { FdeDataStore } from "../dataStore";

describe("FDE table-backed history", () => {
  it("externalizes a legacy state row and removes stale derived history", async () => {
    const legacy = buildInitialState("demo");
    legacy.pages = [legacy.pages[0]];
    const expected = structuredClone(legacy.pages[0].history);
    let stateRow = {
      json: JSON.stringify(legacy),
      version: 3,
      updated_at: "2026-08-17T00:00:00.000Z",
    };
    const history = new Map(expected.map((night) => [
      `${legacy.pages[0].id}:${night.i}`,
      { page_id: legacy.pages[0].id, i: night.i, night_json: JSON.stringify(night) },
    ]));
    history.set(`${legacy.pages[0].id}:99`, {
      page_id: legacy.pages[0].id,
      i: 99,
      night_json: JSON.stringify({ ...expected[0], i: 99 }),
    });

    const statement = (sql: string, values: unknown[] = []) => ({
      sql,
      values,
      bind: (...next: unknown[]) => statement(sql, next),
      first: async () => sql.startsWith("SELECT json, version, updated_at FROM state") ? stateRow : null,
      all: async () => ({ results: [...history.values()] }),
      run: async () => {
        if (sql.startsWith("UPDATE state SET json")) {
          stateRow = {
            json: String(values[0]),
            version: stateRow.version + 1,
            updated_at: String(values[1]),
          };
        }
        return { success: true, meta: { rows_written: 1 } };
      },
    });
    const DB = {
      prepare: (sql: string) => statement(sql),
      batch: async (statements: Array<{ sql: string; values: unknown[] }>) => {
        for (const item of statements) {
          if (item.sql.startsWith("DELETE FROM history")) {
            history.delete(`${item.values[1]}:${item.values[2]}`);
          }
        }
        return statements.map(() => ({ success: true, meta: { rows_written: 1 } }));
      },
    };
    const store = new FdeDataStore("customer:live", { DB, REPORTS: {} } as never);

    const updated = await store.updateState((draft) => {
      draft.visitorExperienceVisible = true;
    });

    expect(updated.pages[0].history).toEqual(expected);
    const persisted = JSON.parse(stateRow.json) as typeof legacy;
    expect(persisted.historyStorageVersion).toBe(1);
    expect(persisted.pages[0].history).toEqual([]);
    expect(history.has(`${legacy.pages[0].id}:99`)).toBe(false);
    await expect(store.getState()).resolves.toMatchObject({
      historyStorageVersion: 1,
      pages: [{ history: expected }],
    });
  });
});

function historyHarness(original: AppState) {
  let stateRow = {
    json: JSON.stringify(stateWithoutEmbeddedHistory(original)),
    version: 3,
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
        return {
          results: [...new Set([...history.values()].map((row) => row.page_id))]
            .map((page_id) => ({ page_id })),
        };
      }
      if (sql.startsWith("SELECT page_id, i, night_json")) return { results: [...history.values()] };
      return { results: [] };
    },
    run: async () => {
      if (sql.startsWith("UPDATE state SET json")) {
        stateRow = {
          json: String(values[0]),
          version: stateRow.version + 1,
          updated_at: String(values[1]),
        };
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
  return { store: new FdeDataStore("customer:live", { DB, REPORTS: {} } as never), history };
}

describe("FDE history writes", () => {
  it("keeps the stored nights when a write says history did not move", async () => {
    const original = buildInitialState("demo");
    original.pages = [original.pages[0]];
    const { store, history } = historyHarness(original);
    const stored = [...history.keys()];
    const orphan = { page_id: "removed-page", i: 1, night_json: JSON.stringify(original.pages[0].history[0]) };
    history.set("removed-page:1", orphan);

    const result = await store.writeVersionedState(
      stateWithoutEmbeddedHistory(original),
      3,
      "unchanged",
    );

    expect([...history.keys()].sort()).toEqual(stored.sort());
    expect(history.has("removed-page:1")).toBe(false);
    expect(result.value?.state.pages[0].history).toEqual(original.pages[0].history);
  });

  it("applies only the nights named in a history delta", async () => {
    const original = buildInitialState("demo");
    original.pages = [original.pages[0]];
    const { store, history } = historyHarness(original);
    const page = original.pages[0];
    const removed = page.history[0];
    const added = { ...page.history.at(-1)!, i: 999, runId: "run-999" };

    const result = await store.writeVersionedState(
      stateWithoutEmbeddedHistory(original),
      3,
      { upserts: [{ pageId: page.id, night: added }], deletes: [{ pageId: page.id, i: removed.i }] },
    );

    expect(history.has(`${page.id}:${removed.i}`)).toBe(false);
    expect(history.has(`${page.id}:999`)).toBe(true);
    expect(result.value?.state.pages[0].history.some((night) => night.i === 999)).toBe(true);
  });
});
