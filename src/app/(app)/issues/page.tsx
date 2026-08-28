"use client";

import { useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  DEFAULT_ISSUE_SORT,
  DEFAULT_SORT_DIRECTION,
  ISSUE_SORTS,
  ISSUE_SORT_LABEL,
  parseIssueSort,
  parseSortDirection,
  reverseDirection,
  useIssuesView,
  useStore,
  type IssueSort,
  type SortDirection,
} from "@/components/store";
import { COUNTED_QUEUES, DESTINATION_LABEL, DESTINATION_PATH, QUEUE_LABEL, parseQueue, type Queue } from "@/lib/vocabulary";
import { PageHeader } from "@/components/page-header";
import { QueueTabs } from "@/components/queue-tabs";
import { IssueGroup } from "@/components/issue-group";
import {
  ISSUE_ROW_COLUMNS,
  ISSUE_ROW_GAP,
  NUMERIC_CELL,
  TRUNCATE_CELL,
} from "@/components/issue-row";
import {
  EverythingResolved,
  FirstRunPending,
  LastRunFailed,
  NoPagesWatched,
  QueueEmptyOthersBusy,
  WatchEmpty,
} from "@/components/issue-empty";
import { SelectMenu } from "@/components/select-menu";
import { WatchQueue } from "@/components/watch-queue";
import { FixQueue } from "@/components/fix-queue";
import { WATCH_EMPTY } from "@/lib/watch-copy";

/**
 * The issues list — the app's primary destination.
 *
 * A fresh project produces fifty to seventy findings in its first couple of
 * days: seven pages by two devices by several opportunities, plus the
 * native-element and visitor readings. Three things keep that from arriving as
 * an undifferentiated wall:
 *
 *   1. Cause grouping, from F2: the same problem on six pages is one case.
 *   2. Remediation grouping: cases that one fix covers are one decision.
 *   3. The fold: everything under the project's own savings threshold collapses
 *      into a single row that says how much it is holding, and expands in place.
 *
 * None of the three hides anything. The fold is a fold, the sorts are sorts,
 * and every case in a queue is one row in it.
 *
 * The queue and the sort live in the URL. Both are things one person sends
 * another, and neither is a preference worth storing.
 */

/** Which way round the active column currently reads. */
const DIRECTION_GLYPH: Record<SortDirection, string> = { asc: "\u2191", desc: "\u2193" };
const DIRECTION_WORD: Record<SortDirection, string> = { asc: "ascending", desc: "descending" };

/**
 * Column headers, drawn on the same six tracks as the rows below them — and the
 * sort control for the column each one heads.
 *
 * The header IS the sort rather than a caption above one:
 *
 *   - The label comes from `ISSUE_SORT_LABEL`, so a column and the Sort menu
 *     read one map and cannot end up calling the same ordering two things.
 *   - The first click sorts the column in ITS OWN default direction rather than
 *     a uniform descending — a triage list wants the lifecycle from `new` and
 *     effort from the cheapest. The second click reverses it, and the arrow
 *     says which way it currently reads.
 *
 * Newest and What changed head no column: there is no date column to head. The
 * menu is what keeps them reachable, which is why it stays.
 */
const COLUMN_SORTS = [
  "state",
  "cause",
  "pages",
  "confidence",
  "impact",
  "effort",
] as const satisfies readonly IssueSort[];

function ColumnHeaders({
  sort,
  direction,
  hrefFor,
}: {
  sort: IssueSort;
  direction: SortDirection;
  hrefFor: (next: { sort: IssueSort; dir?: SortDirection }) => string;
}) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: ISSUE_ROW_COLUMNS,
        gap: ISSUE_ROW_GAP,
        alignItems: "center",
        padding: "0 40px 8px",
        // Registry rule 8: nothing carrying meaning renders below 12px, and a
        // column header is what tells you which column you are reading.
        fontSize: 12,
        fontWeight: 600,
        letterSpacing: ".04em",
        textTransform: "uppercase",
        color: "var(--text-muted)",
      }}
    >
      {COLUMN_SORTS.map((key, index) => {
        const active = key === sort;
        const numeric = index >= 4;
        // An inactive column opens in its own default; the active one reverses.
        const next = active ? reverseDirection(direction) : DEFAULT_SORT_DIRECTION[key];
        return (
          <Link
            key={key}
            href={hrefFor({ sort: key, dir: next })}
            replace
            // Which column is sorted, which way, and what this click will do —
            // in words, for a reader who cannot see the arrow.
            aria-label={
              active
                ? `Sorted by ${ISSUE_SORT_LABEL[key]}, ${DIRECTION_WORD[direction]}. Sort ${DIRECTION_WORD[next]}.`
                : `Sort by ${ISSUE_SORT_LABEL[key]}`
            }
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: numeric ? "flex-end" : "flex-start",
              gap: 4,
              minWidth: 0,
              font: "inherit",
              letterSpacing: "inherit",
              textTransform: "inherit",
              textDecoration: active ? "underline" : "none",
              textUnderlineOffset: 3,
              // Not colour alone — the underline and the arrow carry it too.
              color: active ? "var(--text-body)" : "inherit",
            }}
          >
            {/* Numeric columns are right-aligned, so their arrow leads rather
                than trails; the label still ends at the column edge. */}
            {numeric && active ? <span aria-hidden="true">{DIRECTION_GLYPH[direction]}</span> : null}
            <span style={numeric ? NUMERIC_CELL : TRUNCATE_CELL}>{ISSUE_SORT_LABEL[key]}</span>
            {!numeric && active ? <span aria-hidden="true">{DIRECTION_GLYPH[direction]}</span> : null}
          </Link>
        );
      })}
    </div>
  );
}

