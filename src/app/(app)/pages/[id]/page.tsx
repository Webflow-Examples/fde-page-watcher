"use client";

import { useEffect, useState } from "react";
import { useParams, usePathname, useRouter, useSearchParams } from "next/navigation";
import { ArrowUpRightIcon, CircleIcon } from "@phosphor-icons/react";
import { useStore } from "@/components/store";
import { CATEGORIES } from "@/lib/types";
import type { AgentCheck, CategoryKey, CollectionJob, DevicePolicy, Night, PagePerformanceThresholdOverrides, PageStatus, RangeDays, Rec, WatchPage, WebflowRemediationLevel } from "@/lib/types";
import { agentCheckKey, agentIgnoreOverrideMode, isAgentCheckIgnored, isAgentGroupIgnored, normalizeAgentIgnoreSettings, summarizeAgentChecks } from "@/lib/agentScoring";
import { agentReadinessHistoryPoints } from "@/lib/agentHistory";
import { effectivePerformanceThresholds } from "@/lib/performanceThresholds";
import { deltaMeta, historyForStrategy, nightHasStrategy, pageAgentSnapshotForRange, pageHistoryForRange, pagePreviousPeriodMedian, pageRangeComparison, pageRangeLatestNightForStrategy, pageRangeSeries, pageRangeTrend, pageRecordedHistoryForRange, scoreMeta, statusMeta } from "@/lib/scoring";
import { auditsFor } from "@/lib/audits";
import { C, taskLabel } from "@/lib/ui";
import { AgentReadinessChart, HistoryChart, Sparkline } from "@/components/charts";
import { FieldEvidenceChip, FieldRecommendationStatusBadge, PerformanceIssueStatusBadge, SegToggle, WebflowClassificationChips } from "@/components/bits";
import { SelectMenu } from "@/components/select-menu";
import type { SelectMenuOption } from "@/components/select-menu";
import { DesktopIcon, MobileIcon, PlusIcon, RefreshIcon } from "@/components/icons";
import { failedRunDetailMessage, formatSuccessfulRunAt, lastSuccessfulRunAt } from "@/lib/collectionStatus";
import { isTaskMarker, taskMarkerText } from "@/lib/taskMarkers";
import { VisitorExperiencePanel } from "@/components/visitor-experience";
import {
  evidenceForPage,
  formatVisitorMetric,
  formatVisitorMetricDelta,
  metricRating,
  VISITOR_METRICS,
  visitorSnapshotForNight,
} from "@/lib/visitorExperience";
import type { VisitorMetricKey } from "@/lib/visitorExperience";
import { opportunitiesForNight } from "@/lib/diagnostics";
import { formatLabMetric, LAB_METRICS, labMetricRating, labMetricSeries } from "@/lib/labMetrics";
import { remediationTone, triageActionLabel, webflowClassificationFor } from "@/lib/webflowPerformance";
import { performanceIssueCounts, performanceIssuesForPage } from "@/lib/performanceIssues";
import type { PerformanceIssueLifecycle, PerformanceIssueStatus } from "@/lib/performanceIssues";
import { nativeElementDisposition, nativeElementIssuesForPage } from "@/lib/nativeElements";
import type { NativeElementLifecycle } from "@/lib/nativeElements";
import { culpritEvidenceTrends, formatEvidenceValue } from "@/lib/culpritEvidence";
import { recommendationEvidenceSignal } from "@/lib/fieldPrioritization";
import { isFieldRecommendationActionable } from "@/lib/fieldOnlyRecommendations";
import { collectionLocalDateTime, normalizeCollectionSchedule } from "@/lib/collectionSchedule";

const PAGE_RANGE_OPTIONS: ReadonlyArray<SelectMenuOption<RangeDays>> = [
  { value: 3, label: "Last 3 days" },
  { value: 7, label: "Last 7 days" },
  { value: 30, label: "Last 30 days" },
  { value: 90, label: "Last 90 days" },
];

export default function PageDetail() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { id } = useParams<{ id: string }>();
  const store = useStore();
  const { pages, recs, strategy, setStrategy, rangeDays, setRangeDays, chartCat, setChartCat } = store;
  const page = pages.find((p) => p.id === id);

  useEffect(() => {
    setChartCat("perf");
  }, [id, setChartCat]);

  if (!page) {
    return (
      <div style={{ padding: 40 }}>
        <button onClick={() => router.push(store.pathFor("/dashboard"))} style={{ border: "none", background: "none", color: C.muted, cursor: "pointer", fontSize: 13 }}>← Back to dashboard</button>
        <p style={{ color: C.muted, marginTop: 16 }}>Page not found. It may have been removed from the watchlist.</p>
      </div>
    );
  }

  const latestRangeNight = pageRangeLatestNightForStrategy(page, rangeDays, strategy);
  const agentSnapshot = pageAgentSnapshotForRange(page, rangeDays);
  const agentChecks = agentSnapshot?.checks ?? [];
  const agentSummary = summarizeAgentChecks(agentChecks, page.agentIgnores, store.agentIgnoreDefaults, page.agentIgnoreRestores);
  const { pass, fail, total, unavailable: unavailableCount, ignored, percent: apct } = agentSummary;
  const apm = scoreMeta(apct);
  const failList = agentChecks.filter((check) => !isAgentCheckIgnored(check, page.agentIgnores, store.agentIgnoreDefaults, page.agentIgnoreRestores) && !check.unavailable && !check.pass);
  const isPending = !page.baseline || !page.baselineCapturedAt;
  const collectionBlocked = page.flag === "paused" || (!!page.runState && page.runState !== "failed");
  const successfulRunAt = lastSuccessfulRunAt(page);
  const successfulRunLabel = formatSuccessfulRunAt(successfulRunAt);
  const activeJob = store.jobs?.find((job) => job.runId === page.runId);
  const watchedPageHref = /^[a-z][a-z\d+.-]*:\/\//i.test(page.url) ? page.url : `https://${page.url}`;
  const thresholds = effectivePerformanceThresholds(store.performanceThresholds, page);
  const mobileTrend = pageRangeTrend(page, "mobile", rangeDays, thresholds);
  const desktopTrend = pageRangeTrend(page, "desktop", rangeDays, thresholds);
  const isStatusPreview = process.env.NODE_ENV === "development" && searchParams.get("statusPreview") === "compare";
  const displayedMobileTrend = isStatusPreview ? "regressing" : mobileTrend;
  const displayedDesktopTrend = isStatusPreview ? "improving" : desktopTrend;

  const tabs: { key: "overview" | "history" | "audits" | "agent"; label: string }[] = [
    { key: "overview", label: "Overview" },
    { key: "history", label: "History" },
    { key: "audits", label: "Opportunities" },
    { key: "agent", label: "Agent-readiness" },
  ];
  const tabFromUrl = {
    history: "history",
    opportunities: "audits",
    "agent-readiness": "agent",
  }[searchParams.get("tab") ?? ""] as "history" | "audits" | "agent" | undefined;
  const tab = tabFromUrl ?? "overview";
  const navigateToTab = (nextTab: typeof tab) => {
    const nextParams = new URLSearchParams(searchParams.toString());
    const slug = nextTab === "audits" ? "opportunities" : nextTab === "agent" ? "agent-readiness" : nextTab;
    if (nextTab === "overview") nextParams.delete("tab");
    else nextParams.set("tab", slug);
    const query = nextParams.toString();
    router.push(query ? `${pathname}?${query}` : pathname, { scroll: false });
  };

  return (
    <div>
      <header className="page-header detail-page-header" style={{ padding: "22px 40px 0" }}>
        <nav className="detail-breadcrumb" aria-label="Breadcrumb">
          <button type="button" onClick={() => router.push(store.pathFor("/dashboard"))}>Pages</button>
          <span className="detail-breadcrumb__divider" aria-hidden="true">/</span>
          <span aria-current="page">{page.title}</span>
        </nav>
        <div className="detail-hero">
          <div className="detail-title-row">
            <h1 className="detail-page-title">{page.title}</h1>
            {isStatusPreview && <span style={{ padding: "3px 7px", borderRadius: 5, color: C.violetSoft, background: "rgba(138,92,246,0.15)", fontSize: 10, fontWeight: 650, letterSpacing: "0.03em", textTransform: "uppercase" }}>Status preview</span>}
            <a className="detail-page-link" href={watchedPageHref} target="_blank" rel="noreferrer">
              <span>{page.url}</span>
              <ArrowUpRightIcon size={14} weight="regular" aria-hidden="true" />
            </a>
          </div>
          <div className="detail-status-line">
            <DetailDeviceStatus name="Desktop" status={displayedDesktopTrend} />
            <span className="detail-status-divider" aria-hidden="true" />
            <DetailDeviceStatus name="Mobile" status={displayedMobileTrend} />
            <span className="detail-status-divider detail-status-divider--run" aria-hidden="true" />
            <span className="detail-run-copy">
              {successfulRunAt ? `Last successful PSI run · ${successfulRunLabel}` : successfulRunLabel}
            </span>
          </div>
        </div>
        <div className="page-controls" style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 10, paddingBottom: 20 }}>
          <SegToggle label="Primary page device" value={strategy} onChange={setStrategy} options={[{ value: "desktop", label: "Desktop", icon: <DesktopIcon size={13} /> }, { value: "mobile", label: "Mobile", icon: <MobileIcon size={13} /> }]} />
          <SelectMenu
            ariaLabel="Page date range"
            value={rangeDays}
            options={PAGE_RANGE_OPTIONS}
            onChange={setRangeDays}
            triggerWidth={160}
            menuWidth={160}
          />
          <button disabled={collectionBlocked} title={page.flag === "paused" ? "Change this page to Watching or Priority before collecting" : undefined} onClick={() => store.runPage(page.id)} style={{ display: "flex", alignItems: "center", gap: 8, padding: "9px 15px", border: "none", borderRadius: 8, background: C.accent, color: "#fff", fontSize: 12.5, fontWeight: 550, cursor: collectionBlocked ? "not-allowed" : "pointer", opacity: collectionBlocked ? 0.65 : 1, whiteSpace: "nowrap" }}>
            <RefreshIcon size={15} style={{ color: "#fff" }} />
            {page.flag === "paused" ? "Paused" : page.runState === "queued" ? "Queued…" : page.runState === "dispatching" ? "Starting…" : page.runState === "waiting_for_evidence" ? "Waiting for evidence…" : page.runState === "running" ? "Running…" : "Run now"}
          </button>
          <button onClick={() => store.openMarker(page.id)} style={{ display: "flex", alignItems: "center", gap: 8, padding: "9px 15px", border: "none", borderRadius: 8, background: C.green, color: C.bg, fontSize: 12.5, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap" }}>
            <PlusIcon size={15} style={{ color: C.bg }} />
            Marker
          </button>
        </div>
        {!isPending && <div className="detail-tabs" role="tablist" aria-label="Page detail" style={{ display: "flex", gap: 2 }}>
          {tabs.map((t) => (
            <button
              key={t.key}
              id={`page-tab-${t.key}`}
              role="tab"
              aria-selected={tab === t.key}
              aria-controls={`page-panel-${t.key}`}
              tabIndex={tab === t.key ? 0 : -1}
              onClick={() => navigateToTab(t.key)}
              onKeyDown={(event) => {
                if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
                event.preventDefault();
                const index = tabs.findIndex((item) => item.key === t.key);
                const offset = event.key === "ArrowRight" ? 1 : -1;
                const next = tabs[(index + offset + tabs.length) % tabs.length];
                navigateToTab(next.key);
                document.getElementById(`page-tab-${next.key}`)?.focus();
              }}
              style={{ border: "none", background: "none", fontSize: 13.5, fontWeight: 500, padding: "11px 4px", marginRight: 24, cursor: "pointer", color: tab === t.key ? "#FFFFFF" : C.muted, borderBottom: `2px solid ${tab === t.key ? C.accentBright : "transparent"}` }}
            >
              {t.label}
            </button>
          ))}
        </div>}
      </header>

      <div className="detail-content" style={{ padding: "28px 40px 56px" }}>
        {page.flag === "paused" && (
          <div style={{ marginBottom: 18, padding: "12px 15px", borderRadius: 9, border: "1px solid rgba(255,154,61,0.30)", background: "rgba(255,154,61,0.08)", color: C.muted, fontSize: 12.5 }}>
            This page is paused. Its history and baseline are retained, but it will not collect new data until it is changed to Watching or Priority.
          </div>
        )}
        {page.runState && <CollectionStatus page={page} job={activeJob} />}
        {!page.runState && page.lastCollectionStatus === "partial" && (
          <div style={{ marginBottom: 18, padding: "12px 15px", borderRadius: 9, border: "1px solid rgba(255,154,61,0.30)", background: "rgba(255,154,61,0.08)" }}>
            <div style={{ fontSize: 12.5, fontWeight: 600, color: C.amber }}>Partial collection retained</div>
            <div style={{ fontSize: 11.5, color: C.muted, marginTop: 3 }}>
              Every successful device and agent scan remains in history; unavailable tests will be attempted by the next scheduled collection.
            </div>
          </div>
        )}
        {isPending ? (
          <PendingPanel page={page} store={store} />
        ) : (
          <div role="tabpanel" id={`page-panel-${tab}`} aria-labelledby={`page-tab-${tab}`} tabIndex={0}>
            {tab === "overview" && <OverviewTab page={page} latestNight={latestRangeNight} agentChecks={agentChecks} recs={recs} strategy={strategy} rangeDays={rangeDays} apct={apct} apm={apm} pass={pass} total={total} ignored={ignored} failList={failList} store={store} />}
            {tab === "history" && <HistoryTab page={page} strategy={strategy} rangeDays={rangeDays} chartCat={chartCat} setChartCat={setChartCat} store={store} />}
            {tab === "audits" && <OpportunitiesTab page={page} latest={latestRangeNight} strategy={strategy} />}
            {tab === "agent" && <AgentTab page={page} checks={agentChecks} date={agentSnapshot?.date ?? null} rangeDays={rangeDays} pass={pass} fail={fail} ignored={ignored} unavailable={unavailableCount} store={store} />}
          </div>
        )}
      </div>
    </div>
  );
}

