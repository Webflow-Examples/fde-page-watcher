import type { RemediationGroup } from "@/lib/issue-case";
import { CONFIDENCE_LABEL } from "@/lib/vocabulary";
import { StatusChip } from "@/components/status-chip";
import {
  EFFORT_LABEL,
  ISSUE_ROW_COLUMNS,
  ISSUE_ROW_GAP,
  IssueRow,
  NUMERIC_CELL,
  TRUNCATE_CELL,
  formatGroupImpact,
  scopeLineOf,
} from "@/components/issue-row";

/**
 * One remediation and the pages it covers.
 *
 * The unit of decision on this screen is the remediation, not the finding. Cause
 * grouping has already merged the same problem seen on several pages into one
 * case, so a group holding a single case *is* a single row — it renders exactly
 * that, with every affected page on its scope line, and no extra chrome.
 *
 * A group holding several cases is the step further: different causes that the
 * same steps fix. Those keep their own rows underneath a header for the shared
 * fix, because they are still separate problems with separate evidence and their
 * own lifecycles — merging them into one row would need one diagnosis and one
 * state for two different findings, and inventing either is how a row starts
 * describing something no run ever found. The header carries only what is
 * genuinely shared: the fix, the worst reading behind it, and the one effort of
 * doing it.
 *
 * Nothing is hidden at either depth. Every case in the queue is one row here.
 */

export interface IssueGroupProps {
  group: RemediationGroup;
  basePath: string;
  pageTitles: Record<string, string>;
  /** Set when the group sits inside the folded tail. */
  nested?: boolean;
}

export function IssueGroup({ group, basePath, pageTitles, nested = false }: IssueGroupProps) {
  if (group.cases.length === 1) {
    return <IssueRow issue={group.cases[0]} basePath={basePath} pageTitles={pageTitles} nested={nested} />;
  }

  const impact = formatGroupImpact(group.impactMs);
  // The remediation's first step, which is what the shared fix starts with. It
  // is data, from the case; nothing is authored here.
  const fix = group.remediation.steps.find((step) => step.trim() !== "") ?? group.primary.title;
  const scope = scopeLineOf(group.pageIds, group.primary.strategies, pageTitles);

  return (
    <section>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: ISSUE_ROW_COLUMNS,
          gap: ISSUE_ROW_GAP,
          alignItems: "center",
          padding: "11px 40px",
          borderTop: "1px solid var(--border-hairline)",
          background: "var(--surface-card)",
        }}
      >
        {/* The most urgent state among the members: a live problem never hides
            behind a sibling somebody has already settled. */}
        <span>
          <StatusChip state={group.state} />
        </span>

        <span style={{ ...TRUNCATE_CELL, fontSize: 13, fontWeight: 600 }} title={fix}>
          {fix}
        </span>

        <span style={{ ...TRUNCATE_CELL, fontSize: 12.5, color: "var(--text-muted)" }}>
          {`${group.cases.length} cases · ${scope}`}
        </span>

        <span style={{ ...TRUNCATE_CELL, fontSize: 12.5, color: "var(--confidence-weak)" }}>
          {CONFIDENCE_LABEL[group.confidence]}
        </span>

        {/* The worst reading any member produced, never a total: the number here
            is one of the numbers on the rows below, so the two reconcile
            (rule 19). The effort is the single shared one — the fix is carried
            out once. */}
        <span style={{ ...NUMERIC_CELL, fontSize: 12.5, fontWeight: 600, color: impact.measured ? "var(--magnitude-value)" : "var(--text-muted)" }}>
          {impact.text}
        </span>

        <span style={{ ...NUMERIC_CELL, fontSize: 12.5, color: "var(--text-muted)" }}>
          {EFFORT_LABEL[group.effort]}
        </span>
      </div>

      {group.cases.map((issue) => (
        <IssueRow key={issue.id} issue={issue} basePath={basePath} pageTitles={pageTitles} nested />
      ))}
    </section>
  );
}
