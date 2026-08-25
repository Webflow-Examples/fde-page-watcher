"use client";

/**
 * The Pages route body. Moved here verbatim from the retired route that used to
 * host it, which is now a redirect — `/pages` imported this component across
 * that boundary, so it needed a home that is not itself a route.
 *
 * Its `view` prop still carries the retired variant. Reworking this component
 * is not part of the app-chrome work; leaving the branch in place keeps this a
 * pure move with no behaviour change.
 *
 * The destination now has two views, switched in the header. `DashboardContent`
 * is the All pages one, and it is deliberately untouched below the header it no
 * longer draws: every filter, the device and range selectors, and the sortable
 * matrix are the same table they were. The Changes view lives in
 * `pages-changes.tsx`.
 */

import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Circle, Desktop, DeviceMobile, Eye, X } from "@phosphor-icons/react";
import { lastRunAtOf, useStore } from "@/components/store";
import { SelectMenu } from "@/components/select-menu";
import type { SelectMenuOption } from "@/components/select-menu";
import { DeviceSegmentedControl, StatusSegmentedControl } from "@/components/segmented-control";
import type { SegmentRole } from "@/components/segmented-control";
import { CATEGORIES } from "@/lib/types";
import type { AgentIgnoreSettings, Night, WebflowRemediationLevel } from "@/lib/types";
import { agentReadinessForNight, summarizeAgentChecks } from "@/lib/agentScoring";
import { effectivePerformanceThresholds, normalizePerformanceThresholds } from "@/lib/performanceThresholds";
import { historyForRange, pageAgentSnapshotForRange, pageRangeLatestNightForStrategy, pageRangeTrend } from "@/lib/scoring";
import { flagChip, savingsValue } from "@/lib/ui";
import { DESTINATION_LABEL, DESTINATION_PATH, QUEUE_LABEL } from "@/lib/vocabulary";
import type { Trend } from "@/lib/vocabulary";
import { StatusChip } from "@/components/status-chip";
import { TrendArrow } from "@/components/trend-arrow";
import { Magnitude } from "@/components/magnitude";
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
import type { PerformanceIssueStatus } from "@/lib/performanceIssues";
import { customerActionabilityFor, recommendationIsCustomerActionable, remediationTone, triageActionLabel, webflowClassificationFor } from "@/lib/webflowPerformance";
import { siteNativeElementRollups } from "@/lib/nativeElements";
import { compareLabAndField } from "@/lib/labFieldComparison";
import { fieldPriorityRankForRec, recommendationEvidenceSignal } from "@/lib/fieldPrioritization";
import { isFieldRecommendationActionable } from "@/lib/fieldOnlyRecommendations";
import { PageHeader } from "@/components/page-header";
import { TabStrip } from "@/components/tab-strip";
import { PAGES_VIEWS, pagesViewPath, parsePagesView } from "@/lib/pagesView";
import { PAGES_ALL_PURPOSE, PAGES_VIEW_LABEL, pagesSubtitle } from "@/lib/pages-copy";
import { naturalDate } from "@/lib/ui";
import { PagesChanges, usePageChanges } from "./pages-changes";

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

/**
 * The three treatments a page filter can take, as fixed triples of token
 * names.
 *
 * These used to be one `color` per filter, with the chip ground and border
 * derived from it at runtime by `color-mix(in srgb, ${color} 12%, ...)`. A
 * computed mix can never be a token: it re-derives whatever hue happens to
 * sit in `color`, so a single edit to the text colour silently repainted two
 * other surfaces. Each entry now names its ground and its edge outright.
 *
 * Hue answers "is this good right now?" and nothing else (R1). Low
 * performance and an agent-readiness gap are shortfalls; a regression is the
 * worst reading a page can hold. "Improvements" is a direction, not a
 * verdict, so it takes no hue at all — R2 puts direction in the arrow glyph
 * beside the label instead.
 *
 * These agree by construction with the verdict sentence above the table,
 * whose `.dashboard-verdict__filter-link--*` rules in `globals.css` paint
 * regressions poor, low performance warn, and leave the rest at body ink. The
 * sentence and the chips describe the same pages; they must not disagree.
 */
