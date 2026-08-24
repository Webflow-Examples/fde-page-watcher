import { describe, expect, it } from "vitest";
import { agentCheckKey } from "../agentScoring";
import { pendingPage } from "../mutations";
import { DEFAULT_PERFORMANCE_THRESHOLDS } from "../performanceThresholds";
import { buildSeedState } from "../seed";
import { normalizeState } from "../store/normalize";
import type { AppState } from "../types";

describe("state normalization", () => {
  it("adds team defaults and page restore overrides to legacy state", () => {
    const page = pendingPage("page", "Page", "https://example.com", "priority");
    const checkKey = agentCheckKey({ group: "API / Auth / MCP", name: "WebMCP" });
    page.agentIgnores = { checks: [checkKey], groups: [] };
    delete page.agentIgnoreRestores;
    const legacy = { pages: [page], recs: [] } as AppState;

    const normalized = normalizeState(legacy);

    expect(normalized.agentIgnoreDefaults).toEqual({ checks: [], groups: [] });
    expect(normalized.performanceThresholds).toEqual(DEFAULT_PERFORMANCE_THRESHOLDS);
    expect(normalized.visitorExperienceVisible).toBe(false);
    // External audit consent defaults closed on legacy state: no prior project
    // is treated as having agreed to a public provider scan.
    expect(normalized.externalAgentAuditEnabled).toBe(false);
    expect(normalized.pages[0].agentIgnores).toEqual({ checks: [checkKey], groups: [] });
    expect(normalized.pages[0].agentIgnoreRestores).toEqual({ checks: [], groups: [] });
  });

  it("only accepts an explicit true as external audit consent", () => {
    for (const value of [undefined, null, false, 0, "true", 1, {}]) {
      const state = { pages: [], recs: [], externalAgentAuditEnabled: value } as unknown as AppState;
      expect(normalizeState(state).externalAgentAuditEnabled).toBe(false);
    }
    const consented = { pages: [], recs: [], externalAgentAuditEnabled: true } as AppState;
    expect(normalizeState(consented).externalAgentAuditEnabled).toBe(true);
  });

  it("freezes legacy per-run checks into immutable readiness snapshots", () => {
    const legacy = buildSeedState();
    const page = legacy.pages[0];
    const checks = [
      { group: "API / Auth / MCP", name: "API Catalog", pass: true },
      { group: "API / Auth / MCP", name: "WebMCP", pass: false },
    ];
    page.history[0].agent = checks;
    delete page.history[0].agentReadiness;
    page.agentIgnores = { checks: [agentCheckKey(checks[1])], groups: [] };
    page.agentIgnoreRestores = { checks: [], groups: [] };
    legacy.agentIgnoreDefaults = { checks: [], groups: [] };

    const normalized = normalizeState(legacy);
    expect(normalized.pages[0].history[0].agentReadiness).toMatchObject({
      pass: 1,
      fail: 0,
      total: 1,
      ignored: 1,
      percent: 100,
      ignoredCheckKeys: [agentCheckKey(checks[1])],
    });

    normalized.pages[0].agentIgnores = { checks: [], groups: [] };
    expect(normalizeState(normalized).pages[0].history[0].agentReadiness?.percent).toBe(100);
  });

  it("reconciles task markers from completed state and completed date", () => {
    const state = buildSeedState();
    const completed = state.recs.find((rec) => rec.key === "designer:uses-responsive-images")!;
    const open = state.recs.find((rec) => rec.key === "pricing:unused-javascript")!;
    const completedPage = state.pages.find((page) => page.id === completed.pageId)!;
    const openPage = state.pages.find((page) => page.id === open.pageId)!;
    completedPage.markers = [{
      id: "legacy-completed",
      i: 0,
      date: "Jul 1",
      text: `Acted: ${completed.title}`,
    }];
    openPage.markers.push({
      id: "stale-open",
      i: 0,
      date: "Jul 1",
      text: `Acted: ${open.title}`,
    });

    const normalized = normalizeState(state);
    const normalizedCompletedPage = normalized.pages.find((page) => page.id === completed.pageId)!;
    const normalizedOpenPage = normalized.pages.find((page) => page.id === open.pageId)!;
    const completedMarker = normalizedCompletedPage.markers.find((marker) => marker.recKey === completed.key);

    expect(completedMarker).toMatchObject({
      id: "legacy-completed",
      date: completed.doneDate,
      text: `Completed: ${completed.title}`,
      source: "task",
    });
    expect(normalizedOpenPage.markers.some((marker) => marker.id === "stale-open")).toBe(false);
  });

  it("strips the retired productEscalations field from legacy persisted state", () => {
    const page = pendingPage("page", "Page", "https://example.com", "priority");
    const legacy = {
      pages: [page],
      recs: [],
      productEscalations: [{ id: "product:page:unused-javascript", recKey: "page:unused-javascript", status: "draft" }],
    } as unknown as AppState;

    const normalized = normalizeState(legacy);

    // Deliberately absent from AppState; normalizeState strips any legacy value.
    expect((normalized as unknown as Record<string, unknown>).productEscalations).toBeUndefined();
    expect("productEscalations" in normalized).toBe(false);
  });
});
