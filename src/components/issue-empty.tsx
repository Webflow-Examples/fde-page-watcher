import Link from "next/link";
import type { ReactNode } from "react";
import { COUNTED_QUEUES, DESTINATION_LABEL, QUEUE_LABEL, WORK_STATE_LABEL, type Queue } from "@/lib/vocabulary";

/**
 * The five states in which the issues list has no list to show.
 *
 * Each one is a separate component on purpose. They are five different
 * situations, they need five different sentences, and a single component with a
 * `variant` prop is how those sentences drift into one vague one that fits none
 * of them. In particular "this queue is empty while others are busy" and
 * "nothing is in flight anywhere" are not the same news: the first says what is
 * still moving, the second says nothing is.
 *
 * Two rules hold across all five:
 *
 *   - Say what happened. Not "no results" — what state the project is in, and
 *     what would change it.
 *   - At most one action, and often none. The type below takes a single node.
 *
 * None of them renders a table. An empty table with headers tells the reader
 * their filter is broken rather than that there is nothing to see.
 */

interface EmptyStateProps {
  heading: string;
  /**
   * Optional, for the one state whose sentence is the whole message. Watch's
   * empty state is a single line by decision — see `WatchEmpty`.
   */
  children?: ReactNode;
  /** At most one, by design. */
  action?: ReactNode;
}

function EmptyState({ heading, children, action }: EmptyStateProps) {
  return (
    <section
      style={{
        margin: "4px 40px 40px",
        padding: "28px 26px",
        border: "1px solid var(--border-hairline)",
        borderRadius: 12,
        background: "var(--surface-card)",
      }}
    >
      <h2 style={{ margin: 0, fontSize: 16, fontWeight: 600, color: "var(--text-body)", letterSpacing: "-0.01em" }}>
        {heading}
      </h2>
      {children ? (
        <p style={{ margin: "8px 0 0", maxWidth: 560, fontSize: 13, lineHeight: 1.6, color: "var(--text-muted)" }}>
          {children}
        </p>
      ) : null}
      {action ? <div style={{ marginTop: 16 }}>{action}</div> : null}
    </section>
  );
}

function EmptyAction({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link
      href={href}
      style={{
        display: "inline-flex",
        alignItems: "center",
        padding: "7px 13px",
        borderRadius: 8,
        fontSize: 13,
        fontWeight: 550,
        textDecoration: "none",
        color: "var(--action-primary-text)",
        background: "var(--action-primary-bg)",
      }}
    >
      {children}
    </Link>
  );
}

/* ── 1. Nothing is being watched ────────────────────────────────────────── */

export function NoPagesWatched({ pagesHref }: { pagesHref: string }) {
  return (
    <EmptyState
      heading="No pages are being watched"
      action={<EmptyAction href={pagesHref}>{`Open ${DESTINATION_LABEL.pages}`}</EmptyAction>}
    >
      Page Watch measures the pages you watch on a schedule, and turns what the
      measurements agree on into cases. Add a page and the first run starts this
      list.
    </EmptyState>
  );
}

/* ── 2. Watched, but nothing measured yet ───────────────────────────────── */

export function FirstRunPending({ pageCount, pagesHref }: { pageCount: number; pagesHref: string }) {
  return (
    <EmptyState
      heading="The first run has not finished"
      action={<EmptyAction href={pagesHref}>{`Open ${DESTINATION_LABEL.pages}`}</EmptyAction>}
    >
      {`${pageCount === 1 ? "One page is" : `${pageCount} pages are`} waiting on a first measurement. `}
      A case appears here once a run has finished and the reading has been
      corroborated, which takes more than one run by design.
    </EmptyState>
  );
}

/* ── 3. This queue is empty; others are not ─────────────────────────────── */

/**
 * What is still in flight, in the registry's own words. Only counted queues
 * appear: Show all is the unfiltered view, so counting it here would report
 * every case twice.
 */
