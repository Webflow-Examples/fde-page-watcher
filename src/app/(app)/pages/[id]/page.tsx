"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { ArrowUpRightIcon } from "@phosphor-icons/react";
import { useIssuesView, useStore } from "@/components/store";
import { CATEGORIES } from "@/lib/types";
import type { CategoryKey, CollectionJob, Night, RangeDays, WatchPage } from "@/lib/types";
import { agentReadinessHistoryPoints } from "@/lib/agentHistory";
import { normalizePerformanceThresholds } from "@/lib/performanceThresholds";
import {
  historyForStrategy,
  nightHasStrategy,
  pageAgentHistoryForRange,
  pageHistoryForRange,
  pagePreviousPeriodMedian,
  pageRangeTrend,
  pageRecordedHistoryForRange,
  scoreBand,
  scoreMetaVars,
  statusMeta,
} from "@/lib/scoring";
import {
  APPLICABILITY_LABEL,
  CONFIDENCE_LABEL,
  DESTINATION_LABEL,
  DESTINATION_PATH,
  applicabilityActionLabel,
  type ExclusionReason,
} from "@/lib/vocabulary";
import { queueOf, type IssueCase } from "@/lib/issue-case";
import { runOf } from "@/lib/checkpoint-evaluation";
import { excludedNote } from "@/lib/case-copy";
import { formatImpact } from "@/lib/impact-format";
import { caseHref } from "@/lib/paths";
import {
  PAGE_DETAIL_JUMP_LABEL,
  PAGE_DETAIL_JUMP_TARGET,
  PAGE_DETAIL_SECTIONS,
  PAGE_DETAIL_SECTION_HEADING,
  pageDetailAnchor,
  type PageDetailSectionId,
} from "@/lib/page-detail-sections";
import { ObjectDetailHeader } from "@/components/object-detail-header";
import { StatusChip } from "@/components/status-chip";
import { HealthChip, type HealthChipBand } from "@/components/health-chip";
import { TrendArrow } from "@/components/trend-arrow";
import { CheckpointMarks } from "@/components/checkpoint-marks";
import { ExclusionReasonPicker } from "@/components/exclusion-reason-picker";
import { EFFORT_LABEL, NUMERIC_CELL, TRUNCATE_CELL } from "@/components/issue-row";
import { Magnitude } from "@/components/magnitude";
import { AgentReadinessChart, HistoryChart, seriesToken, type SeriesToken } from "@/components/charts";
import { SegToggle } from "@/components/bits";
import { SelectMenu } from "@/components/select-menu";
import type { SelectMenuOption } from "@/components/select-menu";
import { PlusIcon, RefreshIcon } from "@/components/icons";
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
import {
  isKnownNativeElementId,
  nativeElementApplicability,
  nativeElementExclusionReason,
  nativeElementIssuesForPage,
} from "@/lib/nativeElements";
import type { NativeElementLifecycle } from "@/lib/nativeElements";
import { collectionLocalDateTime, normalizeCollectionSchedule } from "@/lib/collectionSchedule";

/**
 * One page, on one scroll.
 *
 * There are no tabs. Four of them meant four routes into one object, three
 * hidden behind a guess about which word covered what the reader wanted; the
 * body is now the three sections `page-detail-sections.ts` names, in the order
 * that file states, and that array is the only statement of the order in `src/`.
 * Everything the tabs held is either one of those three things or belongs
 * somewhere else:
 *
 *   Recommendations   deleted. The cases ARE the recommendations, and they live
 *                     on the case, which is where the decision lives too.
 *   Opportunities     the same list under a second name.
 *   Agent-readiness   its failures are cases and its history is a reading, so
 *                     both halves are here already, in the two sections that own
 *                     them.
 *
 * Nothing here offers Accept or Dismiss. A lifecycle decision is made on the
 * case, having read it — offering it twice would let the same commitment be made
 * from two places with two different amounts of context, and one of them would be
 * the one made from a list.
 */

const PAGE_RANGE_OPTIONS: ReadonlyArray<SelectMenuOption<RangeDays>> = [
  { value: 3, label: "Last 3 days" },
  { value: 7, label: "Last 7 days" },
  { value: 30, label: "Last 30 days" },
  { value: 90, label: "Last 90 days" },
];

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

/* ── The section shell ──────────────────────────────────────────────────── */