function DetailDeviceStatus({ name, status }: { name: "Desktop" | "Mobile"; status: PageStatus }) {
  const meta = statusMeta(status);
  return (
    <span
      className="detail-device-status"
      aria-label={`${name} Performance change: ${meta.label}`}
      title={`${name} Performance change: ${meta.label}`}
    >
      <CircleIcon className="detail-status-dot" size={7} weight="fill" style={{ color: status === "stable" ? C.accent : meta.fg }} aria-hidden="true" />
      <span className="detail-device-name">{name}</span>
      <strong className="detail-device-value">{meta.label.toLowerCase()}</strong>
    </span>
  );
}

function LabMetricsPanel({
  page,
  latestNight,
  strategy,
  rangeDays,
}: {
  page: WatchPage;
  latestNight: Night | null;
  strategy: "mobile" | "desktop";
  rangeDays: RangeDays;
}) {
  const context = latestNight?.measurementContext?.[strategy];
  const history = pageHistoryForRange(page, rangeDays);
  const hasMetrics = LAB_METRICS.some((metric) => typeof context?.[metric.key] === "number");
  const tone = (rating: ReturnType<typeof labMetricRating>) =>
    rating === "Good" ? C.green : rating === "Needs improvement" ? C.amber : C.redSoft;

  return (
    <section style={{ background: C.panel, border: `1px solid ${C.border}`, borderRadius: 13, padding: 22, marginBottom: 20 }} aria-labelledby="lab-metrics-heading">
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 20 }}>
        <div>
          <h3 id="lab-metrics-heading" style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>Performance sub-metrics</h3>
          <div style={{ fontSize: 11.5, color: C.faint, marginTop: 4 }}>Lighthouse lab medians · <span style={{ textTransform: "capitalize" }}>{strategy}</span> · last {rangeDays} days</div>
        </div>
        {context?.lighthouseVersion && <span style={{ fontSize: 10.5, color: C.faint }}>Lighthouse {context.lighthouseVersion}</span>}
      </div>
      {!hasMetrics ? (
        <div style={{ padding: "28px 12px 10px", textAlign: "center", color: C.muted, fontSize: 12.5 }}>
          Sub-metric history starts with the next successful collection.
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12, marginTop: 16 }}>
          {LAB_METRICS.map((metric) => {
            const value = context?.[metric.key];
            const rating = typeof value === "number" ? labMetricRating(metric.key, value) : null;
            const series = labMetricSeries(history, strategy, metric.key);
            return (
              <div key={metric.key} style={{ minWidth: 0, padding: "13px 14px", borderRadius: 10, border: `1px solid ${C.border2}`, background: C.panel2 }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                  <span style={{ fontSize: 12.5, fontWeight: 600 }}>{metric.label}</span>
                  <span style={{ fontSize: 10, color: C.faint }}>{metric.short}</span>
                </div>
                <div style={{ marginTop: 11 }}>
                  <span style={{ display: "block", fontSize: 22, fontWeight: 600, color: rating ? tone(rating) : C.muted, whiteSpace: "nowrap" }}>{formatLabMetric(metric.key, value)}</span>
                  <span style={{ display: "block", minHeight: 14, marginTop: 4, fontSize: 9.5, color: rating ? tone(rating) : C.faint }}>{rating ?? "No data"}</span>
                </div>
                <div style={{ height: 30, marginTop: 8 }}>
                  {series.length > 0 && <Sparkline series={series} color={rating ? tone(rating) : C.muted} w={150} h={30} />}
                </div>
              </div>
            );
          })}
        </div>
      )}
      <div style={{ marginTop: 12, color: C.faint, fontSize: 10.5 }}>Lower values are better. These controlled lab measurements are separate from Chrome visitor evidence.</div>
    </section>
  );
}

function CollectionStatus({ page, job }: { page: WatchPage; job?: CollectionJob }) {
  const failed = page.runState === "failed";
  const retained = job?.completedStrategies ?? [];
  const retainedTests = [
    ...retained.map((strategy) => `${strategy[0].toUpperCase()}${strategy.slice(1)} PSI`),
    ...(job?.cruxCompletedAt ? ["CrUX"] : []),
    ...(job?.agentCompletedAt ? ["Agent readiness"] : []),
  ];
  const retryingTests = [
    ...(["mobile", "desktop"] as const)
      .filter((strategy) => !retained.includes(strategy))
      .map((strategy) => `${strategy[0].toUpperCase()}${strategy.slice(1)} PSI`),
    ...(!job?.cruxCompletedAt ? ["CrUX"] : []),
    ...(!job?.agentCompletedAt ? ["Agent readiness"] : []),
  ];
  const waitDetail = retainedTests.length > 0
    ? `${retainedTests.join(" and ")} retained. `
      + `Retrying ${retryingTests.join(" and ")}`
      + `${job?.nextRetryAt ? ` around ${formatSuccessfulRunAt(job.nextRetryAt)}` : " in the next evidence cycle"}.`
    : `No independent test has completed yet. Retrying Mobile PSI, Desktop PSI, CrUX, and Agent readiness`
      + `${job?.nextRetryAt ? ` around ${formatSuccessfulRunAt(job.nextRetryAt)}` : " in the next evidence cycle"}.`;
  const providerDetail = (["mobile", "desktop"] as const).flatMap((strategy) => {
    const error = job?.strategyErrors?.[strategy];
    return error ? [`${strategy[0].toUpperCase()}${strategy.slice(1)}: ${error}`] : [];
  }).join(" · ");
  const latestDetail = [providerDetail, job?.cruxError ? `CrUX: ${job.cruxError}` : "", job?.agentError ? `Agent: ${job.agentError}` : ""]
    .filter(Boolean)
    .join(" · ");
  const title = page.runState === "queued"
    ? "Collection queued"
    : page.runState === "dispatching"
      ? "Starting durable collector"
      : page.runState === "waiting_for_evidence"
        ? "Waiting for independent test evidence"
        : page.runState === "running"
          ? "Collecting four independent tests"
          : "Last collection failed";
  return (
    <div style={{ marginBottom: 18, padding: "12px 15px", borderRadius: 9, border: `1px solid ${failed ? "rgba(255,92,108,0.35)" : "rgba(59,137,255,0.35)"}`, background: failed ? "rgba(255,92,108,0.09)" : "rgba(59,137,255,0.09)" }}>
      <div style={{ fontSize: 12.5, fontWeight: 600, color: failed ? C.redSoft : C.accentSoft }}>{title}</div>
      <div style={{ fontSize: 11.5, color: C.muted, marginTop: 3 }}>
        {failed
          ? failedRunDetailMessage(page.lastError)
          : page.runState === "waiting_for_evidence"
            ? waitDetail
            : "This state is persisted, so it is safe to refresh or leave the app while the job runs."}
      </div>
      {!failed && latestDetail && (
        <div style={{ fontSize: 11, color: C.faint, marginTop: 5 }}>Latest collection response · {latestDetail}</div>
      )}
    </div>
  );
}

