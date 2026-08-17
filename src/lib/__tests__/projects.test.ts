import { describe, expect, it } from "vitest";
import { buildInitialState } from "../seed";
import { parseProjectConfiguration, pauseProjectForArchive, resumeProjectAfterArchive, selectAccessibleProject } from "../projects";

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

  it("rejects project aliases that share a tenant scope", () => {
    expect(() => parseProjectConfiguration(JSON.stringify([
      { id: "one", name: "One", tenant: "shared:live" },
      { id: "two", name: "Two", tenant: "shared:live" },
    ]))).toThrow("duplicate tenant shared:live");
  });

  it("rejects unsafe tenant identifiers", () => {
    expect(() => parseProjectConfiguration(JSON.stringify([
      { id: "unsafe", name: "Unsafe", tenant: "../../other" },
    ]))).toThrow("tenant is invalid");
  });

  it("selects the remembered project before the catalog default", () => {
    const projects = parseProjectConfiguration(JSON.stringify([
      { id: "brand-studio", name: "Brand Studio", tenant: "brand-studio:live" },
      { id: "major-brands", name: "Major Brands", tenant: "major-brands:live" },
    ]));

    expect(selectAccessibleProject(projects, { email: "admin@example.com", isAppAdmin: true, projectRoles: {} }, "major-brands")?.id)
      .toBe("major-brands");
  });

  it("never selects a remembered project without access", () => {
    const projects = parseProjectConfiguration(JSON.stringify([
      { id: "brand-studio", name: "Brand Studio", tenant: "brand-studio:live" },
      { id: "major-brands", name: "Major Brands", tenant: "major-brands:live" },
    ]));

    expect(selectAccessibleProject(projects, {
      email: "viewer@example.com",
      isAppAdmin: false,
      projectRoles: { "major-brands": "project_viewer" },
    }, "brand-studio")?.id).toBe("major-brands");
  });

  it("falls back safely when the remembered project was archived", () => {
    const projects = parseProjectConfiguration(JSON.stringify([
      { id: "brand-studio", name: "Brand Studio", tenant: "brand-studio:live" },
      { id: "major-brands", name: "Major Brands", tenant: "major-brands:live" },
    ]));
    projects[1].archivedAt = "2026-08-13T12:00:00.000Z";

    expect(selectAccessibleProject(projects, { email: "admin@example.com", isAppAdmin: true, projectRoles: {} }, "major-brands")?.id)
      .toBe("brand-studio");
  });
});

describe("project archiving", () => {
  it("pauses pages and active jobs without removing historical data", () => {
    const state = buildInitialState("demo");
    const page = state.pages[0];
    const flag = page.flag;
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
    expect(state.projectArchivePageFlags?.[page.id]).toBe(flag);
    expect(state.pages.every((candidate) => candidate.flag === "paused")).toBe(true);
    expect(page.history).toEqual(history);
    expect(page.runState).toBeUndefined();
    expect(page.runId).toBeUndefined();
    expect(state.jobs[0]).toMatchObject({ state: "failed", error: "Project archived", completedAt: archivedAt });
    expect(state.jobs[1].state).toBe("succeeded");
  });

  it("restores every page flag and retained history after an archive round trip", () => {
    const state = buildInitialState("demo");
    state.pages[0].flag = "priority";
    state.pages[1].flag = "watching";
    state.pages[2].flag = "paused";
    const flags = Object.fromEntries(state.pages.map((page) => [page.id, page.flag]));
    const history = Object.fromEntries(state.pages.map((page) => [page.id, structuredClone(page.history)]));

    pauseProjectForArchive(state, "2026-08-11T12:00:00.000Z");
    resumeProjectAfterArchive(state);

    expect(state.projectArchivedAt).toBeUndefined();
    expect(state.projectArchivePageFlags).toBeUndefined();
    expect(Object.fromEntries(state.pages.map((page) => [page.id, page.flag]))).toEqual(flags);
    for (const page of state.pages) expect(page.history).toEqual(history[page.id]);
  });

  it("safely restores legacy archives that did not retain page flags", () => {
    const state = buildInitialState("demo");
    state.projectArchivedAt = "2026-08-11T12:00:00.000Z";
    state.pages.forEach((page) => { page.flag = "paused"; });

    resumeProjectAfterArchive(state);

    expect(state.projectArchivedAt).toBeUndefined();
    expect(state.pages.every((page) => page.flag === "paused")).toBe(true);
  });
});
