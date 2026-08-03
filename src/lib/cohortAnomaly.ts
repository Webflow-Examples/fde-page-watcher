import { normalizePerformanceThresholds } from "./performanceThresholds";
import { mediansOf, nightHasStrategy, pageTrend } from "./scoring";
import type {
  AppState,
  Night,
  PsiMeasurementContext,
  Strategy,
  WatchPage,
} from "./types";
import { isPageActivelyMonitored } from "./watchCapacity";

const MINIMUM_COHORT_PAGES = 5;
const COHORT_AGREEMENT = 0.7;
const BENCHMARK_DROP_RATIO = 0.8;
const TBT_INCREASE_RATIO = 1.75;
const MAX_STABLE_TTFB_INCREASE_MS = 300;
const CONFIRMATION_DELAY_MS = 60 * 60 * 1000;

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)];
}

function previousTrustedNight(page: WatchPage, night: Night): Night | null {
  const index = page.history.indexOf(night);
  for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
    const candidate = page.history[cursor];
    if (
      candidate.evidenceStatus !== "provider-anomaly"
      && nightHasStrategy(candidate, "mobile")
      && nightHasStrategy(candidate, "desktop")
    ) return candidate;
  }
  return null;
}

function contextValue(
  night: Night,
  strategy: Strategy,
  key: keyof PsiMeasurementContext,
): number | null {
  const value = night.measurementContext?.[strategy]?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

interface CohortPage {
  page: WatchPage;
  night: Night;
  previous: Night;
  dropped: boolean;
}

export interface CohortEvaluation {
  evaluated: boolean;
  anomaly: boolean;
  recovered: boolean;
  verified: boolean;
  affectedPages: number;
  eligiblePages: number;
}

/**
 * Evaluate one completed cohort and mutate the state only when the evidence is
 * strong enough to classify it. Individual raw captures always remain stored.
 */
export function evaluateCohortAnomaly(
  state: AppState,
  cohortId: string,
  now = new Date(),
): CohortEvaluation {
  const thresholds = normalizePerformanceThresholds(state.performanceThresholds);
  const isConfirmation = state.measurementIncident?.confirmationCohortId === cohortId;
  const isMonitoringFollowUp = !!(
    state.measurementIncident
    && state.measurementIncident.status === "suspected"
    && cohortId !== state.measurementIncident.cohortId
  );
  const expectedPageIds = new Set(
    isConfirmation
      ? state.measurementIncident?.affectedPageIds ?? []
      : state.pages.filter(isPageActivelyMonitored).map((page) => page.id),
  );
  const terminalWithoutCapture = new Set(
    (state.jobs ?? []).flatMap((job) =>
      job.cohortId === cohortId && (job.state === "inconclusive" || job.state === "failed")
        ? [job.pageId]
        : []),
  );
  const completedPageIds = new Set(
    state.pages.flatMap((page) =>
      page.history.some((night) =>
        night.cohortId === cohortId
        && nightHasStrategy(night, "mobile")
        && nightHasStrategy(night, "desktop")) || terminalWithoutCapture.has(page.id)
        ? [page.id]
        : []),
  );
  const candidates: CohortPage[] = [];
  for (const page of state.pages) {
    const night = page.history.find((item) => item.cohortId === cohortId);
    if (!night || !nightHasStrategy(night, "mobile") || !nightHasStrategy(night, "desktop")) continue;
    const previous = previousTrustedNight(page, night);
    if (!previous) continue;
    const dropped = (["mobile", "desktop"] as Strategy[]).some((strategy) =>
      previous.scores[strategy].perf.m - night.scores[strategy].perf.m >= thresholds.regression);
    candidates.push({ page, night, previous, dropped });
  }

  if (
    completedPageIds.size < expectedPageIds.size
    || candidates.length < MINIMUM_COHORT_PAGES
  ) {
    return {
      evaluated: false,
      anomaly: false,
      recovered: false,
      verified: false,
      affectedPages: candidates.filter((item) => item.dropped).length,
      eligiblePages: candidates.length,
    };
  }

  const affected = candidates.filter((item) => item.dropped);
  const agreement = affected.length / candidates.length;
  const ratios = (strategy: Strategy, key: keyof PsiMeasurementContext) =>
    candidates.flatMap(({ night, previous }) => {
      const current = contextValue(night, strategy, key);
      const before = contextValue(previous, strategy, key);
      return current !== null && before !== null && before > 0 ? [current / before] : [];
    });
  const benchmarkRatio = median(
    (["mobile", "desktop"] as Strategy[]).flatMap((strategy) =>
      ratios(strategy, "medianBenchmarkIndex")),
  );
  const tbtRatio = median(
    (["mobile", "desktop"] as Strategy[]).flatMap((strategy) =>
      ratios(strategy, "medianTotalBlockingTime")),
  );
  const ttfbIncreases = (["mobile", "desktop"] as Strategy[]).flatMap((strategy) =>
    candidates.flatMap(({ night, previous }) => {
      const current = contextValue(night, strategy, "medianServerResponseTime");
      const before = contextValue(previous, strategy, "medianServerResponseTime");
      return current !== null && before !== null ? [current - before] : [];
    }),
  );
  const medianTtfbIncrease = median(ttfbIncreases);
  const environmentShift =
    (benchmarkRatio !== null && benchmarkRatio <= BENCHMARK_DROP_RATIO)
    || (tbtRatio !== null && tbtRatio >= TBT_INCREASE_RATIO);
  const originStable =
    medianTtfbIncrease === null
    || medianTtfbIncrease <= MAX_STABLE_TTFB_INCREASE_MS;
  const synchronizedDrop = agreement >= COHORT_AGREEMENT;
  const anomaly = synchronizedDrop && environmentShift && originStable;
  if (anomaly) {
    const anomalyRunIds = new Set(
      candidates.flatMap(({ night }) => night.runId ? [night.runId] : []),
    );
    state.recs = state.recs.filter((rec) =>
      !rec.sourceRunId || !anomalyRunIds.has(rec.sourceRunId));
    for (const { page, night, previous } of candidates) {
      night.evidenceStatus = "provider-anomaly";
      page.current = {
        mobile: mediansOf(previous.scores.mobile),
        desktop: mediansOf(previous.scores.desktop),
      };
      page.status = pageTrend(page, "mobile", thresholds);
    }
    const existing = state.measurementIncident;
    const confirmationAttempts =
      (existing?.confirmationAttempts ?? 0) + (isConfirmation ? 1 : 0);
    state.measurementIncident = {
      id: existing?.id ?? crypto.randomUUID(),
      cohortId: existing?.cohortId ?? cohortId,
      status: "suspected",
      detectedAt: existing?.detectedAt ?? now.toISOString(),
      // Confirm the full eligible cohort, including pages that did not drop.
      affectedPageIds: candidates.map((item) => item.page.id),
      affectedPages: affected.length,
      eligiblePages: candidates.length,
      retryAt: isConfirmation
        ? undefined
        : new Date(now.getTime() + CONFIRMATION_DELAY_MS).toISOString(),
      confirmationAttempts,
    };
  } else if ((isConfirmation || isMonitoringFollowUp) && state.measurementIncident) {
    state.measurementIncident = {
      ...state.measurementIncident,
      status: synchronizedDrop ? "verified" : "recovered",
      affectedPageIds: affected.map((item) => item.page.id),
      affectedPages: affected.length,
      eligiblePages: candidates.length,
      recoveredAt: synchronizedDrop ? undefined : now.toISOString(),
      retryAt: undefined,
    };
  }

  return {
    evaluated: true,
    anomaly,
    recovered: (isConfirmation || isMonitoringFollowUp) && !synchronizedDrop,
    verified: (isConfirmation || isMonitoringFollowUp) && synchronizedDrop && !anomaly,
    affectedPages: affected.length,
    eligiblePages: candidates.length,
  };
}
