import Link from "next/link";
import { COUNTED_QUEUES, QUEUES, QUEUE_LABEL, type Queue } from "@/lib/vocabulary";

/**
 * The four queue tabs on the issues list.
 *
 * A queue is a filter over work state, so the tabs are named with the
 * registry's verbs and read their membership from it — nothing here decides
 * which states a queue holds, and nothing here counts anything. The counts
 * arrive already derived from `queueOf`, which is the only thing in the app
 * that knows where a case belongs.
 *
 * Show all carries no badge, and cannot: it is the unfiltered view rather than
 * a queue (registry rule 1), so the selector that produces these counts never
 * produces one for it. There is no branch here to get wrong.
 */

export interface QueueTabsProps {
  activeQueue: Queue;
  /** Counted queues only. A queue absent from this map shows no badge. */
  counts: Partial<Record<Queue, number>>;
  hrefFor: (queue: Queue) => string;
}

function Badge({ count, active }: { count: number; active: boolean }) {
  return (
    <span
      style={{
        // 12px, not smaller: the count carries meaning, and the registry's chip
        // rule puts the floor for anything meaningful at 12.
        fontSize: 12,
        fontWeight: 600,
        lineHeight: 1.35,
        padding: "0 6px",
        borderRadius: 20,
        color: active ? "var(--status-information-text)" : "var(--text-muted)",
        background: active ? "var(--status-information-bg)" : "var(--surface-raised)",
      }}
    >
      {count}
    </span>
  );
}

export function QueueTabs({ activeQueue, counts, hrefFor }: QueueTabsProps) {
  return (
    <nav
      aria-label="Queues"
      style={{
        display: "flex",
        gap: 2,
        alignItems: "center",
        padding: "18px 40px 0",
        borderBottom: "1px solid var(--border-hairline)",
        margin: "0 0 20px",
        overflowX: "auto",
      }}
    >
      {QUEUES.map((queue) => {
        const active = queue === activeQueue;
        const count = COUNTED_QUEUES.includes(queue) ? counts[queue] : undefined;
        return (
          <Link
            key={queue}
            href={hrefFor(queue)}
            aria-current={active ? "page" : undefined}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 7,
              padding: "8px 12px 11px",
              fontSize: 13,
              fontWeight: 500,
              whiteSpace: "nowrap",
              textDecoration: "none",
              color: active ? "var(--text-body)" : "var(--text-muted)",
              borderBottom: `2px solid ${active ? "var(--action-primary-bg)" : "transparent"}`,
              marginBottom: -1,
            }}
          >
            {QUEUE_LABEL[queue]}
            {count === undefined ? null : <Badge count={count} active={active} />}
          </Link>
        );
      })}
    </nav>
  );
}
