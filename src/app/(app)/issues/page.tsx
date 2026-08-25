"use client";

import { useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  DEFAULT_ISSUE_SORT,
  ISSUE_SORTS,
  ISSUE_SORT_LABEL,
  parseIssueSort,
  useIssuesView,
  useStore,
  type IssueSort,
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
} from "@/components/issue-empty";
import { SelectMenu } from "@/components/select-menu";

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

/** Column headers, drawn on the same six tracks as the rows below them. */
const COLUMN_HEADERS = ["State", "Diagnosis", "Scope", "Confidence", "Impact", "Effort"] as const;

function ColumnHeaders() {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: ISSUE_ROW_COLUMNS,
        gap: ISSUE_ROW_GAP,
        alignItems: "center",
        padding: "0 40px 8px",
        fontSize: 11.5,
        fontWeight: 600,
        letterSpacing: ".04em",
        textTransform: "uppercase",
        color: "var(--text-muted)",
      }}
    >
      {COLUMN_HEADERS.map((label, index) => (
        <span key={label} style={index >= 4 ? NUMERIC_CELL : TRUNCATE_CELL}>
          {label}
        </span>
      ))}
    </div>
  );
}

export default function IssuesPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { basePath, pathFor, pages } = useStore();

  const queue = parseQueue(searchParams.get("queue"));
  const sort = parseIssueSort(searchParams.get("sort"));
  const view = useIssuesView(queue, sort);

  // The tail starts folded. Opening it is the one action this list offers, and
  // it is not a commitment to anything — see the note on the fold below.
  const [tailOpen, setTailOpen] = useState(false);

  const linkTo = useMemo(
    () => (next: { queue?: Queue; sort?: IssueSort }) => {
      const params = new URLSearchParams();
      params.set("queue", next.queue ?? queue);
      const nextSort = next.sort ?? sort;
      if (nextSort !== DEFAULT_ISSUE_SORT) params.set("sort", nextSort);
      return pathFor(`${DESTINATION_PATH.issues}?${params.toString()}`);
    },
    [pathFor, queue, sort],
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
    if (elsewhere) {
      return <QueueEmptyOthersBusy queue={queue} counts={view.counts} hrefFor={(next) => linkTo({ queue: next })} />;
    }
    // Nothing is in flight in any queue. Cases may still exist — settled ones
    // live in Show all — or the runs may simply never have found anything.
    return <EverythingResolved caseCount={view.cases.length} showAllHref={linkTo({ queue: "show_all" })} />;
  }

  const hasRows = view.groups.length > 0 || view.tail.length > 0;

  return (
    <div style={{ minWidth: 0 }}>
      <PageHeader title={DESTINATION_LABEL.issues} purpose={purpose} flush />

      <QueueTabs activeQueue={queue} counts={view.counts} hrefFor={(next) => linkTo({ queue: next })} />

      {hasRows ? (
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

          <ColumnHeaders />

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
      ) : (
        nonListState()
      )}
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
