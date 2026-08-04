import { describe, expect, it } from "vitest";
import {
  fieldRecommendationLifecycleStatus,
  fieldOnlyRecommendationsForPage,
  isFieldRecommendationActionable,
  reconcileFieldOnlyRecommendationsInState,
} from "../fieldOnlyRecommendations";
import type { CruxPageEvidence, CruxSnapshot } from "../crux";
import type { AppState, Night, Strategy, WatchPage } from "../types";

const score = { m: 90, lo: 88, hi: 92 };
const scores = {
  mobile: { perf: score, a11y: score, bp: score, seo: score },
  desktop: { perf: score, a11y: score, bp: score, seo: score },
};

function page(): WatchPage {
  const night: Night = {
    i: 1,
    date: "Aug 3",
    iso: "2026-08-03T12:00:00.000Z",
    scores,
    measurementContext: {
      mobile: {
        medianLargestContentfulPaint: 2_000,
        medianTotalBlockingTime: 150,
        medianCumulativeLayoutShift: 0.05,
        medianServerResponseTime: 600,
      },
      desktop: {
        medianLargestContentfulPaint: 1_700,
        medianTotalBlockingTime: 100,
        medianCumulativeLayoutShift: 0.04,
        medianServerResponseTime: 500,
      },
    },
  };
  return {
    id: "page",
    title: "Homepage",
    url: "https://example.test/page",
    flag: "priority",
    status: "stable",
    current: { mobile: { perf: 90, a11y: 90, bp: 90, seo: 90 }, desktop: { perf: 90, a11y: 90, bp: 90, seo: 90 } },
    history: [night],
    markers: [],
    agent: [],
  };
}

function snapshot(formFactor: "PHONE" | "DESKTOP", overrides: Partial<CruxSnapshot> = {}): CruxSnapshot {
  return {
    formFactor,
    scope: "url",
    requestedUrl: "https://example.test/page",
    effectiveUrl: "https://example.test/page",
    collectionStart: "2026-07-01",
    collectionEnd: "2026-07-28",
    fetchedAt: "2026-07-29T00:00:00.000Z",
    lcpP75Ms: 4_500,
    inpP75Ms: null,
    clsP75: null,
    ttfbP75Ms: null,
    metrics: {},
    ...overrides,
  };
}

function evidence(strategy: Strategy, value: CruxSnapshot): CruxPageEvidence {
  return { pageId: "page", formFactor: strategy === "mobile" ? "PHONE" : "DESKTOP", status: null, snapshots: [value] };
}

