"use client";

import { Fragment } from "react";
import type { CollectionJob, RangeDays, WatchPage } from "@/lib/types";
import { pageRangeTrend, scoreBand, statusMeta } from "@/lib/scoring";
import { PAGE_DETAIL_JUMP_LABEL, PAGE_DETAIL_JUMP_TARGET, PAGE_DETAIL_SECTION_HEADING, pageDetailAnchor } from "@/lib/page-detail-sections";
import { HealthChip, type HealthChipBand } from "@/components/health-chip";
import { TrendArrow } from "@/components/trend-arrow";
import { Magnitude } from "@/components/magnitude";
import { SelectMenu } from "@/components/select-menu";
import type { SelectMenuOption } from "@/components/select-menu";
import { failedRunDetailMessage, formatSuccessfulRunAt, lastSuccessfulRunAt } from "@/lib/collectionStatus";
import { Reading, Section } from "./page-detail-bits";


const PAGE_RANGE_OPTIONS: ReadonlyArray<SelectMenuOption<RangeDays>> = [
  { value: 3, label: "Last 3 days" },
  { value: 7, label: "Last 7 days" },
  { value: 30, label: "Last 30 days" },
  { value: 90, label: "Last 90 days" },
];

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
    ...retained.map((strategy) => `${strategy[0].toUpperCase()}${strategy.slice(1)} score`),
    ...(job?.cruxCompletedAt ? ["Visitor figures"] : []),
    ...(job?.agentCompletedAt ? ["Agent checks"] : []),
  ];
  const retryingTests = [
    ...(["mobile", "desktop"] as const)
      .filter((strategy) => !retained.includes(strategy))
      .map((strategy) => `${strategy[0].toUpperCase()}${strategy.slice(1)} score`),
    ...(!job?.cruxCompletedAt ? ["Visitor figures"] : []),
    ...(!job?.agentCompletedAt ? ["Agent checks"] : []),
  ];
  const waitDetail = retainedTests.length > 0
    ? `${retainedTests.join(" and ")} retained. `
      + `Retrying ${retryingTests.join(" and ")}`
      + `${job?.nextRetryAt ? ` around ${formatSuccessfulRunAt(job.nextRetryAt)}` : " in the next evidence cycle"}.`
    : `No test has finished yet. Retrying the mobile score, the desktop score, the visitor figures, and the agent checks`
      + `${job?.nextRetryAt ? ` around ${formatSuccessfulRunAt(job.nextRetryAt)}` : " in the next evidence cycle"}.`;
  const providerDetail = (["mobile", "desktop"] as const).flatMap((strategy) => {
    const error = job?.strategyErrors?.[strategy];
    return error ? [`${strategy[0].toUpperCase()}${strategy.slice(1)}: ${error}`] : [];
  }).join(" · ");
  const latestDetail = [
    providerDetail,
    job?.cruxError ? `Visitor figures: ${job.cruxError}` : "",
    job?.agentError ? `Agent checks: ${job.agentError}` : "",
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

export function StatusSection({
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
