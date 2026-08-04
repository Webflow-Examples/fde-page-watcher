import { describe, expect, it } from "vitest";
import { performanceIssueCounts, performanceIssuesForPage, siteCulpritRollups } from "../performanceIssues";
import type { AggregatedLighthouseFinding, Night, WatchPage } from "../types";

const score = { m: 80, lo: 78, hi: 82 };
const scores = {
  mobile: { perf: score, a11y: score, bp: score, seo: score },
  desktop: { perf: score, a11y: score, bp: score, seo: score },
};

function finding(id: string): AggregatedLighthouseFinding {
  return {
    id,
    title: id === "dom-size" ? "Avoid an excessive DOM size" : "Reduce unused JavaScript",
    category: "Performance",
    savingsMs: id === "dom-size" ? 0 : 900,
    savingsBytes: 0,
    actionable: true,
    observedRuns: 5,
    totalObservedRuns: 5,
    eligibleRuns: 5,
    successfulRuns: 5,
    quorum: 3,
    frequency: 1,
    promoted: true,
    confidence: "high",
    savingsLowMs: 0,
    savingsHighMs: 900,
    savingsLowBytes: 0,
    savingsHighBytes: 0,
  };
}

function night(i: number, ids?: string[]): Night {
  return {
    i,
    date: `Aug ${i + 1}`,
    iso: `2026-08-${String(i + 1).padStart(2, "0")}T00:00:00.000Z`,
    scores,
    ...(ids === undefined ? {} : { diagnostics: { mobile: ids.map(finding), desktop: [] } }),
  };
}

describe("performance issue lifecycle", () => {
  it("ignores legacy nights that cannot prove an issue was absent", () => {
    const issues = performanceIssuesForPage([
      night(0),
      night(1, ["unused-javascript"]),
      night(2),
      night(3, ["unused-javascript"]),
    ], "mobile");
    expect(issues[0]).toMatchObject({
      status: "active",
      observedCaptures: 2,
      eligibleCaptures: 2,
      consecutiveDetections: 2,
      resolutionCount: 0,
    });
  });

  it("requires two clean captures before marking a finding resolved", () => {
    const verifying = performanceIssuesForPage([
      night(0, ["dom-size"]),
      night(1, []),
    ], "mobile")[0];
    expect(verifying).toMatchObject({ status: "verifying", trailingAbsences: 1 });

    const resolved = performanceIssuesForPage([
      night(0, ["dom-size"]),
      night(1, []),
      night(2, []),
    ], "mobile")[0];
    expect(resolved).toMatchObject({
      status: "resolved",
      resolvedAt: { date: "Aug 2" },
      trailingAbsences: 2,
      resolutionCount: 1,
    });
  });

  it("marks a finding regressed only after it returns from a confirmed resolution", () => {
    const issue = performanceIssuesForPage([
      night(0, ["unused-javascript"]),
      night(1, []),
      night(2, []),
      night(3, ["unused-javascript"]),
      night(4, ["unused-javascript"]),
    ], "mobile")[0];
    expect(issue).toMatchObject({
      status: "regressed",
      returnedAt: { date: "Aug 4" },
      consecutiveDetections: 2,
      resolutionCount: 1,
      observedCaptures: 3,
      eligibleCaptures: 5,
    });
  });

  it("rolls currently-present findings up by culprit and affected pages", () => {
    const first = {
      id: "first",
      title: "First",
      url: "https://first.test",
      flag: "watching",
      history: [night(0, ["unused-javascript", "dom-size"])],
    } as WatchPage;
    const second = {
      id: "second",
      title: "Second",
      url: "https://second.test",
      flag: "priority",
      history: [night(0, ["unused-javascript"])],
    } as WatchPage;

    const rollups = siteCulpritRollups([first, second], "mobile");
    expect(rollups).toEqual([
      expect.objectContaining({
        culprit: "global-javascript",
        label: "Global JavaScript",
        issueCount: 2,
        pageCount: 2,
        remediationCounts: expect.objectContaining({ blocked: 2 }),
      }),
      expect.objectContaining({
        culprit: "dom-complexity",
        issueCount: 1,
        pageCount: 1,
        remediationCounts: expect.objectContaining({ partial: 1 }),
      }),
    ]);
    expect(performanceIssueCounts(performanceIssuesForPage(first.history, "mobile"))).toMatchObject({ active: 2 });
  });
});
