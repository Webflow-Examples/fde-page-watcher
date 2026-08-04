import { describe, expect, it } from "vitest";
import { buildProductEscalation, escalationMarkdown, recommendationNeedsEscalation } from "../escalations";
import type { CruxPageEvidence } from "../crux";
import type { AppState, Rec, WatchPage } from "../types";

const score = { m: 72, lo: 69, hi: 75 };
const scores = {
  mobile: { perf: score, a11y: score, bp: score, seo: score },
  desktop: { perf: { m: 91, lo: 89, hi: 93 }, a11y: score, bp: score, seo: score },
};

function recommendation(id = "unused-javascript"): Rec {
  return {
    key: `page:${id}`,
    pageId: "page",
    pageTitle: "Homepage",
    url: "https://example.test",
    id,
    title: id === "unused-javascript" ? "Reduce unused JavaScript" : "Properly size images",
    category: "Performance",
    strategies: ["mobile"],
    savings: "1.8 s",
    estTime: "Product gap",
    status: "inbox",
    taskStatus: "todo",
    added: "Aug 3",
    doneDate: null,
  };
}

function state(rec = recommendation()): AppState {
  const page = {
    id: "page",
    title: "Homepage",
    url: "https://example.test",
    history: [{
      i: 0,
      date: "Aug 3",
      iso: "2026-08-03T12:00:00.000Z",
      scores,
      measurementContext: { mobile: { medianTotalBlockingTime: 540, medianLargestContentfulPaint: 3_400 } },
      diagnostics: { mobile: [{
        id: "unused-javascript",
        title: "Reduce unused JavaScript",
        category: "Performance",
        savingsMs: 1_800,
        savingsBytes: 286_000,
        actionable: true,
        observedRuns: 5,
        totalObservedRuns: 5,
        eligibleRuns: 5,
        successfulRuns: 5,
        quorum: 3,
        frequency: 1,
        promoted: true,
        confidence: "high" as const,
        savingsLowMs: 1_700,
        savingsHighMs: 1_900,
        savingsLowBytes: 280_000,
        savingsHighBytes: 290_000,
      }] },
      culpritEvidence: { mobile: [{
        auditId: "unused-javascript",
        title: "Unused JavaScript",
        facts: [{ key: "wastedBytes", label: "Potential savings", value: 286_000, unit: "bytes" as const }],
        sources: [{ host: "cdn.prod.website-files.com", transferBytes: 520_000 }],
        sampleRuns: 5,
      }] },
    }],
    current: { mobile: { perf: 72, a11y: 72, bp: 72, seo: 72 }, desktop: { perf: 91, a11y: 72, bp: 72, seo: 72 } },
    markers: [],
    agent: [],
    flag: "priority",
    status: "stable",
  } as WatchPage;
  return { pages: [page], recs: [rec], jobs: [], followUps: [], productEscalations: [] };
}

describe("product escalation evidence", () => {
  it("freezes classification, lab measurements, lifecycle, and culprit details into an export packet", () => {
    const rec = recommendation();
    const escalation = buildProductEscalation(state(rec), rec, new Date("2026-08-03T13:00:00.000Z"));
    expect(escalation).toMatchObject({
      id: "product:page:unused-javascript",
      status: "draft",
      evidence: {
        classification: { culprit: "global-javascript", remediation: "blocked", metric: "LCP" },
        strategies: [{
          strategy: "mobile",
          performanceScore: 72,
          metricValue: 3_400,
          diagnostic: { observedRuns: 5, eligibleRuns: 5, confidence: "high" },
          lifecycle: { status: "active" },
          culpritEvidence: [expect.objectContaining({ auditId: "unused-javascript" })],
        }],
      },
    });
    escalation.owner = "Performance Platform";
    escalation.notes = "Global bundle cannot be scoped to this page.";
    const markdown = escalationMarkdown(escalation);
    expect(markdown).toContain("# Product escalation: Reduce unused JavaScript");
    expect(markdown).toContain("Owner: Performance Platform");
    expect(markdown).toContain("Potential savings: 279 KB");
    expect(markdown).toContain("cdn.prod.website-files.com");
  });

  it("only routes blocked and partially remediable recommendations into escalation", () => {
    expect(recommendationNeedsEscalation(recommendation())).toBe(true);
    const fixable = recommendation("uses-responsive-images");
    expect(recommendationNeedsEscalation(fixable)).toBe(false);
    expect(() => buildProductEscalation(state(fixable), fixable)).toThrow("fixable without a product escalation");
  });

  it("freezes exact-URL visitor corroboration into the escalation packet and export", () => {
    const rec = recommendation();
    const visitorEvidence: CruxPageEvidence[] = [{
      pageId: "page",
      formFactor: "PHONE",
      status: null,
      snapshots: [{
        formFactor: "PHONE",
        scope: "url",
        requestedUrl: "https://example.test",
        effectiveUrl: "https://example.test",
        collectionStart: "2026-07-01",
        collectionEnd: "2026-07-28",
        fetchedAt: "2026-07-29T00:00:00.000Z",
        lcpP75Ms: 4_500,
        inpP75Ms: 180,
        clsP75: 0.05,
        ttfbP75Ms: 700,
        metrics: {},
      }],
    }];
    const escalation = buildProductEscalation(state(rec), rec, new Date("2026-08-03T13:00:00.000Z"), visitorEvidence);
    expect(escalation.evidence.strategies[0].fieldEvidence).toMatchObject({
      verdict: "corroborated-issue",
      metricLabel: "Visitor LCP p75",
      value: "4.5 s",
      scope: "url",
    });
    const markdown = escalationMarkdown(escalation);
    expect(markdown).toContain("Lab/field verdict: Issue corroborated");
    expect(markdown).toContain("Visitor LCP p75: 4.5 s · Poor");
    expect(markdown).toContain("CrUX evidence: exact URL; 2026-07-01 to 2026-07-28");
  });
});
