"use client";

import { Fragment } from "react";
import { useRouter } from "next/navigation";
import { useStore } from "@/components/store";
import { CATEGORIES } from "@/lib/types";
import type { CategoryKey, Night, RangeDays, WatchPage } from "@/lib/types";
import { agentReadinessHistoryPoints } from "@/lib/agentHistory";
import { normalizePerformanceThresholds } from "@/lib/performanceThresholds";
import { historyForStrategy, nightHasStrategy, pageAgentHistoryForRange, pageAgentSnapshotForRange, pageHistoryForRange, pagePreviousPeriodMedian, pageRecordedHistoryForRange, scoreMetaVars } from "@/lib/scoring";
import { EVIDENCE_SOURCE_LABEL } from "@/lib/vocabulary";
import { caseHref } from "@/lib/paths";
import { TrendArrow } from "@/components/trend-arrow";
import { AgentReadinessChart, HistoryChart, seriesToken, type SeriesToken } from "@/components/charts";
import { SegToggle } from "@/components/bits";
import { isTaskMarker, taskMarkerText } from "@/lib/taskMarkers";
import { VisitorExperiencePanel } from "@/components/visitor-experience";
import { evidenceForPage, formatVisitorMetric, formatVisitorMetricDelta, metricRating, VISITOR_METRICS, visitorSnapshotForNight } from "@/lib/visitorExperience";
import type { VisitorMetricKey } from "@/lib/visitorExperience";
import { collectionLocalDateTime, normalizeCollectionSchedule } from "@/lib/collectionSchedule";
import { AgentAccessPanel } from "@/components/agent-access";
import { assembleAgentIssueCases } from "@/lib/agentIssueCases";
import { agentAccess } from "@/lib/agent-access";
import { agentIssueRecId } from "@/lib/agentIssueTasks";
import { issueCasesFrom } from "@/lib/issue-cases";
import { externalAuditForPage } from "@/lib/externalAgentEvidence";
import { normalizeAgentIgnoreSettings } from "@/lib/agentScoring";

import { Section } from "./page-detail-bits";


/**
 * `formatVisitorMetricDelta` prefixes its own arrow. `<TrendArrow>` is the one
 * trend renderer now, so the baked-in glyph is stripped rather than shown twice.
 */
function measureWithoutArrow(text: string): string {
  return text.replace(/^[\u2191\u2193]\s*/u, "");
}

/**
 * Chart series identity by device (R4) — never a health or trend hue.
 *
 * Reads `seriesToken` in `charts.tsx` rather than restating the pair: the device
 * label beside a chart and the line inside it are the same identity.
 */
function seriesVar(strategy: "mobile" | "desktop"): `var(${SeriesToken})` {
  return `var(${seriesToken(strategy)})`;
}

/* ── Every reading ──────────────────────────────────────────────────────── */

function NoReadingsYet({ page, store }: { page: WatchPage; store: ReturnType<typeof useStore> }) {
  const hasSnapshot = page.history.length > 0;
  const collectionBlocked = page.flag === "paused" || (!!page.runState && page.runState !== "failed");
  return (
    <div
      style={{
        padding: "48px 24px",
        textAlign: "center",
        background: "var(--surface-card)",
        border: "1px solid var(--border-hairline)",
        borderRadius: 11,
      }}
    >
      <div style={{ fontSize: 15, fontWeight: 600 }}>
        {hasSnapshot ? "Snapshot collected — baseline required" : "No collection yet"}
      </div>
      <div
        style={{
          fontSize: 13,
          color: "var(--text-muted)",
          marginTop: 8,
          maxWidth: 460,
          marginInline: "auto",
          lineHeight: 1.55,
        }}
      >
        {page.flag === "paused"
          ? "This page is paused. Change it to Watching or Priority from the Watchlist before collecting a first snapshot or baseline."
          : hasSnapshot
            ? `The latest mobile snapshot is Performance ${page.current.mobile.perf}, Accessibility ${page.current.mobile.a11y}, Best Practices ${page.current.mobile.bp}, and SEO ${page.current.mobile.seo}. Capture an explicit baseline before deltas or a health verdict begin.`
            : "Run now to collect a first snapshot, or capture an explicit baseline to anchor future comparisons. This page also joins the next nightly run automatically."}
      </div>
      {store.canManageProject ? (
        <div style={{ display: "flex", gap: 10, justifyContent: "center", marginTop: 22 }}>
          <button
            disabled={collectionBlocked}
            onClick={() => store.captureBaseline(page.id)}
            style={{
              border: "none",
              background: "var(--action-primary-bg)",
              color: "var(--action-primary-text)",
              fontSize: 12.5,
              fontWeight: 550,
              padding: "9px 16px",
              borderRadius: 8,
              cursor: collectionBlocked ? "not-allowed" : "pointer",
              opacity: collectionBlocked ? 0.65 : 1,
            }}
          >
            {page.flag === "paused"
              ? "Paused"
              : page.runState && page.runState !== "failed"
                ? "Collection in progress…"
                : "Capture baseline"}
          </button>
        </div>
      ) : null}
    </div>
  );
}

