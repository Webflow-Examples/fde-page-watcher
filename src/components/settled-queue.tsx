import { enteredAt, type IssueCase } from "@/lib/issue-case";
import { IssueRow } from "@/components/issue-row";

/**
 * The Settled tab: the two off-ramp states, resolved and dismissed.
 *
 * Nothing here is waiting on a person, so there is no count badge, no sort
 * control and no fold. The order is most recently settled first, which is the
 * only question this view answers: what changed lately.
 */
export interface SettledQueueProps {
  cases: readonly IssueCase[];
  basePath: string;
  pageTitles: Record<string, string>;
}

export function SettledQueue({ cases, basePath, pageTitles }: SettledQueueProps) {
  const ordered = [...cases].sort((left, right) => {
    const leftAt = enteredAt(left, left.state) ?? left.detectedAt;
    const rightAt = enteredAt(right, right.state) ?? right.detectedAt;
    return rightAt.localeCompare(leftAt);
  });

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
        Resolved and dismissed cases. Nothing here is waiting on you.
      </p>
      <div style={{ borderBottom: "1px solid var(--border-hairline)" }}>
        {ordered.map((issue) => (
          <IssueRow key={issue.id} issue={issue} basePath={basePath} pageTitles={pageTitles} dateMode="settled" />
        ))}
      </div>
    </div>
  );
}