const FILTER_TONE = {
  warn: {
    text: "var(--health-warn-text)",
    bg: "var(--health-warn-bg)",
    border: "var(--health-warn-border)",
  },
  poor: {
    text: "var(--health-poor-text)",
    bg: "var(--health-poor-bg)",
    border: "var(--health-poor-border)",
  },
  chrome: {
    text: "var(--text-body)",
    bg: "var(--surface-raised)",
    border: "var(--border-hairline)",
  },
} as const;

type FilterToneName = keyof typeof FILTER_TONE;

/**
 * A filter's tone as a segmented-control role. The control owns its own
 * treatment for each role, so this hands over the NAME and nothing else — the
 * two colour props it used to receive no longer exist.
 */
const FILTER_TONE_ROLE: Record<FilterToneName, SegmentRole> = {
  warn: "health-warn",
  poor: "health-poor",
  chrome: "neutral",
};

interface FilterMeta {
  label: string;
  /** A named treatment, never a colour value. */
  tone: FilterToneName;
  /** Shape redundancy for the chip dot, so the filter is not hue-only. */
  shape: "circle" | "triangle" | "square";
  /**
   * Set only on the two directional filters. Rendered as a `<TrendArrow>`,
   * which is the whole signal for "improvements" and a second, independent
   * one alongside the health hue for "regressions".
   */
  trend?: Trend;
  reason: (strategy: DashboardDevice) => string;
}

const FILTER_META: Record<Exclude<DashboardFilter, "all">, FilterMeta> = {
  lowPerformance: {
    label: "Low performance",
    tone: "warn",
    shape: "triangle",
    reason: (strategy) => `low performance on ${strategy}`,
  },
  agentGaps: {
    label: "Agent gaps",
    // Was purple, which R4 reserves for the desktop chart series. A readiness
    // gap below threshold is a shortfall, so it reads as a warn verdict.
    tone: "warn",
    shape: "circle",
    reason: () => "agent-readiness gaps",
  },
  regressions: {
    label: "Regressions",
    tone: "poor",
    shape: "square",
    trend: "regressing",
    reason: (strategy) => `a performance regression on ${strategy}`,
  },
  improvements: {
    label: "Improvements",
    tone: "chrome",
    shape: "circle",
    trend: "improving",
    reason: (strategy) => `a performance improvement on ${strategy}`,
  },
};

/**
 * Reading order for the issue-count row: worst news first. Replaces four
 * copy-pasted spans that differed only in the status they named.
 */
const ISSUE_COUNT_ORDER: readonly PerformanceIssueStatus[] = ["regressed", "active", "verifying", "resolved"];

/**
 * The dominant remediation on a culprit card, as a label. This used to be an
 * unlabelled 8px dot coloured by `remediationTone()` — colour alone cannot
 * carry four distinct states, and "blocked" is the one level the workaround /
 * actionable counts below the card do not spell out.
 *
 * Shorter than `webflowPerformance`'s own `REMEDIATION_LABELS` (which are not
 * exported) because this chip sits in a card header, not in prose.
 */
