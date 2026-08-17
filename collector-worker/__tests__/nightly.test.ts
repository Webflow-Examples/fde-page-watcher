import { describe, expect, it } from "vitest";
import { dispatchFdeNightly } from "../nightly";

function environment() {
  const selectedTenants: string[] = [];
  const state = { pages: [], recs: [], jobs: [], followUps: [] };
  const DB = {
    prepare: (sql: string) => ({
      bind: (...values: unknown[]) => ({
        first: async () => {
          if (sql.startsWith("SELECT json, version, updated_at FROM state")) {
            selectedTenants.push(String(values[0]));
            return { json: JSON.stringify(state), version: 1, updated_at: "2026-08-17T00:00:00.000Z" };
          }
          return null;
        },
        all: async () => ({ results: [] }),
        run: async () => ({ success: true, meta: { rows_written: 1 } }),
      }),
    }),
    batch: async () => [],
  };
  return {
    env: {
      DB,
      REPORTS: {},
      NIGHTLY_TENANT: "default:live",
      COLLECTION_WORKFLOW: {
        create: async () => { throw new Error("no workflow expected"); },
        createBatch: async () => { throw new Error("no workflow expected"); },
      },
    },
    selectedTenants,
  };
}

describe("nightly tenant scope", () => {
  it("uses the explicit project tenant instead of the deployment default", async () => {
    const { env, selectedTenants } = environment();
    const result = await dispatchFdeNightly(env as never, { tenant: "customer:live" });

    expect(result).toMatchObject({ ok: true, tenant: "customer:live", queued: 0 });
    expect(selectedTenants.length).toBeGreaterThan(0);
    expect(selectedTenants.every((tenant) => tenant === "customer:live")).toBe(true);
  });
});