export function ReadingsSection({
  page,
  strategy,
  rangeDays,
  chartCat,
  setChartCat,
  store,
  isPending,
}: {
  page: WatchPage;
  strategy: "mobile" | "desktop";
  rangeDays: RangeDays;
  chartCat: CategoryKey;
  setChartCat: (c: CategoryKey) => void;
  store: ReturnType<typeof useStore>;
  isPending: boolean;
}) {
  const router = useRouter();
  const rangeHistory = pageHistoryForRange(page, rangeDays);
  const recordedRangeHistory = pageRecordedHistoryForRange(page, rangeDays);
  const agentRangeHistory = pageAgentHistoryForRange(page, rangeDays);
  const excludedHistory = recordedRangeHistory.filter((night) => night.evidenceStatus === "provider-anomaly");
  // The table is an audit trail, so it shows every recorded collection. The
  // chart and the trend above continue to use trusted history only.
  const runs = [...recordedRangeHistory].reverse().slice(0, 12);
  const collectionSchedule = normalizeCollectionSchedule(store.collectionSchedule);
  const runMetadata = runs.map((night) => {
    const local = night.iso ? collectionLocalDateTime(night.iso, collectionSchedule.timeZone) : null;
    const dateKey = local?.dateKey ?? `legacy:${night.date}`;
    const runLabel = night.cohortId?.startsWith("confirmation:")
      ? "Confirmation"
      : night.cohortId?.startsWith("nightly:")
        ? "Nightly"
        : night.cohortId?.startsWith("manual:")
          ? "Manual"
          : "Collection";
    return {
      night,
      dateKey,
      dateLabel: local?.dateLabel ?? night.date,
      timeLabel: local?.timeLabel ?? null,
      runLabel,
    };
  });
  const displayedRuns = runMetadata.map((run, index) => ({
    ...run,
    startsDateGroup: run.dateKey !== runMetadata[index - 1]?.dateKey,
  }));

  /**
   * Agent access, as one verdict over five readings.
   *
   * It sits in Readings and not in Status because it IS a reading question:
   * the verdict exists to be checked against the five rows underneath it, and
   * separating the two would put a conclusion on one screenful and its evidence
   * on another, which is the arrangement S4 exists to replace.
   *
   * Its failures are still cases and its history is still a chart, exactly as
   * this file's header says. What it adds is the origin-level conclusion that
   * neither of those carries, and the next action links back to the case rather
   * than restating it here.
   */
  const agentSnapshot = pageAgentSnapshotForRange(page, rangeDays);
  const agentChecks = agentSnapshot?.checks ?? [];
  // The scan's own ISO stamp, not its display date. `PageAgentSnapshot.date` is
  // a label like "Jul 16", and a row that parsed one would put a plausible
  // wrong date beside a reading; absent, the row says the date is unknown.
  const agentObservedAt = [...agentRangeHistory].reverse()
    .find((night) => Array.isArray(night.agent))?.agentCapturedAt;
  const ignores = normalizeAgentIgnoreSettings(page.agentIgnores);
  const ignoreDefaults = normalizeAgentIgnoreSettings(store.agentIgnoreDefaults);
  const ignoreRestores = normalizeAgentIgnoreSettings(page.agentIgnoreRestores);
  const latestKitesurf = [...agentRangeHistory].reverse().find((night) => night.kitesurf)?.kitesurf ?? null;
  const agentCases = assembleAgentIssueCases({
    checks: agentChecks,
    ...(agentObservedAt ? { checksObservedAt: agentObservedAt } : {}),
    ignores,
    ignoreDefaults,
    ignoreRestores,
    audit: externalAuditForPage(store.externalAgentAudits, page.url),
    kitesurf: latestKitesurf,
  });
  // The two rows that do not come through the assembler. Each keeps its own
  // date: the table shows when that system last looked, never when the newest
  // of the five did.
  const nativeElementsNight = [...rangeHistory].reverse().find((night) => night.nativeElements);
  const lighthouseNight = [...rangeHistory].reverse().find((night) => night.iso);
  const access = agentAccess({
    cases: agentCases,
    ...(nativeElementsNight?.nativeElements
      ? {
        nativeElements: {
          scan: nativeElementsNight.nativeElements,
          ...(nativeElementsNight.iso ? { observedAt: nativeElementsNight.iso } : {}),
        },
      }
      : {}),
    ...(lighthouseNight?.iso ? { lighthouse: { observedAt: lighthouseNight.iso } } : {}),
    // No `excluded` producer here on purpose: S8 owns exclusions end to end, and
    // a second resolver for the same record would be a second opinion about
    // what a valid reason is. See DECISIONS.md 5 for the remaining seam.
  });
  // Where each family's case lives, keyed on the CAUSE and never on a case id.
  // A case is a group with no identity of its own — the merged case takes the id
  // of whichever member came first, and membership changes whenever evidence
  // does — so the id is used to form the address and nothing else is held by it.
  // Until a finding is tracked there is no case, and no link is offered.
  const hrefByCause = new Map(
    issueCasesFrom({
      recs: store.recs,
      pages: store.pages,
      ...(store.caseDecisions ? { caseDecisions: store.caseDecisions } : {}),
    }).map((item) => [item.cause, caseHref(store.basePath, item.id)] as const),
  );
  const hrefForCase = (key: string) => hrefByCause.get(agentIssueRecId(key));
  const thresholds = normalizePerformanceThresholds(store.performanceThresholds);
  const readinessHistory = agentReadinessHistoryPoints(
    agentRangeHistory,
    page.agentIgnores,
    store.agentIgnoreDefaults,
    page.agentIgnoreRestores,
  );
  const latestReadiness = readinessHistory.at(-1)?.snapshot ?? null;
  const visitorEvidence = evidenceForPage(store.visitorExperience, page.id, strategy);
  const showVisitorColumns = store.visitorExperienceVisible;
  const GRID = showVisitorColumns
    ? "110px minmax(180px, 1fr) repeat(4, 76px) repeat(4, 96px) 90px"
    : "120px 1fr 84px 84px 84px 84px 100px";

  function fallbackReport(d: Night): string {
    if (!nightHasStrategy(d, strategy)) {
      return JSON.stringify({
        note: `No ${strategy} score was measured this time. The other readings were kept.`,
        date: d.date,
        strategy,
        agentChecksRecorded: d.agent?.length ?? 0,
        agentReadiness: d.agentReadiness ?? null,
        kitesurf: d.kitesurf ?? null,
      }, null, 2);
    }
    return JSON.stringify(
      {
        note: "The full reply from the test was not stored for this night, so only the saved scores and their spread are shown.",
        date: d.date,
        strategy,
        samples: d.samples ?? d.sampleSize ?? null,
        scores: {
          performance: { median: d.scores[strategy].perf.m, range: [d.scores[strategy].perf.lo, d.scores[strategy].perf.hi] },
          accessibility: { median: d.scores[strategy].a11y.m, range: [d.scores[strategy].a11y.lo, d.scores[strategy].a11y.hi] },
          "best-practices": { median: d.scores[strategy].bp.m, range: [d.scores[strategy].bp.lo, d.scores[strategy].bp.hi] },
          seo: { median: d.scores[strategy].seo.m, range: [d.scores[strategy].seo.lo, d.scores[strategy].seo.hi] },
        },
        agentChecksRecorded: d.agent?.length ?? 0,
        agentReadiness: d.agentReadiness ?? null,
        kitesurf: d.kitesurf ?? null,
      },
      null,
      2,
    );
  }

  const openReport = async (d: Night) => {
    if (!nightHasStrategy(d, strategy)) return;
    const cats = CATEGORIES.map((c) => {
      const s = d.scores[strategy][c.key];
      return { label: c.label, median: s.m, range: `${s.lo}–${s.hi}`, key: c.key };
    });
    // The stored object for this night, never a fabricated payload. Seed and
    // imported nights have none, so the fallback says what IS stored.
    let raw: string;
    const rawReportKey = d.strategyReportKeys?.[strategy] ?? d.rawReportKey;
    if (rawReportKey) {
      try {
        const res = await fetch(store.pathFor(`/api/pages/${page.id}/report/${encodeURIComponent(rawReportKey)}`));
        raw = res.ok
          ? JSON.stringify(((await res.json()) as { report: unknown }).report, null, 2)
          : fallbackReport(d);
      } catch {
        raw = fallbackReport(d);
      }
    } else {
      raw = fallbackReport(d);
    }
    store.openReport({ date: d.date, url: page.url, raw, cats });
  };

  if (isPending) {
    return (
      <Section id="readings">
        <NoReadingsYet page={page} store={store} />
      </Section>
    );
  }

  return (
    <Section
      id="readings"
      aside={
        <SegToggle
          label="History category"
          value={chartCat}
          onChange={setChartCat}
          options={CATEGORIES.map((c) => ({ value: c.key, label: c.short }))}
        />
      }
    >
      <AgentAccessPanel
        access={access}
        caseHref={hrefForCase}
        consent={{
          on: store.externalAgentAuditEnabled === true,
          history: store.externalAgentAuditConsentHistory ?? [],
        }}
      />
      <div
        style={{
          background: "var(--surface-card)",
          border: "1px solid var(--border-hairline)",
          borderRadius: 11,
          padding: 22,
          marginBottom: 16,
        }}
      >
        <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 18 }}>
          Desktop and Mobile are stacked for comparison. Each line is the middle score of a night&apos;s runs, with the
          spread between those runs around it; the reference lines show that device&apos;s starting point and, once
          there are enough nights, the middle score of the previous {rangeDays} days.
          {excludedHistory.length > 0 && " Shaded bands are readings kept for diagnosis but left out of scores, trends and recommendations."}
        </div>
        {historyForStrategy(rangeHistory, "desktop").length < 2 && historyForStrategy(rangeHistory, "mobile").length < 2 ? (
          <div style={{ padding: "42px 16px", textAlign: "center", color: "var(--text-muted)", fontSize: 13 }}>
            At least two collections inside this range are required to chart change.
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
            {(["desktop", "mobile"] as const).map((device) => (
              <div key={device}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 7 }}>
                  <span style={{ fontSize: 12, fontWeight: 600, textTransform: "capitalize", color: seriesVar(device) }}>
                    {device}
                  </span>
                  <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
                    Latest {page.current[device][chartCat]}
                  </span>
                </div>
                {historyForStrategy(rangeHistory, device).length < 2 ? (
                  <div style={{ padding: "34px 16px", textAlign: "center", color: "var(--text-muted)", fontSize: 12.5 }}>
                    At least two successful {device} collections are required to chart change.
                  </div>
                ) : (
                  <HistoryChart
                    history={rangeHistory}
                    strategy={device}
                    catKey={chartCat}
                    baseline={page.baseline![device][chartCat].m}
                    previousPeriod={pagePreviousPeriodMedian(page, device, chartCat, rangeDays)}
                    markers={page.markers}
                    excludedHistory={excludedHistory}
                  />
                )}
              </div>
            ))}
          </div>
        )}
        {store.visitorExperienceVisible && (
          <VisitorExperiencePanel
            evidence={visitorEvidence}
            labHistory={rangeHistory}
            strategy={strategy}
            compact
          />
        )}
        <div style={{ marginTop: 22, paddingTop: 20, borderTop: "1px solid var(--border-hairline)" }}>
          <div style={{ display: "flex", alignItems: "start", justifyContent: "space-between", gap: 20, marginBottom: 4 }}>
            <div>
              <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-body)" }}>Agent readiness</div>
              <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 4 }}>
                Each point freezes the score and the checks that were set aside when that agent scan completed.
              </div>
            </div>
            {latestReadiness && (
              <div style={{ flex: "0 0 auto", textAlign: "right" }}>
                <div style={{ color: scoreMetaVars(latestReadiness.percent).fg, fontSize: 13, fontWeight: 650 }}>
                  {latestReadiness.percent}%
                </div>
                <div style={{ color: "var(--text-muted)", fontSize: 12, marginTop: 2 }}>
                  {latestReadiness.pass}/{latestReadiness.total}
                </div>
              </div>
            )}
          </div>
          {readinessHistory.length === 0 ? (
            <div style={{ padding: "34px 16px 18px", textAlign: "center", color: "var(--text-muted)", fontSize: 13 }}>
              Readiness history starts with the next successful agent scan in this range.
            </div>
          ) : (
            <>
              <div style={{ display: "flex", gap: 16, alignItems: "center", marginTop: 12, color: "var(--text-muted)", fontSize: 12 }}>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                  <span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--series-marker)" }} />
                  Fixed since prior run
                </span>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                  <span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: "50%", border: "1.5px solid var(--series-marker)" }} />
                  Newly excluded
                </span>
              </div>
              <AgentReadinessChart
                history={agentRangeHistory}
                threshold={thresholds.agentReadiness}
                ignores={page.agentIgnores}
                defaults={store.agentIgnoreDefaults}
                restores={page.agentIgnoreRestores}
              />
              {readinessHistory.length === 1 && (
                <div style={{ color: "var(--text-muted)", fontSize: 12, marginTop: -4 }}>
                  One retained snapshot is shown; direction appears after the next successful scan.
                </div>
              )}
            </>
          )}
        </div>
      </div>

      <div
        className="table-scroll"
        style={{ background: "var(--surface-card)", border: "1px solid var(--border-hairline)", borderRadius: 11 }}
      >
        {/*
          The caption is where every measurement below it is introduced in
          words. The column headings are acronyms because a column is four
          characters wide, and that is only honest if the reader has met the
          words first — so they are met here, once, and the headings are the
          second mention. Nothing below relies on a hover to be understood.
        */}
        <div style={{ padding: "13px 22px", borderBottom: "1px solid var(--border-hairline)", fontSize: 12, color: "var(--text-muted)" }}>
          Every measurement ever taken · <span style={{ color: "var(--text-body)", textTransform: "capitalize", fontWeight: 600 }}>{strategy}</span> first · the middle score of each night&apos;s runs, with the spread beneath it
          {showVisitorColumns && " · then what real visitors met, at the level three quarters of them did better than (p75): when the main content appeared (LCP), how long the page took to answer a tap (INP), how much it jumped about (CLS), and how long the server took to reply (TTFB), each with its change on the week"}
          {excludedHistory.length > 0 && " · rows marked as odd readings were measured and then left out of the scoring"}
          {` · Dates in ${collectionSchedule.timeZone}`}
        </div>
        <div
          className="narrow-table"
          style={{
            display: "grid",
            gridTemplateColumns: GRID,
            minWidth: showVisitorColumns ? 1120 : undefined,
            padding: "14px 22px",
            borderBottom: "1px solid var(--border-hairline)",
            fontSize: 12,
            fontWeight: 550,
            letterSpacing: "0.05em",
            textTransform: "uppercase",
            color: "var(--text-muted)",
          }}
        >
          <div>Night</div>
          <div>Marker</div>
          {/* Four columns, four score names. "A11y" was a numeronym nobody
              outside the trade reads; the others are the score names
              themselves, abbreviated to fit the column. */}
          <div style={{ textAlign: "center" }}>Perf</div>
          <div style={{ textAlign: "center" }}>Access</div>
          <div style={{ textAlign: "center" }}>Practices</div>
          <div style={{ textAlign: "center" }}>SEO</div>
          {showVisitorColumns && VISITOR_METRICS.map((metric) => (
            <div
              key={metric.key}
              title={`${metric.label} · ${metric.technicalName}`}
              style={{ textAlign: "center", borderLeft: metric.key === "lcpP75Ms" ? "1px solid var(--border-hairline)" : undefined }}
            >
              {metric.key === "lcpP75Ms" ? "LCP" : metric.key === "inpP75Ms" ? "INP" : metric.key === "clsP75" ? "CLS" : "TTFB"}
            </div>
          ))}
          <div />
        </div>
        {displayedRuns.map(({ night: d, startsDateGroup, dateLabel, timeLabel, runLabel }) => {
          const markers = page.markers.filter((m) => m.i === d.i);
          const excludedAnomaly = d.evidenceStatus === "provider-anomaly";
          const visitorSnapshot = visitorSnapshotForNight(visitorEvidence?.snapshots ?? [], d);
          const visitorSnapshotIndex = visitorSnapshot
            ? visitorEvidence?.snapshots.indexOf(visitorSnapshot) ?? -1
            : -1;
          const previousVisitorSnapshot = visitorSnapshotIndex > 0
            ? visitorEvidence!.snapshots[visitorSnapshotIndex - 1]
            : null;
          const completedTests = [
            nightHasStrategy(d, "mobile") ? "Mobile" : null,
            nightHasStrategy(d, "desktop") ? "Desktop" : null,
            visitorSnapshot ? "Visitors" : null,
            Array.isArray(d.agent) ? "Agent checks" : null,
            d.kitesurf?.status === "available" ? EVIDENCE_SOURCE_LABEL.kitesurf : null,
          ].filter((label): label is string => label !== null);
          const cell = (k: CategoryKey) => {
            if (!nightHasStrategy(d, strategy)) {
              return (
                <div aria-label={`No ${strategy} score measured`} style={{ textAlign: "center", color: "var(--health-none-text)" }}>
                  —
                </div>
              );
            }
            const score = d.scores[strategy][k];
            const categoryLabel = CATEGORIES.find((category) => category.key === k)?.label ?? k;
            return (
              <div
                aria-label={`${categoryLabel} ${excludedAnomaly ? "observed" : "median"} ${score.m}, range ${score.lo} to ${score.hi}${excludedAnomaly ? ", an odd reading left out of the scoring" : ""}`}
                style={{ textAlign: "center" }}
              >
                <div style={{ fontSize: 14, lineHeight: 1.1, fontWeight: 650, color: scoreMetaVars(score.m).fg }}>{score.m}</div>
                <div style={{ marginTop: 3, fontSize: 12, lineHeight: 1.2, color: "var(--magnitude-unit)" }}>
                  {score.lo}–{score.hi}
                </div>
              </div>
            );
          };
          const visitorCell = (key: VisitorMetricKey) => {
            const value = visitorSnapshot?.[key] ?? null;
            const previous = previousVisitorSnapshot?.[key] ?? null;
            const rating = value === null ? null : metricRating(key, value);
            const movement = formatVisitorMetricDelta(key, previous, value);
            const delta = previous === null || value === null ? null : value - previous;
            const valueColor = rating === "Good"
              ? "var(--health-good-text)"
              : rating === "Needs improvement"
                ? "var(--health-warn-text)"
                : rating === "Poor"
                  ? "var(--health-poor-text)"
                  : "var(--health-none-text)";
            // Every metric here is one where lower is better, so a drop improves.
            const movementTrend = delta === null ? null : delta < 0 ? "improving" : delta > 0 ? "regressing" : "no_change";
            const label = VISITOR_METRICS.find((metric) => metric.key === key)?.label ?? key;
            return (
              <div
                aria-label={`${label} ${formatVisitorMetric(key, value)}, ${movement === "—" ? "no earlier reading to compare" : movement}`}
                title={visitorSnapshot ? `28 days ending ${visitorSnapshot.collectionEnd} · ${rating ?? "Unavailable"}` : "No visitor figures cover this night"}
                style={{ textAlign: "center", borderLeft: key === "lcpP75Ms" ? "1px solid var(--border-hairline)" : undefined }}
              >
                <div style={{ fontSize: 13, lineHeight: 1.1, fontWeight: 650, color: valueColor }}>
                  {formatVisitorMetric(key, value)}
                </div>
                <div style={{ marginTop: 3, display: "flex", justifyContent: "center" }}>
                  {movementTrend === null ? (
                    <span style={{ fontSize: 12, lineHeight: 1.2, color: "var(--text-muted)" }}>{movement}</span>
                  ) : movementTrend === "no_change" ? (
                    <TrendArrow trend="no_change" fontSize={12} labelHidden />
                  ) : (
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                      <TrendArrow trend={movementTrend} fontSize={12} labelHidden />
                      <span style={{ fontSize: 12, lineHeight: 1.2, fontWeight: 650, color: "var(--magnitude-value)" }}>
                        {measureWithoutArrow(movement)}
                      </span>
                    </span>
                  )}
                </div>
              </div>
            );
          };
          return (
            <div
              key={d.i}
              className="narrow-table"
              data-psi-anomaly={excludedAnomaly || undefined}
              style={{
                display: "grid",
                gridTemplateColumns: GRID,
                minWidth: showVisitorColumns ? 1120 : undefined,
                alignItems: "center",
                padding: "12px 22px",
                borderBottom: "1px solid var(--border-hairline)",
                boxShadow: excludedAnomaly ? "inset 3px 0 var(--series-anomaly-edge)" : undefined,
                background: excludedAnomaly ? "var(--series-anomaly-fill)" : undefined,
                fontSize: 13,
              }}
            >
              <div>
                <div
                  aria-label={`${dateLabel}${timeLabel ? ` at ${timeLabel}` : ""}, ${runLabel}`}
                  style={{ fontWeight: 500, color: "var(--text-body)" }}
                >
                  {startsDateGroup ? dateLabel : `↳ ${timeLabel ?? "Additional run"}`}
                </div>
                <div style={{ marginTop: 3, color: "var(--text-muted)", fontSize: 12, lineHeight: 1.3 }}>
                  {startsDateGroup && timeLabel ? `${timeLabel} · ${runLabel}` : runLabel}
                </div>
                <div
                  title={`Measured separately: ${completedTests.join(", ") || "nothing"}`}
                  style={{ marginTop: 4, color: "var(--text-muted)", fontSize: 12, lineHeight: 1.3 }}
                >
                  {completedTests.join(" · ") || "Nothing measured"}
                </div>
              </div>
              <div style={{ fontSize: 12, display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 5 }}>
                {excludedAnomaly && (
                  <span
                    title="Retained for diagnosis; not used in status, trend, or recommendations"
                    style={{ color: "var(--text-muted)", fontWeight: 600 }}
                  >
                    ◆ Odd reading · left out
                  </span>
                )}
                {!excludedAnomaly && markers.length === 0 ? (
                  <span style={{ color: "var(--text-muted)" }}>—</span>
                ) : markers.map((marker) => {
                  const legacyRecKey = isTaskMarker(marker)
                    ? store.recs.find((rec) =>
                      rec.pageId === page.id
                      && (`Acted: ${rec.title}` === marker.text || taskMarkerText(rec.title) === marker.text))?.key
                    : undefined;
                  const recKey = marker.recKey ?? legacyRecKey;
                  if (recKey) {
                    // A marker that came from a case goes back to that case.
                    return (
                      <button
                        key={marker.id}
                        type="button"
                        onClick={() => router.push(caseHref(store.basePath, recKey))}
                        style={{
                          border: 0,
                          padding: 0,
                          background: "transparent",
                          color: "var(--series-marker)",
                          font: "inherit",
                          cursor: "pointer",
                          textAlign: "left",
                        }}
                      >
                        ◆ {marker.text} ↗
                      </button>
                    );
                  }
                  return (
                    <button
                      key={marker.id}
                      type="button"
                      onClick={() => store.editMarker(page.id, marker.id)}
                      title="Edit marker"
                      style={{
                        border: 0,
                        padding: 0,
                        background: "transparent",
                        color: "var(--series-marker)",
                        font: "inherit",
                        cursor: "pointer",
                        textAlign: "left",
                      }}
                    >
                      ◆ {marker.text}
                    </button>
                  );
                })}
              </div>
              {cell("perf")}
              {cell("a11y")}
              {cell("bp")}
              {cell("seo")}
              {showVisitorColumns && VISITOR_METRICS.map((metric) => (
                <div key={metric.key}>{visitorCell(metric.key)}</div>
              ))}
              <div style={{ textAlign: "right" }}>
                <button
                  disabled={!nightHasStrategy(d, strategy)}
                  onClick={() => openReport(d)}
                  style={{
                    border: "1px solid var(--border-strong)",
                    background: "var(--surface-raised)",
                    color: "var(--text-body)",
                    fontSize: 12,
                    fontWeight: 500,
                    padding: "5px 11px",
                    borderRadius: 7,
                    cursor: nightHasStrategy(d, strategy) ? "pointer" : "not-allowed",
                    opacity: nightHasStrategy(d, strategy) ? 1 : 0.45,
                  }}
                >
                  Report
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </Section>
  );
}
