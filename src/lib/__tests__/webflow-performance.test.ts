import { describe, expect, it } from "vitest";
import {
  classifyWebflowPerformance,
  culpritGroupLabel,
  effortLabel,
  formatDiagnosticImpact,
  triageActionLabel,
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
    expect(effortLabel({ id: "unused-css-rules", estTime: "2 days" })).toBe("Product gap");
    expect(triageActionLabel({ id: "unused-css-rules" })).toBe("Create escalation");
    expect(triageActionLabel({ id: "dom-size" })).toBe("Escalate workaround");
    expect(triageActionLabel({ id: "uses-responsive-images" })).toBe("Save fix as task");
  });
});
