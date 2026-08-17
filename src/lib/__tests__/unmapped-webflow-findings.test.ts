import { describe, expect, it } from "vitest";
import { summarizeUnmappedWebflowFindings } from "../unmappedWebflowFindings";
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

describe("unmapped Webflow finding summaries", () => {
  it("surfaces an audit ID with no catalog entry or title alias, deduplicated across devices", () => {
    const state = buildInitialState("live");
    const novel = finding("brand-new-lighthouse-audit", "Some brand-new Lighthouse insight");
    const night: Night = {
      i: 30,
      runId: "run-30",
      date: "Aug 10",
      iso: "2026-08-10T12:00:00.000Z",
      scores,
      diagnostics: { mobile: [novel], desktop: [novel] },
    };
    state.pages = [{ ...state.pages[0], id: "home", history: [night] }];

    const result = summarizeUnmappedWebflowFindings(
      [{ project: { id: "project", name: "Project", customer: "Customer" }, state }],
      new Date("2026-08-17T12:00:00.000Z"),
    );

    expect(result).toEqual([
      expect.objectContaining({
        key: "brand-new-lighthouse-audit",
        title: "Some brand-new Lighthouse insight",
        category: "Performance",
        customerCount: 1,
        projectCount: 1,
        pageCount: 1,
        detections: 1,
        lastSeen: "2026-08-10T12:00:00.000Z",
      }),
    ]);
  });

  it("omits documented audit IDs and captures outside the retention window", () => {
    const state = buildInitialState("live");
    const documented = finding("unused-css-rules", "Reduce unused CSS");
    const stale = finding("another-unmapped-audit", "Another unmapped audit");
    state.pages = [{ ...state.pages[0], history: [
      { i: 1, date: "Jul 1", iso: "2026-07-01T00:00:00.000Z", scores, diagnostics: { mobile: [stale] } },
      { i: 2, date: "Aug 10", iso: "2026-08-10T00:00:00.000Z", scores, diagnostics: { mobile: [documented] } },
    ] }];

    expect(summarizeUnmappedWebflowFindings(
      [{ project: { id: "project", name: "Project" }, state }],
      new Date("2026-08-17T12:00:00.000Z"),
    )).toEqual([]);
  });
});
