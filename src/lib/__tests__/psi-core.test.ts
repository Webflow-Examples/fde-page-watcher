import { afterEach, describe, expect, it, vi } from "vitest";
import { collectPsi, PsiRequestError, runPsiOnce, summarizePsiMeasurements } from "../psiCore";

function psiResponse(warnings: string[] = [], perf = 0.8, fetchTime?: string) {
  return {
    lighthouseResult: {
      fetchTime,
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
  it("summarizes all five scored lab sub-metrics across runs", () => {
    const raw = (offset: number) => ({
      lighthouseResult: {
        lighthouseVersion: "13.0.0",
        audits: {
          "first-contentful-paint": { numericValue: 1_000 + offset },
          "speed-index": { numericValue: 2_000 + offset },
          "largest-contentful-paint": { numericValue: 2_500 + offset },
          "total-blocking-time": { numericValue: 200 + offset },
          "cumulative-layout-shift": { numericValue: 0.1 + offset / 10_000 },
        },
      },
    });
    expect(summarizePsiMeasurements([raw(0), raw(200), raw(100)])).toMatchObject({
      lighthouseVersion: "13.0.0",
      medianFirstContentfulPaint: 1_100,
      medianSpeedIndex: 2_100,
      medianLargestContentfulPaint: 2_600,
      medianTotalBlockingTime: 300,
      medianCumulativeLayoutShift: 0.11,
    });
  });

  it("preserves the provider status and safe quota detail", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({
      error: { code: 429, message: "Quota exceeded for this project" },
    }, { status: 429 })));

    const request = runPsiOnce("https://example.com", "mobile");
    await expect(request).rejects.toThrow("HTTP 429: Quota exceeded");
    await expect(request).rejects.toMatchObject<PsiRequestError>({ status: 429 });
  });

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

  it("retains duplicate provider responses without counting them as independent samples", async () => {
    const duplicate = psiResponse([], 0.42, "2026-07-27T03:00:00.000Z");
    vi.stubGlobal("fetch", vi.fn(async () => Response.json(duplicate)));

    const result = await collectPsi("https://example.com", "mobile", { runs: 5 });

    expect(result.raws).toHaveLength(5);
    expect(result.runEvidence).toHaveLength(1);
    expect(result.sampleSize).toBe(1);
    expect(result.quality).toMatchObject({
      attemptRuns: 5,
      successfulRuns: 1,
      uniqueRuns: 1,
      duplicateRuns: 4,
      eligibleRuns: 1,
      status: "low-confidence",
    });
  });
});
