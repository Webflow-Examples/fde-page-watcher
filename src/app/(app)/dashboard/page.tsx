"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Circle, Desktop, DeviceMobile, Eye, X } from "@phosphor-icons/react";
import { useStore } from "@/components/store";
import { SelectMenu } from "@/components/select-menu";
import type { SelectMenuOption } from "@/components/select-menu";
import { DeviceSegmentedControl, StatusSegmentedControl } from "@/components/segmented-control";
import { CATEGORIES } from "@/lib/types";
import type { AgentIgnoreSettings, Night } from "@/lib/types";
import { agentReadinessForNight, summarizeAgentChecks } from "@/lib/agentScoring";
import { effectivePerformanceThresholds, normalizePerformanceThresholds } from "@/lib/performanceThresholds";
import { deltaMeta, historyForRange, pageAgentSnapshotForRange, pageRangeComparison, pageRangeLatestNightForStrategy, pageRangeSeries, pageRangeTrend, scoreMeta } from "@/lib/scoring";
import { C, flagChip, savingsValue } from "@/lib/ui";
import { AgentAccessChip } from "@/components/agent-access";
import { agentAccessSummary, assembleAgentIssueCases } from "@/lib/agentIssueCases";
import { externalAuditForPage } from "@/lib/externalAgentEvidence";
import { scoreCardDataForCategory } from "@/lib/scoreCardAdapter";
import { XSmallScoreCard } from "@/components/ScoreCard";
import { DeviceChangeLabels, FieldEvidenceChip, PerformanceIssueStatusBadge, SortHeader, WebflowClassificationChips } from "@/components/bits";
import { isPageActivelyMonitored } from "@/lib/watchCapacity";
import { sortDashboardRows } from "@/lib/dashboardSort";
import { combinedDashboardSignals } from "@/lib/dashboardVerdict";
import { normalizeCollectionSchedule } from "@/lib/collectionSchedule";
import { evidenceForPage, visitorExperienceTrend } from "@/lib/visitorExperience";
import { performanceIssueCounts, siteCulpritRollups, sitePerformanceIssues } from "@/lib/performanceIssues";
import { customerActionabilityFor, recommendationIsCustomerActionable, remediationTone, triageActionLabel, webflowClassificationFor } from "@/lib/webflowPerformance";
import { siteNativeElementRollups } from "@/lib/nativeElements";
import { compareLabAndField } from "@/lib/labFieldComparison";
import { fieldPriorityRankForRec, recommendationEvidenceSignal } from "@/lib/fieldPrioritization";
import { isFieldRecommendationActionable } from "@/lib/fieldOnlyRecommendations";

// The 4 category columns each now hold an XSmall ScoreCard row cell (desktop
// + mobile hairlines with start/end numerals) rather than a single sparkline,
// so they're wider than the old 126px sparkline+score column. Agent matches
// that same 190px — it's a single-metric XSmall cell (one hairline, not a
// pair), and a narrower column just means a shorter, harder-to-read line for
// no layout benefit; the row already stretches to fill whatever width it's
// given (see XSmallScoreCard), so the two sparklines read at a comparable
// length only because their columns are the same width.
const GRID = "minmax(170px,1fr) 142px 190px 190px 190px 190px 190px";
type DashboardFilter = "all" | "lowPerformance" | "agentGaps" | "regressions" | "improvements";
type DeviceDashboardFilter = "lowPerformance" | "regressions" | "improvements";
type DashboardRange = 3 | 7 | 30 | 90;
type DashboardDevice = "mobile" | "desktop";
type VerdictClause =
  | {
      kind: "filter";
      filter: Exclude<DashboardFilter, "all">;
      count: number;
      suffix: string;
    }
  | {
      kind: "device";
      filter: DeviceDashboardFilter;
      desktopCount: number;
      mobileCount: number;
    };

const RANGE_OPTIONS: ReadonlyArray<SelectMenuOption<DashboardRange>> = [
  { value: 3, label: "Last 3 days" },
  { value: 7, label: "Last 7 days" },
  { value: 30, label: "Last 30 days" },
  { value: 90, label: "Last 90 days" },
];

const FILTER_META: Record<Exclude<DashboardFilter, "all">, {
  label: string;
  color: string;
  tint: string;
  border: string;
  shape: "circle" | "triangle" | "square";
  reason: (strategy: DashboardDevice) => string;
}> = {
  lowPerformance: {
    label: "Low performance",
    color: "var(--wf-yellow-300)",
    tint: "color-mix(in srgb, var(--wf-yellow) 12%, transparent)",
    border: "color-mix(in srgb, var(--wf-yellow) 18%, transparent)",
    shape: "triangle",
    reason: (strategy) => `low performance on ${strategy}`,
  },
  agentGaps: {
    label: "Agent gaps",
    color: "var(--wf-purple-200)",
    tint: "color-mix(in srgb, var(--wf-purple-300) 12%, transparent)",
    border: "color-mix(in srgb, var(--wf-purple-300) 18%, transparent)",
    shape: "circle",
    reason: () => "agent-readiness gaps",
  },
  regressions: {
    label: "Regressions",
    color: "var(--wf-red-300)",
    tint: "color-mix(in srgb, var(--wf-red-300) 12%, transparent)",
    border: "color-mix(in srgb, var(--wf-red-300) 18%, transparent)",
    shape: "square",
    reason: (strategy) => `a performance regression on ${strategy}`,
  },
  improvements: {
    label: "Improvements",
    color: "var(--wf-green-300)",
    tint: "color-mix(in srgb, var(--wf-green-300) 12%, transparent)",
    border: "color-mix(in srgb, var(--wf-green-300) 18%, transparent)",
    shape: "circle",
    reason: (strategy) => `a performance improvement on ${strategy}`,
  },
};

