"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type { CSSProperties } from "react";
import { issueCasesFrom, lastRunAtOf, useStore } from "@/components/store";
import { EmptyAction, EmptyState } from "@/components/empty-state";
import { HealthChip } from "@/components/health-chip";
import { Magnitude } from "@/components/magnitude";
import { TrendArrow } from "@/components/trend-arrow";
import { buildPageChanges, type PageChangeGroupView, type PageChangeRow, type PageChangesView } from "@/lib/pageChanges";
import {
  PAGES_CALM,
  PAGES_CASES_ZERO,
  PAGES_GROUP_EMPTY,
  PAGES_GROUP_HIDE,
  PAGES_GROUP_MEANS,
  PAGES_GROUP_SHOW,
  pagesCasesUnit,
  pagesDelta,
  pagesDeltaLine,
  pagesGroupHeading,
  pagesStuckDuration,
} from "@/lib/pages-copy";
import { withBasePath } from "@/lib/paths";
import type { Strategy } from "@/lib/types";
import { DESTINATION_LABEL, DESTINATION_PATH } from "@/lib/vocabulary";

/**
 * The Changes view: what moved on the watchlist, in four groups.
 *
 * This is the default face of the Pages destination, because the question a
 * person opens it with is "what happened", not "show me every page". The matrix
 * answers the second question and is one tab away, unchanged.
 *
 * What this screen does NOT carry is worth stating, because all three were on
 * the table:
 *
 *   - No watch controls. Deciding what is worth watching is the Watchlist's.
 *   - No alert thresholds. Those are S8's, on their own screen.
 *   - No range selector. The groups are read over the longest window each page
 *     has evidence for, and a second range control on a screen whose readings
 *     ignore it would be a control that lies.
 *
 * Nothing about a page's issues is shown inline either. A row says how many
 * cases are open and links to the page; the case itself is where evidence and
 * every action live, and a list that starts summarising findings becomes a
 * second issues list that nobody maintains.
 *
 * Every number here carries its unit, and every word comes from
 * `lib/pages-copy.ts` — nothing on this screen is authored in the markup.
 */

/**
 * Five tracks, shared by the rows and the column header above them.
 *
 * Health and trend are two adjacent columns rather than one cell, which is
 * rule 4 made structural: the verdict keeps the hue, the direction keeps the
 * word, and they sit side by side so a reader takes them as two facts. Merging
 * them into one cell is how a coloured direction gets reinvented.
 */
const ROW_COLUMNS = [
  // path — takes the space the others do not need, and ellipses
  "minmax(0, 1fr)",
  // health — a chip carries meaning, so it keeps a floor and is never clipped
  "minmax(112px, max-content)",
  // trend — the word, at its own width
  "minmax(104px, max-content)",
  // delta — right-aligned, wide enough for "−14 pts over 30 days"
  "minmax(150px, max-content)",
  // open cases
  "minmax(96px, max-content)",
].join(" ");

const ROW_GAP = 14;

const COLUMN_HEADERS = ["Path", "Health", "Trend", "Delta", "Open cases"] as const;

const TRUNCATE_CELL: CSSProperties = {
  minWidth: 0,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};

const NUMERIC_CELL: CSSProperties = {
  whiteSpace: "nowrap",
  textAlign: "right",
  fontVariantNumeric: "tabular-nums",
  justifySelf: "end",
};

/** The device a reading came from, in the row prefix the app already uses. */
const DEVICE_PREFIX: Record<Strategy, string> = { mobile: "M", desktop: "D" };
const DEVICE_NAME: Record<Strategy, string> = { mobile: "Mobile", desktop: "Desktop" };

/**
 * One derivation of the Changes view, memoised on the store's state.
 *
 * The shell reads it for the header line and hands the same object to the body,
 * so the sentence above the groups and the groups themselves are one reading
 * rather than two that happen to agree.
 */
export function usePageChanges(): PageChangesView {
  const { pages, recs, performanceThresholds } = useStore();
  return useMemo(
    () => buildPageChanges({
      pages,
      cases: issueCasesFrom({ recs, pages }),
      performanceThresholds,
      // The newest completed run, not the wall clock: it keeps a render a pure
      // function of stored state, and dates arrival against the last thing that
      // actually measured anything.
      now: lastRunAtOf(pages),
    }),
    [pages, recs, performanceThresholds],
  );
}

function ColumnHeaders() {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: ROW_COLUMNS,
        gap: ROW_GAP,
        alignItems: "center",
        padding: "0 40px 8px",
        // Registry rule 8: a column header tells you which column you are
        // reading, so it never renders below 12px.
        fontSize: 12,
        fontWeight: 600,
        letterSpacing: ".04em",
        textTransform: "uppercase",
        color: "var(--text-muted)",
      }}
    >
      {COLUMN_HEADERS.map((label, index) => (
        <span key={label} style={index >= 3 ? NUMERIC_CELL : TRUNCATE_CELL}>
          {label}
        </span>
      ))}
    </div>
  );
}

