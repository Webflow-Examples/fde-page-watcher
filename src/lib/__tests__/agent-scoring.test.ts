import { describe, expect, it } from "vitest";
import { agentCheckKey, summarizeAgentChecks, updateAgentIgnoreSettings } from "../agentScoring";
import type { AgentCheck } from "../types";

const checks: AgentCheck[] = [
  { group: "Discoverability", name: "robots.txt", pass: true },
  { group: "API / Auth / MCP", name: "API Catalog", pass: true },
  { group: "API / Auth / MCP", name: "WebMCP", pass: false },
  { group: "Commerce", name: "x402", pass: false, unavailable: true },
];

describe("agent-readiness applicability scoring", () => {
  it("excludes unavailable checks from the score", () => {
    expect(summarizeAgentChecks(checks)).toEqual({
      pass: 2,
      fail: 1,
      total: 3,
      unavailable: 1,
      ignored: 0,
      percent: 67,
    });
  });

  it("excludes an ignored check from failures and the denominator", () => {
    const settings = updateAgentIgnoreSettings(undefined, "check", agentCheckKey(checks[2]), true);
    expect(summarizeAgentChecks(checks, settings)).toMatchObject({
      pass: 2,
      fail: 0,
      total: 2,
      unavailable: 1,
      ignored: 1,
      percent: 100,
    });
  });

  it("reports 18 of 19 when one passing check is ignored and one failure remains", () => {
    const pageChecks: AgentCheck[] = [
      ...Array.from({ length: 19 }, (_, index) => ({
        group: "Passing",
        name: `Passing check ${index + 1}`,
        pass: true,
      })),
      { group: "Failing", name: "Failing check", pass: false },
    ];
    const settings = updateAgentIgnoreSettings(undefined, "check", agentCheckKey(pageChecks[0]), true);

    expect(summarizeAgentChecks(pageChecks, settings)).toEqual({
      pass: 18,
      fail: 1,
      total: 19,
      unavailable: 0,
      ignored: 1,
      percent: 95,
    });
  });

  it("ignores a whole category and restores it without affecting other categories", () => {
    const ignored = updateAgentIgnoreSettings(undefined, "group", "API / Auth / MCP", true);
    expect(summarizeAgentChecks(checks, ignored)).toMatchObject({
      pass: 1,
      fail: 0,
      total: 1,
      unavailable: 1,
      ignored: 2,
      percent: 100,
    });

    const restored = updateAgentIgnoreSettings(ignored, "group", "API / Auth / MCP", false);
    expect(summarizeAgentChecks(checks, restored)).toEqual(summarizeAgentChecks(checks));
  });
});