function agentSeries(
  history: Night[],
  ignores?: AgentIgnoreSettings,
  defaults?: AgentIgnoreSettings,
  restores?: AgentIgnoreSettings,
): number[] {
  return history.flatMap((night) => {
    const snapshot = agentReadinessForNight(night, ignores, defaults, restores);
    return snapshot?.total ? [snapshot.percent] : [];
  });
}

function isDashboardFilter(value: string | undefined): value is DashboardFilter {
  return value === "all"
    || value === "lowPerformance"
    || value === "agentGaps"
    || value === "regressions"
    || value === "improvements";
}

function DashboardContent({
  view,
  initialFilter,
}: {
  view: "dashboard" | "pages";
  initialFilter?: string;
}) {
  const router = useRouter();
  const {
    pages,
    recs,
    agentIgnoreDefaults,
    externalAgentAudits,
    performanceThresholds,
    collectionSchedule,
    measurementIncident,
    strategy,
    setStrategy,
    rangeDays,
    setRangeDays,
    dashSort,
    sortDash,
    triageRec,
    pathFor,
    visitorExperienceVisible,
    visitorExperience,
  } = useStore();
  const [activeFilter, setActiveFilter] = useState<DashboardFilter>(() => isDashboardFilter(initialFilter) ? initialFilter : "all");
  const tableRef = useRef<HTMLDivElement>(null);
  const thresholds = normalizePerformanceThresholds(performanceThresholds);
  const schedule = normalizeCollectionSchedule(collectionSchedule);
  const activePages = pages.filter(isPageActivelyMonitored);
  const topRibbonRec = recs
    .filter((rec) =>
      rec.status === "inbox"
      && rec.taskStatus !== "done"
      && isFieldRecommendationActionable(rec)
      && recommendationIsCustomerActionable(rec)
      && (!rec.strategies?.length || rec.strategies.includes(strategy)))
    .sort((left, right) => {
      const priority = { available: 0, partial: 1, unknown: 2, blocked: 3 } as const;
      return fieldPriorityRankForRec(right, pages, visitorExperience) - fieldPriorityRankForRec(left, pages, visitorExperience)
        || priority[webflowClassificationFor(left).remediation] - priority[webflowClassificationFor(right).remediation]
        || savingsValue(right) - savingsValue(left);
    })[0] ?? null;
  const topRibbonClassification = topRibbonRec ? webflowClassificationFor(topRibbonRec) : null;
  const topRibbonEvidence = topRibbonRec
    ? recommendationEvidenceSignal(topRibbonRec, pages.find((page) => page.id === topRibbonRec.pageId), visitorExperience)
    : null;
  const isRunning = activePages.some((page) => page.runState && page.runState !== "failed");
  const siteIssues = sitePerformanceIssues(activePages, strategy);
  const siteIssueCounts = performanceIssueCounts(siteIssues);
  const culpritRollups = siteCulpritRollups(activePages, strategy).slice(0, 6);
  const nativeElementRollups = siteNativeElementRollups(activePages);

  const rows = pages.map((p, watchlistOrder) => {
    const pageThresholds = effectivePerformanceThresholds(thresholds, p);
    const mobileTrend = pageRangeTrend(p, "mobile", rangeDays, pageThresholds);
    const desktopTrend = pageRangeTrend(p, "desktop", rangeDays, pageThresholds);
    const visitorEvidence = evidenceForPage(visitorExperience, p.id, strategy);
    const experienceTrend = visitorExperienceTrend(visitorEvidence);
    const labFieldComparison = compareLabAndField(historyForRange(p.history, rangeDays), strategy, visitorEvidence).status;
    const trend = strategy === "mobile" ? mobileTrend : desktopTrend;
    const secondaryStrategy = strategy === "mobile" ? "desktop" : "mobile";
    const rangeAgentSnapshot = pageAgentSnapshotForRange(p, rangeDays);
    const rangeAgentSummary = summarizeAgentChecks(rangeAgentSnapshot?.checks ?? [], p.agentIgnores, agentIgnoreDefaults, p.agentIgnoreRestores);
    const { total, percent: pct } = rangeAgentSummary;
    const readinessSeries = agentSeries(historyForRange(p.history, rangeDays), p.agentIgnores, agentIgnoreDefaults, p.agentIgnoreRestores);
    const latestMobileNight = pageRangeLatestNightForStrategy(p, rangeDays, "mobile");
    const latestDesktopNight = pageRangeLatestNightForStrategy(p, rangeDays, "desktop");
    const latestRangeNight = strategy === "mobile" ? latestMobileNight : latestDesktopNight;
    const latestSecondaryNight = secondaryStrategy === "mobile" ? latestMobileNight : latestDesktopNight;
    const hasSnapshot = !!latestRangeNight;
    const hasBaseline = !!p.baseline && !!p.baselineCapturedAt;
    const isMonitored = isPageActivelyMonitored(p);
    const combinedSignals = combinedDashboardSignals({
      isMonitored,
      mobilePerformance: latestMobileNight?.scores.mobile.perf.m ?? null,
      desktopPerformance: latestDesktopNight?.scores.desktop.perf.m ?? null,
      lowPerformanceThreshold: pageThresholds.lowPerformance,
      mobileTrend,
      desktopTrend,
    });
    const matches = {
      lowPerformance: strategy === "mobile"
        ? combinedSignals.mobileLowPerformance
        : combinedSignals.desktopLowPerformance,
      agentGaps: isMonitored && total > 0 && pct < pageThresholds.agentReadiness,
      regressions: strategy === "mobile"
        ? combinedSignals.mobileRegression
        : combinedSignals.desktopRegression,
      improvements: strategy === "mobile"
        ? combinedSignals.mobileImprovement
        : combinedSignals.desktopImprovement,
    };
    const cats = CATEGORIES.map((c) => {
      if (!hasSnapshot) {
        return { key: c.key, score: null as number | null, fg: C.faint, delta: "", deltaFg: C.faint, series: [] as number[], line: C.faint, secondary: null as number | null, secondaryFg: C.faint, secondaryLabel: strategy === "mobile" ? "D" : "M" };
      }
      const v = latestRangeNight.scores[strategy][c.key].m;
      const sm = scoreMeta(v);
      const series = pageRangeSeries(p, strategy, c.key, rangeDays);
      const secondary = latestSecondaryNight?.scores[secondaryStrategy][c.key].m ?? null;
      const secondaryMeta = secondary === null ? null : scoreMeta(secondary);
      if (!hasBaseline) {
        return { key: c.key, score: v as number | null, fg: sm.fg, delta: "", deltaFg: C.faint, series, line: sm.line, secondary, secondaryFg: secondaryMeta?.fg ?? C.faint, secondaryLabel: secondaryStrategy === "mobile" ? "M" : "D" };
      }
      const comparison = pageRangeComparison(p, strategy, c.key, rangeDays);
      const dm = comparison ? deltaMeta(comparison.to, comparison.from) : null;
      return { key: c.key, score: v as number | null, fg: sm.fg, delta: dm?.text ?? "", deltaFg: dm?.fg ?? C.faint, series, line: sm.line, secondary, secondaryFg: secondaryMeta?.fg ?? C.faint, secondaryLabel: secondaryStrategy === "mobile" ? "M" : "D" };
    });
    // The XSmall ScoreCard row cell draws both devices' hairlines at once (see
    // the density handoff §4), unlike `cats` above which only tracks the
    // selected strategy's series plus the other device's single latest value.
    // Reuses the same adapter as the Details page's Overview tab so both
    // surfaces agree on what's "in range."
    const scoreCardData = CATEGORIES.map((c) => scoreCardDataForCategory(p, c.key, c.label, rangeDays));
    const sortVals: Record<string, string | number> = { title: p.title.toLowerCase(), status: trend, agent: pct };
    CATEGORIES.forEach((c) => (sortVals[c.key] = latestRangeNight?.scores[strategy][c.key].m ?? -1));
    return {
      id: p.id,
      title: p.title,
      url: p.url,
      mobileTrend,
      desktopTrend,
      experienceTrend,
      labFieldComparison,
      monitoringFlag: p.flag,
      watchlistOrder,
      flag: flagChip(p.flag),
      cats,
      scoreCardData,
      // The Page Watch verdict, not a provider score. Provider numbers stay on
      // the page's own Agent-readiness tab.
      agentVerdict: agentAccessSummary(assembleAgentIssueCases({
        checks: rangeAgentSnapshot?.checks ?? [],
        ignores: p.agentIgnores,
        ignoreDefaults: agentIgnoreDefaults,
        ignoreRestores: p.agentIgnoreRestores,
        audit: externalAuditForPage(externalAgentAudits, p.url),
      })).verdict,
      // Legacy pages may only have a latest page-level scan. A single point is
      // shown as a flat sparkline until the next retained collection arrives.
      agentSeries: total ? (readinessSeries.length ? readinessSeries : [pct]) : ([] as number[]),
      combinedLowPerformance: combinedSignals.lowPerformance,
      lowPerformanceByDevice: {
        mobile: combinedSignals.mobileLowPerformance,
        desktop: combinedSignals.desktopLowPerformance,
      },
      combinedRegression: combinedSignals.regressions,
      regressionsByDevice: {
        mobile: combinedSignals.mobileRegression,
        desktop: combinedSignals.desktopRegression,
      },
      combinedImprovement: combinedSignals.improvements,
      improvementsByDevice: {
        mobile: combinedSignals.mobileImprovement,
        desktop: combinedSignals.desktopImprovement,
      },
      matches,
      sortVals,
    };
  });

  const sortedRows = sortDashboardRows(rows, dashSort);
  const slowCounts: Record<DashboardDevice, number> = {
    mobile: sortedRows.filter((row) => row.lowPerformanceByDevice.mobile).length,
    desktop: sortedRows.filter((row) => row.lowPerformanceByDevice.desktop).length,
  };
  const regressionCounts: Record<DashboardDevice, number> = {
    mobile: sortedRows.filter((row) => row.regressionsByDevice.mobile).length,
    desktop: sortedRows.filter((row) => row.regressionsByDevice.desktop).length,
  };
  const improvementCounts: Record<DashboardDevice, number> = {
    mobile: sortedRows.filter((row) => row.improvementsByDevice.mobile).length,
    desktop: sortedRows.filter((row) => row.improvementsByDevice.desktop).length,
  };
  const combinedLowPerformanceCount = sortedRows
    .filter((row) => row.combinedLowPerformance)
    .length;
  const combinedRegressionCount = sortedRows
    .filter((row) => row.combinedRegression)
    .length;
  const combinedImprovementCount = sortedRows
    .filter((row) => row.combinedImprovement)
    .length;

  const filterCounts: Record<DashboardFilter, number> = {
    all: sortedRows.length,
    lowPerformance: slowCounts[strategy],
    agentGaps: sortedRows.filter((row) => row.matches.agentGaps).length,
    regressions: regressionCounts[strategy],
    improvements: improvementCounts[strategy],
  };
  const effectiveFilter: DashboardFilter = activeFilter !== "all" && filterCounts[activeFilter] === 0
    ? "all"
    : activeFilter;
  const filteredRows = effectiveFilter === "all"
    ? sortedRows
    : sortedRows.filter((row) => row.matches[effectiveFilter]);

  function selectFilter(filter: DashboardFilter, scrollToTable = false) {
    if (filter !== "all" && filterCounts[filter] === 0) return;
    if (view === "dashboard") {
      router.push(pathFor(`/pages${filter === "all" ? "" : `?filter=${filter}`}`));
      return;
    }
    setActiveFilter(filter);
    if (scrollToTable) scrollToTableFilters();
  }

  function scrollToTableFilters() {
    requestAnimationFrame(() => {
      const tableTop = tableRef.current?.getBoundingClientRect().top;
      if (tableTop === undefined) return;
      window.scrollTo({
        top: window.scrollY + tableTop - 92,
        behavior: "smooth",
      });
    });
  }

  function selectDeviceFilter(filter: DeviceDashboardFilter, device: DashboardDevice) {
    const counts = filter === "lowPerformance"
      ? slowCounts
      : filter === "regressions"
        ? regressionCounts
        : improvementCounts;
    if (counts[device] === 0) return;
    setStrategy(device);
    if (view === "dashboard") {
      router.push(pathFor(`/pages?filter=${filter}`));
      return;
    }
    setActiveFilter(filter);
    scrollToTableFilters();
  }

  const headers: { col: string; label: string; align: "left" | "center" }[] = [
    { col: "title", label: "Page", align: "left" },
    { col: "status", label: "Change", align: "left" },
    { col: "perf", label: "Performance", align: "center" },
    { col: "a11y", label: "Accessibility", align: "center" },
    { col: "bp", label: "Best practices", align: "center" },
    { col: "seo", label: "SEO", align: "center" },
    { col: "agent", label: "Agent", align: "center" },
  ];

  const conditionFilters: Array<Exclude<DashboardFilter, "all">> = ["lowPerformance", "agentGaps", "regressions", "improvements"];
  const statusFilters: DashboardFilter[] = [
    "all",
    ...conditionFilters.filter((filter) => filterCounts[filter] > 0),
    ...conditionFilters.filter((filter) => filterCounts[filter] === 0),
  ];
  const verdictClauses: VerdictClause[] = [];

  if (combinedRegressionCount > 0) {
    verdictClauses.push({
      kind: "device",
      filter: "regressions",
      desktopCount: regressionCounts.desktop,
      mobileCount: regressionCounts.mobile,
    });
  }
  if (combinedLowPerformanceCount > 0) {
    verdictClauses.push({
      kind: "device",
      filter: "lowPerformance",
      desktopCount: slowCounts.desktop,
      mobileCount: slowCounts.mobile,
    });
  }
  if (filterCounts.agentGaps > 0) {
    verdictClauses.push({
      kind: "filter",
      filter: "agentGaps",
      count: filterCounts.agentGaps,
      suffix: ` ${filterCounts.agentGaps === 1 ? "page has" : "have"} agent-readiness gaps`,
    });
  }
  if (verdictClauses.length === 0 && combinedImprovementCount > 0) {
    verdictClauses.push({
      kind: "device",
      filter: "improvements",
      desktopCount: improvementCounts.desktop,
      mobileCount: improvementCounts.mobile,
    });
  }

  const visibleVerdictClauses = verdictClauses.slice(0, 2);
  const isAllClear = combinedRegressionCount === 0
    && combinedLowPerformanceCount === 0
    && filterCounts.agentGaps === 0
    && combinedImprovementCount === 0;
  const activeFilterMeta = effectiveFilter === "all" ? null : FILTER_META[effectiveFilter];

  return (
    <div className="dashboard-page">
      {view === "dashboard" ? (
        <>
      <section
        className={`watcher-ribbon${topRibbonRec || isRunning ? "" : " watcher-ribbon--muted"}`}
        aria-label="The Watcher recommendation"
        aria-live="polite"
      >
        <span className="watcher-ribbon__icon" aria-hidden="true">
          <Eye size={14} weight="bold" />
        </span>
        <span className="watcher-ribbon__label">The Watcher</span>
        <span className="watcher-ribbon__divider" aria-hidden="true" />
        <p className="watcher-ribbon__message">
          {isRunning ? (
            <>Analyzing <strong>{activePages.length} pages</strong>…</>
          ) : topRibbonRec && topRibbonClassification ? (
            topRibbonRec.source === "crux-field-only" ? (
              <>
                Investigate <strong>{topRibbonRec.pageTitle}</strong> — {topRibbonRec.title} is the clearest next step because exact-URL visitor evidence is outside the good range while Lighthouse did not reproduce or explain it.
              </>
            ) : customerActionabilityFor(topRibbonRec) === "workaround" ? (
              <>
                Work around <strong>{topRibbonRec.pageTitle}</strong> — {topRibbonRec.title} could recover about{" "}
                <strong>{topRibbonRec.savings}</strong> of load time.{topRibbonEvidence?.priority === "corroborated" ? " Visitor evidence corroborates the affected metric." : topRibbonEvidence?.priority === "field-only" ? " Visitor evidence is worse than the controlled test." : ""}
              </>
            ) : (
              <>
                Start with <strong>{topRibbonRec.pageTitle}</strong> — {topRibbonRec.title} can recover about{" "}
                <strong>{topRibbonRec.savings}</strong> of load time.{topRibbonEvidence?.priority === "corroborated" ? " Visitor evidence corroborates the affected metric." : topRibbonEvidence?.priority === "field-only" ? " Visitor evidence is worse than the controlled test." : ""}
              </>
            )
          ) : (
            <>No open recommendations. Next collection window · {schedule.localTime} {schedule.timeZone}</>
          )}
        </p>
        <div className="watcher-ribbon__actions">
          {isRunning ? (
            <span className="watcher-ribbon__running" aria-label="Analysis is running">
              <Circle size={10} weight="fill" />
            </span>
          ) : topRibbonRec ? (
            <>
              {topRibbonEvidence && <FieldEvidenceChip signal={topRibbonEvidence} />}
              <button type="button" className="watcher-ribbon__primary" onClick={() => triageRec(topRibbonRec.key)}>
                {triageActionLabel(topRibbonRec)}
              </button>
            </>
          ) : null}
          <Link className="watcher-ribbon__inbox" href={pathFor("/inbox")}>
            Open Inbox
          </Link>
        </div>
      </section>

      {measurementIncident && (
        <section
          role="status"
          aria-live="polite"
          style={{
            margin: "18px 40px 0",
            padding: "14px 16px",
            borderRadius: 10,
            border: `1px solid ${
              measurementIncident.status === "verified"
                ? "rgba(255,82,99,0.35)"
                : measurementIncident.status === "recovered"
                  ? "rgba(48,201,132,0.32)"
                  : "rgba(255,165,72,0.34)"
            }`,
            background:
              measurementIncident.status === "verified"
                ? "rgba(255,82,99,0.08)"
                : measurementIncident.status === "recovered"
                  ? "rgba(48,201,132,0.08)"
                  : "rgba(255,165,72,0.08)",
            color: C.text,
          }}
        >
          <div style={{ fontSize: 13, fontWeight: 650 }}>
            {measurementIncident.status === "suspected"
              ? measurementIncident.confirmationAttempts
                ? "PSI measurement anomaly persists"
                : "Possible PSI measurement anomaly"
              : measurementIncident.status === "confirming"
                ? "Collecting independent confirmation"
                : measurementIncident.status === "recovered"
                  ? "Performance recovered"
                  : "Sitewide regression verified"}
          </div>
          <div style={{ maxWidth: 900, marginTop: 4, color: C.muted, fontSize: 12, lineHeight: 1.5 }}>
            {measurementIncident.status === "suspected"
              ? measurementIncident.confirmationAttempts
                ? `Independent confirmation showed the same PSI environment pattern across ${measurementIncident.affectedPages} pages. The suspect measurements remain excluded, no action is recommended, and the next scheduled cohort will continue monitoring.`
                : `${measurementIncident.affectedPages} of ${measurementIncident.eligiblePages} pages moved together while the PSI test environment also changed. No action is recommended until the automatic confirmation finishes.`
              : measurementIncident.status === "confirming"
                ? "Page Watch is re-testing the affected cohort with independent, staggered samples. Earlier measurements are excluded from regression statuses while confirmation is running."
                : measurementIncident.status === "recovered"
                  ? "Follow-up measurements returned to the expected range. The earlier movement was treated as temporary PSI test-environment variability; no action is needed."
                  : "Independent follow-up measurements confirmed the synchronized slowdown without the earlier PSI environment anomaly. Review the affected pages and shared site dependencies."}
          </div>
        </section>
      )}

      <header className="dashboard-verdict">
        <h1 className={`dashboard-verdict__headline${isAllClear ? " dashboard-verdict__headline--all-clear" : ""}`}>
          {isAllClear ? (
            <>
              <span className="dashboard-verdict__good">All {activePages.length} pages are healthy.</span>{" "}
              Nothing regressed, nothing is slow, and every page is agent-ready.
            </>
          ) : (
            <>
              {combinedRegressionCount === 0 && (
                <span className="dashboard-verdict__good">Nothing regressed today.</span>
              )}
              {combinedRegressionCount === 0 && visibleVerdictClauses.length > 0 ? " " : ""}
              {visibleVerdictClauses.map((clause, index) => {
                const punctuation = index === visibleVerdictClauses.length - 1 ? "." : "";
                if (clause.kind === "device") {
                  const bothDevices = clause.desktopCount > 0 && clause.mobileCount > 0;
                  const ariaCondition = clause.filter === "lowPerformance"
                    ? "slow"
                    : clause.filter === "regressions"
                      ? "regressing"
                      : "improving";
                  const conditionText = clause.filter === "lowPerformance"
                    ? bothDevices || (clause.desktopCount || clause.mobileCount) !== 1
                      ? " are slow"
                      : " is slow"
                    : clause.filter === "regressions"
                      ? " regressed since yesterday"
                      : " improved";
                  return (
                    <span key={clause.filter}>
                      {index > 0 ? " and " : ""}
                      {clause.desktopCount > 0 && (
                        <button
                          type="button"
                          className={`dashboard-verdict__filter-link dashboard-verdict__filter-link--${clause.filter}`}
                          aria-label={`Show ${clause.desktopCount} ${ariaCondition} desktop ${clause.desktopCount === 1 ? "page" : "pages"}`}
                          onClick={() => selectDeviceFilter(clause.filter, "desktop")}
                        >
                          {clause.desktopCount} desktop {clause.desktopCount === 1 ? "page" : "pages"}
                        </button>
                      )}
                      {bothDevices ? " and " : ""}
                      {clause.mobileCount > 0 && (
                        <button
                          type="button"
                          className={`dashboard-verdict__filter-link dashboard-verdict__filter-link--${clause.filter}`}
                          aria-label={`Show ${clause.mobileCount} ${ariaCondition} mobile ${clause.mobileCount === 1 ? "page" : "pages"}`}
                          onClick={() => selectDeviceFilter(clause.filter, "mobile")}
                        >
                          {clause.mobileCount} mobile {clause.mobileCount === 1 ? "page" : "pages"}
                        </button>
                      )}
                      {conditionText}
                      {punctuation}
                    </span>
                  );
                }

                return (
                  <span key={clause.filter}>
                    {index > 0 ? " and " : ""}
                    <button
                      type="button"
                      className={`dashboard-verdict__filter-link dashboard-verdict__filter-link--${clause.filter}`}
                      onClick={() => selectFilter(clause.filter, true)}
                    >
                      {clause.count}
                    </button>
                    {clause.suffix}
                    {punctuation}
                  </span>
                );
              })}
            </>
          )}
        </h1>
      </header>

      <div className="dashboard-content">
        <section aria-label="Site-wide performance culprits" style={{ marginBottom: 20, background: C.panel, border: `1px solid ${C.border}`, borderRadius: 14, overflow: "hidden" }}>
          <div style={{ display: "flex", alignItems: "flex-start", gap: 18, padding: "17px 20px", borderBottom: `1px solid ${C.border}` }}>
            <div>
              <h2 style={{ margin: 0, fontSize: 15, fontWeight: 650 }}>Site-wide performance culprits</h2>
              <div style={{ marginTop: 4, fontSize: 11.5, color: C.faint }}>
                <span style={{ textTransform: "capitalize" }}>{strategy}</span> · active findings grouped across retained diagnostic history
              </div>
            </div>
            {siteIssues.length > 0 && (
              <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", justifyContent: "flex-end", flexWrap: "wrap", gap: 9 }}>
                {siteIssueCounts.regressed > 0 && <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11, color: C.dim }}><PerformanceIssueStatusBadge status="regressed" /><strong>{siteIssueCounts.regressed}</strong></span>}
                {siteIssueCounts.active > 0 && <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11, color: C.dim }}><PerformanceIssueStatusBadge status="active" /><strong>{siteIssueCounts.active}</strong></span>}
                {siteIssueCounts.verifying > 0 && <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11, color: C.dim }}><PerformanceIssueStatusBadge status="verifying" /><strong>{siteIssueCounts.verifying}</strong></span>}
                {siteIssueCounts.resolved > 0 && <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11, color: C.dim }}><PerformanceIssueStatusBadge status="resolved" /><strong>{siteIssueCounts.resolved}</strong></span>}
              </div>
            )}
          </div>
          {culpritRollups.length === 0 ? (
            <div style={{ padding: "26px 20px", color: C.muted, fontSize: 12.5 }}>
              No currently-present <span style={{ textTransform: "capitalize" }}>{strategy}</span> culprits have enough retained diagnostic evidence yet.
            </div>
          ) : (
            <div className="dashboard-culprit-grid" style={{ background: C.border }}>
              {culpritRollups.map((rollup) => {
                const dominantRemediation = rollup.remediationCounts.blocked > 0
                  ? "blocked"
                  : rollup.remediationCounts.partial > 0
                    ? "partial"
                    : rollup.remediationCounts.available > 0
                      ? "available"
                      : "unknown";
                const tone = remediationTone(dominantRemediation);
                return (
                  <article key={rollup.culprit} style={{ minWidth: 0, padding: "16px 18px", background: C.panel }}>
                    <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: 13.5, fontWeight: 650 }}>{rollup.label}</div>
                        <div style={{ marginTop: 4, fontSize: 11.5, color: C.faint }}>
                          {rollup.pageCount} {rollup.pageCount === 1 ? "page" : "pages"} · {rollup.issueCount} {rollup.issueCount === 1 ? "issue" : "issues"} · as of {rollup.oldestDetection.date}
                        </div>
                      </div>
                      <span style={{ marginLeft: "auto", flex: "none", width: 8, height: 8, marginTop: 4, borderRadius: "50%", background: tone.color }} />
                    </div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 11 }}>
                      {rollup.metrics.filter((metric) => metric.metric !== "other").map((metric) => (
                        <span key={`${metric.metric}:${metric.metricWeight}`} style={{ fontSize: 10.5, fontWeight: 650, color: C.accentSoft, background: "rgba(59,137,255,0.12)", padding: "2px 7px", borderRadius: 5 }}>
                          {metric.metric} · {metric.metricWeight}%
                        </span>
                      ))}
                      {rollup.remediationCounts.partial + rollup.remediationCounts.blocked > 0 && <span style={{ fontSize: 10.5, fontWeight: 650, color: C.amber, background: "rgba(255,154,61,0.13)", padding: "2px 7px", borderRadius: 5 }}>{rollup.remediationCounts.partial + rollup.remediationCounts.blocked} workaround</span>}
                      {rollup.remediationCounts.available > 0 && <span style={{ fontSize: 10.5, fontWeight: 650, color: C.green, background: "rgba(53,208,127,0.13)", padding: "2px 7px", borderRadius: 5 }}>{rollup.remediationCounts.available} actionable</span>}
                      {rollup.regressedCount > 0 && <span style={{ fontSize: 10.5, fontWeight: 650, color: C.redSoft, padding: "2px 2px" }}>{rollup.regressedCount} returned</span>}
                    </div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 12 }}>
                      {rollup.pages.slice(0, 3).map((page) => (
                        <button key={page.id} type="button" onClick={() => router.push(pathFor(`/pages/${page.id}?tab=opportunities`))} style={{ border: `1px solid ${C.border2}`, background: "rgba(255,255,255,0.035)", color: C.dim, fontSize: 10.5, padding: "3px 7px", borderRadius: 5, cursor: "pointer" }}>
                          {page.title} ↗
                        </button>
                      ))}
                      {rollup.pages.length > 3 && <span style={{ alignSelf: "center", fontSize: 10.5, color: C.faint }}>+{rollup.pages.length - 3} more</span>}
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>
        {nativeElementRollups.length > 0 && (
          <section aria-label="Native Webflow element hotspots" style={{ marginBottom: 20, background: C.panel, border: `1px solid ${C.border}`, borderRadius: 14, overflow: "hidden" }}>
            <div style={{ padding: "15px 20px", borderBottom: `1px solid ${C.border}` }}>
              <h2 style={{ margin: 0, fontSize: 14, fontWeight: 650 }}>Native Webflow element hotspots</h2>
              <div style={{ marginTop: 3, fontSize: 11.5, color: C.faint }}>Device-neutral findings from published HTML, grouped across monitored pages.</div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(235px, 1fr))", gap: 1, background: C.border }}>
              {nativeElementRollups.map((rollup) => (
                <article key={rollup.id} style={{ padding: "15px 18px", background: C.panel }}>
                  <div style={{ fontSize: 13.5, fontWeight: 650 }}>{rollup.title}</div>
                  <div style={{ marginTop: 4, fontSize: 11.5, color: C.faint }}>{rollup.instanceCount} {rollup.instanceCount === 1 ? "instance" : "instances"} · {rollup.pageCount} {rollup.pageCount === 1 ? "page" : "pages"}</div>
                  <div style={{ marginTop: 9 }}><WebflowClassificationChips classification={rollup.webflow} /></div>
                  {rollup.acknowledgedCount > 0 && <div style={{ marginTop: 8, fontSize: 10.5, fontWeight: 650, color: C.green }}>{rollup.acknowledgedCount} {rollup.acknowledgedCount === 1 ? "page has" : "pages have"} acknowledged this finding</div>}
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 11 }}>
                    {rollup.pages.slice(0, 3).map((page) => (
                      <button key={page.id} type="button" onClick={() => router.push(pathFor(`/pages/${page.id}?tab=opportunities`))} style={{ border: `1px solid ${C.border2}`, background: "rgba(255,255,255,0.035)", color: C.dim, fontSize: 10.5, padding: "3px 7px", borderRadius: 5, cursor: "pointer" }}>{page.title} ↗</button>
                    ))}
                    {rollup.pages.length > 3 && <span style={{ alignSelf: "center", fontSize: 10.5, color: C.faint }}>+{rollup.pages.length - 3} more</span>}
                  </div>
                </article>
              ))}
            </div>
          </section>
        )}
      </div>
        </>
      ) : (
        <>
          <header className="pages-header">
            <h1>Pages</h1>
            <p>Review current scores, trends, and agent readiness for every watched page.</p>
          </header>
          <div className="dashboard-content">
        <div ref={tableRef} className="dashboard-table-card">
          <div className="dashboard-table-toolbar">
            <div className="dashboard-filter-bar" role="toolbar" aria-label="Page filters">
              <div className="dashboard-filter-bar__status">
                <StatusSegmentedControl
                  ariaLabel="Page status"
                  value={effectiveFilter}
                  loading={isRunning}
                  onChange={(filter) => selectFilter(filter)}
                  options={statusFilters.map((filter) => {
                  const count = filterCounts[filter];
                  const disabled = filter !== "all" && count === 0;
                  const meta = filter === "all" ? null : FILTER_META[filter];
                    return {
                      value: filter,
                      label: filter === "all" ? "All" : meta!.label,
                      count,
                      disabled,
                      showDot: filter !== "all",
                      shape: meta?.shape,
                      tone: meta?.color,
                      selectedBackground: meta?.tint,
                    };
                  })}
                />
              </div>
              <div className="dashboard-filter-bar__view">
                <DeviceSegmentedControl
                  ariaLabel="Page chart device"
                  value={strategy}
                  onChange={setStrategy}
                  options={[
                    { value: "desktop", label: "Desktop", icon: <Desktop size={14} weight="regular" /> },
                    { value: "mobile", label: "Mobile", icon: <DeviceMobile size={14} weight="regular" /> },
                  ]}
                />
                <span className="dashboard-filter-bar__divider" aria-hidden="true" />
                <SelectMenu
                  ariaLabel="Page date range"
                  value={rangeDays}
                  options={RANGE_OPTIONS}
                  onChange={setRangeDays}
                  triggerWidth={160}
                  menuWidth={160}
                />
              </div>
            </div>
            {activeFilterMeta && (
              <div
                className="dashboard-filter-summary"
                style={{ color: activeFilterMeta.color, background: `color-mix(in srgb, ${activeFilterMeta.color} 6%, transparent)`, borderColor: activeFilterMeta.border }}
              >
                <span>
                  Showing <strong>{filteredRows.length}</strong> {filteredRows.length === 1 ? "page" : "pages"} with {activeFilterMeta.reason(strategy)}
                </span>
                <button type="button" onClick={() => selectFilter("all")}>
                  Clear filter <X size={13} weight="bold" aria-hidden="true" />
                </button>
              </div>
            )}
          </div>

          <div style={{ display: "grid", gridTemplateColumns: GRID, alignItems: "center", padding: "14px 24px", borderBottom: `1px solid ${C.border}`, fontSize: 11, fontWeight: 550, letterSpacing: "0.05em", textTransform: "uppercase", color: C.faint, minWidth: 1140 }}>
            {headers.map((h) => (
              <SortHeader key={h.col} label={h.label} align={h.align} active={dashSort.col === h.col} dir={dashSort.dir} onSort={() => sortDash(h.col)} />
            ))}
          </div>
          {filteredRows.map((row) => (
            <div
              key={row.id}
              role="button"
              tabIndex={0}
              aria-label={`Open ${row.title} details`}
              onClick={() => router.push(pathFor(`/pages/${row.id}`))}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  router.push(pathFor(`/pages/${row.id}`));
                }
              }}
              style={{ display: "grid", gridTemplateColumns: GRID, alignItems: "center", padding: "16px 24px", borderBottom: `1px solid ${C.rowBorder}`, cursor: "pointer", minWidth: 1140 }}
            >
              <div style={{ minWidth: 0, paddingRight: 16 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
                  <span style={{ fontSize: 14, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{row.title}</span>
                  <span style={{ flex: "none", fontSize: 10, fontWeight: 550, letterSpacing: "0.03em", textTransform: "uppercase", padding: "2px 7px", borderRadius: 4, color: row.flag.fg, background: row.flag.bg }}>{row.flag.label}</span>
                </div>
                <div style={{ fontSize: 12, color: C.faint, marginTop: 3, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{row.url}</div>
              </div>
              <div>
                <DeviceChangeLabels
                  mobile={row.mobileTrend}
                  desktop={row.desktopTrend}
                  visitorExperience={visitorExperienceVisible ? row.experienceTrend : undefined}
                  labFieldComparison={visitorExperienceVisible ? row.labFieldComparison : undefined}
                />
              </div>
              {row.scoreCardData.map((data) => (
                <div key={data.title} onClick={(event) => event.stopPropagation()} style={{ cursor: "default" }}>
                  <XSmallScoreCard data={data} showTitle={false} />
                </div>
              ))}
              <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                <div
                  aria-label={`Agent readiness history: ${row.agentSeries.length} retained ${row.agentSeries.length === 1 ? "snapshot" : "snapshots"} in this range`}
                  title={row.agentSeries.length === 1 ? "One retained readiness snapshot; trend appears after the next scan." : undefined}
                >
                  <XSmallScoreCard data={{ title: "Agent", desktop: row.agentSeries }} showTitle={false} />
                </div>
                {/* The Page Watch verdict sits under the readiness trend; the
                    trend is a percentage over time, the verdict is a conclusion. */}
                <div style={{ display: "flex", justifyContent: "center" }}>
                  <AgentAccessChip verdict={row.agentVerdict} />
                </div>
              </div>
            </div>
          ))}
        </div>
        <p style={{ fontSize: 11.5, color: C.faint, margin: "15px 2px 0", lineHeight: 1.5 }}>
          {`Change compares the oldest and newest nightly medians inside the selected ${rangeDays}-day range. Both device labels remain visible; charts and large scores follow the ${strategy} selection, with the other device shown beneath. Filter counts can overlap. Agent is derived from recorded per-check history.`}
        </p>
      </div>
        </>
      )}
    </div>
  );
}

export default function DashboardPage() {
  return <DashboardContent view="dashboard" />;
}

export function PagesPageContent({ initialFilter }: { initialFilter?: string }) {
  return <DashboardContent view="pages" initialFilter={initialFilter} />;
}
