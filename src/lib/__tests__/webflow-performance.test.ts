import { describe, expect, it } from "vitest";
import {
  classifyWebflowPerformance,
  classificationForPage,
  culpritGroupLabel,
  effortLabel,
  formatDiagnosticImpact,
  isDocumentedWebflowAudit,
  recommendationIsCustomerActionable,
} from "../webflowPerformance";

describe("Webflow performance taxonomy", () => {
  it.each([
    ["bootup-time", "TBT", "global-javascript", "blocked"],
    ["mainthread-work-breakdown", "TBT", "main-thread-work", "blocked"],
    ["third-party-summary", "TBT", "third-party-code", "partial"],
    ["dom-size", "TBT", "dom-complexity", "partial"],
    ["largest-contentful-paint-element", "LCP", "lcp-element", "partial"],
    ["unused-css-rules", "LCP", "global-css", "blocked"],
    ["uses-responsive-images", "LCP", "image-delivery", "available"],
    ["render-blocking-resources", "LCP", "render-blocking", "blocked"],
    ["unminified-javascript", "LCP", "custom-javascript", "partial"],
    ["legacy-javascript", "LCP", "global-javascript", "blocked"],
    ["unused-javascript", "LCP", "global-javascript", "blocked"],
    ["unsized-images", "CLS", "layout-stability", "available"],
  ] as const)("classifies %s from the document's remediation table", (id, metric, culprit, remediation) => {
    expect(classifyWebflowPerformance(id)).toMatchObject({ metric, culprit, remediation });
  });

  it("keeps unmapped Lighthouse audits explicitly unassigned", () => {
    expect(classifyWebflowPerformance("new-lighthouse-insight")).toMatchObject({
      metric: "other",
      metricWeight: 0,
      culprit: "other",
      remediation: "unknown",
      remediationLabel: "Needs review",
    });
  });

  it("classifies legacy recommendations through exact title aliases", () => {
    expect(classifyWebflowPerformance("r1", "Reduce unused JavaScript")).toMatchObject({
      culprit: "global-javascript",
      remediation: "blocked",
    });
    expect(classifyWebflowPerformance("r4", "Properly size images")).toMatchObject({
      culprit: "image-delivery",
      remediation: "available",
    });
    expect(culpritGroupLabel({ id: "r4", title: "Properly size images" })).toBe("Image delivery");
  });

  it("uses remediation-aware impact, effort, and triage labels", () => {
    expect(formatDiagnosticImpact({ savingsMs: 0, savingsBytes: 0 })).toBe("Detected");
    expect(formatDiagnosticImpact({ savingsMs: 0, savingsBytes: 65_536 })).toBe("64 KB");
    expect(effortLabel({ id: "unused-css-rules", estTime: "2 days" })).toBe("2 days");
  });

  it("keeps platform ownership separate from neutral customer guidance", () => {
    expect(classificationForPage({ id: "render-blocking-resources" }, true)).toMatchObject({
      actionability: "none",
      remediationLabel: "No direct action",
    });
    expect(classificationForPage({ id: "render-blocking-resources" }, false)).toMatchObject({
      actionability: "workaround",
    });
    expect(classifyWebflowPerformance("unused-javascript").guidance).not.toMatch(/Webflow|product|escalat/i);
  });

  it("flags audit IDs (and their exact title aliases) that are documented in the remediation table", () => {
    expect(isDocumentedWebflowAudit("dom-size")).toBe(true);
    expect(isDocumentedWebflowAudit("r1", "Reduce unused JavaScript")).toBe(true);
    expect(isDocumentedWebflowAudit("brand-new-lighthouse-audit")).toBe(false);
    expect(isDocumentedWebflowAudit("brand-new-lighthouse-audit", "Some new insight")).toBe(false);
  });

  it("keeps unmapped findings actionable (visible) so they don't silently disappear, unlike confirmed platform-only gaps", () => {
    expect(recommendationIsCustomerActionable({ id: "brand-new-lighthouse-audit" })).toBe(true);
    expect(recommendationIsCustomerActionable({ id: "unused-css-rules" })).toBe(true);
    expect(recommendationIsCustomerActionable({
      id: "render-blocking-resources",
      webflow: classificationForPage({ id: "render-blocking-resources" }, true),
    })).toBe(false);
  });

  it("defaults main-thread work to review even without a confirmed platform signal, unlike other blocked entries", () => {
    expect(classifyWebflowPerformance("mainthread-work-breakdown")).toMatchObject({ actionability: "review" });
    expect(classifyWebflowPerformance("render-blocking-resources")).toMatchObject({ actionability: "workaround" });
    expect(effortLabel({ id: "mainthread-work-breakdown", estTime: "2 days" })).toBe("Needs review");
  });
});
