import { describe, expect, it } from "vitest";
import { compareLabAndField } from "../labFieldComparison";
import type { CruxPageEvidence, CruxSnapshot } from "../crux";
import type { Night } from "../types";

const score = { m: 80, lo: 78, hi: 82 };
const scores = {
  mobile: { perf: score, a11y: score, bp: score, seo: score },
  desktop: { perf: score, a11y: score, bp: score, seo: score },
};

function lab(overrides: Partial<NonNullable<Night["measurementContext"]>["mobile"]> = {}, evidenceStatus?: Night["evidenceStatus"]): Night {
  return {
    i: 1,
    date: "Aug 3",
    iso: "2026-08-03T12:00:00.000Z",
    scores,
    evidenceStatus,
    measurementContext: {
      mobile: {
        medianLargestContentfulPaint: 2_000,
        medianTotalBlockingTime: 150,
        medianCumulativeLayoutShift: 0.05,
        medianServerResponseTime: 600,
        ...overrides,
      },
    },
  };
}

function snapshot(overrides: Partial<CruxSnapshot> = {}): CruxSnapshot {
  return {
    formFactor: "PHONE",
    scope: "url",
    requestedUrl: "https://example.com/page",
    effectiveUrl: "https://example.com/page",
    collectionStart: "2026-07-01",
    collectionEnd: "2026-07-28",
    fetchedAt: "2026-07-29T00:00:00.000Z",
    lcpP75Ms: 2_200,
    inpP75Ms: 180,
    clsP75: 0.08,
    ttfbP75Ms: 700,
    metrics: {},
    ...overrides,
  };
}

function evidence(value: CruxSnapshot): CruxPageEvidence {
  return { pageId: "page", formFactor: "PHONE", status: null, snapshots: [value] };
}

describe("lab and field comparison", () => {
  it("aligns direct metrics while labeling TBT versus INP as a proxy", () => {
    const result = compareLabAndField([lab()], "mobile", evidence(snapshot()));
    expect(result).toMatchObject({ status: "aligned", headline: "Lab and visitor signals align" });
    expect(result.metrics.map((metric) => [metric.key, metric.relationship, metric.verdict])).toEqual([
      ["lcp", "direct", "aligned-good"],
      ["responsiveness", "proxy", "aligned-good"],
      ["cls", "direct", "aligned-good"],
      ["ttfb", "direct", "aligned-good"],
    ]);
  });

  it("identifies visitor problems that Lighthouse does not reproduce", () => {
    const result = compareLabAndField([lab()], "mobile", evidence(snapshot({ lcpP75Ms: 4_500 })));
    expect(result).toMatchObject({ status: "divergent", headline: "Lab and visitor evidence diverge" });
    expect(result.metrics.find((metric) => metric.key === "lcp")).toMatchObject({
      verdict: "field-only-risk",
      lab: { rating: "Good" },
      field: { rating: "Poor" },
    });
  });

  it("corroborates issues present in both controlled and visitor evidence", () => {
    const result = compareLabAndField(
      [lab({ medianLargestContentfulPaint: 4_800, medianCumulativeLayoutShift: 0.3 })],
      "mobile",
      evidence(snapshot({ lcpP75Ms: 4_500, clsP75: 0.28 })),
    );
    expect(result.status).toBe("corroborated");
    expect(result.metrics.filter((metric) => metric.verdict === "corroborated-issue").map((metric) => metric.key)).toEqual(["lcp", "cls"]);
  });

  it("ignores provider-anomaly lab runs and reports partial evidence honestly", () => {
    const trusted = lab();
    const anomaly = { ...lab({ medianLargestContentfulPaint: 9_000 }, "provider-anomaly"), i: 2 };
    const result = compareLabAndField([trusted, anomaly], "mobile", evidence(snapshot({ inpP75Ms: null })));
    expect(result.labCapturedAt).toBe(trusted.iso);
    expect(result.metrics.find((metric) => metric.key === "lcp")?.lab?.formatted).toBe("2.0 s");
    expect(result.metrics.find((metric) => metric.key === "responsiveness")?.verdict).toBe("unavailable");
    expect(result.status).toBe("partial");
  });

  it("distinguishes a controlled-only problem from unavailable comparison data", () => {
    const labOnly = compareLabAndField([lab({ medianTotalBlockingTime: 800 })], "mobile", evidence(snapshot()));
    expect(labOnly.metrics.find((metric) => metric.key === "responsiveness")?.verdict).toBe("lab-only-risk");
    expect(labOnly.status).toBe("divergent");

    const unavailable = compareLabAndField([], "mobile", null);
    expect(unavailable).toMatchObject({ status: "unavailable", labCapturedAt: null, fieldWindow: null });
  });

  it("treats origin-wide CrUX as context rather than page-level proof", () => {
    const result = compareLabAndField([lab()], "mobile", evidence(snapshot({ scope: "origin", effectiveUrl: "https://example.com" })));
    expect(result).toMatchObject({ status: "partial", headline: "Origin-level visitor context only", fieldWindow: { scope: "origin" } });
    expect(result.detail).toContain("rather than proving conditions on this page");
  });
});