function elsewhereSentence(counts: Partial<Record<Queue, number>>, except: Queue): string {
  const busy = COUNTED_QUEUES
    .filter((queue) => queue !== except && (counts[queue] ?? 0) > 0)
    .map((queue) => `${counts[queue]} in ${QUEUE_LABEL[queue]}`);
  if (busy.length === 0) return "";
  if (busy.length === 1) return busy[0];
  return `${busy.slice(0, -1).join(", ")} and ${busy.at(-1)}`;
}

export function QueueEmptyOthersBusy({
  queue,
  counts,
  hrefFor,
}: {
  queue: Queue;
  counts: Partial<Record<Queue, number>>;
  hrefFor: (queue: Queue) => string;
}) {
  const busiest = COUNTED_QUEUES
    .filter((candidate) => candidate !== queue && (counts[candidate] ?? 0) > 0)
    .sort((a, b) => (counts[b] ?? 0) - (counts[a] ?? 0))[0];

  return (
    <EmptyState
      heading={`Nothing to ${QUEUE_LABEL[queue].toLowerCase()} right now`}
      action={busiest ? <EmptyAction href={hrefFor(busiest)}>{`Go to ${QUEUE_LABEL[busiest]}`}</EmptyAction> : undefined}
    >
      {`Work is still moving elsewhere: ${elsewhereSentence(counts, queue)}. `}
      This queue fills again the next time a run finds something, or a check
      disagrees with a fix.
    </EmptyState>
  );
}

/* ── 3b. Watch, specifically ───────────────────────────────────────── */

/**
 * Watch with nothing in it.
 *
 * One sentence, no illustration, and — unlike its three siblings — no way out.
 * The others offer a link because their emptiness is a detour: work is moving
 * somewhere else and the reader probably wants to be there. An empty Watch is
 * not a detour. Nothing is waiting on evidence, which is the finished state of
 * this queue rather than a gap in it, and a "Go to Decide" button under it
 * would invent an errand.
 *
 * It replaces states 3 and 4 for this queue only. States 1, 2 and 5 still win,
 * because "nothing is waiting on evidence" is a comfortable thing to read and a
 * false one when no page is monitored, the first run has not landed, or the
 * last run failed.
 */
export function WatchEmpty({ heading }: { heading: string }) {
  return <EmptyState heading={heading} />;
}

/* ── 4. Nothing anywhere is in flight ────────────────────────────────── */

export function EverythingResolved({ caseCount, showAllHref }: { caseCount: number; showAllHref: string }) {
  const settled = caseCount === 0
    // Reachable on a project whose runs have simply never found anything. The
    // heading is still the true one — nothing is in flight — but claiming a
    // count of settled cases when there are none would not be.
    ? "No case has been opened on this project."
    : `All ${caseCount} ${caseCount === 1 ? "case is" : "cases are"} ${WORK_STATE_LABEL.resolved.toLowerCase()} or ${WORK_STATE_LABEL.dismissed.toLowerCase()}.`;

  return (
    <EmptyState
      heading="Nothing is in flight"
      action={<EmptyAction href={showAllHref}>{`Go to ${QUEUE_LABEL.show_all}`}</EmptyAction>}
    >
      {`${settled} `}
      Nothing is waiting on a decision, a fix, or a scheduled check. Every
      reading taken so far is still on the record.
    </EmptyState>
  );
}

/* ── 5. The last run failed ─────────────────────────────────────────────── */

export function LastRunFailed({
  pageTitle,
  error,
  pageHref,
}: {
  pageTitle: string;
  error?: string;
  pageHref: string;
}) {
  return (
    <EmptyState
      heading="The last run did not finish"
      action={<EmptyAction href={pageHref}>{pageTitle}</EmptyAction>}
    >
      {`The most recent run on ${pageTitle} stopped before it produced a reading${error ? `: ${error}` : ""}. `}
      Nothing has been measured since, so this list is empty because of the run
      rather than because the pages are clean.
    </EmptyState>
  );
}