/**
 * One band of the scroll, named by its id.
 *
 * The heading comes from the registry of sections rather than from the call
 * site, so the jump link's words and the heading it lands on cannot disagree.
 */
function Section({
  id,
  aside,
  children,
}: {
  id: PageDetailSectionId;
  aside?: React.ReactNode;
  children: React.ReactNode;
}) {
  const anchor = pageDetailAnchor(id);
  return (
    <section
      id={anchor}
      aria-labelledby={`${anchor}-heading`}
      // So a jump link does not park the heading under the sticky chrome.
      style={{ marginTop: 30, scrollMarginTop: 20 }}
    >
      <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginBottom: 12 }}>
        <h2
          id={`${anchor}-heading`}
          style={{ margin: 0, fontSize: 14, fontWeight: 600, color: "var(--text-body)" }}
        >
          {PAGE_DETAIL_SECTION_HEADING[id]}
        </h2>
        {aside ? <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 10 }}>{aside}</div> : null}
      </div>
      {children}
    </section>
  );
}

/** One labelled cell of the status strip: what it is above, the reading below. */
function Reading({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ minWidth: 0 }}>
      <div style={{ fontSize: 12, color: "var(--text-muted)", whiteSpace: "nowrap" }}>{label}</div>
      <div style={{ marginTop: 5, display: "flex", alignItems: "center", gap: 6, minHeight: 20 }}>
        {children}
      </div>
    </div>
  );
}

/**
 * One device's direction of travel.
 *
 * An arrow and a word, never a fill. The health chip two cells to the left is
 * the fill, and that division is what lets a page read "Poor" and "Improving" at
 * the same time without the two arguing (registry rule 4).
 */
function DeviceTrend({ name, status }: { name: "Desktop" | "Mobile"; status: ReturnType<typeof pageRangeTrend> }) {
  const meta = statusMeta(status);
  return (
    <Reading label={name}>
      {meta.kind === "trend" ? (
        <TrendArrow trend={meta.trend} style={{ fontWeight: 600 }} />
      ) : (
        // Pending is not a fourth direction. No verdict has been reached, which
        // is a different statement from "no change".
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            padding: "1px 8px",
            borderRadius: 20,
            fontSize: 12,
            fontWeight: 600,
            color: "var(--status-neutral-text)",
            background: "var(--status-neutral-bg)",
          }}
        >
          {meta.label}
        </span>
      )}
    </Reading>
  );
}

/* ── Status ─────────────────────────────────────────────────────────────── */

function CollectionNotice({
  tone = "neutral",
  title,
  detail,
}: {
  tone?: "neutral" | "warn" | "danger";
  title?: string;
  detail: React.ReactNode;
}) {
  const border = tone === "danger"
    ? "var(--status-danger-border)"
    : tone === "warn"
      ? "var(--health-warn-border)"
      : "var(--border-hairline)";
  const background = tone === "danger"
    ? "var(--status-danger-bg)"
    : tone === "warn"
      ? "var(--health-warn-bg)"
      : "var(--surface-card)";
  const ink = tone === "danger"
    ? "var(--status-danger-text)"
    : tone === "warn"
      ? "var(--health-warn-text)"
      : "var(--text-muted)";
  return (
    <div style={{ marginTop: 10, padding: "12px 15px", borderRadius: 9, border: `1px solid ${border}`, background }}>
      {title ? (
        <div style={{ fontSize: 12.5, fontWeight: 600, color: tone === "neutral" ? "var(--text-body)" : ink }}>
          {title}
        </div>
      ) : null}
      <div style={{ fontSize: 12, color: ink, marginTop: title ? 3 : 0, lineHeight: 1.5 }}>{detail}</div>
    </div>
  );
}

function CollectionState({ page, job }: { page: WatchPage; job?: CollectionJob }) {
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
  const latestDetail = [
    providerDetail,
    job?.cruxError ? `CrUX: ${job.cruxError}` : "",
    job?.agentError ? `Agent: ${job.agentError}` : "",
  ].filter(Boolean).join(" · ");
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
    <CollectionNotice
      tone={failed ? "danger" : "neutral"}
      title={title}
      detail={
        <>
          {failed
            ? failedRunDetailMessage(page.lastError)
            : page.runState === "waiting_for_evidence"
              ? waitDetail
              : "This state is persisted, so it is safe to refresh or leave the app while the job runs."}
          {!failed && latestDetail ? (
            <div style={{ marginTop: 5 }}>Latest collection response · {latestDetail}</div>
          ) : null}
        </>
      }
    />
  );
}

