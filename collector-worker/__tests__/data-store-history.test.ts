import { describe, expect, it } from "vitest";
import { buildInitialState } from "../../src/lib/seed";
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
