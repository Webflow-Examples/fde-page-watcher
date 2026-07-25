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
    expect(normalized.pages[0].agentIgnores).toEqual({ checks: [checkKey], groups: [] });
    expect(normalized.pages[0].agentIgnoreRestores).toEqual({ checks: [], groups: [] });
  });

  it("freezes legacy per-run checks into immutable readiness snapshots", () => {
    const legacy = buildSeedState();
    const page = legacy.pages[0];
    const checks = [
      { group: "API / Auth / MCP", name: "API Catalog", pass: true },
      { group: "API / Auth / MCP", name: "WebMCP", pass: false },
    ];
    page.history[0].agent = checks;
    page.agentIgnores = { checks: [agentCheckKey(checks[1])], groups: [] };

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
});
