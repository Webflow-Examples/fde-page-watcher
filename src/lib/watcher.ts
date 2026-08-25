import type { AgentIgnoreSettings, PerformanceThresholds, RangeDays, Rec, Strategy, WatchPage } from "./types";
import { summarizeAgentChecks } from "./agentScoring";
import { DEFAULT_PERFORMANCE_THRESHOLDS, effectivePerformanceThresholds, normalizePerformanceThresholds } from "./performanceThresholds";
import { savingsValue } from "./ui";
import {
  pageAgentSnapshotForRange,
  pageRangeComparison,
  pageRangeLatestScore,
  pageRangeTrend,
} from "./scoring";
import { isPageActivelyMonitored } from "./watchCapacity";
import type { CruxPageEvidence } from "./crux";
import { pageFieldPriority, recommendationEvidenceSignal } from "./fieldPrioritization";
import { isFieldRecommendationActionable } from "./fieldOnlyRecommendations";
import { recommendationIsCustomerActionable } from "./webflowPerformance";

/** "A" · "A and B" · "A, B and C". */
function listJoin(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

export interface WatcherBullet {
  lead: string;
  text: string;
}

export interface WatcherSummary {
  total: number;
  stable: number;
  improving: number;
  regressing: number;
  lowPerformance: number;
  agentGaps: number;
  qualityIssues: number;
  fieldCorroborated: number;
  fieldOnly: number;
  changed: WatcherBullet[];
  winning: string | null;
  topRec: { pageId: string; pageTitle: string; recTitle: string; savings: string; evidenceLabel: string; source?: Rec["source"] } | null;
}

export interface WatcherCardItem {
  pageId: string;
  pageTitle: string;
  meta: string;
  sortValue: number;
}

export interface WatcherCards {
  improvements: WatcherCardItem[];
  regressions: WatcherCardItem[];
  lowPerformance: WatcherCardItem[];
  agentGaps: WatcherCardItem[];
}

export const LOW_PERFORMANCE_THRESHOLD = DEFAULT_PERFORMANCE_THRESHOLDS.lowPerformance;

function latestScore(page: WatchPage, strategy: Strategy, key: "perf" | "a11y" | "bp" | "seo", rangeDays: RangeDays): number | null {
  return pageRangeLatestScore(page, strategy, key, rangeDays);
}

function orderedDevices(preferredStrategy: Strategy): Strategy[] {
  return preferredStrategy === "mobile" ? ["mobile", "desktop"] : ["desktop", "mobile"];
}

function deviceChangeMeta(
  page: WatchPage,
  rangeDays: RangeDays,
  trend: "improving" | "regressing",
  devices: Strategy[],
  thresholds: PerformanceThresholds,
): { meta: string; sortValue: number } {
  const changes = devices.flatMap((device) => {
    if (pageRangeTrend(page, device, rangeDays, thresholds) !== trend) return [];
    const delta = pageRangeComparison(page, device, "perf", rangeDays)?.delta ?? 0;
    return [{ label: `${device === "mobile" ? "M" : "D"} ${delta > 0 ? "+" : "−"}${Math.abs(delta)}`, magnitude: Math.abs(delta) }];
  });
  return {
    meta: changes.map((change) => change.label).join(" · "),
    sortValue: Math.max(0, ...changes.map((change) => change.magnitude)),
  };
}

function devicesForPolicy(
  matching: Strategy[],
  preferredStrategy: Strategy,
  policy: PerformanceThresholds["devicePolicy"],
): Strategy[] {
  const ordered = orderedDevices(preferredStrategy);
  if (policy === "both") return matching.length === ordered.length ? ordered : [];
  if (policy === "preferred") return matching.includes(preferredStrategy) ? [preferredStrategy] : [];
  return ordered.filter((device) => matching.includes(device));
}

/** The four page lists shown in the dashboard summary cards. */
export function buildWatcherCards(
  pages: WatchPage[],
  rangeDays: RangeDays,
  agentIgnoreDefaults?: AgentIgnoreSettings,
  preferredStrategy: Strategy = "desktop",
  performanceThresholds?: Partial<PerformanceThresholds>,
): WatcherCards {
  const activePages = pages.filter(isPageActivelyMonitored);
  const teamThresholds = normalizePerformanceThresholds(performanceThresholds);
  const improvements: WatcherCardItem[] = [];
  const regressions: WatcherCardItem[] = [];
  const lowPerformance: WatcherCardItem[] = [];
  const agentGaps: WatcherCardItem[] = [];
  const devices = orderedDevices(preferredStrategy);

  for (const page of activePages) {
    const thresholds = effectivePerformanceThresholds(teamThresholds, page);
    const trends = {
      mobile: pageRangeTrend(page, "mobile", rangeDays, thresholds),
      desktop: pageRangeTrend(page, "desktop", rangeDays, thresholds),
    };
    const improvingDevices = devicesForPolicy(
      devices.filter((device) => trends[device] === "improving"),
      preferredStrategy,
      thresholds.devicePolicy,
    );
    const regressingDevices = devicesForPolicy(
      devices.filter((device) => trends[device] === "regressing"),
      preferredStrategy,
      thresholds.devicePolicy,
    );

    if (improvingDevices.length) {
      const change = deviceChangeMeta(page, rangeDays, "improving", improvingDevices, thresholds);
      improvements.push({ pageId: page.id, pageTitle: page.title, ...change });
    }
    if (regressingDevices.length) {
      const change = deviceChangeMeta(page, rangeDays, "regressing", regressingDevices, thresholds);
      regressions.push({ pageId: page.id, pageTitle: page.title, ...change });
    }

    const matchingLowDevices = devices.filter((device) => {
      const score = latestScore(page, device, "perf", rangeDays);
      return score !== null && score < thresholds.lowPerformance;
    });
    const lowScores = devicesForPolicy(matchingLowDevices, preferredStrategy, thresholds.devicePolicy).flatMap((device) => {
      const score = latestScore(page, device, "perf", rangeDays);
      return score === null ? [] : [{ label: `${device === "mobile" ? "M" : "D"} ${score}`, score }];
    });
    if (lowScores.length) {
      lowPerformance.push({
        pageId: page.id,
        pageTitle: page.title,
        meta: lowScores.map((score) => score.label).join(" · "),
        sortValue: Math.min(...lowScores.map((score) => score.score)),
      });
    }

    const agentSnapshot = pageAgentSnapshotForRange(page, rangeDays);
    const agentSummary = agentSnapshot
      ? summarizeAgentChecks(agentSnapshot.checks, page.agentIgnores, agentIgnoreDefaults, page.agentIgnoreRestores)
      : null;
    if (agentSummary?.total && agentSummary.percent < thresholds.agentReadiness) {
      agentGaps.push({
        pageId: page.id,
        pageTitle: page.title,
        meta: `${agentSummary.percent}%`,
        sortValue: agentSummary.percent,
      });
    }
  }

  improvements.sort((a, b) => b.sortValue - a.sortValue || a.pageTitle.localeCompare(b.pageTitle));
  regressions.sort((a, b) => b.sortValue - a.sortValue || a.pageTitle.localeCompare(b.pageTitle));
  lowPerformance.sort((a, b) => a.sortValue - b.sortValue || a.pageTitle.localeCompare(b.pageTitle));
  agentGaps.sort((a, b) => a.sortValue - b.sortValue || a.pageTitle.localeCompare(b.pageTitle));

  return { improvements, regressions, lowPerformance, agentGaps };
}

/**
 * The Watcher: an agent-authored read of current conditions, what changed over
 * the selected range, and a top recommendation (REQ-049). Derived live from stored state.
 */
export function buildWatcher(
  pages: WatchPage[],
  recs: Rec[],
  strategy: Strategy,
  rangeDays: RangeDays = 30,
  agentIgnoreDefaults?: AgentIgnoreSettings,
  performanceThresholds?: Partial<PerformanceThresholds>,
  visitorEvidence: CruxPageEvidence[] = [],
): WatcherSummary {
  const activePages = pages.filter(isPageActivelyMonitored);
  const teamThresholds = normalizePerformanceThresholds(performanceThresholds);
  const devices = orderedDevices(strategy);
  const trends = new Map(activePages.map((page) => {
    const thresholds = effectivePerformanceThresholds(teamThresholds, page);
    const byDevice = {
      mobile: pageRangeTrend(page, "mobile", rangeDays, thresholds),
      desktop: pageRangeTrend(page, "desktop", rangeDays, thresholds),
    };
    if (devicesForPolicy(devices.filter((device) => byDevice[device] === "regressing"), strategy, thresholds.devicePolicy).length) {
      return [page.id, "regressing"] as const;
    }
    if (devicesForPolicy(devices.filter((device) => byDevice[device] === "improving"), strategy, thresholds.devicePolicy).length) {
      return [page.id, "improving"] as const;
    }
    if (devicesForPolicy(devices.filter((device) => byDevice[device] === "pending"), strategy, thresholds.devicePolicy).length) {
      return [page.id, "pending"] as const;
    }
    return [page.id, "stable"] as const;
  }));
  const stable = activePages.filter((p) => trends.get(p.id) === "stable").length;
  const improving = activePages.filter((p) => trends.get(p.id) === "improving").length;
  const regressing = activePages.filter((p) => trends.get(p.id) === "regressing").length;
  const lowPerformance = activePages.filter((page) => devicesForPolicy(
    devices.filter((device) => {
      const score = latestScore(page, device, "perf", rangeDays);
      return score !== null && score < effectivePerformanceThresholds(teamThresholds, page).lowPerformance;
    }),
    strategy,
    effectivePerformanceThresholds(teamThresholds, page).devicePolicy,
  ).length > 0).length;
  const agentGaps = activePages.filter((page) => {
    const snapshot = pageAgentSnapshotForRange(page, rangeDays);
    if (!snapshot) return false;
    const summary = summarizeAgentChecks(snapshot.checks, page.agentIgnores, agentIgnoreDefaults, page.agentIgnoreRestores);
    return summary.total > 0 && summary.percent < effectivePerformanceThresholds(teamThresholds, page).agentReadiness;
  }).length;
  const qualityIssues = activePages.filter((page) => devicesForPolicy(
    devices.filter((device) => (["a11y", "bp", "seo"] as const).some((key) => {
      const score = latestScore(page, device, key, rangeDays);
      const thresholds = effectivePerformanceThresholds(teamThresholds, page);
      const qualityCutoffs = { a11y: thresholds.accessibility, bp: thresholds.bestPractices, seo: thresholds.seo } as const;
      return score !== null && score < qualityCutoffs[key];
    })),
    strategy,
    effectivePerformanceThresholds(teamThresholds, page).devicePolicy,
  ).length > 0).length;
  const fieldByPage = new Map(activePages.map((page) => [page.id, pageFieldPriority(page, strategy, visitorEvidence)]));
  const hasExactUrlSignal = (page: WatchPage, key: "corroborated" | "fieldOnly") => {
    const priority = fieldByPage.get(page.id);
    return priority?.comparison.fieldWindow?.scope === "url" && priority[key].length > 0;
  };
  const fieldCorroborated = activePages.filter((page) => hasExactUrlSignal(page, "corroborated")).length;
  const fieldOnly = activePages.filter((page) => hasExactUrlSignal(page, "fieldOnly")).length;

  const ranked = activePages.filter((p) => trends.get(p.id) !== "pending" && p.baseline);
  const regressionPages = ranked.filter((p) => trends.get(p.id) === "regressing");

  const changed: WatcherBullet[] = [];

  const corroboratedPages = activePages.filter((page) => hasExactUrlSignal(page, "corroborated"));
  const fieldOnlyPages = activePages.filter((page) => hasExactUrlSignal(page, "fieldOnly"));
  if (corroboratedPages.length) {
    changed.push({ lead: listJoin(corroboratedPages.map((page) => page.title)), text: "has visitor issues reproduced in Lighthouse." });
  }
  if (fieldOnlyPages.length) {
    changed.push({ lead: listJoin(fieldOnlyPages.map((page) => page.title)), text: "has visitor issues that Lighthouse did not reproduce." });
  }

  // Evaluate Accessibility and SEO over the same selected range instead of
  // asserting they are stable — the Watcher must not make unchecked claims.
  //
  // A page has no comparison for this device when the selected device never
  // measured it: `availableStrategies` lets a night report desktop and not
  // mobile, and under `devicePolicy: "both"` such a page is still ranked. This
  // used to read `?? 0` for the movement and `?? 100` for the score, which
  // fabricated a flat, perfect reading and counted the page as one that held.
  // One page nobody measured was enough to print "stable across the board" over
  // data that did not exist — registry rule 18, in its worst form, in copy.
  //
  // An absent measurement is neither a hold nor a drop. It cannot support the
  // claim, so it withholds it.
  const stableCategories: string[] = [];
  if (ranked.length) {
    for (const [key, label] of [["a11y", "Accessibility"], ["seo", "SEO"]] as const) {
      const readings = ranked.map((page) => ({
        page,
        comparison: pageRangeComparison(page, strategy, key, rangeDays),
        thresholds: effectivePerformanceThresholds(teamThresholds, page),
      }));
      const dropped = readings.filter(({ comparison, thresholds }) =>
        comparison !== null
        && comparison.delta <= -thresholds.regression
        && comparison.to < thresholds.regressionFloor);
      const unmeasured = readings.filter(({ comparison }) => comparison === null);
      if (dropped.length) {
        changed.push({ lead: listJoin(dropped.map(({ page }) => page.title)), text: `dropped on ${label} over the last ${rangeDays} days.` });
      } else if (unmeasured.length === 0) {
        // "Across the board" means every page on the board.
        stableCategories.push(label);
      }
    }
  }
  const winning = stableCategories.length
    ? `${listJoin(stableCategories)} ${stableCategories.length > 1 ? "are" : "is"} stable across the board.`
    : null;

  const focus = corroboratedPages[0] ?? fieldOnlyPages[0] ?? regressionPages[0] ?? [...ranked].sort(
    (a, b) => (latestScore(a, strategy, "perf", rangeDays) ?? 100) - (latestScore(b, strategy, "perf", rangeDays) ?? 100),
  )[0];
  let topRec: WatcherSummary["topRec"] = null;
  if (focus) {
    // Only recommend something still actionable — not an ignored or completed rec.
    const cand = recs
      .filter((r) =>
        r.pageId === focus.id
        && r.category === "Performance"
        && (!r.strategies?.length || r.strategies.includes(strategy))
        && r.status !== "ignored"
        && r.taskStatus !== "done")
      .filter(isFieldRecommendationActionable)
      .filter(recommendationIsCustomerActionable)
      .sort((a, b) => {
        const aSignal = recommendationEvidenceSignal(a, focus, visitorEvidence);
        const bSignal = recommendationEvidenceSignal(b, focus, visitorEvidence);
        return bSignal.rank - aSignal.rank || savingsValue(b) - savingsValue(a);
      })[0];
    if (cand) {
      const signal = recommendationEvidenceSignal(cand, focus, visitorEvidence);
      topRec = { pageId: focus.id, pageTitle: focus.title, recTitle: cand.title, savings: cand.savings, evidenceLabel: signal.label, source: cand.source };
    }
  }

  return { total: activePages.length, stable, improving, regressing, lowPerformance, agentGaps, qualityIssues, fieldCorroborated, fieldOnly, changed, winning, topRec };
}