export default function IssuesPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { basePath, pathFor, pages } = useStore();

  const queue = parseQueue(searchParams.get("queue"));
  const sort = parseIssueSort(searchParams.get("sort"));
  const direction = parseSortDirection(searchParams.get("dir"), sort);
  const view = useIssuesView(queue, sort, direction);

  // The tail starts folded. Opening it is the one action this list offers, and
  // it is not a commitment to anything — see the note on the fold below.
  const [tailOpen, setTailOpen] = useState(false);

  const linkTo = useMemo(
    () => (next: { queue?: Queue; sort?: IssueSort; dir?: SortDirection }) => {
      const params = new URLSearchParams();
      params.set("queue", next.queue ?? queue);
      const nextSort = next.sort ?? sort;
      // Naming a sort without a direction means "start it the way it reads by
      // default" — which is how the menu behaves, and how the first click on a
      // column behaves. Staying on the current sort keeps the current
      // direction, so changing queue does not silently un-reverse the list.
      const nextDir = next.dir ?? (nextSort === sort ? direction : DEFAULT_SORT_DIRECTION[nextSort]);
      if (nextSort !== DEFAULT_ISSUE_SORT) params.set("sort", nextSort);
      // Only a direction that is not the sort's own default reaches the URL, so
      // the common link stays short and a reversed one is explicit.
      if (nextDir !== DEFAULT_SORT_DIRECTION[nextSort]) params.set("dir", nextDir);
      return pathFor(`${DESTINATION_PATH.issues}?${params.toString()}`);
    },
    [pathFor, queue, sort, direction],
  );

  // The same counts the tabs badge, stated in a sentence. One selector behind
  // both, so the header and the tabs cannot disagree.
  const purpose = `One case per problem. ${COUNTED_QUEUES
    .map((counted) => `${view.counts[counted] ?? 0} to ${QUEUE_LABEL[counted].toLowerCase()}`)
    .join(", ")}.`;

  const watched = pages.filter((page) => page.flag !== "paused");
  const failed = watched
    .filter((page) => page.runState === "failed")
    .sort((a, b) => (a.lastRunAt ?? "").localeCompare(b.lastRunAt ?? ""))
    .at(-1);
  const elsewhere = COUNTED_QUEUES.some((counted) => counted !== queue && (view.counts[counted] ?? 0) > 0);

  /**
   * Which of the five non-list states applies, in the order that answers the
   * reader's question soonest. Nothing measured beats nothing found, and
   * nothing found beats nothing in this particular queue.
   */
  function nonListState() {
    if (watched.length === 0) {
      return <NoPagesWatched pagesHref={pathFor(DESTINATION_PATH.pages)} />;
    }
    if (watched.every((page) => page.status === "pending")) {
      return <FirstRunPending pageCount={watched.length} pagesHref={pathFor(DESTINATION_PATH.pages)} />;
    }
    if (view.cases.length === 0 && failed) {
      return (
        <LastRunFailed
          pageTitle={failed.title}
          error={failed.lastError}
          pageHref={pathFor(`${DESTINATION_PATH.pages}/${failed.id}`)}
        />
      );
    }
    // Watch says its own sentence, and offers nothing. The three states above
    // still win: each of them describes a project that cannot have produced
    // evidence yet, which is not the same as having none outstanding.
    if (queue === "watch") {
      return <WatchEmpty heading={WATCH_EMPTY} />;
    }
    if (elsewhere) {
      return <QueueEmptyOthersBusy queue={queue} counts={view.counts} hrefFor={(next) => linkTo({ queue: next })} />;
    }
    // Nothing is in flight in any queue. Cases may still exist — settled ones
    // live in Show all — or the runs may simply never have found anything.
    return <EverythingResolved caseCount={view.cases.length} showAllHref={linkTo({ queue: "show_all" })} />;
  }

  /**
   * Two of the four queues draw themselves, and both for the same reason.
   *
   * Decide and Show all are lists of undecided things, so they are grouped by
   * remediation, folded at the savings gate and sorted however the reader asks —
   * every one of those is a way of deciding. Fix and Watch hold things that have
   * already been decided, and neither question left has a sort control as its
   * answer: Fix asks which to do next, Watch asks what is heard from when. Both
   * read the queue's cases directly rather than the folded groups, because a
   * fold is a triage affordance and there is no triage left to do.
   */
  const isFix = queue === "fix";
  const isWatch = queue === "watch";
  const ownQueue = isFix || isWatch;
  const hasRows = ownQueue ? view.inQueue.length > 0 : view.groups.length > 0 || view.tail.length > 0;

  return (
    <div style={{ minWidth: 0 }}>
      <PageHeader title={DESTINATION_LABEL.issues} purpose={purpose} flush />

      <QueueTabs activeQueue={queue} counts={view.counts} hrefFor={(next) => linkTo({ queue: next })} />

      {hasRows && isFix ? <FixQueue cases={view.inQueue} basePath={basePath} /> : null}

      {hasRows && isWatch ? <WatchQueue cases={view.inQueue} /> : null}

      {hasRows && !ownQueue ? (
        <>
          <div
            style={{
              display: "flex",
              justifyContent: "flex-end",
              alignItems: "center",
              gap: 10,
              padding: "0 40px 14px",
            }}
          >
            <span style={{ fontSize: 12.5, color: "var(--text-muted)" }}>Sort</span>
            <SelectMenu
              value={sort}
              options={ISSUE_SORTS.map((option) => ({ value: option, label: ISSUE_SORT_LABEL[option] }))}
              onChange={(next) => router.replace(linkTo({ sort: next }))}
              ariaLabel="Sort"
              menuWidth={180}
              triggerWidth={150}
            />
          </div>

          <ColumnHeaders sort={sort} direction={direction} hrefFor={linkTo} />

          <div style={{ borderBottom: "1px solid var(--border-hairline)" }}>
            {view.groups.map((group) => (
              <IssueGroup
                key={group.key}
                group={group}
                basePath={basePath}
                pageTitles={view.pageTitles}
              />
            ))}

            {view.tail.length > 0 ? (
              <LowImpactTail
                open={tailOpen}
                onToggle={() => setTailOpen((previous) => !previous)}
                caseCount={view.tailCases.length}
                pageCount={new Set(view.tailCases.flatMap((item) => item.pageIds)).size}
                minimumSavingsMs={view.minimumSavingsMs}
              >
                {view.tail.map((group) => (
                  <IssueGroup
                    key={group.key}
                    group={group}
                    basePath={basePath}
                    pageTitles={view.pageTitles}
                    nested
                  />
                ))}
              </LowImpactTail>
            ) : null}
          </div>
        </>
      ) : null}

      {hasRows ? null : nonListState()}
    </div>
  );
}