function StatusSection({
  page,
  job,
  desktopTrend,
  mobileTrend,
  openCases,
  rangeDays,
  setRangeDays,
  isPending,
}: {
  page: WatchPage;
  job?: CollectionJob;
  desktopTrend: ReturnType<typeof pageRangeTrend>;
  mobileTrend: ReturnType<typeof pageRangeTrend>;
  openCases: number;
  rangeDays: RangeDays;
  setRangeDays: (days: RangeDays) => void;
  isPending: boolean;
}) {
  const successfulRunAt = lastSuccessfulRunAt(page);
  const experimentVariation = page.history.at(-1)?.nativeElements?.variationRisk?.source === "webflow-optimize";
  // Mobile Performance, which is what status has always been read from
  // (DECISIONS.md §1). A page with no baseline has no verdict, and the `none`
  // band says that rather than guessing at one.
  const band: HealthChipBand = isPending ? "none" : scoreBand(page.current.mobile.perf);

  return (
    <Section
      id="status"
      aside={
        <>
          <SelectMenu
            ariaLabel="Page date range"
            value={rangeDays}
            options={PAGE_RANGE_OPTIONS}
            onChange={setRangeDays}
            triggerWidth={160}
            menuWidth={160}
          />
          {/* The one link out of this section, and it goes down the page rather
              than to another route: the readings are the evidence for
              everything above, and doubting a verdict should cost one click and
              no navigation. */}
          <a
            href={`#${pageDetailAnchor(PAGE_DETAIL_JUMP_TARGET)}`}
            style={{ fontSize: 12.5, fontWeight: 500, color: "var(--action-primary-ink)", whiteSpace: "nowrap" }}
          >
            {PAGE_DETAIL_JUMP_LABEL}
          </a>
        </>
      }
    >
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          alignItems: "flex-start",
          gap: 32,
          padding: "15px 18px",
          border: "1px solid var(--border-hairline)",
          borderRadius: 11,
          background: "var(--surface-card)",
        }}
      >
        {/* Health and trend sit next to each other on purpose, and they are
            drawn as different KINDS of thing on purpose: one verdict in a fill,
            two directions as arrows. */}
        <Reading label="Health · Mobile Performance">
          <HealthChip band={band} />
        </Reading>
        <DeviceTrend name="Desktop" status={desktopTrend} />
        <DeviceTrend name="Mobile" status={mobileTrend} />
        <Reading label="Last collection">
          <span style={{ fontSize: 12.5, color: "var(--text-body)" }}>
            {formatSuccessfulRunAt(successfulRunAt)}
          </span>
        </Reading>
        <Reading label={PAGE_DETAIL_SECTION_HEADING.cases}>
          <Magnitude value={openCases} fontSize={12.5} />
        </Reading>
      </div>

      {page.flag === "paused" ? (
        <CollectionNotice detail="This page is paused. Its history and baseline are retained, but it will not collect new data until it is changed to Watching or Priority." />
      ) : null}
      {page.runState ? <CollectionState page={page} job={job} /> : null}
      {!page.runState && page.lastCollectionStatus === "partial" ? (
        <CollectionNotice
          tone="warn"
          title="Partial collection retained"
          detail="Every successful device and agent scan remains in history; unavailable tests will be attempted by the next scheduled collection."
        />
      ) : null}
      {experimentVariation ? (
        <CollectionNotice
          title="Experiment variation detected"
          detail="This page may serve different experiment variants across repeated measurements. Compare trends and retained evidence before treating a single-run change as a regression."
        />
      ) : null}
    </Section>
  );
}

/* ── Open cases ─────────────────────────────────────────────────────────── */

/**
 * The columns of a case row on this page.
 *
 * Narrower than the issues list's six, and for a reason rather than for space:
 * the list's scope column says which pages a case covers, and here the answer is
 * always this one. A column whose value never changes is a column that teaches
 * the reader to stop reading it.
 */
const CASE_ROW_COLUMNS = [
  "minmax(72px, max-content)",
  "minmax(0, 1fr)",
  "minmax(0, max-content)",
  "minmax(88px, max-content)",
  "minmax(0, max-content)",
].join(" ");

