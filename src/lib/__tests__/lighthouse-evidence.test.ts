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

/* ── T6 — the informative audits that were dropped ──────────────────────── */

describe("informative audits", () => {
  const thirdPartyRun = (blocking: number, bytes: number) => ({
    lighthouseResult: {
      categories: {
        performance: {
          score: 0.5,
          auditRefs: [{ id: "third-party-summary" }, { id: "resource-summary" }, { id: "lcp-lazy-loaded" }],
        },
      },
      audits: {
        "third-party-summary": {
          title: "Reduce the impact of third-party code",
          score: null,
          scoreDisplayMode: "informative",
          details: {
            type: "table",
            items: [
              { url: "https://www.googletagmanager.com/gtm.js", transferSize: Math.round(bytes * 0.6), blockingTime: Math.round(blocking * 0.7), mainThreadTime: blocking },
              { url: "https://connect.facebook.net/sdk.js", transferSize: Math.round(bytes * 0.4), blockingTime: Math.round(blocking * 0.3), mainThreadTime: blocking },
            ],
          },
        },
        "resource-summary": {
          title: "Keep request counts low and transfer sizes small",
          score: null,
          scoreDisplayMode: "informative",
          details: {
            type: "table",
            items: [
              { resourceType: "total", transferSize: 3_515_000 },
              { resourceType: "third-party", transferSize: 2_849 * 1024 },
            ],
          },
        },
        "lcp-lazy-loaded": {
          title: "The largest contentful paint image was lazily loaded",
          score: null,
          scoreDisplayMode: "informative",
          details: { type: "debugdata", items: [{ node: { nodeLabel: "Image", loading: "lazy" } }] },
        },
      },
    },
  });

  it("keeps a third-party summary with its transfer and blocking numbers", () => {
    const normalized = extractLighthouseRunEvidence(thirdPartyRun(1_200, 2_849 * 1024), 1);
    const summary = normalized.findings.find((item) => item.id === "third-party-summary");
    expect(summary).toMatchObject({
      category: "Performance",
      scoreDisplayMode: "informative",
      savingsBytes: 2_849 * 1024,
      savingsMs: 1_200,
      actionable: true,
    });
    expect(summary?.webflow?.culprit).toBe("third-party-code");
  });

  it("keeps a resource summary as evidence, never as work of its own", () => {
    const normalized = extractLighthouseRunEvidence(thirdPartyRun(1_200, 2_849 * 1024), 1);
    expect(normalized.findings.find((item) => item.id === "resource-summary")).toMatchObject({
      savingsBytes: 2_849 * 1024,
      savingsMs: 0,
      actionable: false,
    });
  });

  it("keeps the lazy-loaded image as an actionable finding", () => {
    const normalized = extractLighthouseRunEvidence(thirdPartyRun(1_200, 2_849 * 1024), 1);
    expect(normalized.findings.find((item) => item.id === "lcp-lazy-loaded")).toMatchObject({
      actionable: true,
      scoreDisplayMode: "informative",
    });
  });

  it("promotes the third-party case through the same strict-majority quorum", () => {
    const result = aggregateLighthouseRunEvidence([
      extractLighthouseRunEvidence(thirdPartyRun(1_200, 2_849 * 1024), 1),
      extractLighthouseRunEvidence(thirdPartyRun(1_100, 2_800 * 1024), 2),
      extractLighthouseRunEvidence(thirdPartyRun(1_300, 2_900 * 1024), 3),
    ], 3);
    const summary = result.findings.find((item) => item.id === "third-party-summary");
    expect(summary).toMatchObject({ promoted: true, observedRuns: 3, eligibleRuns: 3 });
    // Median of the three runs, never a sum of runs.
    expect(summary?.savingsMs).toBe(1_200);
    expect(summary?.savingsBytes).toBe(2_849 * 1024);
  });

  it("adds no finding when an informative audit found nothing", () => {
    const quiet = {
      lighthouseResult: {
        categories: { performance: { score: 0.9, auditRefs: [{ id: "third-party-summary" }, { id: "lcp-lazy-loaded" }] } },
        audits: {
          "third-party-summary": { title: "Third party", score: null, scoreDisplayMode: "informative", details: { items: [] } },
          "lcp-lazy-loaded": {
            title: "LCP image",
            score: null,
            scoreDisplayMode: "informative",
            details: { items: [{ node: { nodeLabel: "Image", loading: "eager" } }] },
          },
        },
      },
    };
    expect(extractLighthouseRunEvidence(quiet, 1).findings).toEqual([]);
  });
});