/**
 * The low-impact tail: one row for everything under the project's own savings
 * threshold.
 *
 * It states what it is holding — how many and across how many pages — so the
 * reader can see the size of what they are not looking at, and it expands in
 * place. It is a fold, never a filter: nothing here is dropped, and turning the
 * threshold down to zero empties it rather than moving anything.
 *
 * Opening it is the only action the list offers. Accept and Dismiss are not
 * here and are not on a row: a commitment made from a list is one made without
 * reading the plan. Reviewing this set together is the exception, because the
 * decision it leads to is still taken on the case.
 */
function LowImpactTail({
  open,
  onToggle,
  caseCount,
  pageCount,
  minimumSavingsMs,
  children,
}: {
  open: boolean;
  onToggle: () => void;
  caseCount: number;
  pageCount: number;
  minimumSavingsMs: number;
  children: React.ReactNode;
}) {
  return (
    <section>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 14,
          width: "100%",
          padding: "11px 40px",
          border: 0,
          borderTop: "1px solid var(--border-hairline)",
          background: "var(--surface-raised)",
          color: "var(--text-muted)",
          font: "inherit",
          fontSize: 12.5,
          textAlign: "left",
          cursor: "pointer",
        }}
      >
        <span style={TRUNCATE_CELL}>
          {`${caseCount} ${caseCount === 1 ? "finding" : "findings"} under your ${minimumSavingsMs} ms threshold, across ${pageCount} ${pageCount === 1 ? "page" : "pages"}`}
        </span>
        <span style={{ whiteSpace: "nowrap", fontWeight: 600, color: "var(--action-primary-ink)" }}>
          {open ? "Collapse" : "Review together"}
        </span>
      </button>
      {open ? children : null}
    </section>
  );
}
