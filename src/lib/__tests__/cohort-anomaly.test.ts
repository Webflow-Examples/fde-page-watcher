import { describe, expect, it } from "vitest";
import { evaluateCohortAnomaly } from "../cohortAnomaly";
import { pendingPage } from "../mutations";
import type { AppState, Night, NightScores, PsiMeasurementContext } from "../types";

const score = (value: number) => ({ m: value, lo: value, hi: value });
const scores = (performance: number): NightScores => ({
  perf: score(performance),
  a11y: score(95),
  bp: score(95),
  seo: score(95),
});
const context = (
  benchmark: number,
  totalBlockingTime: number,
  serverResponseTime: number,
): PsiMeasurementContext => ({
  lighthouseVersion: "13.4.0",
  medianBenchmarkIndex: benchmark,
  medianTotalBlockingTime: totalBlockingTime,
  medianServerResponseTime: serverResponseTime,
});

function night(
  i: number,
  runId: string,
  cohortId: string,
  performance: number,
  measurement: PsiMeasurementContext,
): Night {
  return {
    i,
    runId,
    cohortId,
    date: `Jul ${26 + i}`,
    iso: `2026-07-${26 + i}T05:00:00.000Z`,
    scores: { mobile: scores(performance), desktop: scores(performance) },
    measurementContext: { mobile: measurement, desktop: measurement },
  };
}

function cohortState(): AppState {
  const pages = Array.from({ length: 5 }, (_, index) => {
    const page = pendingPage(
      `page-${index}`,
      `Page ${index}`,
      `https://example.com/${index}`,
      "watching",
    );
    page.baseline = { mobile: scores(80), desktop: scores(80) };
    page.baselineCapturedAt = "2026-07-25T05:00:00.000Z";
    page.history = [
      night(0, `before-${index}`, "nightly:2026-07-26", 80, context(1_000, 300, 20)),
      night(1, `dip-${index}`, "nightly:2026-07-27", 60, context(600, 900, 25)),
    ];
    page.current = { mobile: { perf: 60, a11y: 95, bp: 95, seo: 95 }, desktop: { perf: 60, a11y: 95, bp: 95, seo: 95 } };
    return page;
  });
  return {
    pages,
    recs: pages.map((page, index) => ({
      key: `${page.id}:unused-javascript`,
      pageId: page.id,
      pageTitle: page.title,
      url: page.url,
      id: "unused-javascript",
      sourceRunId: `dip-${index}`,
      title: "Reduce unused JavaScript",
      category: "Performance",
      savings: "1.0 s",
      estTime: "1 day",
      status: "inbox",
      taskStatus: "todo",
      added: "Jul 27",
      doneDate: null,
    })),
  };
}

describe("cohort anomaly detection", () => {
  it("quarantines synchronized PSI environment drops and retains trusted state", () => {
    const state = cohortState();
    const result = evaluateCohortAnomaly(
      state,
      "nightly:2026-07-27",
      new Date("2026-07-27T06:00:00.000Z"),
    );

    expect(result).toMatchObject({ evaluated: true, anomaly: true, affectedPages: 5 });
    expect(state.measurementIncident).toMatchObject({
      status: "suspected",
      affectedPages: 5,
      eligiblePages: 5,
    });
    expect(state.pages[0].history[1].evidenceStatus).toBe("provider-anomaly");
    expect(state.pages[0].current.mobile.perf).toBe(80);
    expect(state.recs).toEqual([]);
  });

  it("marks a healthy independent confirmation as recovered", () => {
    const state = cohortState();
    evaluateCohortAnomaly(state, "nightly:2026-07-27");
    const confirmationCohortId = "confirmation:incident:one";
    state.measurementIncident = {
      ...state.measurementIncident!,
      status: "confirming",
      confirmationCohortId,
    };
    state.pages.forEach((page, index) => {
      page.history.push(
        night(2, `confirm-${index}`, confirmationCohortId, 79, context(1_000, 320, 20)),
      );
    });

    const result = evaluateCohortAnomaly(state, confirmationCohortId);
    expect(result.recovered).toBe(true);
    expect(state.measurementIncident?.status).toBe("recovered");
  });
});
