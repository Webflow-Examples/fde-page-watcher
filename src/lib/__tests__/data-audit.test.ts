import { describe, expect, it } from "vitest";
import { captureAgentReadiness } from "../agentScoring";
import { buildWeeklyDataAudit } from "../dataAudit";
import type { Night } from "../types";

function raw(run: number) {
  return {
    id: `provider-run-${run}`,
    lighthouseResult: {
      lighthouseVersion: "13.4.0",
      requestedUrl: "https://customer.example/private-page",
      finalDisplayedUrl: "https://customer.example/private-page",
      runWarnings: [],
      categories: {
        performance: { score: 0.8, auditRefs: [{ id: "unused-javascript", weight: 1 }] },
        accessibility: { score: 0.9, auditRefs: [] },
        "best-practices": { score: 0.95, auditRefs: [] },
        seo: { score: 0.98, auditRefs: [] },
      },
      audits: {
        "unused-javascript": {
          title: "Reduce unused JavaScript",
          score: run < 3 ? 0.4 : 1,
          scoreDisplayMode: "metricSavings",
          details: {
            type: "opportunity",
            overallSavingsMs: 1_000 + run * 100,
            items: [{ url: "https://customer.example/private.js" }],
          },
        },
      },
    },
  };
}

function night(): Night {
  const score = (m: number) => ({ m, lo: m, hi: m });
  const agent = [
    { group: "API / Auth / MCP", name: "API Catalog", pass: true },
    { group: "API / Auth / MCP", name: "WebMCP", pass: false },
  ];
  return {
    i: 4,
    runId: "customer-visible-run-id",
    date: "Jul 23",
    iso: "2026-07-23T03:05:00.000Z",
    rawReportKey: "run-customer-visible-run-id",
    scores: {
      mobile: { perf: score(80), a11y: score(90), bp: score(95), seo: score(98) },
      desktop: { perf: score(80), a11y: score(90), bp: score(95), seo: score(98) },
    },
    samples: { mobile: 3, desktop: 3 },
    agent,
    agentReadiness: captureAgentReadiness(agent),
  };
}

function strategyReport() {
  return {
    schemaVersion: 2,
    sampleSize: 3,
    quality: { requestedRuns: 3 },
    raws: [raw(1), raw(2), raw(3)],
    findings: [{ id: "unused-javascript", promoted: true }],
  };
}

describe("weekly PSI data audit", () => {
  it("reconciles scores and finding aggregation without emitting customer identifiers or raw data", async () => {
    const audit = await buildWeeklyDataAudit({
      tenant: "customer-name:live",
      generatedAt: "2026-07-24T05:30:05.000Z",
      periodStart: "2026-07-17T05:30:00.000Z",
      periodEnd: "2026-07-24T05:30:00.000Z",
      monitoredPageIds: ["internal-page-123"],
      captures: [{
        pageId: "internal-page-123",
        night: night(),
        report: { strategies: { mobile: strategyReport(), desktop: strategyReport() } },
      }],
      jobs: [{
        id: "job-private",
        runId: "customer-visible-run-id",
        pageId: "internal-page-123",
        kind: "nightly",
        state: "succeeded",
        attempts: 1,
        createdAt: "2026-07-23T03:00:00.000Z",
        updatedAt: "2026-07-23T03:05:00.000Z",
        completedAt: "2026-07-23T03:05:00.000Z",
      }],
    });

    expect(audit.health).toBe("healthy");
    expect(audit.totals).toMatchObject({
      captures: 1,
      rawReportsFound: 1,
      strategyReports: 2,
      rawPsiRuns: 6,
      scoreCellsChecked: 8,
      scoreCellMismatches: 0,
      findingsPromoted: 2,
      findingAggregationMismatches: 0,
      agentScans: 1,
      agentReadinessSnapshots: 1,
      agentReadinessSnapshotMismatches: 0,
      jobsSucceeded: 1,
    });
    expect(audit.pages[0].pageRef).toMatch(/^[a-f0-9]{16}$/);
    const serialized = JSON.stringify(audit);
    for (const privateValue of [
      "customer-name",
      "customer.example",
      "private-page",
      "private.js",
      "internal-page-123",
      "customer-visible-run-id",
      "job-private",
    ]) {
      expect(serialized).not.toContain(privateValue);
    }
  });

  it("fails closed when a linked raw report is missing", async () => {
    const audit = await buildWeeklyDataAudit({
      tenant: "tenant:live",
      generatedAt: "2026-07-24T05:30:05.000Z",
      periodStart: "2026-07-17T05:30:00.000Z",
      periodEnd: "2026-07-24T05:30:00.000Z",
      monitoredPageIds: ["page"],
      captures: [{ pageId: "page", night: night(), report: null }],
      jobs: [],
    });

    expect(audit.health).toBe("failed");
    expect(audit.totals).toMatchObject({ missingRawReports: 1, rawReportsFound: 0 });
    expect(audit.pages[0].health).toBe("failed");
  });

  it("fails when readiness history is missing or does not reconcile with its raw checks", async () => {
    const missing = night();
    delete missing.agentReadiness;
    const mismatched = night();
    mismatched.i = 5;
    mismatched.iso = "2026-07-23T04:05:00.000Z";
    mismatched.agentReadiness = { ...mismatched.agentReadiness!, percent: 100 };

    const audit = await buildWeeklyDataAudit({
      tenant: "tenant:live",
      generatedAt: "2026-07-24T05:30:05.000Z",
      periodStart: "2026-07-17T05:30:00.000Z",
      periodEnd: "2026-07-24T05:30:00.000Z",
      monitoredPageIds: ["page"],
      captures: [
        { pageId: "page", night: missing, report: { strategies: { mobile: strategyReport(), desktop: strategyReport() } } },
        { pageId: "page", night: mismatched, report: { strategies: { mobile: strategyReport(), desktop: strategyReport() } } },
      ],
      jobs: [],
    });

    expect(audit.health).toBe("failed");
    expect(audit.totals).toMatchObject({
      agentScans: 2,
      agentReadinessSnapshots: 1,
      missingAgentReadinessSnapshots: 1,
      agentReadinessSnapshotMismatches: 1,
    });
  });
});
