import { COUNTED_QUEUES, QUEUES, QUEUE_LABEL, type Queue } from "@/lib/vocabulary";
import { TabStrip } from "@/components/tab-strip";

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
 *
 * The strip itself is `<TabStrip>`, shared with the pages destination's view
 * switch. What stays here is what is actually about queues.
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
    <TabStrip
      ariaLabel="Queues"
      tabs={QUEUES.map((queue) => {
        const active = queue === activeQueue;
        const count = COUNTED_QUEUES.includes(queue) ? counts[queue] : undefined;
        return {
          key: queue,
          label: QUEUE_LABEL[queue],
          href: hrefFor(queue),
          current: active,
          badge: count === undefined ? undefined : <Badge count={count} active={active} />,
        };
      })}
    />
  );
}
