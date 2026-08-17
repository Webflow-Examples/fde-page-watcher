import { describe, expect, it } from "vitest";
import { alertFieldContext, pageFieldPriority, recommendationEvidenceSignal } from "../fieldPrioritization";
import type { CruxPageEvidence, CruxSnapshot } from "../crux";
import type { Night, Rec, WatchPage } from "../types";

const score = { m: 80, lo: 78, hi: 82 };
const scores = {
  mobile: { perf: score, a11y: score, bp: score, seo: score },
  desktop: { perf: score, a11y: score, bp: score, seo: score },
};

function page(lcp = 4_500): WatchPage {
  const night: Night = {
    i: 1,
    date: "Aug 3",
    iso: "2026-08-03T12:00:00.000Z",
    scores,
    measurementContext: {
      mobile: {
        medianLargestContentfulPaint: lcp,
        medianTotalBlockingTime: 150,
        medianCumulativeLayoutShift: 0.05,
        medianServerResponseTime: 600,
      },
    },
  };
  return {
    id: "page",
    title: "Homepage",
    url: "https://example.test/page",
    flag: "priority",
    status: "stable",
    current: { mobile: { perf: 80, a11y: 80, bp: 80, seo: 80 }, desktop: { perf: 80, a11y: 80, bp: 80, seo: 80 } },
    history: [night],
    markers: [],
    agent: [],
  };
}

function rec(id = "unused-javascript"): Rec {
  return {
    key: `page:${id}`,
    pageId: "page",
    pageTitle: "Homepage",
    url: "https://example.test/page",
    id,
    title: "Reduce unused JavaScript",
    category: "Performance",
    strategies: ["mobile"],
    savings: "1.8 s",
    estTime: "2 days",
    status: "inbox",
    taskStatus: "todo",
    added: "Aug 3",
    doneDate: null,
  };
}

function snapshot(overrides: Partial<CruxSnapshot> = {}): CruxSnapshot {
  return {
    formFactor: "PHONE",
    scope: "url",
    requestedUrl: "https://example.test/page",
    effectiveUrl: "https://example.test/page",
    collectionStart: "2026-07-01",
    collectionEnd: "2026-07-28",
    fetchedAt: "2026-07-29T00:00:00.000Z",
    lcpP75Ms: 4_300,
    inpP75Ms: 180,
    clsP75: 0.05,
    ttfbP75Ms: 700,
    metrics: {},
    ...overrides,
  };
}

function evidence(value: CruxSnapshot): CruxPageEvidence[] {
  return [{ pageId: "page", formFactor: "PHONE", status: null, snapshots: [value] }];
}

describe("field evidence prioritization", () => {
  it("ranks an exact-URL visitor issue reproduced in Lighthouse highest", () => {
    const signal = recommendationEvidenceSignal(rec(), page(), evidence(snapshot()));
    expect(signal).toMatchObject({ priority: "corroborated", rank: 4, label: "Visitor corroborated", scope: "url" });
    expect(signal.metric).toMatchObject({ key: "lcp", verdict: "corroborated-issue" });
  });

  it("recognizes a visitor-only problem and keeps origin-wide data contextual", () => {
    const fieldOnly = recommendationEvidenceSignal(rec(), page(2_000), evidence(snapshot()));
    expect(fieldOnly).toMatchObject({ priority: "field-only", rank: 3, label: "Field-only signal" });

    const origin = recommendationEvidenceSignal(rec(), page(), evidence(snapshot({ scope: "origin", effectiveUrl: "https://example.test" })));
    expect(origin).toMatchObject({ priority: "origin-context", rank: 2, label: "Origin context", scope: "origin" });
  });

  it("qualifies origin-wide alert evidence and produces a stable field signature", () => {
    const context = alertFieldContext(page(), ["mobile"], evidence(snapshot({ scope: "origin", effectiveUrl: "https://example.test" })));
    expect(context.signature).toBe("corroborated:mobile Main content load:origin");
    expect(context.text).toContain("Origin-wide CrUX is contextual, not page-level proof");
    expect(pageFieldPriority(page(), "mobile", evidence(snapshot())).corroborated).toContain("Main content load");
  });

  it("does not invent a comparable field metric for an unclassified recommendation", () => {
    expect(recommendationEvidenceSignal({ ...rec("unknown-audit"), title: "Unknown audit" }, page(), evidence(snapshot()))).toMatchObject({
      priority: "unavailable",
      label: "Field evidence unavailable",
    });
  });

  it("uses the explicit metric on a synthetic field-only recommendation", () => {
    const synthetic = {
      ...rec("crux-field-only-lcp"),
      title: "Investigate visitor-only content loading",
      source: "crux-field-only" as const,
      webflow: {
        version: 1 as const,
        metric: "other" as const,
        metricWeight: 0 as const,
        culprit: "other" as const,
        culpritLabel: "Root cause unconfirmed",
        remediation: "unknown" as const,
        remediationLabel: "Investigation needed",
        guidance: "Investigate field evidence.",
        source: "crux-field-only" as const,
      },
      fieldSignals: {
        mobile: {
          metricKey: "lcp" as const,
          metricLabel: "Main content load",
          relationship: "direct" as const,
          labLabel: "Lab LCP",
          labFormatted: "2.0 s",
          fieldLabel: "Visitor LCP p75",
          fieldValue: 4_300,
          fieldFormatted: "4.3 s",
          fieldRating: "Poor" as const,
          scope: "url" as const,
          collectionStart: "2026-07-01",
          collectionEnd: "2026-07-28",
          detectedAt: "2026-08-03T13:00:00.000Z",
        },
      },
    };
    expect(recommendationEvidenceSignal(synthetic, page(2_000), evidence(snapshot()))).toMatchObject({
      priority: "field-only",
      metric: { key: "lcp", verdict: "field-only-risk" },
    });
    expect(recommendationEvidenceSignal(synthetic, page(2_000), [])).toMatchObject({
      priority: "field-only",
      label: "Field-only signal",
      scope: "url",
      collectionStart: "2026-07-01",
      collectionEnd: "2026-07-28",
    });
  });
});
