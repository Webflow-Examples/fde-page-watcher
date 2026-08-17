import { describe, expect, it } from "vitest";
import { summarizeKnownWebflowIssues } from "../knownWebflowIssues";
import { nativeElementScan } from "../nativeElements";
import { buildInitialState } from "../seed";
import { classifyWebflowPerformance } from "../webflowPerformance";
import type { AggregatedLighthouseFinding, Night } from "../types";

const score = { m: 80, lo: 78, hi: 82 };
const scores = {
  mobile: { perf: score, a11y: score, bp: score, seo: score },
  desktop: { perf: score, a11y: score, bp: score, seo: score },
};

function finding(id: string, title: string): AggregatedLighthouseFinding {
  return {
    id,
    title,
    category: "Performance",
    savingsMs: 400,
    savingsBytes: 0,
    actionable: true,
    observedRuns: 3,
    totalObservedRuns: 3,
    eligibleRuns: 3,
    successfulRuns: 3,
    quorum: 2,
    frequency: 1,
    promoted: true,
    confidence: "high",
    savingsLowMs: 350,
    savingsHighMs: 450,
    savingsLowBytes: 0,
    savingsHighBytes: 0,
    webflow: classifyWebflowPerformance(id, title),
  };
}

describe("known Webflow issue summaries", () => {
  it("deduplicates devices, requires Webflow attribution, and annotates Optimize variance", () => {
    const state = buildInitialState("live");
    const scan = nativeElementScan(`<html data-wf-site="private" data-wf-page="private" data-wf-intellimize-customer-id="private"><body><div class="w-background-video"></div></body></html>`);
    const renderBlocking = finding("render-blocking-resources", "Eliminate render-blocking resources");
    const night: Night = {
      i: 30,
      runId: "run-30",
      date: "Aug 10",
      iso: "2026-08-10T12:00:00.000Z",
      scores,
      nativeElements: scan,
      diagnostics: { mobile: [renderBlocking], desktop: [renderBlocking] },
      culpritEvidence: {
        mobile: [{ auditId: renderBlocking.id, title: renderBlocking.title, facts: [], sources: [{ host: "cdn.prod.website-files.com" }], sampleRuns: 3 }],
        desktop: [{ auditId: renderBlocking.id, title: renderBlocking.title, facts: [], sources: [{ host: "cdn.prod.website-files.com" }], sampleRuns: 3 }],
      },
    };
    state.pages = [{ ...state.pages[0], id: "home", history: [night] }];

    const result = summarizeKnownWebflowIssues(
      [{ project: { id: "project", name: "Project", customer: "Customer" }, state }],
      new Date("2026-08-17T12:00:00.000Z"),
    );

    expect(result).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: "render-blocking-resources", detections: 1, pageCount: 1, customerCount: 1, optimizeAffectedDetections: 1 }),
      expect.objectContaining({ key: "webflow-background-video", detections: 1, pageCount: 1, optimizeAffectedDetections: 1 }),
    ]));
  });

  it("does not infer a platform issue from a generic audit on an unattributed page", () => {
    const state = buildInitialState("live");
    state.pages = [{ ...state.pages[0], history: [{
      i: 1,
      date: "Aug 10",
      iso: "2026-08-10T12:00:00.000Z",
      scores,
      nativeElements: nativeElementScan("<html><body></body></html>"),
      diagnostics: { mobile: [finding("render-blocking-resources", "Eliminate render-blocking resources")] },
    }] }];
    expect(summarizeKnownWebflowIssues(
      [{ project: { id: "project", name: "Project" }, state }],
      new Date("2026-08-17T12:00:00.000Z"),
    )).toEqual([]);
  });
});