/**
 * One case, as a link and nothing else.
 *
 * A case in Watch carries W1's marks, imported rather than redrawn: the run is
 * three 16px marks with the next scheduled check stretched into a countdown, and
 * changing W1's mark set changes this row without an edit here. They are not
 * dots — a dot cannot say whether a check agreed, disagreed, or could not be
 * taken, and those are the three things the reader is here for.
 *
 * Where the case is a native-element finding, the applicability control is a
 * SIBLING of the link rather than a child: a control inside a control is invalid,
 * and a screen reader cannot say which of the two it is about to activate.
 * Applicability is also not one of S2's decisions — Exclude answers "does this
 * count for this site", which is a different question from Accept and Dismiss.
 */
function CaseRow({
  issue,
  basePath,
  now,
  applicability,
}: {
  issue: IssueCase;
  basePath: string;
  now?: Date;
  applicability?: React.ReactNode;
}) {
  const impact = formatImpact(issue.impactMs);
  const diagnosis = issue.diagnosis || issue.title;
  const run = queueOf(issue.state) === "watch" ? runOf(issue) : [];

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 14,
        borderTop: "1px solid var(--border-hairline)",
        background: "var(--surface-card)",
      }}
    >
      <Link
        href={caseHref(basePath, issue.id)}
        style={{
          display: "grid",
          gridTemplateColumns: CASE_ROW_COLUMNS,
          gap: 14,
          alignItems: "center",
          flex: "1 1 auto",
          minWidth: 0,
          padding: "11px 14px",
          textDecoration: "none",
          color: "var(--text-body)",
        }}
      >
        <span>
          <StatusChip state={issue.state} />
        </span>

        <span style={{ ...TRUNCATE_CELL, fontSize: 13, fontWeight: 500 }} title={diagnosis}>
          {diagnosis}
        </span>

        {run.length > 0 ? (
          <CheckpointMarks run={run} countdown now={now} />
        ) : (
          <span style={{ ...TRUNCATE_CELL, fontSize: 12.5, color: "var(--text-muted)" }}>
            {CONFIDENCE_LABEL[issue.confidence]}
          </span>
        )}

        <span
          style={{
            ...NUMERIC_CELL,
            fontSize: 12.5,
            color: impact.measured ? "var(--magnitude-value)" : "var(--text-muted)",
          }}
        >
          {impact.text}
        </span>

        <span style={{ ...NUMERIC_CELL, fontSize: 12.5, color: "var(--text-muted)" }}>
          {EFFORT_LABEL[issue.effort]}
        </span>
      </Link>

      {applicability ? <span style={{ flex: "0 0 auto", paddingRight: 14 }}>{applicability}</span> : null}
    </div>
  );
}

/** The same button treatment on both sides of the applicability toggle. */
function QuietButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        appearance: "none",
        cursor: "pointer",
        fontSize: 12,
        padding: "4px 9px",
        borderRadius: 6,
        border: "1px solid var(--border-strong)",
        background: "var(--surface-card)",
        color: "var(--text-body)",
        whiteSpace: "nowrap",
      }}
    >
      {label}
    </button>
  );
}

/**
 * The last reading of an excluded native-element finding, kept.
 *
 * Excluding is not deleting. The reading stays, greyed and struck, with the
 * reason beside it — the audit is explicit that hiding evidence without saying
 * why is how the agent tab lost its reader's trust. The sentence is S2's, not a
 * second version of it: the two consequences it names are the same two here.
 */
function ExcludedFinding({
  finding,
  reason,
  onInclude,
}: {
  finding: NativeElementLifecycle;
  reason: ExclusionReason;
  onInclude: () => void;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 14,
        padding: "11px 14px",
        borderTop: "1px solid var(--border-hairline)",
        background: "var(--surface-raised)",
      }}
    >
      <div style={{ flex: "1 1 auto", minWidth: 0 }}>
        <div style={{ fontSize: 13, color: "var(--text-muted)", textDecoration: "line-through" }}>
          {finding.title}
        </div>
        <div style={{ marginTop: 3, fontSize: 12, color: "var(--text-muted)" }}>
          <Magnitude value={finding.count} unit={finding.count === 1 ? "instance" : "instances"} fontSize={12} />
          {" · last seen "}
          {finding.lastDetected.date}
        </div>
        <div style={{ marginTop: 4, fontSize: 12, color: "var(--text-muted)", maxWidth: "70ch" }}>
          {excludedNote(reason)}
        </div>
      </div>
      <span style={{ flex: "0 0 auto" }}>
        <QuietButton label={applicabilityActionLabel("excluded")} onClick={onInclude} />
      </span>
    </div>
  );
}