function OverviewTab({
  page,
  latestNight,
  agentChecks,
  recs,
  strategy,
  rangeDays,
  apct,
  apm,
  pass,
  total,
  ignored,
  failList,
  store,
}: {
  page: WatchPage;
  latestNight: Night | null;
  agentChecks: AgentCheck[];
  recs: Rec[];
  strategy: "mobile" | "desktop";
  rangeDays: RangeDays;
  apct: number;
  apm: { fg: string; ring: string };
  pass: number;
  total: number;
  ignored: number;
  failList: { name: string }[];
  store: ReturnType<typeof useStore>;
}) {
  const pageRecs = recs.filter((r) =>
    r.pageId === page.id && (!r.strategies?.length || r.strategies.includes(strategy)));
  const secondaryStrategy = strategy === "mobile" ? "desktop" : "mobile";
  const secondaryNight = pageRangeLatestNightForStrategy(page, rangeDays, secondaryStrategy);
  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 16, marginBottom: 20 }}>
        {CATEGORIES.map((c) => {
          const v = latestNight?.scores[strategy][c.key].m ?? null;
          const secondary = secondaryNight?.scores[secondaryStrategy][c.key].m ?? null;
          const baseline = page.baseline![strategy][c.key].m;
          const secondaryBaseline = page.baseline![secondaryStrategy][c.key].m;
          const sm = v === null ? null : scoreMeta(v);
          const secondaryMeta = secondary === null ? null : scoreMeta(secondary);
          const comparison = pageRangeComparison(page, strategy, c.key, rangeDays);
          const dm = comparison ? deltaMeta(comparison.to, comparison.from) : null;
          return (
            <div key={c.key} style={{ background: C.panel, border: `1px solid ${C.border}`, borderRadius: 13, padding: "18px 14px 8px" }}>
              <div style={{ fontSize: 13, color: C.text, fontWeight: 600, marginBottom: 10 }}>{c.label}</div>
              <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) auto", alignItems: "end", gap: 8 }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 10, color: C.faint, textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 5 }}>{strategy}</div>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={{ fontSize: 32, fontWeight: 600, lineHeight: 1, color: sm?.fg ?? C.faint }}>{v ?? "—"}</span>
                    {dm && <span style={{ display: "inline-flex", alignItems: "center", gap: 3, flex: "none", whiteSpace: "nowrap", fontSize: 12, fontWeight: 600, padding: "3px 6px", borderRadius: 6, color: dm.fg, background: dm.chip }}>{dm.text}</span>}
                  </div>
                </div>
                <div style={{ minWidth: 0, textAlign: "right", paddingBottom: 1 }}>
                  <div style={{ fontSize: 10, color: C.faint, textTransform: "uppercase", letterSpacing: "0.04em" }}>{secondaryStrategy}</div>
                  <div style={{ fontSize: 18, fontWeight: 600, color: secondaryMeta?.fg ?? C.faint, marginTop: 3 }}>{secondary ?? "—"}</div>
                </div>
              </div>
              <div style={{ fontSize: 11, color: C.faint, marginTop: 8 }}>Baseline {strategy === "mobile" ? "M" : "D"} {baseline} · {secondaryStrategy === "mobile" ? "M" : "D"} {secondaryBaseline}</div>
              <div style={{ height: 52, marginTop: 6 }}>
                <Sparkline
                  series={pageRangeSeries(page, strategy, c.key, rangeDays)}
                  color={sm?.line ?? C.faint}
                  h={52}
                  sw={2}
                  w={200}
                />
              </div>
            </div>
          );
        })}
      </div>

      <LabMetricsPanel page={page} latestNight={latestNight} strategy={strategy} rangeDays={rangeDays} />

      <PageCalibrationPanel key={`${page.id}:${JSON.stringify(page.performanceThresholdOverrides ?? {})}`} page={page} store={store} />

      {store.visitorExperienceVisible && (
        <div style={{ background: C.panel, border: `1px solid ${C.border}`, borderRadius: 13, padding: 22, marginBottom: 20 }}>
          <VisitorExperiencePanel
            evidence={evidenceForPage(store.visitorExperience, page.id, strategy)}
            labHistory={pageHistoryForRange(page, rangeDays)}
            strategy={strategy}
          />
        </div>
      )}

      <div style={{ background: C.panel, border: `1px solid ${C.border}`, borderRadius: 13, padding: 22, marginBottom: 20, display: "flex", alignItems: "center", gap: 28 }}>
        <div style={{ flex: "none", display: "flex", alignItems: "center", gap: 16 }}>
          <div style={{ width: 64, height: 64, borderRadius: "50%", border: `4px solid ${total ? apm.ring : C.border2}`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, fontWeight: 600, color: total ? apm.fg : C.muted }}>
            {total ? `${apct}%` : "—"}
          </div>
          <div style={{ lineHeight: 1.45 }}>
            <div style={{ fontSize: 15, fontWeight: 600 }}>Agent-readiness</div>
            <div style={{ fontSize: 12.5, color: C.muted }}>
              {total
                ? `${pass} of ${total} applicable checks passing · ${ignored} ignored`
                : agentChecks.length
                  ? `No applicable checks · ${ignored} ignored`
                  : "No scan in this range"}
            </div>
            <div style={{ fontSize: 11.5, color: C.faint, marginTop: 2 }}>Pass rate, computed live from per-check results — not a composite score</div>
          </div>
        </div>
        <div style={{ flex: 1, minWidth: 0, borderLeft: `1px solid ${C.border}`, paddingLeft: 26 }}>
          {failList.length === 0 ? (
            <div style={{ fontSize: 13, color: total ? C.green : C.muted, fontWeight: 500 }}>
              {total ? "All applicable checks passing." : agentChecks.length ? "No applicable checks are currently scored." : "No agent-readiness scan was recorded in this range."}
            </div>
          ) : (
            <div>
              <div style={{ fontSize: 11, fontWeight: 550, letterSpacing: "0.05em", textTransform: "uppercase", color: C.faint, marginBottom: 11 }}>Failing checks</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                {failList.map((f) => (
                  <span key={f.name} style={{ display: "inline-flex", alignItems: "center", gap: 7, fontSize: 12.5, color: C.redSoft, background: "rgba(255,92,108,0.13)", padding: "5px 11px", borderRadius: 7 }}>
                    <span style={{ flex: "0 0 15px", width: 15, height: 15, aspectRatio: "1 / 1", borderRadius: 4, background: C.red, color: C.bg, fontSize: 9, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center" }}>✕</span>
                    {f.name}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      <div style={{ background: C.panel, border: `1px solid ${C.border}`, borderRadius: 13, overflow: "hidden" }}>
        <div style={{ padding: "18px 22px", borderBottom: `1px solid ${C.border}`, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <h3 style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>Recommendations for this page</h3>
          <span style={{ fontSize: 12, color: C.faint }}>Measured impact or signal</span>
        </div>
        {pageRecs.map((r) => {
          const fieldActionable = isFieldRecommendationActionable(r);
          return (
          <div key={r.key} style={{ display: "flex", alignItems: "center", gap: 16, padding: "15px 22px", borderBottom: `1px solid ${C.rowBorder}` }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13.5, fontWeight: 500 }}>{r.title}</div>
              <div style={{ display: "flex", alignItems: "center", gap: 7, marginTop: 2 }}>
                <span style={{ fontSize: 12, color: C.faint }}>{r.category}</span>
                {r.strategies?.map((device) => (
                  <span key={device} style={{ fontSize: 9.5, color: C.accentSoft, textTransform: "capitalize" }}>{device}</span>
                ))}
              </div>
              <div style={{ marginTop: 7 }}>
                <WebflowClassificationChips classification={webflowClassificationFor(r)} />
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 6 }}>
                <FieldEvidenceChip signal={recommendationEvidenceSignal(r, page, store.visitorExperience)} />
                <FieldRecommendationStatusBadge rec={r} />
              </div>
              {r.aiSummary && <div style={{ fontSize: 12, color: C.muted, marginTop: 6, lineHeight: 1.45 }}>{r.aiSummary}</div>}
            </div>
            <div style={{ fontSize: 13, fontWeight: 600, color: C.amber, whiteSpace: "nowrap" }}>{r.savings}</div>
            {r.status === "inbox" && fieldActionable ? (
              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={() => store.triageRec(r.key)} style={{ border: "none", background: C.accent, color: "#fff", fontSize: 12, fontWeight: 550, padding: "7px 12px", borderRadius: 7, cursor: "pointer", whiteSpace: "nowrap" }}>{triageActionLabel(r)}</button>
                <button onClick={() => store.ignoreRec(r.key)} style={{ border: `1px solid ${C.border2}`, background: "rgba(255,255,255,0.03)", color: C.dim, fontSize: 12, fontWeight: 500, padding: "7px 12px", borderRadius: 7, cursor: "pointer", whiteSpace: "nowrap" }}>Ignore</button>
              </div>
            ) : (
              <span
                style={{
                  fontSize: 12,
                  fontWeight: 550,
                  padding: "6px 12px",
                  borderRadius: 7,
                  whiteSpace: "nowrap",
                  color: r.status === "task" ? C.accentSoft : C.muted,
                  background: r.status === "task" ? "rgba(59,137,255,0.14)" : "rgba(255,255,255,0.06)",
                }}
              >
                {r.status === "task" ? `In tasks · ${taskLabel(r.taskStatus)}` : r.status === "ignored" ? "Ignored" : "Monitoring lifecycle"}
              </span>
            )}
          </div>
          );
        })}
      </div>
    </div>
  );
}

const PAGE_CALIBRATION_FIELDS = [
  { key: "regression", label: "Regression", suffix: "points", min: 1, max: 50 },
  { key: "confirmationRuns", label: "Confirm after", suffix: "scans", min: 1, max: 5 },
  { key: "regressionFloor", label: "Score floor", suffix: "/ 100", min: 1, max: 100 },
  { key: "minimumFindingRuns", label: "Finding evidence", suffix: "runs", min: 1, max: 5 },
  { key: "minimumSavingsMs", label: "Minimum time saving", suffix: "ms", min: 0, max: 5000 },
  { key: "minimumSavingsKilobytes", label: "Minimum transfer saving", suffix: "KB", min: 0, max: 5000 },
] as const;

type PageCalibrationNumericKey = typeof PAGE_CALIBRATION_FIELDS[number]["key"];

function PageCalibrationPanel({ page, store }: { page: WatchPage; store: ReturnType<typeof useStore> }) {
  const team = effectivePerformanceThresholds(store.performanceThresholds);
  const saved = page.performanceThresholdOverrides ?? {};
  const [custom, setCustom] = useState(Object.keys(saved).length > 0);
  const [draft, setDraft] = useState<Record<PageCalibrationNumericKey, string>>(() =>
    Object.fromEntries(PAGE_CALIBRATION_FIELDS.map(({ key }) => [key, String(saved[key] ?? team[key])])) as Record<PageCalibrationNumericKey, string>);
  const [devicePolicy, setDevicePolicy] = useState<DevicePolicy>(saved.devicePolicy ?? team.devicePolicy);

  const valid = PAGE_CALIBRATION_FIELDS.every(({ key, min, max }) => {
    const value = Number(draft[key]);
    return Number.isInteger(value) && value >= min && value <= max;
  });
  const save = () => {
    if (!valid) return;
    const overrides = Object.fromEntries(PAGE_CALIBRATION_FIELDS.map(({ key }) => [key, Number(draft[key])])) as PagePerformanceThresholdOverrides;
    overrides.devicePolicy = devicePolicy;
    store.updatePagePerformanceThresholds(page.id, overrides);
  };
  const reset = () => {
    setCustom(false);
    setDraft(Object.fromEntries(PAGE_CALIBRATION_FIELDS.map(({ key }) => [key, String(team[key])])) as Record<PageCalibrationNumericKey, string>);
    setDevicePolicy(team.devicePolicy);
    store.updatePagePerformanceThresholds(page.id, {});
  };

  return (
    <section aria-labelledby="page-calibration-heading" style={{ background: C.panel, border: `1px solid ${C.border}`, borderRadius: 13, padding: 22, marginBottom: 20 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 20 }}>
        <div>
          <h3 id="page-calibration-heading" style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>Page alert calibration</h3>
          <div style={{ marginTop: 4, color: C.faint, fontSize: 11.5, lineHeight: 1.5 }}>
            Tune noisy or business-critical pages without changing the team defaults. Evidence gates apply only to new Inbox findings.
          </div>
        </div>
        <SegToggle
          label="Page calibration source"
          value={custom ? "custom" : "team"}
          onChange={(value) => value === "team" ? reset() : setCustom(true)}
          options={[{ value: "team", label: "Team defaults" }, { value: "custom", label: "Custom" }]}
        />
      </div>
      {!custom ? (
        <div style={{ marginTop: 16, padding: "12px 14px", borderRadius: 8, background: C.bgElev, color: C.muted, fontSize: 12 }}>
          Inheriting {team.regression}-point regression · {team.confirmationRuns} confirmation scan{team.confirmationRuns === 1 ? "" : "s"} · {team.devicePolicy} device policy · {team.minimumFindingRuns} finding run{team.minimumFindingRuns === 1 ? "" : "s"}.
        </div>
      ) : (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 10, marginTop: 16 }}>
            {PAGE_CALIBRATION_FIELDS.map(({ key, label, suffix, min, max }) => (
              <label key={key} style={{ display: "grid", gap: 6, padding: 12, borderRadius: 8, background: C.bgElev, color: C.muted, fontSize: 11 }}>
                {label}
                <span style={{ display: "flex", alignItems: "center", gap: 7 }}>
                  <input
                    aria-label={label}
                    type="number"
                    min={min}
                    max={max}
                    value={draft[key]}
                    onChange={(event) => setDraft((current) => ({ ...current, [key]: event.target.value }))}
                    style={{ width: 80, border: `1px solid ${C.border2}`, borderRadius: 6, background: C.panel, color: C.text, padding: "7px 8px", fontSize: 12 }}
                  />
                  <span style={{ color: C.faint }}>{suffix}</span>
                </span>
              </label>
            ))}
            <div style={{ padding: 12, borderRadius: 8, background: C.bgElev }}>
              <div style={{ color: C.muted, fontSize: 11, marginBottom: 8 }}>Device policy</div>
              <SegToggle label="Page device policy" value={devicePolicy} onChange={setDevicePolicy} options={[{ value: "either", label: "Either" }, { value: "both", label: "Both" }, { value: "preferred", label: "Default" }]} />
            </div>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, marginTop: 12 }}>
            <span style={{ color: valid ? C.faint : C.redSoft, fontSize: 11.5 }}>{valid ? "Overrides affect this page's status, alerts, and future findings." : "One or more values are outside the supported range."}</span>
            <button type="button" disabled={!valid} onClick={save} style={{ border: "none", borderRadius: 7, background: C.accent, color: "#fff", padding: "8px 12px", fontSize: 12, fontWeight: 600, cursor: valid ? "pointer" : "not-allowed", opacity: valid ? 1 : 0.55 }}>Save calibration</button>
          </div>
        </>
      )}
    </section>
  );
}

