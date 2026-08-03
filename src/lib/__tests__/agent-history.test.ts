import { describe, expect, it } from "vitest";
import { agentCheckKey, captureAgentReadiness } from "../agentScoring";
import { agentReadinessHistoryPoints } from "../agentHistory";
import type { AgentCheck, Night } from "../types";

function night(i: number, checks: AgentCheck[], ignoredCheckKeys: string[] = []): Night {
  const ignores = { checks: ignoredCheckKeys, groups: [] };
  return {
    i,
    date: `Jul ${20 + i}`,
    scores: {} as Night["scores"],
    agent: checks,
    agentReadiness: captureAgentReadiness(checks, ignores),
  };
}

describe("agent-readiness history events", () => {
  it("identifies fixes and newly ignored checks between retained runs", () => {
    const catalog = { group: "API / Auth / MCP", name: "API Catalog", pass: true };
    const webMcpFailing = { group: "API / Auth / MCP", name: "WebMCP", pass: false };
    const x402Failing = { group: "Commerce", name: "x402", pass: false };
    const first = night(0, [catalog, webMcpFailing, x402Failing]);
    const second = night(1, [catalog, { ...webMcpFailing, pass: true }, x402Failing]);
    const third = night(2, [catalog, { ...webMcpFailing, pass: true }, x402Failing], [agentCheckKey(x402Failing)]);

    const points = agentReadinessHistoryPoints([first, second, third]);

    expect(points.map((point) => point.snapshot.percent)).toEqual([33, 67, 100]);
    expect(points[1].fixedNames).toEqual(["WebMCP"]);
    expect(points[1].ignoredNames).toEqual([]);
    expect(points[2].fixedNames).toEqual([]);
    expect(points[2].ignoredNames).toEqual(["x402"]);
  });

  it("retains an agent-only event without a PSI device result", () => {
    const agentOnly = {
      ...night(0, [{ group: "Discovery", name: "llms.txt", pass: true }]),
      availableStrategies: [],
      agentCapturedAt: "2026-08-03T03:00:00.000Z",
    } satisfies Night;

    expect(agentReadinessHistoryPoints([agentOnly])).toHaveLength(1);
    expect(agentReadinessHistoryPoints([agentOnly])[0].snapshot.percent).toBe(100);
  });
});