function CasesSection({
  page,
  cases,
  basePath,
  canManage,
  onExclude,
  onInclude,
}: {
  page: WatchPage;
  cases: IssueCase[];
  basePath: string;
  canManage: boolean;
  onExclude: (findingId: string, reason: ExclusionReason) => void;
  onInclude: (findingId: string) => void;
}) {
  const [choosingFor, setChoosingFor] = useState<string | null>(null);

  // Excluded findings are read off the page's own scans rather than off the
  // cases: an excluded finding stops being promoted, so waiting for a case to
  // carry it would be waiting for the thing exclusion prevents.
  const excluded = useMemo(
    () => nativeElementIssuesForPage(page.history).filter((finding) =>
      nativeElementApplicability(page.nativeElementControls, finding.id) === "excluded"),
    [page.history, page.nativeElementControls],
  );

  const empty = cases.length === 0 && excluded.length === 0;

  return (
    <Section id="cases">
      <div style={{ border: "1px solid var(--border-hairline)", borderRadius: 11, overflow: "hidden" }}>
        {empty ? (
          <div style={{ padding: "26px 18px", fontSize: 12.5, color: "var(--text-muted)" }}>
            Nothing is open on this page.
          </div>
        ) : null}

        {cases.map((issue) => {
          // `cause` is the finding id a case was derived from, and it survives
          // grouping — which is why applicability is read from it rather than
          // from a case id that a merge can change.
          const findingId = isKnownNativeElementId(issue.cause) ? issue.cause : null;
          const choosing = findingId !== null && choosingFor === findingId;
          return (
            <Fragment key={issue.id}>
              <CaseRow
                issue={issue}
                basePath={basePath}
                applicability={findingId && canManage && !choosing ? (
                  <QuietButton
                    label={applicabilityActionLabel("included")}
                    onClick={() => setChoosingFor(findingId)}
                  />
                ) : undefined}
              />
              {choosing && findingId ? (
                <div style={{ padding: "0 14px 12px 14px", background: "var(--surface-card)" }}>
                  <ExclusionReasonPicker
                    label={`Reason for excluding ${issue.title}`}
                    onChoose={(reason) => {
                      setChoosingFor(null);
                      onExclude(findingId, reason);
                    }}
                    onCancel={() => setChoosingFor(null)}
                  />
                </div>
              ) : null}
            </Fragment>
          );
        })}

        {excluded.length > 0 ? (
          <div
            style={{
              padding: "9px 14px",
              borderTop: "1px solid var(--border-hairline)",
              background: "var(--surface-raised)",
              fontSize: 12,
              fontWeight: 600,
              color: "var(--text-muted)",
            }}
          >
            {APPLICABILITY_LABEL.excluded}
          </div>
        ) : null}
        {excluded.map((finding) => (
          <ExcludedFinding
            key={finding.key}
            finding={finding}
            reason={nativeElementExclusionReason(page.nativeElementControls, finding.id)!}
            onInclude={() => onInclude(finding.id)}
          />
        ))}
      </div>
    </Section>
  );
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

function ReadingsSection({
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
        note: `No ${strategy} PSI measurement completed for this collection. Other independent results are retained.`,
        date: d.date,
        strategy,
        agentChecksRecorded: d.agent?.length ?? 0,
        agentReadiness: d.agentReadiness ?? null,
        kitesurf: d.kitesurf ?? null,
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
          Desktop and Mobile are stacked for comparison. Each median line includes its run-to-run range; reference
          lines show that device&apos;s original benchmark and, when enough scans exist, the previous {rangeDays}-day
          period median.
          {excludedHistory.length > 0 && " Shaded bands mark measurements retained for diagnosis but excluded from scores, trends, and recommendations."}
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
        <div style={{ padding: "13px 22px", borderBottom: "1px solid var(--border-hairline)", fontSize: 12, color: "var(--text-muted)" }}>
          Every recorded collection · <span style={{ color: "var(--text-body)", textTransform: "capitalize", fontWeight: 600 }}>{strategy}</span> primary · Lighthouse median with range below
          {showVisitorColumns && " · CrUX p75 with weekly change below"}
          {excludedHistory.length > 0 && " · PSI anomaly rows are observed measurements excluded from scoring"}
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
          <div style={{ textAlign: "center" }}>Perf</div>
          <div style={{ textAlign: "center" }}>A11y</div>
          <div style={{ textAlign: "center" }}>BP</div>
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
            nightHasStrategy(d, "mobile") ? "M PSI" : null,
            nightHasStrategy(d, "desktop") ? "D PSI" : null,
            visitorSnapshot ? "CrUX" : null,
            Array.isArray(d.agent) ? "Agent" : null,
            d.kitesurf?.status === "available" ? "Kitesurf" : null,
          ].filter((label): label is string => label !== null);
          const cell = (k: CategoryKey) => {
            if (!nightHasStrategy(d, strategy)) {
              return (
                <div aria-label={`No ${strategy} PSI measurement`} style={{ textAlign: "center", color: "var(--health-none-text)" }}>
                  —
                </div>
              );
            }
            const score = d.scores[strategy][k];
            const categoryLabel = CATEGORIES.find((category) => category.key === k)?.label ?? k;
            return (
              <div
                aria-label={`${categoryLabel} ${excludedAnomaly ? "observed" : "median"} ${score.m}, range ${score.lo} to ${score.hi}${excludedAnomaly ? ", excluded PSI anomaly" : ""}`}
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
                aria-label={`${label} ${formatVisitorMetric(key, value)}, ${movement === "—" ? "no prior CrUX snapshot" : movement}`}
                title={visitorSnapshot ? `Rolling window ending ${visitorSnapshot.collectionEnd} · ${rating ?? "Unavailable"}` : "No CrUX window available for this night"}
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
                  title={`Completed independently: ${completedTests.join(", ") || "none"}`}
                  style={{ marginTop: 4, color: "var(--text-muted)", fontSize: 12, lineHeight: 1.3 }}
                >
                  {completedTests.join(" · ") || "No completed test"}
                </div>
              </div>
              <div style={{ fontSize: 12, display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 5 }}>
                {excludedAnomaly && (
                  <span
                    title="Retained for diagnosis; not used in status, trend, or recommendations"
                    style={{ color: "var(--text-muted)", fontWeight: 600 }}
                  >
                    ◆ PSI anomaly · excluded
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

/* ── The page ───────────────────────────────────────────────────────────── */

export default function PageDetail() {
  const searchParams = useSearchParams();
  const { id } = useParams<{ id: string }>();
  const store = useStore();
  const { pages, strategy, rangeDays, setRangeDays, chartCat, setChartCat } = store;
  const page = pages.find((p) => p.id === id);
  // Every case in the project, so the ones on this page can be picked out. The
  // hook runs before the missing-page branch below because a hook must.
  const view = useIssuesView("show_all", "impact");

  useEffect(() => {
    setChartCat("perf");
  }, [id, setChartCat]);

  const openCases = useMemo(
    () => view.cases
      // Open means a queue holds it. Resolved and Dismissed are reachable only
      // through Show all, and a page's open work is not either of those.
      .filter((issue) => queueOf(issue.state) !== "show_all" && issue.pageIds.includes(id))
      // An excluded finding does not count for this site, so it is not open work
      // — it keeps its reading below, under Excluded.
      .filter((issue) => !isKnownNativeElementId(issue.cause)
        || nativeElementApplicability(page?.nativeElementControls, issue.cause) === "included"),
    [view.cases, id, page?.nativeElementControls],
  );

  if (!page) {
    return (
      <div style={{ padding: 40 }}>
        <h1 style={{ margin: 0, fontSize: 18, fontWeight: 600, color: "var(--text-body)" }}>
          No page with that id
        </h1>
        <p style={{ marginTop: 8, fontSize: 13, color: "var(--text-muted)", maxWidth: "60ch" }}>
          It may have been removed from the Watchlist, or the link may be old.
        </p>
        <Link
          href={store.pathFor(DESTINATION_PATH.pages)}
          style={{ display: "inline-block", marginTop: 14, fontSize: 13, color: "var(--action-primary-ink)" }}
        >
          ← {DESTINATION_LABEL.pages}
        </Link>
      </div>
    );
  }

  const isPending = !page.baseline || !page.baselineCapturedAt;
  const collectionBlocked = page.flag === "paused" || (!!page.runState && page.runState !== "failed");
  const activeJob = store.jobs?.find((job) => job.runId === page.runId);
  const watchedPageHref = /^[a-z][a-z\d+.-]*:\/\//i.test(page.url) ? page.url : `https://${page.url}`;
  const thresholds = normalizePerformanceThresholds(store.performanceThresholds);
  // A development-only comparison of the two trend renderings side by side.
  const isStatusPreview = process.env.NODE_ENV === "development" && searchParams.get("statusPreview") === "compare";
  const mobileTrend = isStatusPreview ? "regressing" : pageRangeTrend(page, "mobile", rangeDays, thresholds);
  const desktopTrend = isStatusPreview ? "improving" : pageRangeTrend(page, "desktop", rangeDays, thresholds);

  /**
   * The section views, keyed by id.
   *
   * A `Record`, not an array: its key order cannot decide what appears where, so
   * the only thing that can is `PAGE_DETAIL_SECTIONS`. Adding a section to the
   * type without adding it here is a compile error rather than a silent gap.
   */
  const sections: Record<PageDetailSectionId, React.ReactNode> = {
    status: (
      <StatusSection
        page={page}
        job={activeJob}
        desktopTrend={desktopTrend}
        mobileTrend={mobileTrend}
        openCases={openCases.length}
        rangeDays={rangeDays}
        setRangeDays={setRangeDays}
        isPending={isPending}
      />
    ),
    cases: (
      <CasesSection
        page={page}
        cases={openCases}
        basePath={store.basePath}
        canManage={store.canManageProject}
        onExclude={(findingId, reason) => store.setNativeElementApplicability(page.id, findingId, reason)}
        onInclude={(findingId) => store.setNativeElementApplicability(page.id, findingId, null)}
      />
    ),
    readings: (
      <ReadingsSection
        page={page}
        strategy={strategy}
        rangeDays={rangeDays}
        chartCat={chartCat}
        setChartCat={setChartCat}
        store={store}
        isPending={isPending}
      />
    ),
  };

  return (
    <div>
      <ObjectDetailHeader
        breadcrumb={{ label: DESTINATION_LABEL.pages, href: store.pathFor(DESTINATION_PATH.pages) }}
        title={page.title}
        actions={store.canManageProject ? (
          <>
            <button
              disabled={collectionBlocked}
              title={page.flag === "paused" ? "Change this page to Watching or Priority before collecting" : undefined}
              onClick={() => store.runPage(page.id)}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 8,
                padding: "9px 15px",
                border: "none",
                borderRadius: 8,
                background: "var(--action-primary-bg)",
                color: "var(--action-primary-text)",
                fontSize: 12.5,
                fontWeight: 550,
                cursor: collectionBlocked ? "not-allowed" : "pointer",
                opacity: collectionBlocked ? 0.65 : 1,
                whiteSpace: "nowrap",
              }}
            >
              <RefreshIcon size={15} style={{ color: "var(--action-primary-text)" }} />
              {page.flag === "paused"
                ? "Paused"
                : page.runState === "queued"
                  ? "Queued…"
                  : page.runState === "dispatching"
                    ? "Starting…"
                    : page.runState === "waiting_for_evidence"
                      ? "Waiting for evidence…"
                      : page.runState === "running"
                        ? "Running…"
                        : "Run now"}
            </button>
            <button
              onClick={() => store.openMarker(page.id)}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 8,
                padding: "9px 15px",
                border: "1px solid var(--border-strong)",
                borderRadius: 8,
                background: "var(--surface-card)",
                color: "var(--text-body)",
                fontSize: 12.5,
                fontWeight: 550,
                cursor: "pointer",
                whiteSpace: "nowrap",
              }}
            >
              <PlusIcon size={15} />
              Marker
            </button>
          </>
        ) : undefined}
        metadata={
          <a
            href={watchedPageHref}
            target="_blank"
            rel="noreferrer"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              fontSize: 12.5,
              color: "var(--action-primary-ink)",
              textDecoration: "none",
            }}
          >
            <span>{page.url}</span>
            <ArrowUpRightIcon size={14} weight="regular" aria-hidden="true" />
          </a>
        }
      />

      <div style={{ padding: "0 40px 64px" }}>
        {/* Rendered from the array, so the array is the order. */}
        {PAGE_DETAIL_SECTIONS.map((section) => (
          <Fragment key={section}>{sections[section]}</Fragment>
        ))}
      </div>
    </div>
  );
}