describe("field-only recommendations", () => {
  it("creates a root-cause-neutral recommendation from exact-URL visitor evidence", () => {
    const recommendations = fieldOnlyRecommendationsForPage(
      page(),
      [evidence("mobile", snapshot("PHONE"))],
      new Date("2026-08-03T13:00:00.000Z"),
      "run-one",
    );

    expect(recommendations).toHaveLength(1);
    expect(recommendations[0]).toMatchObject({
      key: "page:crux-field-only-lcp",
      source: "crux-field-only",
      strategies: ["mobile"],
      title: "Investigate visitor-only content loading",
      savings: "Field signal",
      webflow: {
        metric: "other",
        culpritLabel: "Root cause unconfirmed",
        remediationLabel: "Investigation needed",
        source: "crux-field-only",
      },
      fieldSignals: {
        mobile: {
          metricKey: "lcp",
          fieldLabel: "Visitor LCP p75",
          fieldFormatted: "4.5 s",
          fieldRating: "Poor",
          scope: "url",
        },
      },
      fieldLifecycle: {
        mobile: { status: "active", consecutiveGoodWindows: 0, lastEvaluatedCollectionEnd: "2026-07-28" },
      },
      sourceRunId: "run-one",
    });
    expect(recommendations[0].aiSummary).toContain("produced no matching audit");
    expect(recommendations[0].aiSummary).toContain("before assigning a culprit");
  });

  it("combines devices and labels TBT versus INP as a diagnostic proxy", () => {
    const visitorEvidence = [
      evidence("mobile", snapshot("PHONE", { lcpP75Ms: null, inpP75Ms: 650 })),
      evidence("desktop", snapshot("DESKTOP", { lcpP75Ms: null, inpP75Ms: 560 })),
    ];
    const [recommendation] = fieldOnlyRecommendationsForPage(page(), visitorEvidence, new Date("2026-08-03T13:00:00.000Z"));
    expect(recommendation).toMatchObject({
      id: "crux-field-only-inp",
      strategies: ["mobile", "desktop"],
      fieldSignals: {
        mobile: { metricKey: "responsiveness", relationship: "proxy" },
        desktop: { metricKey: "responsiveness", relationship: "proxy" },
      },
    });
    expect(recommendation.aiSummary).toContain("lab TBT is only a diagnostic proxy for visitor INP");
  });

  it("does not create page proof from origin data or duplicate a matching Lighthouse metric", () => {
    const watched = page();
    expect(fieldOnlyRecommendationsForPage(
      watched,
      [evidence("mobile", snapshot("PHONE", { scope: "origin", effectiveUrl: "https://example.test" }))],
      new Date(),
    )).toEqual([]);

    watched.history[0].opportunitiesByStrategy = {
      mobile: [{ id: "unused-javascript", title: "Reduce unused JavaScript", category: "Performance", savingsMs: 500 }],
    };
    expect(fieldOnlyRecommendationsForPage(
      watched,
      [evidence("mobile", snapshot("PHONE"))],
      new Date(),
    )).toEqual([]);
  });

  it("does not promote stale snapshots whose latest CrUX status is insufficient", () => {
    const stale = evidence("mobile", snapshot("PHONE"));
    stale.status = {
      pageId: "page",
      formFactor: "PHONE",
      status: "insufficient",
      effectiveScope: "url",
      latestCollectionEnd: "2026-07-28",
      lastAttemptedAt: "2026-08-03T12:00:00.000Z",
      lastSucceededAt: "2026-07-29T00:00:00.000Z",
      errorCode: "LATEST_PERIOD_UNAVAILABLE",
      errorMessage: "Latest period unavailable",
    };
    expect(fieldOnlyRecommendationsForPage(page(), [stale], new Date())).toEqual([]);
  });

  it("updates evidence without reopening a recommendation the user already triaged", () => {
    const watched = page();
    const state: AppState = { pages: [watched], recs: [], jobs: [], followUps: [] };
    const firstEvidence = [evidence("mobile", snapshot("PHONE"))];
    expect(reconcileFieldOnlyRecommendationsInState(state, firstEvidence, new Date("2026-08-03T13:00:00.000Z"))).toEqual({ created: 1, updated: 0 });
    state.recs[0].status = "task";
    state.recs[0].taskStatus = "in-progress";
    state.recs[0].sourceRunId = "original-run";

    const updatedEvidence = [evidence("mobile", snapshot("PHONE", { lcpP75Ms: 5_200, collectionEnd: "2026-08-04" }))];
    expect(reconcileFieldOnlyRecommendationsInState(state, updatedEvidence, new Date("2026-08-05T13:00:00.000Z"), undefined, "newer-run")).toEqual({ created: 0, updated: 1 });
    expect(state.recs).toHaveLength(1);
    expect(state.recs[0]).toMatchObject({
      status: "task",
      taskStatus: "in-progress",
      sourceRunId: "original-run",
      fieldSignals: { mobile: { fieldFormatted: "5.2 s", collectionEnd: "2026-08-04" } },
    });
  });

  it("requires two distinct good CrUX windows to resolve and marks a later return", () => {
    const state: AppState = { pages: [page()], recs: [], jobs: [], followUps: [] };
    reconcileFieldOnlyRecommendationsInState(
      state,
      [evidence("mobile", snapshot("PHONE"))],
      new Date("2026-08-03T13:00:00.000Z"),
    );
    const recommendation = state.recs[0];
    expect(fieldRecommendationLifecycleStatus(recommendation)).toBe("active");
    expect(isFieldRecommendationActionable(recommendation)).toBe(true);

    const firstGood = [evidence("mobile", snapshot("PHONE", { lcpP75Ms: 2_200, collectionEnd: "2026-08-04" }))];
    expect(reconcileFieldOnlyRecommendationsInState(state, firstGood, new Date("2026-08-05T13:00:00.000Z"))).toEqual({ created: 0, updated: 1 });
    expect(recommendation.fieldLifecycle?.mobile).toMatchObject({ status: "verifying", consecutiveGoodWindows: 1 });
    expect(isFieldRecommendationActionable(recommendation)).toBe(false);

    expect(reconcileFieldOnlyRecommendationsInState(state, firstGood, new Date("2026-08-06T13:00:00.000Z"))).toEqual({ created: 0, updated: 0 });
    expect(recommendation.fieldLifecycle?.mobile?.consecutiveGoodWindows).toBe(1);

    const secondGood = [evidence("mobile", snapshot("PHONE", { lcpP75Ms: 2_300, collectionEnd: "2026-08-11" }))];
    reconcileFieldOnlyRecommendationsInState(state, secondGood, new Date("2026-08-12T13:00:00.000Z"));
    expect(recommendation.fieldLifecycle?.mobile).toMatchObject({ status: "resolved", consecutiveGoodWindows: 2 });

    const returned = [evidence("mobile", snapshot("PHONE", { lcpP75Ms: 4_700, collectionEnd: "2026-08-18" }))];
    reconcileFieldOnlyRecommendationsInState(state, returned, new Date("2026-08-19T13:00:00.000Z"));
    expect(recommendation.fieldLifecycle?.mobile).toMatchObject({ status: "regressed", consecutiveGoodWindows: 0 });
    expect(recommendation.fieldLifecycle?.mobile?.returnedAt).toBe("2026-08-19T13:00:00.000Z");
    expect(isFieldRecommendationActionable(recommendation)).toBe(true);
  });

  it("retires the synthetic investigation when Lighthouse later explains the metric", () => {
    const watched = page();
    const state: AppState = { pages: [watched], recs: [], jobs: [], followUps: [] };
    const visitorEvidence = [evidence("mobile", snapshot("PHONE"))];
    reconcileFieldOnlyRecommendationsInState(state, visitorEvidence, new Date("2026-08-03T13:00:00.000Z"));
    watched.history[0].opportunitiesByStrategy = {
      mobile: [{ id: "unused-javascript", title: "Reduce unused JavaScript", category: "Performance", savingsMs: 500 }],
    };

    expect(reconcileFieldOnlyRecommendationsInState(state, visitorEvidence, new Date("2026-08-04T13:00:00.000Z"))).toEqual({ created: 0, updated: 1 });
    expect(fieldRecommendationLifecycleStatus(state.recs[0])).toBe("corroborated");
    expect(isFieldRecommendationActionable(state.recs[0])).toBe(false);
  });
});
