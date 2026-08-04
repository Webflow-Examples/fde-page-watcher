import { describe, expect, it } from "vitest";
import { aggregateLighthouseRunEvidence, extractLighthouseRunEvidence, lighthouseScores } from "../lighthouseEvidence";
import type { LighthouseRunEvidence, LighthouseRunFinding } from "../types";

function finding(id: string, savingsMs: number): LighthouseRunFinding {
  return {
    id,
    title: id,
    category: "Performance",
    savingsMs,
    savingsBytes: 0,
    actionable: true,
  };
}

function evidence(run: number, ids: string[], warnings: string[] = []): LighthouseRunEvidence {
  return { run, warnings, findings: ids.map((id) => finding(id, id === "a" ? 1_000 + run * 100 : 400)) };
}

describe("multi-run Lighthouse evidence", () => {
  it("promotes a strict majority and keeps minority findings as intermittent evidence", () => {
    const result = aggregateLighthouseRunEvidence([
      evidence(1, ["a", "b"]),
      evidence(2, ["a"]),
      evidence(3, []),
    ], 3);

    expect(result.findings.find((item) => item.id === "a")).toMatchObject({
      observedRuns: 2,
      eligibleRuns: 3,
      quorum: 2,
      promoted: true,
      confidence: "medium",
      savingsMs: 1_150,
      savingsLowMs: 1_100,
      savingsHighMs: 1_200,
    });
    expect(result.findings.find((item) => item.id === "b")).toMatchObject({
      observedRuns: 1,
      promoted: false,
      confidence: "intermittent",
    });
    expect(result.opportunities.map((item) => item.id)).toEqual(["a"]);
  });

  it("requires 3-of-4 and labels repeatable 4-of-5 evidence high confidence", () => {
    const fourRuns = aggregateLighthouseRunEvidence([
      evidence(1, ["a"]),
      evidence(2, ["a"]),
      evidence(3, []),
      evidence(4, []),
    ], 4);
    expect(fourRuns.findings[0]).toMatchObject({ quorum: 3, promoted: false, confidence: "intermittent" });

    const fiveRuns = aggregateLighthouseRunEvidence([
      evidence(1, ["a"]),
      evidence(2, ["a"]),
      evidence(3, ["a"]),
      evidence(4, ["a"]),
      evidence(5, []),
    ], 5);
    expect(fiveRuns.findings[0]).toMatchObject({
      observedRuns: 4,
      eligibleRuns: 5,
      promoted: true,
      confidence: "high",
    });
  });

  it("retains warned-run findings but excludes those runs from scoring and recommendation quorum", () => {
    const result = aggregateLighthouseRunEvidence([
      evidence(1, ["a"], ["Page loaded too slowly"]),
      evidence(2, ["a"], ["Page loaded too slowly"]),
      evidence(3, ["a"]),
      evidence(4, ["a"]),
      evidence(5, ["a"], ["Page loaded too slowly"]),
    ], 5);

    expect(result.quality).toMatchObject({
      successfulRuns: 5,
      eligibleRuns: 2,
      warnedRuns: 3,
      status: "low-confidence",
    });
    expect(result.findings[0]).toMatchObject({
      observedRuns: 2,
      totalObservedRuns: 5,
      promoted: false,
      confidence: "insufficient",
    });
  });

  it("normalizes run warnings and failing audits without copying item-level resources", () => {
    const raw = {
      lighthouseResult: {
        runWarnings: [" Page loaded too slowly "],
        categories: {
          performance: {
            score: 0.72,
            auditRefs: [{ id: "unused-javascript", weight: 1 }],
          },
          accessibility: { score: 0.9, auditRefs: [] },
          "best-practices": { score: 0.95, auditRefs: [] },
          seo: { score: 1, auditRefs: [] },
        },
        audits: {
          "unused-javascript": {
            title: "Reduce unused JavaScript",
            description: "Remove code that is not used.",
            score: 0.3,
            scoreDisplayMode: "metricSavings",
            details: {
              type: "opportunity",
              overallSavingsMs: 1_234.4,
              items: [{ url: "https://customer.example/private.js" }],
            },
          },
        },
      },
    };

    expect(lighthouseScores(raw)).toEqual({ perf: 72, a11y: 90, bp: 95, seo: 100 });
    const normalized = extractLighthouseRunEvidence(raw, 2);
    expect(normalized).toMatchObject({
      run: 2,
      warnings: ["Page loaded too slowly"],
      findings: [{
        id: "unused-javascript",
        title: "Reduce unused JavaScript",
        description: "Remove code that is not used.",
        category: "Performance",
        score: 0.3,
        scoreDisplayMode: "metricSavings",
        savingsMs: 1_234,
        savingsBytes: 0,
        actionable: true,
        webflow: {
          metric: "LCP",
          culprit: "global-javascript",
          remediation: "blocked",
        },
      }],
    });
    expect(JSON.stringify(normalized)).not.toContain("customer.example");
  });
});
