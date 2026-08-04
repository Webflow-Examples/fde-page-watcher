import { describe, expect, it } from "vitest";
import { mergeStrategyOpportunities, opportunitiesForNight, promotedDiagnostics } from "../diagnostics";
import type { AggregatedLighthouseFinding, Night } from "../types";

const opportunity = (id: string, savingsMs: number) => ({
  id,
  title: id,
  category: "Performance",
  savingsMs,
});

describe("device-specific diagnostics", () => {
  it("keeps device attribution while merging duplicate recommendation work", () => {
    expect(mergeStrategyOpportunities({
      mobile: [opportunity("unused-javascript", 1_500)],
      desktop: [opportunity("unused-javascript", 700), opportunity("render-blocking", 400)],
    })).toEqual([
      expect.objectContaining({ id: "unused-javascript", savingsMs: 1_500, strategies: ["mobile", "desktop"] }),
      expect.objectContaining({ id: "render-blocking", strategies: ["desktop"] }),
    ]);
  });

  it("falls back to legacy opportunities for mobile only", () => {
    const night = { opportunities: [opportunity("legacy", 300)] } as Night;
    expect(opportunitiesForNight(night, "mobile")).toHaveLength(1);
    expect(opportunitiesForNight(night, "desktop")).toEqual([]);
  });

  it("retains promoted binary diagnostics even without estimated savings", () => {
    const finding = {
      id: "dom-size",
      promoted: true,
      savingsMs: 0,
      savingsBytes: 0,
    } as AggregatedLighthouseFinding;
    expect(promotedDiagnostics([finding])).toEqual([finding]);
  });

  it("makes repeatable zero-savings diagnostics triageable recommendations", () => {
    const finding = {
      id: "dom-size",
      title: "Avoid an excessive DOM size",
      category: "Performance",
      promoted: true,
      savingsMs: 0,
      savingsBytes: 0,
      observedRuns: 5,
      eligibleRuns: 5,
      confidence: "high",
    } as AggregatedLighthouseFinding;

    expect(mergeStrategyOpportunities({}, { mobile: [finding] })).toEqual([
      expect.objectContaining({
        id: "dom-size",
        savingsMs: 0,
        strategies: ["mobile"],
        webflow: expect.objectContaining({
          culprit: "dom-complexity",
          remediation: "partial",
        }),
      }),
    ]);
  });
});
