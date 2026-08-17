import { describe, expect, it, vi } from "vitest";
import type { AppState } from "../../src/lib/types";
import { activeProjectTenantsFromState, runTenantTasks } from "../tenants";

function registry(managedProjects: AppState["managedProjects"]): AppState {
  return { pages: [], recs: [], jobs: [], followUps: [], managedProjects };
}

describe("multi-tenant background execution", () => {
  it("includes the configured project and every active managed project exactly once", () => {
    const createdAt = "2026-08-17T00:00:00.000Z";
    expect(activeProjectTenantsFromState("brand-studio:live", registry([
      { id: "brand-studio", name: "Brand Studio", tenant: "brand-studio:live", createdAt },
      { id: "project-one", name: "Claude", tenant: "project-one:live", createdAt },
      { id: "project-two", name: "Tech Companies", tenant: "project-two:live", createdAt },
    ]))).toEqual([
      "brand-studio:live",
      "project-one:live",
      "project-two:live",
    ]);
  });

  it("excludes archived and malformed registry records, including an archived default project", () => {
    const createdAt = "2026-08-17T00:00:00.000Z";
    expect(activeProjectTenantsFromState("brand-studio:live", registry([
      { id: "brand-studio", name: "Brand Studio", tenant: "brand-studio:live", createdAt, archivedAt: createdAt },
      { id: "active", name: "Active", tenant: "active:live", createdAt },
      { id: "archived", name: "Archived", tenant: "archived:live", createdAt, archivedAt: createdAt },
      { id: "unsafe", name: "Unsafe", tenant: "../../unsafe", createdAt },
    ]))).toEqual(["active:live"]);
  });

  it("continues other projects when one tenant task fails", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const visited: string[] = [];
    const results = await runTenantTasks(["one:live", "two:live", "three:live"], async (tenant) => {
      visited.push(tenant);
      if (tenant === "two:live") throw new Error("provider unavailable");
      return { queued: 1 };
    });

    expect(visited).toEqual(["one:live", "two:live", "three:live"]);
    expect(results).toEqual([
      { tenant: "one:live", status: "succeeded", value: { queued: 1 } },
      { tenant: "two:live", status: "failed", error: "provider unavailable" },
      { tenant: "three:live", status: "succeeded", value: { queued: 1 } },
    ]);
    log.mockRestore();
  });
});