/** One page. The row's only job is to get you to the page (S3). */
function PageRow({ row, basePath }: { row: PageChangeRow; basePath: string }) {
  const delta = pagesDelta(row.delta, row.band !== null);
  const healthTitle = row.score !== null && row.scoreDevice
    ? `${DEVICE_NAME[row.scoreDevice]} Performance ${row.score} of 100`
    : undefined;

  return (
    <Link
      href={withBasePath(basePath, `${DESTINATION_PATH.pages}/${encodeURIComponent(row.pageId)}`)}
      style={{
        display: "grid",
        gridTemplateColumns: ROW_COLUMNS,
        gap: ROW_GAP,
        alignItems: "center",
        padding: "11px 40px",
        borderTop: "1px solid var(--border-hairline)",
        textDecoration: "none",
        color: "var(--text-body)",
        background: "var(--surface-card)",
      }}
    >
      <span style={{ minWidth: 0 }}>
        <span style={{ ...TRUNCATE_CELL, display: "block", fontSize: 13, fontWeight: 600 }} title={row.url}>
          {row.path}
        </span>
        <span style={{ ...TRUNCATE_CELL, display: "block", marginTop: 2, fontSize: 12, color: "var(--text-muted)" }}>
          {row.title}
        </span>
      </span>

      {/* Hue, and only hue. `none` says the reading is absent rather than
          painting a page nobody measured as though it were fine. The duration
          under it is how long the band has held, which is the whole question in
          the group this row is usually in. */}
      <span style={{ minWidth: 0 }}>
        <HealthChip band={row.band ?? "none"} title={healthTitle} />
        {row.band === "poor" && row.poorForDays !== null ? (
          <span style={{ ...TRUNCATE_CELL, display: "block", marginTop: 3, fontSize: 12, color: "var(--text-muted)" }}>
            {pagesStuckDuration(row.poorForDays)}
          </span>
        ) : null}
      </span>

      {/* Words, and only words. A page with no verdict yet gets neither an
          arrow nor a direction — it gets the reason there is nothing to show. */}
      <span style={{ ...TRUNCATE_CELL, fontSize: 12.5 }}>
        {row.trend
          ? <TrendArrow trend={row.trend} fontSize={12.5} />
          : <span style={{ color: "var(--health-none-text)" }}>No verdict yet</span>}
      </span>

      <span
        style={{ ...NUMERIC_CELL, display: "inline-flex", alignItems: "baseline", gap: 6, fontSize: 12.5 }}
        aria-label={row.delta
          ? `${DEVICE_NAME[row.delta.device]} Performance change: ${pagesDeltaLine(delta)}`
          : `Performance change: ${pagesDeltaLine(delta)}`}
      >
        {delta.unit ? (
          <>
            {row.delta ? (
              <span aria-hidden="true" style={{ color: "var(--text-muted)", fontSize: 12, fontWeight: 650 }}>
                {DEVICE_PREFIX[row.delta.device]}
              </span>
            ) : null}
            <Magnitude value={delta.value} unit={delta.unit} fontSize={12.5} />
          </>
        ) : (
          <span style={{ color: "var(--text-muted)" }}>{delta.value}</span>
        )}
      </span>

      {/*
        A count over the three counted queues — Decide, Fix and Watch — which is
        what "open" means here. Registry rule 9 allows the word: "Open" is
        banned as a work-state LABEL, and this is a quantity, not a state. The
        accessible name spells the queues out so the two cannot be confused.
      */}
      <span
        style={{ ...NUMERIC_CELL, fontSize: 12.5 }}
        aria-label={`${row.openCases} ${row.openCases === 1 ? "case" : "cases"} in Decide, Fix or Watch`}
      >
        {row.openCases > 0
          ? <Magnitude value={row.openCases} unit={pagesCasesUnit(row.openCases)} fontSize={12.5} />
          : <span style={{ color: "var(--text-muted)" }}>{PAGES_CASES_ZERO}</span>}
      </span>
    </Link>
  );
}

/**
 * One group and its rows.
 *
 * A group that starts closed folds behind its exact count and a Show control,
 * never behind a gate: the count is the whole set, it is stated whether the
 * group is open or shut, and opening it is a local toggle rather than a
 * navigation. A group that starts open and holds nothing says so in a line —
 * three of these on a quiet site is the calm reading, and an empty group with
 * no line at all is what reads as broken.
 */