function HistoryTab({
  page,
  strategy,
  rangeDays,
  chartCat,
  setChartCat,
  store,
}: {
  page: WatchPage;
  strategy: "mobile" | "desktop";
  rangeDays: RangeDays;
  chartCat: CategoryKey;
  setChartCat: (c: CategoryKey) => void;
  store: ReturnType<typeof useStore>;
}) {
  const router = useRouter();
  const rangeHistory = pageHistoryForRange(page, rangeDays);
  const recordedRangeHistory = pageRecordedHistoryForRange(page, rangeDays);
  const excludedHistory = recordedRangeHistory.filter((night) => night.evidenceStatus === "provider-anomaly");
  // The table is an audit trail, so it shows every recorded collection. The
  // chart/status/readiness paths above continue to use trusted history only.
  const runs = [...recordedRangeHistory].reverse().slice(0, 12);
  const collectionSchedule = normalizeCollectionSchedule(store.collectionSchedule);
  const runMetadata = runs.map((night) => {
    const local = night.iso
      ? collectionLocalDateTime(night.iso, collectionSchedule.timeZone)
      : null;
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
  const thresholds = effectivePerformanceThresholds(store.performanceThresholds, page);
  const readinessHistory = agentReadinessHistoryPoints(
    rangeHistory,
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
  const openReport = async (d: Night) => {
    if (!nightHasStrategy(d, strategy)) return;
    const cats = CATEGORIES.map((c) => {
      const s = d.scores[strategy][c.key];
      return { label: c.label, median: s.m, range: `${s.lo}–${s.hi}`, key: c.key };
    });
    // Read the actual stored object for this night, not a fabricated payload
    // (audit: audit trail). Seed / imported nights have no stored report, so
    // show an honest summary of what IS stored instead of inventing PSI metadata.
    let raw: string;
    const rawReportKey = d.strategyReportKeys?.[strategy] ?? d.rawReportKey;
    if (rawReportKey) {
      try {
        const res = await fetch(store.pathFor(`/api/pages/${page.id}/report/${encodeURIComponent(rawReportKey)}`));
        if (res.ok) {
          const json = (await res.json()) as { report: unknown };
          raw = JSON.stringify(json.report, null, 2);
        } else {
          raw = fallbackReport(d);
        }
      } catch {
        raw = fallbackReport(d);
      }
    } else {
      raw = fallbackReport(d);
    }
    store.openReport({ date: d.date, url: page.url, raw, cats });
  };

  function fallbackReport(d: Night): string {
    if (!nightHasStrategy(d, strategy)) {
      return JSON.stringify({
        note: `No ${strategy} PSI measurement completed for this collection. Other independent results are retained.`,
        date: d.date,
        strategy,
        agentChecksRecorded: d.agent?.length ?? 0,
        agentReadiness: d.agentReadiness ?? null,
      }, null, 2);
    }
    return JSON.stringify(
      {
        note: "No raw PSI payload is stored for this night (seed / imported data). Showing the stored medians and ranges only.",
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
      },
      null,
      2,
    );
  }

  return (
    <div>
      <div style={{ background: C.panel, border: `1px solid ${C.border}`, borderRadius: 13, padding: 22, marginBottom: 20 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
          <h3 style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>Score over time · last {rangeDays} days</h3>
          <SegToggle label="History category" value={chartCat} onChange={setChartCat} options={CATEGORIES.map((c) => ({ value: c.key, label: c.short }))} />
        </div>
        <div style={{ fontSize: 12, color: C.faint, marginBottom: 18 }}>
          Desktop and Mobile are stacked for comparison. Each median line includes its run-to-run range; reference lines show that device&apos;s original benchmark and, when enough scans exist, the previous {rangeDays}-day period median.
          {excludedHistory.length > 0 && " Orange anomaly bands mark measurements retained for diagnosis but excluded from scores, trends, and recommendations."}
        </div>
        {historyForStrategy(rangeHistory, "desktop").length < 2 && historyForStrategy(rangeHistory, "mobile").length < 2 ? (
          <div style={{ padding: "42px 16px", textAlign: "center", color: C.muted, fontSize: 13 }}>At least two collections inside this range are required to chart change.</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
            {(["desktop", "mobile"] as const).map((device) => (
              <div key={device}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 7 }}>
                  <span style={{ fontSize: 12, fontWeight: 600, textTransform: "capitalize", color: device === "desktop" ? C.violetSoft : C.accentSoft }}>{device}</span>
                  <span style={{ fontSize: 11, color: C.faint }}>Latest {page.current[device][chartCat]}</span>
                </div>
                {historyForStrategy(rangeHistory, device).length < 2 ? (
                  <div style={{ padding: "34px 16px", textAlign: "center", color: C.muted, fontSize: 12.5 }}>
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
            evidence={evidenceForPage(store.visitorExperience, page.id, strategy)}
            labHistory={rangeHistory}
            strategy={strategy}
            compact
          />
        )}
        <div style={{ marginTop: 22, paddingTop: 20, borderTop: `1px solid ${C.border}` }}>
          <div style={{ display: "flex", alignItems: "start", justifyContent: "space-between", gap: 20, marginBottom: 4 }}>
            <div>
              <div style={{ fontSize: 12, fontWeight: 600, color: C.violetSoft }}>Agent readiness</div>
              <div style={{ fontSize: 11.5, color: C.faint, marginTop: 4 }}>
                Each point freezes the score and ignored checks that were effective when that agent scan completed.
              </div>
            </div>
            {latestReadiness && (
              <div style={{ flex: "0 0 auto", textAlign: "right" }}>
                <div style={{ color: scoreMeta(latestReadiness.percent).fg, fontSize: 13, fontWeight: 650 }}>{latestReadiness.percent}%</div>
                <div style={{ color: C.faint, fontSize: 10.5, marginTop: 2 }}>
                  {latestReadiness.pass}/{latestReadiness.total}{latestReadiness.ignored ? ` · ${latestReadiness.ignored} ignored` : ""}
                </div>
              </div>
            )}
          </div>
          {readinessHistory.length === 0 ? (
            <div style={{ padding: "34px 16px 18px", textAlign: "center", color: C.muted, fontSize: 13 }}>
              Readiness history starts with the next successful agent scan in this range.
            </div>
          ) : (
            <>
              <div style={{ display: "flex", gap: 16, alignItems: "center", marginTop: 12, color: C.faint, fontSize: 10.5 }}>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}><span aria-hidden="true" style={{ width: 7, height: 7, borderRadius: "50%", background: C.green }} />Fixed since prior run</span>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}><span aria-hidden="true" style={{ width: 7, height: 7, borderRadius: "50%", background: C.accentSoft }} />Newly ignored</span>
              </div>
              <AgentReadinessChart
                history={rangeHistory}
                threshold={thresholds.agentReadiness}
                ignores={page.agentIgnores}
                defaults={store.agentIgnoreDefaults}
                restores={page.agentIgnoreRestores}
              />
              {readinessHistory.length === 1 && (
                <div style={{ color: C.faint, fontSize: 11, marginTop: -4 }}>
                  One retained snapshot is shown; direction appears after the next successful scan.
                </div>
              )}
            </>
          )}
        </div>
      </div>

      <div id="nightly-detail" className="table-scroll" style={{ background: C.panel, border: `1px solid ${C.border}`, borderRadius: 13 }}>
        <div style={{ padding: "13px 22px", borderBottom: `1px solid ${C.border}`, fontSize: 12, color: C.muted }}>
          Nightly detail · <span style={{ color: C.text, textTransform: "capitalize", fontWeight: 600 }}>{strategy}</span> primary · Lighthouse median with range below
          {showVisitorColumns && " · CrUX p75 with weekly change below"}
          {excludedHistory.length > 0 && " · PSI anomaly rows are observed measurements excluded from scoring"}
          {` · Dates in ${collectionSchedule.timeZone}`}
        </div>
        <div className="narrow-table" style={{ display: "grid", gridTemplateColumns: GRID, minWidth: showVisitorColumns ? 1120 : undefined, padding: "14px 22px", borderBottom: `1px solid ${C.border}`, fontSize: 11, fontWeight: 550, letterSpacing: "0.05em", textTransform: "uppercase", color: C.faint }}>
          <div>Night</div>
          <div>Marker</div>
          <div style={{ textAlign: "center" }}>Perf</div>
          <div style={{ textAlign: "center" }}>A11y</div>
          <div style={{ textAlign: "center" }}>BP</div>
          <div style={{ textAlign: "center" }}>SEO</div>
          {showVisitorColumns && VISITOR_METRICS.map((metric) => (
            <div
              key={metric.key}
              title={`${metric.label} · ${metric.technicalName}`}
              style={{ textAlign: "center", borderLeft: metric.key === "lcpP75Ms" ? `1px solid ${C.border}` : undefined }}
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
            nightHasStrategy(d, "mobile") ? "M PSI" : null,
            nightHasStrategy(d, "desktop") ? "D PSI" : null,
            visitorSnapshot ? "CrUX" : null,
            Array.isArray(d.agent) ? "Agent" : null,
          ].filter((label): label is string => label !== null);
          const cell = (k: CategoryKey) => {
            if (!nightHasStrategy(d, strategy)) {
              return <div aria-label={`No ${strategy} PSI measurement`} style={{ textAlign: "center", color: C.faint }}>—</div>;
            }
            const score = d.scores[strategy][k];
            const categoryLabel = CATEGORIES.find((category) => category.key === k)?.label ?? k;
            return (
              <div
                aria-label={`${categoryLabel} ${excludedAnomaly ? "observed" : "median"} ${score.m}, range ${score.lo} to ${score.hi}${excludedAnomaly ? ", excluded PSI anomaly" : ""}`}
                style={{ textAlign: "center" }}
              >
                <div style={{ fontSize: 14, lineHeight: 1.1, fontWeight: 650, color: excludedAnomaly ? C.amber : scoreMeta(score.m).fg }}>{score.m}</div>
                <div style={{ marginTop: 3, fontSize: 10, lineHeight: 1, color: C.faint }}>{score.lo}–{score.hi}</div>
              </div>
            );
          };
          const visitorCell = (key: VisitorMetricKey) => {
            const value = visitorSnapshot?.[key] ?? null;
            const previous = previousVisitorSnapshot?.[key] ?? null;
            const rating = value === null ? null : metricRating(key, value);
            const movement = formatVisitorMetricDelta(key, previous, value);
            const delta = previous === null || value === null ? null : value - previous;
            const valueColor = rating === "Good" ? C.green : rating === "Needs improvement" ? C.amber : rating === "Poor" ? C.redSoft : C.muted;
            const movementColor = delta === null || delta === 0 ? C.faint : delta < 0 ? C.green : C.redSoft;
            const label = VISITOR_METRICS.find((metric) => metric.key === key)?.label ?? key;
            return (
              <div
                aria-label={`${label} ${formatVisitorMetric(key, value)}, ${movement === "—" ? "no prior CrUX snapshot" : movement}`}
                title={visitorSnapshot ? `Rolling window ending ${visitorSnapshot.collectionEnd} · ${rating ?? "Unavailable"}` : "No CrUX window available for this night"}
                style={{ textAlign: "center", borderLeft: key === "lcpP75Ms" ? `1px solid ${C.border}` : undefined }}
              >
                <div style={{ fontSize: 13, lineHeight: 1.1, fontWeight: 650, color: valueColor }}>{formatVisitorMetric(key, value)}</div>
                <div style={{ marginTop: 3, fontSize: 9.5, lineHeight: 1, color: movementColor }}>{movement}</div>
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
                borderBottom: `1px solid ${C.rowBorder}`,
                boxShadow: excludedAnomaly ? `inset 3px 0 ${C.amber}` : undefined,
                background: excludedAnomaly ? "rgba(255,165,72,0.045)" : undefined,
                fontSize: 13,
              }}
            >
              <div>
                <div
                  aria-label={`${dateLabel}${timeLabel ? ` at ${timeLabel}` : ""}, ${runLabel}`}
                  style={{ fontWeight: 500, color: excludedAnomaly ? C.amber : C.text }}
                >
                  {startsDateGroup ? dateLabel : `↳ ${timeLabel ?? "Additional run"}`}
                </div>
                <div style={{ marginTop: 3, color: C.faint, fontSize: 9.5, lineHeight: 1.3 }}>
                  {startsDateGroup && timeLabel ? `${timeLabel} · ${runLabel}` : runLabel}
                </div>
                <div title={`Completed independently: ${completedTests.join(", ") || "none"}`} style={{ marginTop: 4, color: C.faint, fontSize: 9.5, lineHeight: 1.3 }}>
                  {completedTests.join(" · ") || "No completed test"}
                </div>
              </div>
              <div style={{ fontSize: 12, display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 5 }}>
                {excludedAnomaly && (
                  <span title="Retained for diagnosis; not used in status, trend, or recommendations" style={{ color: C.amber, fontWeight: 600 }}>
                    ◆ PSI anomaly · excluded
                  </span>
                )}
                {!excludedAnomaly && markers.length === 0 ? <span style={{ color: "#4A4A50" }}>—</span> : markers.map((marker) => {
                  const legacyRecKey = isTaskMarker(marker)
                    ? store.recs.find((rec) =>
                      rec.pageId === page.id
                      && (`Acted: ${rec.title}` === marker.text || taskMarkerText(rec.title) === marker.text)
                    )?.key
                    : undefined;
                  const recKey = marker.recKey ?? legacyRecKey;
                  const custom = !isTaskMarker(marker) && !recKey;
                  const color = custom ? C.green : C.violetSoft;
                  if (recKey) {
                    return (
                      <button
                        key={marker.id}
                        type="button"
                        onClick={() => router.push(`${store.pathFor("/tasks")}?task=${encodeURIComponent(recKey)}`)}
                        style={{ border: 0, padding: 0, background: "transparent", color, font: "inherit", cursor: "pointer", textAlign: "left" }}
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
                      style={{ border: 0, padding: 0, background: "transparent", color, font: "inherit", cursor: "pointer", textAlign: "left" }}
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
                <button disabled={!nightHasStrategy(d, strategy)} onClick={() => openReport(d)} style={{ border: `1px solid ${C.border2}`, background: "rgba(255,255,255,0.03)", color: C.text, fontSize: 11.5, fontWeight: 500, padding: "5px 11px", borderRadius: 7, cursor: nightHasStrategy(d, strategy) ? "pointer" : "not-allowed", opacity: nightHasStrategy(d, strategy) ? 1 : 0.45 }}>Report</button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function PendingPanel({ page, store }: { page: WatchPage; store: ReturnType<typeof useStore> }) {
  const hasSnapshot = page.history.length > 0;
  const collectionBlocked = page.flag === "paused" || (!!page.runState && page.runState !== "failed");
  return (
    <div style={{ padding: "56px 24px", textAlign: "center", background: C.panel, border: `1px solid ${C.border}`, borderRadius: 13 }}>
      <div style={{ fontSize: 16, fontWeight: 600 }}>{hasSnapshot ? "Snapshot collected — baseline required" : "No collection yet"}</div>
      <div style={{ fontSize: 13, color: C.muted, marginTop: 8, maxWidth: 460, marginInline: "auto", lineHeight: 1.55 }}>
        {page.flag === "paused"
          ? "This page is paused. Change it to Watching or Priority from the Watch List before collecting a first snapshot or baseline."
          : hasSnapshot
          ? `The latest mobile snapshot is Performance ${page.current.mobile.perf}, Accessibility ${page.current.mobile.a11y}, Best Practices ${page.current.mobile.bp}, and SEO ${page.current.mobile.seo}. Capture an explicit baseline before deltas or health classification begin.`
          : "Run now to collect a first snapshot, or capture an explicit baseline to anchor future comparisons. This page also joins the next nightly run automatically."}
      </div>
      <div style={{ display: "flex", gap: 10, justifyContent: "center", marginTop: 22 }}>
        <button disabled={collectionBlocked} title={page.flag === "paused" ? "Activate this page from the Watch List first" : undefined} onClick={() => store.captureBaseline(page.id)} style={{ border: "none", background: C.accent, color: "#fff", fontSize: 12.5, fontWeight: 550, padding: "9px 16px", borderRadius: 8, cursor: collectionBlocked ? "not-allowed" : "pointer", opacity: collectionBlocked ? 0.65 : 1 }}>{page.flag === "paused" ? "Paused" : page.runState && page.runState !== "failed" ? "Collection in progress…" : "Capture baseline"}</button>
        <button disabled={collectionBlocked} title={page.flag === "paused" ? "Activate this page from the Watch List first" : undefined} onClick={() => store.runPage(page.id)} style={{ border: `1px solid ${C.border2}`, background: "rgba(255,255,255,0.04)", color: C.text, fontSize: 12.5, fontWeight: 500, padding: "9px 16px", borderRadius: 8, cursor: collectionBlocked ? "not-allowed" : "pointer", opacity: collectionBlocked ? 0.65 : 1 }}>{page.flag === "paused" ? "Paused" : page.runState === "queued" ? "Queued…" : page.runState === "dispatching" ? "Starting…" : page.runState === "waiting_for_evidence" ? "Waiting…" : page.runState === "running" ? "Running…" : "Run now"}</button>
      </div>
    </div>
  );
}

function lifecycleEvidence(issue: PerformanceIssueLifecycle): string {
  const persistence = `${issue.observedCaptures}/${issue.eligibleCaptures} diagnostic captures since first detection`;
  if (issue.status === "regressed") return `First detected ${issue.firstDetected.date} · returned ${issue.returnedAt?.date ?? issue.lastDetected.date} · ${issue.consecutiveDetections} consecutive · ${persistence}`;
  if (issue.status === "resolved") return `First detected ${issue.firstDetected.date} · resolved ${issue.resolvedAt?.date ?? issue.lastDetected.date} · ${persistence}`;
  if (issue.status === "verifying") return `First detected ${issue.firstDetected.date} · absent from the latest capture · ${persistence}`;
  return `First detected ${issue.firstDetected.date} · ${issue.consecutiveDetections} consecutive · ${persistence}`;
}

function nativeLifecycleEvidence(issue: NativeElementLifecycle): string {
  const persistence = `${issue.observedCaptures}/${issue.eligibleCaptures} HTML scans since first detection`;
  if (issue.status === "regressed") return `First detected ${issue.firstDetected.date} · returned ${issue.returnedAt?.date ?? issue.lastDetected.date} · ${issue.consecutiveDetections} consecutive · ${persistence}`;
  if (issue.status === "resolved") return `First detected ${issue.firstDetected.date} · resolved ${issue.resolvedAt?.date ?? issue.lastDetected.date} · ${persistence}`;
  if (issue.status === "verifying") return `First detected ${issue.firstDetected.date} · absent from the latest available scan · ${persistence}`;
  return `First detected ${issue.firstDetected.date} · ${issue.consecutiveDetections} consecutive · ${persistence}`;
}

function CulpritEvidencePanel({ history, strategy }: { history: Night[]; strategy: "mobile" | "desktop" }) {
  const trends = culpritEvidenceTrends(history, strategy);
  return (
    <section aria-label="Culprit evidence" style={{ borderBottom: `1px solid ${C.border}` }}>
      <div style={{ padding: "16px 22px", borderBottom: trends.length ? `1px solid ${C.border}` : undefined, background: "rgba(59,137,255,0.025)" }}>
        <h4 style={{ margin: 0, fontSize: 13.5, fontWeight: 650 }}>Why the score moved</h4>
        <div style={{ marginTop: 3, fontSize: 11.5, color: C.faint }}>Privacy-safe culprit measurements from warning-free Lighthouse reports. Trends compare retained collection snapshots.</div>
      </div>
      {trends.length === 0 ? (
        <div style={{ padding: "18px 22px", fontSize: 12, color: C.muted }}>No culprit evidence has been retained for {strategy} yet. The next collection will capture DOM, CSS, script, resource, image, and LCP details.</div>
      ) : (
        <div className="culprit-evidence-grid" style={{ background: C.border }}>
          {trends.map(({ evidence, primary, series, delta }) => {
            const changeColor = delta === undefined || delta === 0 ? C.faint2 : delta < 0 ? C.green : C.amber;
            const change = delta === undefined || !primary
              ? "First retained snapshot"
              : delta === 0
                ? "No change from previous snapshot"
                : `${delta > 0 ? "+" : "−"}${formatEvidenceValue(Math.abs(delta), primary.unit)} since previous snapshot`;
            return (
              <article key={evidence.auditId} style={{ minWidth: 0, padding: "15px 18px", background: C.panel }}>
                <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontSize: 13, fontWeight: 650 }}>{evidence.title}</div>
                    {primary && <div style={{ marginTop: 4, fontSize: 17, fontWeight: 650, color: C.accentSoft }}>{formatEvidenceValue(primary.value, primary.unit)} <span style={{ fontSize: 10.5, fontWeight: 500, color: C.faint }}>{primary.label.toLowerCase()}</span></div>}
                  </div>
                  {series.length > 1 && <div style={{ width: 62, flex: "none" }}><Sparkline series={series} color={changeColor} w={62} h={27} /></div>}
                </div>
                <div style={{ marginTop: 7, fontSize: 10.5, color: changeColor }}>{change}</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginTop: 9 }}>
                  {evidence.facts.filter((item) => item.key !== primary?.key).slice(0, 3).map((item) => (
                    <span key={item.key} style={{ fontSize: 10.5, color: C.dim, background: "rgba(255,255,255,0.045)", padding: "2px 6px", borderRadius: 5 }}>{formatEvidenceValue(item.value, item.unit)} {item.label.toLowerCase()}</span>
                  ))}
                </div>
                {evidence.lcpElement && (
                  <div style={{ marginTop: 9, fontSize: 10.5, color: C.muted }}>
                    &lt;{evidence.lcpElement.elementType}&gt;
                    {evidence.lcpElement.assetHost ? ` · ${evidence.lcpElement.assetHost}` : ""}
                    {evidence.lcpElement.width && evidence.lcpElement.height ? ` · ${Math.round(evidence.lcpElement.width)}×${Math.round(evidence.lcpElement.height)} px` : ""}
                  </div>
                )}
                {!!evidence.sources?.length && <div style={{ marginTop: 9, fontSize: 10.5, color: C.faint }}>Top hosts · {evidence.sources.map((item) => item.host).join(" · ")}</div>}
                <div style={{ marginTop: 7, fontSize: 10, color: C.faint }}>Median of {evidence.sampleRuns} warning-free {evidence.sampleRuns === 1 ? "run" : "runs"}</div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}

function NativeElementsPanel({ page }: { page: WatchPage }) {
  const store = useStore();
  const history = page.history;
  const issues = nativeElementIssuesForPage(history);
  const detected = issues.filter((issue) => issue.status === "active" || issue.status === "regressed");
  const current = detected.filter((issue) => nativeElementDisposition(page.nativeElementControls, issue.id) !== "suppressed");
  const suppressed = detected.filter((issue) => nativeElementDisposition(page.nativeElementControls, issue.id) === "suppressed");
  const cleared = issues.filter((issue) => issue.status === "verifying" || issue.status === "resolved");
  const retainedScans = history.filter((night) => night.nativeElements?.status === "available");
  const latestAttempt = [...history].reverse().find((night) => night.nativeElements);
  return (
    <section aria-label="Native Webflow elements" style={{ borderBottom: `1px solid ${C.border}` }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 12, padding: "16px 22px", background: "rgba(138,92,246,0.035)", borderBottom: current.length || cleared.length || retainedScans.length === 0 ? `1px solid ${C.border}` : undefined }}>
        <div>
          <h4 style={{ margin: 0, fontSize: 13.5, fontWeight: 650 }}>Native Webflow elements</h4>
          <div style={{ marginTop: 3, fontSize: 11.5, color: C.faint }}>Published-HTML checks for Background Video, YouTube/Vimeo, Lottie, Spline, and unresponsive raster images.</div>
        </div>
        <span style={{ marginLeft: "auto", flex: "none", fontSize: 11, fontWeight: 650, color: current.length ? C.violetSoft : C.green, background: current.length ? "rgba(138,92,246,0.12)" : "rgba(53,208,127,0.12)", padding: "3px 8px", borderRadius: 6 }}>
          {current.length ? `${current.length} detected` : suppressed.length ? `${suppressed.length} suppressed` : retainedScans.length ? "No current findings" : "Awaiting scan"}
        </span>
      </div>
      {latestAttempt?.nativeElements?.status === "unavailable" && (
        <div style={{ padding: "10px 22px", borderBottom: `1px solid ${C.rowBorder}`, fontSize: 11.5, color: C.amber }}>
          Latest HTML scan unavailable: {latestAttempt.nativeElements.reason ?? "published page could not be inspected"}. Prior lifecycle state was preserved.
        </div>
      )}
      {retainedScans.length === 0 && (
        <div style={{ padding: "22px", fontSize: 12, color: C.muted }}>No native-element scan has been retained yet. Run a new collection to inspect the published HTML.</div>
      )}
      {retainedScans.length > 0 && current.length === 0 && suppressed.length === 0 && cleared.length === 0 && (
        <div style={{ padding: "22px", fontSize: 12, color: C.green }}>No known problematic Webflow-native element footprints were detected.</div>
      )}
      {current.map((issue) => (
        <div key={issue.key} style={{ padding: "15px 22px", borderBottom: `1px solid ${C.rowBorder}` }}>
          <div style={{ display: "flex", alignItems: "flex-start", gap: 14 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 7 }}>
                <span style={{ fontSize: 13.5, fontWeight: 650 }}>{issue.title}</span>
                <PerformanceIssueStatusBadge status={issue.status} />
                <WebflowClassificationChips classification={issue.webflow} />
                <span style={{ fontSize: 10.5, color: C.faint2, textTransform: "capitalize" }}>{issue.confidence} confidence</span>
                {nativeElementDisposition(page.nativeElementControls, issue.id) === "acknowledged" && <span style={{ fontSize: 10.5, fontWeight: 650, color: C.green, background: "rgba(53,208,127,0.12)", padding: "2px 7px", borderRadius: 5 }}>Acknowledged</span>}
              </div>
              <div style={{ marginTop: 5, fontSize: 12, color: C.faint2, lineHeight: 1.45 }}>{issue.detail}</div>
              {!!issue.evidence?.length && (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 7 }} aria-label="Detection evidence">
                  {issue.evidence.map((item) => <span key={item.label} style={{ fontSize: 10.5, color: C.dim, background: "rgba(255,255,255,0.045)", border: `1px solid ${C.border2}`, padding: "2px 7px", borderRadius: 5 }}><strong>{item.count}</strong> {item.label}</span>)}
                </div>
              )}
              <div style={{ marginTop: 7, fontSize: 11.5, color: C.muted, lineHeight: 1.45 }}><span style={{ color: C.faint2, fontWeight: 600 }}>Webflow guidance:</span> {issue.webflow.guidance}</div>
              <div style={{ marginTop: 5, fontSize: 11.5, color: C.faint }}>{nativeLifecycleEvidence(issue)}</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 7, marginTop: 10 }}>
                {nativeElementDisposition(page.nativeElementControls, issue.id) === "acknowledged" ? (
                  <button type="button" onClick={() => store.setNativeElementDisposition(page.id, issue.id, null)} style={{ border: `1px solid ${C.border2}`, background: "transparent", color: C.dim, fontSize: 11, padding: "5px 9px", borderRadius: 6, cursor: "pointer" }}>Clear acknowledgement</button>
                ) : (
                  <button type="button" onClick={() => store.setNativeElementDisposition(page.id, issue.id, "acknowledged")} style={{ border: `1px solid ${C.border2}`, background: "rgba(53,208,127,0.08)", color: C.green, fontSize: 11, padding: "5px 9px", borderRadius: 6, cursor: "pointer" }}>Acknowledge</button>
                )}
                <button type="button" onClick={() => store.setNativeElementDisposition(page.id, issue.id, "suppressed")} style={{ border: `1px solid ${C.border2}`, background: "transparent", color: C.faint2, fontSize: 11, padding: "5px 9px", borderRadius: 6, cursor: "pointer" }}>Suppress</button>
              </div>
            </div>
            <div style={{ flex: "none", textAlign: "right" }}>
              <div style={{ fontSize: 11, color: C.faint }}>Instances</div>
              <div style={{ fontSize: 17, fontWeight: 650, color: C.violetSoft }}>{issue.count}</div>
            </div>
          </div>
        </div>
      ))}
      {suppressed.length > 0 && (
        <div>
          <div style={{ padding: "11px 22px", borderBottom: `1px solid ${C.rowBorder}`, fontSize: 11.5, fontWeight: 600, color: C.faint2 }}>Suppressed findings · excluded from hotspots and future recommendations</div>
          {suppressed.map((issue) => (
            <div key={issue.key} style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 7, padding: "12px 22px", borderBottom: `1px solid ${C.rowBorder}`, opacity: 0.78 }}>
              <span style={{ fontSize: 12.5, fontWeight: 600 }}>{issue.title}</span>
              <span style={{ fontSize: 10.5, color: C.faint }}>{issue.count} {issue.count === 1 ? "instance" : "instances"}</span>
              <button type="button" onClick={() => store.setNativeElementDisposition(page.id, issue.id, null)} style={{ marginLeft: "auto", border: `1px solid ${C.border2}`, background: "transparent", color: C.dim, fontSize: 11, padding: "5px 9px", borderRadius: 6, cursor: "pointer" }}>Restore to review</button>
            </div>
          ))}
        </div>
      )}
      {cleared.length > 0 && (
        <div>
          <div style={{ padding: "11px 22px", borderBottom: `1px solid ${C.rowBorder}`, fontSize: 11.5, fontWeight: 600, color: C.faint2 }}>Cleared native-element findings</div>
          {cleared.map((issue) => (
            <div key={issue.key} style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 7, padding: "12px 22px", borderBottom: `1px solid ${C.rowBorder}` }}>
              <span style={{ fontSize: 12.5, fontWeight: 600 }}>{issue.title}</span>
              <PerformanceIssueStatusBadge status={issue.status} />
              <span style={{ marginLeft: "auto", fontSize: 11, color: C.faint }}>{nativeLifecycleEvidence(issue)}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function OpportunitiesTab({ page, latest, strategy }: { page: WatchPage; latest: Night | null; strategy: "mobile" | "desktop" }) {
  const history = page.history;
  const audits = auditsFor(
    opportunitiesForNight(latest, strategy),
    latest?.diagnostics?.[strategy] ?? [],
  );
  const issues = performanceIssuesForPage(history, strategy);
  const issueById = new Map(issues.map((issue) => [issue.id, issue]));
  const lifecycleCounts = performanceIssueCounts(issues);
  const clearedIssues = issues.filter((issue) => issue.status === "verifying" || issue.status === "resolved");
  const lifecycleSummary: { key: PerformanceIssueStatus; label: string }[] = [
    { key: "regressed", label: "returned" },
    { key: "active", label: "active" },
    { key: "verifying", label: "verifying" },
    { key: "resolved", label: "resolved" },
  ];
  const remediationCounts = audits.reduce<Record<WebflowRemediationLevel, number>>((counts, audit) => {
    counts[audit.webflow.remediation] += 1;
    return counts;
  }, { blocked: 0, partial: 0, available: 0, unknown: 0 });
  const remediationSummary: { key: WebflowRemediationLevel; label: string }[] = [
    { key: "available", label: "fixable in Webflow" },
    { key: "partial", label: "partial remediation" },
    { key: "blocked", label: "product gaps" },
    { key: "unknown", label: "need review" },
  ];
  return (
    <div style={{ background: C.panel, border: `1px solid ${C.border}`, borderRadius: 13, overflow: "hidden" }}>
      <div style={{ padding: "18px 22px", borderBottom: `1px solid ${C.border}` }}>
        <h3 style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>Failing audits &amp; opportunities</h3>
        <div style={{ fontSize: 12, color: C.faint, marginTop: 3 }}>Repeatable <span style={{ textTransform: "capitalize" }}>{strategy}</span> findings with lifecycle derived from retained diagnostic captures.</div>
      </div>
      {issues.length > 0 && (
        <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 12, padding: "12px 22px", borderBottom: `1px solid ${C.border}`, background: "rgba(255,255,255,0.018)" }}>
          <span style={{ fontSize: 11, fontWeight: 650, color: C.faint2, textTransform: "uppercase", letterSpacing: "0.04em" }}>Lifecycle</span>
          {lifecycleSummary.filter(({ key }) => lifecycleCounts[key] > 0).map(({ key, label }) => (
            <span key={key} style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11.5, color: C.dim }}>
              <PerformanceIssueStatusBadge status={key} />
              <strong>{lifecycleCounts[key]}</strong> {label}
            </span>
          ))}
          <span style={{ marginLeft: "auto", fontSize: 11, color: C.faint }}>Resolved after 2 consecutive clean captures</span>
        </div>
      )}
      {audits.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 14, padding: "12px 22px", borderBottom: `1px solid ${C.border}`, background: C.panel2 }}>
          {remediationSummary.filter(({ key }) => remediationCounts[key] > 0).map(({ key, label }) => {
            const tone = remediationTone(key);
            return (
              <span key={key} style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11.5, color: tone.color }}>
                <span style={{ width: 7, height: 7, borderRadius: "50%", background: tone.color }} />
                <strong>{remediationCounts[key]}</strong> {label}
              </span>
            );
          })}
        </div>
      )}
      <CulpritEvidencePanel history={history} strategy={strategy} />
      <NativeElementsPanel page={page} />
      {audits.length === 0 && (
        <div style={{ padding: "42px 22px", textAlign: "center", color: C.muted, fontSize: 13 }}>
          {latest ? `No repeatable ${strategy} diagnostics were promoted in this range.` : "No real Lighthouse diagnostic data has been collected yet."}
        </div>
      )}
      {audits.map((a) => (
        <div key={a.id} style={{ display: "flex", alignItems: "flex-start", gap: 16, padding: "17px 22px", borderBottom: `1px solid ${C.rowBorder}` }}>
          <div style={{ flex: "none", width: 8, height: 8, borderRadius: "50%", marginTop: 6, background: a.dot }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 14, fontWeight: 600 }}>{a.title}</div>
            <div style={{ fontSize: 12.5, color: C.faint2, marginTop: 4, lineHeight: 1.5 }}>{a.desc}</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 7, marginTop: 9 }}>
              {issueById.get(a.id) && <PerformanceIssueStatusBadge status={issueById.get(a.id)!.status} />}
              <WebflowClassificationChips classification={a.webflow} />
              <span style={{ display: "inline-block", fontSize: 11, fontWeight: 500, color: C.dim, background: "rgba(255,255,255,0.06)", padding: "2px 9px", borderRadius: 5 }}>{a.category}</span>
              {a.evidence && <span style={{ display: "inline-block", fontSize: 11, color: C.accentSoft, background: "rgba(59,137,255,0.12)", padding: "2px 9px", borderRadius: 5 }}>{a.evidence}</span>}
              {a.confidence && <span style={{ display: "inline-block", fontSize: 11, color: C.faint2, padding: "2px 2px", textTransform: "capitalize" }}>{a.confidence} confidence</span>}
            </div>
            <div style={{ fontSize: 11.5, color: C.muted, marginTop: 9, lineHeight: 1.45 }}>
              <span style={{ color: C.faint2, fontWeight: 600 }}>Webflow guidance:</span> {a.webflow.guidance}
            </div>
            {issueById.get(a.id) && (
              <div style={{ fontSize: 11.5, color: C.faint, marginTop: 5, lineHeight: 1.45 }}>
                {lifecycleEvidence(issueById.get(a.id)!)}
              </div>
            )}
          </div>
          <div style={{ flex: "none", textAlign: "right" }}>
            <div style={{ fontSize: 11, color: C.faint }}>Measured impact</div>
            <div style={{ fontSize: 17, fontWeight: 600, color: C.amber }}>{a.savings}</div>
          </div>
        </div>
      ))}
      {clearedIssues.length > 0 && (
        <div>
          <div style={{ padding: "14px 22px", borderBottom: `1px solid ${C.border}`, background: C.panel2 }}>
            <div style={{ fontSize: 12.5, fontWeight: 600 }}>Cleared findings</div>
            <div style={{ fontSize: 11, color: C.faint, marginTop: 2 }}>Absent from the latest diagnostic capture; verification state remains evidence-based.</div>
          </div>
          {clearedIssues.map((issue) => (
            <div key={issue.key} style={{ display: "flex", alignItems: "flex-start", gap: 14, padding: "14px 22px", borderBottom: `1px solid ${C.rowBorder}` }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 7 }}>
                  <span style={{ fontSize: 13.5, fontWeight: 600 }}>{issue.title}</span>
                  <PerformanceIssueStatusBadge status={issue.status} />
                  <WebflowClassificationChips classification={issue.webflow} />
                </div>
                <div style={{ fontSize: 11.5, color: C.faint, marginTop: 6 }}>{lifecycleEvidence(issue)}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function AgentTab({
  page,
  checks,
  date,
  rangeDays,
  pass,
  fail,
  ignored,
  unavailable,
  store,
}: {
  page: WatchPage;
  checks: AgentCheck[];
  date: string | null;
  rangeDays: RangeDays;
  pass: number;
  fail: number;
  ignored: number;
  unavailable: number;
  store: ReturnType<typeof useStore>;
}) {
  const groups = new Map<string, AgentCheck[]>();
  checks.forEach((c) => groups.set(c.group, [...(groups.get(c.group) ?? []), c]));
  const ignores = normalizeAgentIgnoreSettings(page.agentIgnores);
  const restores = normalizeAgentIgnoreSettings(page.agentIgnoreRestores);
  const defaults = normalizeAgentIgnoreSettings(store.agentIgnoreDefaults);
  const allApplicableUnavailable = checks.length > 0 && pass === 0 && fail === 0 && unavailable > 0;
  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 20, padding: "15px 18px", background: C.panel, border: `1px solid ${C.border}`, borderRadius: 11 }}>
        <div style={{ fontSize: 13, color: C.faint2 }}>{date ? `Recorded per check on ${date}.` : `No scan recorded in the selected ${rangeDays}-day range.`} Watch List defaults apply unless overridden here.</div>
        <div style={{ marginLeft: "auto", display: "flex", flexWrap: "wrap", justifyContent: "flex-end", gap: 16, fontSize: 12.5, fontWeight: 500 }}>
          <span style={{ color: C.green }}>{pass} passing</span>
          <span style={{ color: C.red }}>{fail} failing</span>
          <span style={{ color: C.violetSoft }}>{ignored} ignored</span>
          {unavailable > 0 && <span style={{ color: C.muted }}>{unavailable} unavailable</span>}
        </div>
      </div>
      {checks.length === 0 ? (
        <div style={{ padding: "40px 22px", textAlign: "center", background: C.panel, border: `1px solid ${C.border}`, borderRadius: 13, color: C.muted, fontSize: 13 }}>
          No agent-readiness scan in this range. Choose a longer range or run a new scan.
        </div>
      ) : (
        <div>
          {allApplicableUnavailable && (
            <div style={{ marginBottom: 16, padding: "13px 16px", background: "rgba(255,255,255,0.035)", border: `1px solid ${C.border}`, borderRadius: 10, color: C.muted, fontSize: 12.5 }}>
              The last scan couldn&apos;t reach this page, so every applicable check is unavailable — not failing. Try running again once the page is reachable.
            </div>
          )}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 16, alignItems: "start" }}>
            {[...groups.entries()].map(([name, checks]) => {
              const groupMode = agentIgnoreOverrideMode(ignores, restores, "group", name);
              const groupIgnored = isAgentGroupIgnored(name, ignores, defaults, restores);
              return (
                <div
                  key={name}
                  style={{
                    background: groupIgnored ? `linear-gradient(rgba(138,92,246,0.07), rgba(138,92,246,0.07)), ${C.panel}` : C.panel,
                    border: `1px solid ${groupIgnored ? "rgba(138,92,246,0.28)" : C.border}`,
                    borderRadius: 13,
                    padding: "18px 20px",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 15 }}>
                    <div style={{ minWidth: 0, fontSize: 11, fontWeight: 550, letterSpacing: "0.05em", textTransform: "uppercase", color: groupIgnored ? C.violetSoft : C.faint }}>{name}</div>
                    <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8 }}>
                      {groupMode !== "inherit" && (
                        <button
                          type="button"
                          aria-label={`Use Watch List default for ${name} category`}
                          onClick={() => store.setAgentIgnore(page.id, "group", name, "inherit")}
                          style={{ flex: "none", border: "none", background: "transparent", color: C.faint, fontSize: 10.5, fontWeight: 550, padding: "4px 0", cursor: "pointer" }}
                        >
                          Use default
                        </button>
                      )}
                      <button
                        type="button"
                        aria-label={`${groupIgnored ? "Restore" : "Ignore"} ${name} category for this page`}
                        onClick={() => store.setAgentIgnore(page.id, "group", name, groupIgnored ? "restore" : "ignore")}
                        style={{ flex: "none", border: `1px solid ${groupIgnored ? "rgba(183,156,255,0.30)" : C.border2}`, background: groupIgnored ? "rgba(138,92,246,0.14)" : "rgba(255,255,255,0.03)", color: groupIgnored ? C.violetSoft : C.faint2, fontSize: 10.5, fontWeight: 550, padding: "4px 8px", borderRadius: 6, cursor: "pointer" }}
                      >
                        {groupIgnored ? "Restore for page" : "Ignore category"}
                      </button>
                    </div>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                    {checks.map((chk) => {
                      const checkKey = agentCheckKey(chk);
                      const checkMode = agentIgnoreOverrideMode(ignores, restores, "check", checkKey);
                      const checkIgnored = isAgentCheckIgnored(chk, ignores, defaults, restores);
                      // Four states: pass, fail, unavailable, and ignored.
                      const mark = checkIgnored || chk.unavailable ? "–" : chk.pass ? "✓" : "✕";
                      const markBg = checkIgnored ? "rgba(138,92,246,0.18)" : chk.unavailable ? C.border2 : chk.pass ? C.green : C.red;
                      const markColor = checkIgnored ? C.violetSoft : chk.unavailable ? C.muted : C.bg;
                      const textColor = checkIgnored ? C.faint : chk.unavailable ? C.faint : chk.pass ? C.dim : C.redSoft;
                      return (
                        <div key={chk.name} style={{ display: "flex", alignItems: "center", gap: 9, minWidth: 0 }}>
                          <span style={{ flex: "none", width: 18, height: 18, borderRadius: 5, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 700, color: markColor, background: markBg }}>{mark}</span>
                          <span style={{ minWidth: 0, flex: 1, fontSize: 13, color: textColor }}>{chk.name}</span>
                          {!checkIgnored && chk.unavailable && (
                            <span style={{ flex: "none", fontSize: 10, fontWeight: 600, color: C.muted, background: "rgba(255,255,255,0.06)", padding: "1px 7px", borderRadius: 4 }}>unavailable</span>
                          )}
                          {!checkIgnored && !chk.unavailable && chk.regressed && (
                            <span style={{ flex: "none", fontSize: 10, fontWeight: 600, color: C.redSoft, background: "rgba(255,92,108,0.14)", padding: "1px 7px", borderRadius: 4 }}>regressed</span>
                          )}
                          <div style={{ flex: "none", display: "flex", alignItems: "center", gap: 8 }}>
                            {checkMode !== "inherit" && (
                              <button
                                type="button"
                                aria-label={`Use Watch List default for ${chk.name} check`}
                                onClick={() => store.setAgentIgnore(page.id, "check", checkKey, "inherit")}
                                style={{ border: "none", background: "transparent", color: C.faint, fontSize: 10.5, fontWeight: 550, padding: "2px 0", cursor: "pointer" }}
                              >
                                Use default
                              </button>
                            )}
                            <button
                              type="button"
                              aria-label={`${checkIgnored ? "Restore" : "Ignore"} ${chk.name} check for this page`}
                              onClick={() => store.setAgentIgnore(page.id, "check", checkKey, checkIgnored ? "restore" : "ignore")}
                              style={{ border: "none", background: "transparent", color: checkIgnored ? C.violetSoft : C.faint, fontSize: 10.5, fontWeight: 550, padding: "2px 0", cursor: "pointer" }}
                            >
                              {checkIgnored ? "Restore" : "Ignore"}
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
