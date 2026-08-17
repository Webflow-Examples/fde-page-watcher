import { describe, expect, it } from "vitest";
import { runWeeklyDataAudit, tenantWeeklyAuditLatestKey } from "../weeklyAudit";

function environment() {
  const puts: string[] = [];
  const state = { pages: [], recs: [], jobs: [], followUps: [] };
  const DB = {
    prepare: (sql: string) => ({
      bind: () => ({
        first: async () => sql.startsWith("SELECT json, version, updated_at FROM state")
          ? { json: JSON.stringify(state), version: 1, updated_at: "2026-08-17T00:00:00.000Z" }
          : null,
      }),
    }),
  };
  const REPORTS = {
    put: async (key: string) => { puts.push(key); },
  };
  return { env: { DB, REPORTS, NIGHTLY_TENANT: "default:live" }, puts };
}

describe("weekly audit tenant scope", () => {
  it("stores dated and latest reports below the explicit tenant prefix", async () => {
    const { env, puts } = environment();
    const audit = await runWeeklyDataAudit(
      env as never,
      new Date("2026-08-17T05:30:00.000Z"),
      { tenant: "customer:live" },
    );

    expect(audit.tenantRef).toBeTruthy();
    expect(puts).toContain("customer:live/audits/weekly/2026-08-17.json");
    expect(puts).toContain(tenantWeeklyAuditLatestKey("customer:live"));
    expect(puts.every((key) => key.startsWith("customer:live/"))).toBe(true);
  });
});