function ChangeGroup({ group, basePath }: { group: PageChangeGroupView; basePath: string }) {
  const [open, setOpen] = useState(group.startsOpen);
  // An empty group has nothing to show, so it carries no control to show it.
  const foldable = !group.startsOpen && group.count > 0;
  const showRows = (open || !foldable) && group.count > 0;

  const heading = (
    <span style={{ minWidth: 0 }}>
      {/* The heading carries the count, and the count is exact — open or shut.
          It counts rows; it never totals or averages what they say (rule 19). */}
      <span style={{ display: "block", fontSize: 13.5, fontWeight: 650 }}>
        {pagesGroupHeading(group.key, group.count, group.improved)}
      </span>
      <span style={{ display: "block", marginTop: 3, fontSize: 12.5, color: "var(--text-muted)" }}>
        {PAGES_GROUP_MEANS[group.key]}
      </span>
    </span>
  );

  const HEADING_ROW: CSSProperties = {
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 14,
    padding: "13px 40px",
    background: "var(--surface-raised)",
  };

  return (
    <section style={{ borderTop: "1px solid var(--border-hairline)" }}>
      {foldable ? (
        <button
          type="button"
          onClick={() => setOpen((previous) => !previous)}
          aria-expanded={open}
          style={{
            ...HEADING_ROW,
            width: "100%",
            border: 0,
            color: "var(--text-body)",
            font: "inherit",
            textAlign: "left",
            cursor: "pointer",
          }}
        >
          {heading}
          <span style={{ whiteSpace: "nowrap", fontSize: 12.5, fontWeight: 600, color: "var(--action-primary-ink)" }}>
            {open ? PAGES_GROUP_HIDE : PAGES_GROUP_SHOW}
          </span>
        </button>
      ) : (
        <div style={HEADING_ROW}>{heading}</div>
      )}

      {showRows ? group.rows.map((row) => <PageRow key={row.pageId} row={row} basePath={basePath} />) : null}

      {group.count === 0 ? (
        <p style={{ margin: 0, padding: "13px 40px", borderTop: "1px solid var(--border-hairline)", background: "var(--surface-card)", fontSize: 12.5, color: "var(--text-muted)" }}>
          {PAGES_GROUP_EMPTY[group.key]}
        </p>
      ) : null}
    </section>
  );
}

export function PagesChanges({ view }: { view: PageChangesView }) {
  const { basePath, pathFor } = useStore();

  /*
    Nothing is being measured, so there is nothing to group. The column headers
    do not render here on purpose: an empty table with headers tells the reader
    their view is broken rather than that their watchlist is empty. Four empty
    group headings would say the same thing at four times the volume.

    This is not the quiet-week case. A quiet week has pages, and it shows every
    heading.
  */
  if (view.rows.length === 0) {
    return (
      <EmptyState
        heading={view.pausedCount > 0 ? "Every page is paused" : "No pages are being measured"}
        action={(
          <EmptyAction href={pathFor(DESTINATION_PATH.watchlist)}>
            {`Open ${DESTINATION_LABEL.watchlist}`}
          </EmptyAction>
        )}
      >
        {view.pausedCount > 0
          ? `Nothing measures a paused page, so no reading can say whether ${view.pausedCount === 1 ? "it has" : "they have"} changed. Resume one and the next run puts it back in this view.`
          : "Page Watch measures the pages on your watchlist on a schedule. Add one, and what the runs find shows up here."}
      </EmptyState>
    );
  }

  return (
    <div style={{ minWidth: 0 }}>
      {/* The three groups that would have asked something of the reader are all
          empty. Saying so once, in a sentence, is what makes the four headings
          below read as a quiet week rather than as a screen that failed to
          load. It claims exactly what `calm` means and nothing more — pages
          that improved are in the unchanged group, and it does not speak for
          them. */}
      {view.calm ? (
        <p style={{ margin: "0 40px 16px", fontSize: 13, color: "var(--health-good-text)" }}>
          {PAGES_CALM}
        </p>
      ) : null}

      <ColumnHeaders />

      <div style={{ borderBottom: "1px solid var(--border-hairline)" }}>
        {view.groups.map((group) => (
          <ChangeGroup key={group.key} group={group} basePath={basePath} />
        ))}
      </div>

      <p style={{ margin: "15px 40px 0", maxWidth: 760, fontSize: 12, color: "var(--text-muted)", lineHeight: 1.5 }}>
        {"Health is the worse of the two devices' latest Performance medians. A delta compares the oldest and newest medians the page has evidence for, on the device that moved most, and a page is regressing when either device dropped."}
        {view.pausedCount > 0
          ? ` ${view.pausedCount} paused ${view.pausedCount === 1 ? "page is" : "pages are"} not measured and are not grouped here; they are in All pages.`
          : ""}
      </p>
    </div>
  );
}