const REMEDIATION_CHIP_LABEL: Record<WebflowRemediationLevel, string> = {
  blocked: "No direct action",
  partial: "Workaround",
  available: "Action available",
  unknown: "Needs review",
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
  headerless = false,
}: {
  view: "dashboard" | "pages";
  initialFilter?: string;
  /** Set when the route header and its view switch are drawn above this. */
  headerless?: boolean;
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
    const rangeAgentSnapshot = pageAgentSnapshotForRange(p, rangeDays);
    const rangeAgentSummary = summarizeAgentChecks(rangeAgentSnapshot?.checks ?? [], p.agentIgnores, agentIgnoreDefaults, p.agentIgnoreRestores);
    const { total, percent: pct } = rangeAgentSummary;
    const readinessSeries = agentSeries(historyForRange(p.history, rangeDays), p.agentIgnores, agentIgnoreDefaults, p.agentIgnoreRestores);
    const latestMobileNight = pageRangeLatestNightForStrategy(p, rangeDays, "mobile");
    const latestDesktopNight = pageRangeLatestNightForStrategy(p, rangeDays, "desktop");
    const latestRangeNight = strategy === "mobile" ? latestMobileNight : latestDesktopNight;
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
    // The XSmall ScoreCard row cell draws both devices' hairlines at once (see
    // the density handoff §4). It reuses the same adapter as the Details
    // page's Overview tab, so both surfaces agree on what's "in range."
    //
    // A parallel `cats` array used to be built here, carrying a per-category
    // score, delta and series alongside four hand-picked hues. Nothing had
    // rendered it since the row cell replaced the old sparkline column, so it
    // was deleted rather than migrated.
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
  const activeFilterTone = activeFilterMeta ? FILTER_TONE[activeFilterMeta.tone] : null;
  // Text is the token paired with its own ground, so contrast holds in both
  // themes without a second lookup. The two process statuses land on a plain
  // card: nothing is wrong with the site while confirmation is running.
  const incidentSurface = measurementIncident?.status === "verified"
    ? { border: "var(--health-poor-border)", bg: "var(--health-poor-bg)", text: "var(--health-poor-text)", body: "var(--health-poor-text)" }
    : measurementIncident?.status === "recovered"
      ? { border: "var(--health-good-border)", bg: "var(--health-good-bg)", text: "var(--health-good-text)", body: "var(--health-good-text)" }
      : { border: "var(--border-hairline)", bg: "var(--surface-card)", text: "var(--text-body)", body: "var(--text-muted)" };

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
          <Link className="watcher-ribbon__inbox" href={pathFor(`${DESTINATION_PATH.issues}?queue=decide`)}>
            {`Open ${QUEUE_LABEL.decide}`}
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
            border: `1px solid ${incidentSurface.border}`,
            background: incidentSurface.bg,
            color: incidentSurface.text,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
            <span style={{ fontSize: 13, fontWeight: 650 }}>
              {measurementIncident.status === "suspected"
                ? measurementIncident.confirmationAttempts
                  ? "PSI measurement anomaly persists"
                  : "Possible PSI measurement anomaly"
                : measurementIncident.status === "confirming"
                  ? "Collecting independent confirmation"
                  : measurementIncident.status === "recovered"
                    ? "Performance recovered"
                    : "Sitewide regression verified"}
            </span>
            {/* Suspected and confirming are positions in a process, not
                verdicts about the site, so they carry a work-state chip on a
                plain card rather than a health hue. Verified and recovered
                are verdicts and keep theirs. */}
            {measurementIncident.status === "confirming" && <StatusChip state="in_progress" />}
            {measurementIncident.status === "suspected" && <StatusChip state="new" />}
          </div>
          <div style={{ maxWidth: 900, marginTop: 4, color: incidentSurface.body, fontSize: 12, lineHeight: 1.5 }}>
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
        <section aria-label="Site-wide performance culprits" style={{ marginBottom: 20, background: "var(--surface-card)", border: "1px solid var(--border-hairline)", borderRadius: 14, overflow: "hidden" }}>
          <div style={{ display: "flex", alignItems: "flex-start", gap: 18, padding: "17px 20px", borderBottom: "1px solid var(--border-hairline)" }}>
            <div>
              <h2 style={{ margin: 0, fontSize: 15, fontWeight: 650 }}>Site-wide performance culprits</h2>
              <div style={{ marginTop: 4, fontSize: 12, color: "var(--text-muted)" }}>
                <span style={{ textTransform: "capitalize" }}>{strategy}</span> · active findings grouped across retained diagnostic history
              </div>
            </div>
            {siteIssues.length > 0 && (
              <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", justifyContent: "flex-end", flexWrap: "wrap", gap: 9 }}>
                {ISSUE_COUNT_ORDER.map((status) => siteIssueCounts[status] > 0 && (
                  <span key={status} style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                    <PerformanceIssueStatusBadge status={status} />
                    <Magnitude value={siteIssueCounts[status]} fontSize={12} />
                  </span>
                ))}
              </div>
            )}
          </div>
          {culpritRollups.length === 0 ? (
            <div style={{ padding: "26px 20px", color: "var(--text-muted)", fontSize: 12.5 }}>
              No currently-present <span style={{ textTransform: "capitalize" }}>{strategy}</span> culprits have enough retained diagnostic evidence yet.
            </div>
          ) : (
            // `background` is doing hairline duty: the grid has `gap: 1px`, so
            // this paints the gutters, not a surface. It stays a border token.
            <div className="dashboard-culprit-grid" style={{ background: "var(--border-hairline)" }}>
              {culpritRollups.map((rollup) => {
                const dominantRemediation: WebflowRemediationLevel = rollup.remediationCounts.blocked > 0
                  ? "blocked"
                  : rollup.remediationCounts.partial > 0
                    ? "partial"
                    : rollup.remediationCounts.available > 0
                      ? "available"
                      : "unknown";
                // A tone NAME. `remediationTone` no longer returns a colour;
                // resolving it here is what keeps the value in the token layer.
                const tone = remediationTone(dominantRemediation);
                const workaroundCount = rollup.remediationCounts.partial + rollup.remediationCounts.blocked;
                return (
                  <article key={rollup.culprit} style={{ minWidth: 0, padding: "16px 18px", background: "var(--surface-card)" }}>
                    <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: 13.5, fontWeight: 650 }}>{rollup.label}</div>
                        <div style={{ marginTop: 4, fontSize: 12, color: "var(--text-muted)" }}>
                          {rollup.pageCount} {rollup.pageCount === 1 ? "page" : "pages"} · {rollup.issueCount} {rollup.issueCount === 1 ? "issue" : "issues"} · as of {rollup.oldestDetection.date}
                        </div>
                      </div>
                      <span
                        style={{
                          marginLeft: "auto",
                          flex: "none",
                          padding: "1px 8px",
                          borderRadius: 20,
                          fontSize: 12,
                          fontWeight: 600,
                          lineHeight: 1.35,
                          whiteSpace: "nowrap",
                          color: `var(--status-${tone}-text)`,
                          background: `var(--status-${tone}-bg)`,
                        }}
                      >
                        {REMEDIATION_CHIP_LABEL[dominantRemediation]}
                      </span>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 6, marginTop: 11 }}>
                      {rollup.metrics.filter((metric) => metric.metric !== "other").map((metric) => (
                        <span key={`${metric.metric}:${metric.metricWeight}`} style={{ display: "inline-flex", alignItems: "baseline", gap: 5, fontSize: 12, color: "var(--text-muted)", background: "var(--surface-raised)", padding: "2px 7px", borderRadius: 5 }}>
                          {metric.metric} ·
                          {/* The unit sits tight against the numeral so it
                              still reads as a percent sign, not a word. */}
                          <Magnitude value={metric.metricWeight} unit="%" fontSize={12} style={{ gap: 1 }} />
                        </span>
                      ))}
                      {workaroundCount > 0 && (
                        <span style={{ display: "inline-flex", alignItems: "baseline", background: "var(--surface-raised)", padding: "2px 7px", borderRadius: 5 }}>
                          <Magnitude value={workaroundCount} unit="workaround" fontSize={12} />
                        </span>
                      )}
                      {rollup.remediationCounts.available > 0 && (
                        <span style={{ display: "inline-flex", alignItems: "baseline", background: "var(--surface-raised)", padding: "2px 7px", borderRadius: 5 }}>
                          <Magnitude value={rollup.remediationCounts.available} unit="actionable" fontSize={12} />
                        </span>
                      )}
                      {/* "Returned" is a work state, so it wears the chip the
                          rest of the app uses; the count beside it is a plain
                          magnitude. */}
                      {rollup.regressedCount > 0 && (
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                          <StatusChip state="reopened" />
                          <Magnitude value={rollup.regressedCount} fontSize={12} />
                        </span>
                      )}
                    </div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 12 }}>
                      {rollup.pages.slice(0, 3).map((page) => (
                        <button key={page.id} type="button" onClick={() => router.push(pathFor(`/pages/${page.id}`))} style={{ border: "1px solid var(--border-strong)", background: "var(--surface-input)", color: "var(--text-body)", fontSize: 12, padding: "3px 7px", borderRadius: 5, cursor: "pointer" }}>
                          {page.title} ↗
                        </button>
                      ))}
                      {rollup.pages.length > 3 && <span style={{ alignSelf: "center", fontSize: 12, color: "var(--text-muted)" }}>+{rollup.pages.length - 3} more</span>}
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>
        {nativeElementRollups.length > 0 && (
          <section aria-label="Native Webflow element hotspots" style={{ marginBottom: 20, background: "var(--surface-card)", border: "1px solid var(--border-hairline)", borderRadius: 14, overflow: "hidden" }}>
            <div style={{ padding: "15px 20px", borderBottom: "1px solid var(--border-hairline)" }}>
              <h2 style={{ margin: 0, fontSize: 14, fontWeight: 650 }}>Native Webflow element hotspots</h2>
              <div style={{ marginTop: 3, fontSize: 12, color: "var(--text-muted)" }}>Device-neutral findings from published HTML, grouped across monitored pages.</div>
            </div>
            {/* As above: `gap: 1` plus a border-token background is how these
                gutters read as hairlines. */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(235px, 1fr))", gap: 1, background: "var(--border-hairline)" }}>
              {nativeElementRollups.map((rollup) => (
                <article key={rollup.id} style={{ padding: "15px 18px", background: "var(--surface-card)" }}>
                  <div style={{ fontSize: 13.5, fontWeight: 650 }}>{rollup.title}</div>
                  <div style={{ marginTop: 4, fontSize: 12, color: "var(--text-muted)" }}>{rollup.instanceCount} {rollup.instanceCount === 1 ? "instance" : "instances"} · {rollup.pageCount} {rollup.pageCount === 1 ? "page" : "pages"}</div>
                  <div style={{ marginTop: 9 }}><WebflowClassificationChips classification={rollup.webflow} /></div>
                  {/* A count of set-aside findings is a quantity, not a verdict
                      — it was green, which said "good" about a finding that is
                      still open. The word is the registry's: these pages
                      dismissed the finding, they did not resolve it. */}
                  {rollup.dismissedCount > 0 && (
                    <div style={{ display: "flex", alignItems: "baseline", gap: 5, marginTop: 8, fontSize: 12, color: "var(--text-muted)" }}>
                      <Magnitude value={rollup.dismissedCount} fontSize={12} />
                      <span>{rollup.dismissedCount === 1 ? "page has" : "pages have"} dismissed this finding</span>
                    </div>
                  )}
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 11 }}>
                    {rollup.pages.slice(0, 3).map((page) => (
                      <button key={page.id} type="button" onClick={() => router.push(pathFor(`/pages/${page.id}`))} style={{ border: "1px solid var(--border-strong)", background: "var(--surface-input)", color: "var(--text-body)", fontSize: 12, padding: "3px 7px", borderRadius: 5, cursor: "pointer" }}>{page.title} ↗</button>
                    ))}
                    {rollup.pages.length > 3 && <span style={{ alignSelf: "center", fontSize: 12, color: "var(--text-muted)" }}>+{rollup.pages.length - 3} more</span>}
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
          {headerless ? null : (
            <PageHeader
              title={DESTINATION_LABEL.pages}
              purpose={PAGES_ALL_PURPOSE}
            />
          )}
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
                      // A role, never a colour. The control resolves it to its
                      // own tokens; passing `tone`/`selectedBackground` here was
                      // silently dropped once that channel was closed.
                      role: meta ? FILTER_TONE_ROLE[meta.tone] : "neutral",
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
            {activeFilterMeta && activeFilterTone && (
              <div
                className="dashboard-filter-summary"
                // Three named tokens. The ground used to be
                // `color-mix(in srgb, ${color} 6%, transparent)` — derived at
                // runtime from the text colour, so it could never be a token
                // and silently tracked whatever hue `color` held.
                style={{ color: activeFilterTone.text, background: activeFilterTone.bg, borderColor: activeFilterTone.border }}
              >
                <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                  {/* Direction is a glyph, never a hue (R2). It rides
                      alongside the health ground rather than replacing it —
                      both facts are true at once. */}
                  {activeFilterMeta.trend && <TrendArrow trend={activeFilterMeta.trend} labelHidden fontSize={13} />}
                  <span>
                    Showing <strong>{filteredRows.length}</strong> {filteredRows.length === 1 ? "page" : "pages"} with {activeFilterMeta.reason(strategy)}
                  </span>
                </span>
                <button type="button" onClick={() => selectFilter("all")}>
                  Clear filter <X size={13} weight="bold" aria-hidden="true" />
                </button>
              </div>
            )}
          </div>

          <div style={{ display: "grid", gridTemplateColumns: GRID, alignItems: "center", padding: "14px 24px", borderBottom: "1px solid var(--border-hairline)", fontSize: 12, fontWeight: 550, letterSpacing: "0.05em", textTransform: "uppercase", color: "var(--text-muted)", minWidth: 1140 }}>
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
              style={{ display: "grid", gridTemplateColumns: GRID, alignItems: "center", padding: "16px 24px", borderBottom: "1px solid var(--border-hairline)", cursor: "pointer", minWidth: 1140 }}
            >
              <div style={{ minWidth: 0, paddingRight: 16 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
                  <span style={{ fontSize: 14, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{row.title}</span>
                  {/* A watch flag is not one of the seven work states, so it
                      does not go through <StatusChip> — but it is the same
                      kind of thing, so it resolves the same tone tokens.
                      `flagChip` returns the tone NAME; the colour is named
                      once, in globals.css. */}
                  <span style={{ flex: "none", fontSize: 12, fontWeight: 600, letterSpacing: "0.03em", textTransform: "uppercase", padding: "2px 7px", borderRadius: 4, color: `var(--status-${row.flag.tone}-text)`, background: `var(--status-${row.flag.tone}-bg)` }}>{row.flag.label}</span>
                </div>
                <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 3, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{row.url}</div>
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
        <p style={{ fontSize: 12, color: "var(--text-muted)", margin: "15px 2px 0", lineHeight: 1.5 }}>
          {`Change compares the oldest and newest nightly medians inside the selected ${rangeDays}-day range. Both device labels remain visible; charts and large scores follow the ${strategy} selection, with the other device shown beneath. Filter counts can overlap. Agent is derived from recorded per-check history.`}
        </p>
      </div>
        </>
      )}
    </div>
  );
}

/* ── The two views ──────────────────────────────────────────────────────── */

/**
 * The destination shell: one header, one view switch, one of two bodies.
 *
 * Which views exist, which is the default, and how one is addressed all live in
 * `lib/pagesView.ts` — the URL is the contract between this shell and anyone
 * who has ever pasted a link to it, so it is decided in one place and tested
 * there rather than assembled here.
 */
export function PagesPageContent({
  initialFilter,
  initialView,
}: {
  initialFilter?: string;
  initialView?: string;
}) {
  const { pages, pathFor } = useStore();
  const view = parsePagesView(initialView);
  // One derivation, read by the header line and handed to the body, so the
  // sentence and the groups under it cannot disagree.
  const changes = usePageChanges();
  const lastRunAt = lastRunAtOf(pages);

  return (
    <div style={{ minWidth: 0 }}>
      <PageHeader
        title={DESTINATION_LABEL.pages}
        purpose={view === "changes"
          ? pagesSubtitle(
            changes.measuredCount,
            // The last run, in the words a person uses for a date: "today",
            // "yesterday", "4 days ago". A project that has never finished a
            // run says so rather than borrowing a date from somewhere else.
            lastRunAt ? naturalDate(lastRunAt) : "never",
            changes.movedCount,
          )
          : PAGES_ALL_PURPOSE}
        flush
      />

      <TabStrip
        ariaLabel="Pages views"
        tabs={PAGES_VIEWS.map((candidate) => ({
          key: candidate,
          label: PAGES_VIEW_LABEL[candidate],
          href: pathFor(pagesViewPath(candidate, initialFilter)),
          current: candidate === view,
        }))}
      />

      {view === "changes"
        ? <PagesChanges view={changes} />
        : <DashboardContent view="pages" initialFilter={initialFilter} headerless />}
    </div>
  );
}
