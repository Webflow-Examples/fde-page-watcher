import { describe, expect, it } from "vitest";
import type { CruxPageEvidence, CruxSnapshot } from "../crux";
import {
  evidenceForPage,
  formatVisitorMetricDelta,
  formatVisitorMetric,
  metricRating,
  visitorSnapshotForNight,
  visitorConfidenceLabel,
  visitorExperienceTrend,
  VISITOR_CONFIDENCE_LABEL,
} from "../visitorExperience";

function snapshot(overrides: Partial<CruxSnapshot> = {}): CruxSnapshot {
  return {
    formFactor: "DESKTOP",
    scope: "url",
    requestedUrl: "https://example.com/page",
    effectiveUrl: "https://example.com/page",
    collectionStart: "2026-06-01",
    collectionEnd: "2026-06-28",
    fetchedAt: "2026-06-29T00:00:00.000Z",
    lcpP75Ms: 2_000,
    inpP75Ms: 150,
    clsP75: 0.08,
    ttfbP75Ms: 600,
    metrics: {},
    ...overrides,
  };
}

function evidence(snapshots: CruxSnapshot[], formFactor: "PHONE" | "DESKTOP" = "DESKTOP"): CruxPageEvidence {
  return { pageId: "page-1", formFactor, status: null, snapshots };
}

describe("visitor experience presentation", () => {
  it("selects evidence for the requested page and device", () => {
    const desktop = evidence([snapshot()]);
    const phone = evidence([snapshot({ formFactor: "PHONE" })], "PHONE");
    expect(evidenceForPage([desktop, phone], "page-1", "desktop")).toBe(desktop);
    expect(evidenceForPage([desktop, phone], "page-1", "mobile")).toBe(phone);
  });

  it("requires two usable snapshots before claiming a direction", () => {
    expect(visitorExperienceTrend(evidence([snapshot()]))).toBe("insufficient");
  });

  it("classifies meaningful worsening and improvement", () => {
    const baseline = snapshot();
    const worse = snapshot({
      collectionEnd: "2026-07-05",
      lcpP75Ms: 3_000,
      inpP75Ms: 260,
      clsP75: 0.16,
      ttfbP75Ms: 1_100,
    });
    expect(visitorExperienceTrend(evidence([baseline, worse]))).toBe("worsening");
    expect(visitorExperienceTrend(evidence([worse, baseline]))).toBe("improving");
  });

  it("uses plain metric formatting and confidence labels", () => {
    expect(metricRating("lcpP75Ms", 2_500)).toBe("Good");
    expect(metricRating("inpP75Ms", 350)).toBe("Needs improvement");
    expect(formatVisitorMetric("lcpP75Ms", 2_450)).toBe("2.5 s");
    expect(formatVisitorMetric("clsP75", 0.081)).toBe("0.08");
    // Asserts which conclusion each pair of trends resolves to, from the one
    // place those conclusions are written (rule 21).
    expect(visitorConfidenceLabel("regressing", "stable")).toBe(VISITOR_CONFIDENCE_LABEL.worse_test_only);
    expect(visitorConfidenceLabel("regressing", "worsening")).toBe(VISITOR_CONFIDENCE_LABEL.worse_both);
  });

  it("matches nightly rows to the latest eligible weekly CrUX window", () => {
    const first = snapshot({ collectionEnd: "2026-07-18" });
    const latest = snapshot({ collectionEnd: "2026-07-25" });
    const snapshots = [first, latest];
    expect(visitorSnapshotForNight(snapshots, {
      date: "Jul 24",
      iso: "2026-07-25T02:00:00.000Z",
    })).toBe(first);
    expect(visitorSnapshotForNight(snapshots, {
      date: "Jul 25",
      iso: "2026-07-26T02:00:00.000Z",
    })).toBe(latest);
  });

  it("formats metric movement separately from the quality rating", () => {
    expect(formatVisitorMetricDelta("ttfbP75Ms", 1_700, 1_522)).toBe("↓ 178 ms");
    expect(formatVisitorMetricDelta("lcpP75Ms", 2_000, 2_500)).toBe("↑ 0.5 s");
    expect(formatVisitorMetricDelta("clsP75", 0.08, 0.08)).toBe("No change");
  });
});
