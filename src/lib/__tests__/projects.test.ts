import { describe, expect, it } from "vitest";
import { buildInitialState } from "../seed";
import { parseProjectConfiguration, pauseProjectForArchive } from "../projects";

describe("project configuration", () => {
  it("parses an ordered project allowlist", () => {
    expect(parseProjectConfiguration(JSON.stringify([
      { id: "brand-studio", name: "Brand Studio", customer: "Acme Inc.", tenant: "brand-studio:live" },
      { id: "marketing", name: "Marketing", tenant: "marketing:live" },
    ]))).toEqual([
      { id: "brand-studio", name: "Brand Studio", customer: "Acme Inc.", tenant: "brand-studio:live" },
      { id: "marketing", name: "Marketing", tenant: "marketing:live" },
    ]);
  });

  it("rejects customer names over 120 characters", () => {
    expect(() => parseProjectConfiguration(JSON.stringify([
      { id: "brand-studio", name: "Brand Studio", customer: "x".repeat(121), tenant: "brand-studio:live" },
    ]))).toThrow("customer is invalid");
  });

  it("rejects duplicate public ids", () => {
    expect(() => parseProjectConfiguration(JSON.stringify([
      { id: "same", name: "One", tenant: "one" },
      { id: "same", name: "Two", tenant: "two" },
    ]))).toThrow("duplicate id same");
  });

  it("rejects unsafe tenant identifiers", () => {
    expect(() => parseProjectConfiguration(JSON.stringify([
      { id: "unsafe", name: "Unsafe", tenant: "../../other" },
    ]))).toThrow("tenant is invalid");
  });
});

describe("project archiving", () => {
  it("pauses pages and active jobs without removing historical data", () => {
    const state = buildInitialState("demo");
    const page = state.pages[0];
    const history = structuredClone(page.history);
    const archivedAt = "2026-08-11T12:00:00.000Z";
    state.jobs = [{
      id: "job-active",
      runId: "job-active",
      pageId: page.id,
      kind: "nightly",
      state: "running",
      attempts: 1,
      createdAt: archivedAt,
      updatedAt: archivedAt,
    }, {
      id: "job-complete",
      runId: "job-complete",
      pageId: page.id,
      kind: "nightly",
      state: "succeeded",
      attempts: 1,
      createdAt: archivedAt,
      updatedAt: archivedAt,
    }];
    page.runId = "job-active";
    page.runState = "running";

    pauseProjectForArchive(state, archivedAt);

    expect(state.projectArchivedAt).toBe(archivedAt);
    expect(state.pages.every((candidate) => candidate.flag === "paused")).toBe(true);
    expect(page.history).toEqual(history);
    expect(page.runState).toBeUndefined();
    expect(page.runId).toBeUndefined();
    expect(state.jobs[0]).toMatchObject({ state: "failed", error: "Project archived", completedAt: archivedAt });
    expect(state.jobs[1].state).toBe("succeeded");
  });
});
