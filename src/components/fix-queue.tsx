import { byWorstMeasured, type IssueCase } from "@/lib/issue-case";
import { FIX_GROUPS, FIX_QUEUE_NOTE } from "@/lib/fix-copy";
import { WORK_STATE_LABEL } from "@/lib/vocabulary";
import { FixRow } from "@/components/fix-row";

/**
 * The Fix tab: what has been committed to, and what is being worked on.
 *
 * Two groups, To do above In progress, in the order the registry holds them.
 * That order is the reading order of the queue rather than a ranking: To do is
 * the shelf you take from and In progress is what is off the shelf, so the
 * choice comes before the check.
 *
 * Impact-ordered inside each group, worst measured first, with unmeasured
 * findings moved as a block rather than sorted by their zero (rule 18). It does
 * not take the list's sort control. The list sorts because it is being triaged
 * and there are several honest ways to read a queue of undecided things; this is
 * a queue of decided things, and the only question left is which to do next.
 *
 * One nudge, stated once at the top and rendered once per row: the started date,
 * amber after thirty days. Nothing escalates after it. That is written down
 * where the reader can see it, because a reader who has been told there is no
 * escalation can leave a case for thirty-one days on purpose — and a reader who
 * suspects there might be one starts managing the queue instead of the work.
 */

export interface FixQueueProps {
  cases: readonly IssueCase[];
  basePath: string;
  now?: Date;
}

export function FixQueue({ cases, basePath, now }: FixQueueProps) {
  const groups = FIX_GROUPS.map((state) => ({
    state,
    // A group is impact-ordered within itself and never against the other one.
    // The two are answering different questions, so interleaving them would put
    // a job nobody has started above one somebody is holding on the strength of
    // a number that says nothing about either.
    cases: cases.filter((item) => item.state === state).sort(byWorstMeasured),
  })).filter((group) => group.cases.length > 0);

  return (
    <div>
      <p
        style={{
          margin: "0 0 16px",
          padding: "0 40px",
          fontSize: 12.5,
          color: "var(--text-muted)",
          maxWidth: "78ch",
        }}
      >
        {FIX_QUEUE_NOTE}
      </p>

      <div style={{ borderBottom: "1px solid var(--border-hairline)" }}>
        {groups.map((group) => (
          <section key={group.state}>
            {/* The registry's own name for the state, so the heading and the
                chip on the case it leads to cannot say different words. An
                empty group is not drawn at all — a heading with nothing under
                it reads as a load that has not finished. */}
            <h2
              style={{
                display: "flex",
                alignItems: "baseline",
                gap: 8,
                margin: 0,
                padding: "14px 40px 6px",
                borderTop: "1px solid var(--border-hairline)",
                background: "var(--surface-page)",
                // Rule 8: a group heading tells you which group you are reading,
                // so it carries meaning and keeps the 12px floor.
                fontSize: 12,
                fontWeight: 600,
                letterSpacing: ".04em",
                textTransform: "uppercase",
                color: "var(--text-muted)",
              }}
            >
              {WORK_STATE_LABEL[group.state]}
              <span style={{ fontWeight: 500, letterSpacing: 0, textTransform: "none" }}>
                {group.cases.length}
              </span>
            </h2>

            {group.cases.map((issue) => (
              <FixRow key={issue.id} issue={issue} basePath={basePath} now={now} />
            ))}
          </section>
        ))}
      </div>
    </div>
  );
}
