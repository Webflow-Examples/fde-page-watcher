import { afterEach, describe, expect, it, vi } from "vitest";
import { collectPsi, runPsiOnce } from "../psiCore";

function psiResponse(warnings: string[] = [], perf = 0.8) {
  return {
    lighthouseResult: {
      runWarnings: warnings,
      categories: {
        performance: { score: perf, auditRefs: [{ id: "unused-javascript", weight: 1 }] },
        accessibility: { score: 0.9, auditRefs: [] },
        "best-practices": { score: 0.95, auditRefs: [] },
        seo: { score: 0.98, auditRefs: [] },
      },
      audits: {
        "unused-javascript": {
          title: "Reduce unused JavaScript",
          score: 0.3,
          scoreDisplayMode: "metricSavings",
          details: { type: "opportunity", overallSavingsMs: 1_200 },
        },
      },
    },
  };
}

afterEach(() => vi.unstubAllGlobals());

describe("PSI collection quality", () => {
  it("rejects missing category scores instead of converting them to zero", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({
      lighthouseResult: {
        categories: {
          performance: { score: null },
          accessibility: { score: 0.9 },
          "best-practices": { score: 0.95 },
          seo: { score: 0.98 },
        },
      },
    })));

    await expect(runPsiOnce("https://example.com", "mobile")).rejects.toThrow(
      "missing one or more requested Lighthouse category scores",
    );
  });

  it("stages warned runs but excludes them from the trusted median and quorum", async () => {
    const responses = [
      psiResponse([], 0.7),
      psiResponse(["Page loaded too slowly"], 0.1),
      psiResponse([], 0.9),
    ];
    let index = 0;
    vi.stubGlobal("fetch", vi.fn(async () => Response.json(responses[index++])));

    const result = await collectPsi("https://example.com", "mobile", { runs: 3 });

    expect(result.scores.perf).toEqual({ m: 80, lo: 70, hi: 90 });
    expect(result.sampleSize).toBe(2);
    expect(result.raws).toHaveLength(3);
    expect(result.runEvidence[1].warnings).toEqual(["Page loaded too slowly"]);
    expect(result.quality).toMatchObject({
      successfulRuns: 3,
      eligibleRuns: 2,
      warnedRuns: 1,
      status: "low-confidence",
    });
    expect(result.opportunities).toEqual([]);
    expect(result.findings[0]).toMatchObject({
      totalObservedRuns: 3,
      observedRuns: 2,
      promoted: false,
      confidence: "insufficient",
    });
  });
});
