import type { RemediationGroup } from "@/lib/issue-case";
import { CONFIDENCE_LABEL } from "@/lib/vocabulary";
import { StatusChip } from "@/components/status-chip";
import {
  EFFORT_LABEL,
  ISSUE_ROW_COLUMNS,
  ISSUE_ROW_GAP,
  IssueRow,
  NUMERIC_CELL,
  PageScope,
  TRUNCATE_CELL,
  formatGroupImpact,
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
  const steps = group.remediation.steps.map((step) => step.trim()).filter(Boolean);
  const fix = steps[0] ?? group.primary.title;
  // The first step on its own reads like an instruction with no subject. Naming
  // its position in the shared remediation makes it a step of this group.
  const stepPrefix = steps.length > 1 ? `Step 1 of ${steps.length}: ` : "Shared step: ";

  return (
    <section aria-label={`One fix for ${group.cases.length} cases`}>
      <div
        className="issue-group__header"
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

        {/* A group is not a case, so the header is not a link. It names the
            relationship — two findings, one fix — and shows the first step of
            that fix in context. */}
        <span style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
          <span style={{ fontSize: 13, fontWeight: 600 }}>
            One fix for {group.cases.length} cases
            {steps.length > 0 ? ` · ${steps.length} steps` : ""}
          </span>
          <span
            style={{
              fontSize: 12,
              lineHeight: 1.35,
              color: "var(--text-muted)",
              whiteSpace: "normal",
            }}
            title={fix}
          >
            {stepPrefix}{fix}
          </span>
        </span>

        {/* The pages link here for the same reason they do on a row: this is
            the same column, and a header that names a page the reader cannot
            open teaches them the column is not clickable. */}
        <span style={{ ...TRUNCATE_CELL, fontSize: 12.5, color: "var(--text-muted)" }}>
          <PageScope
            pageIds={group.pageIds}
            strategies={group.primary.strategies}
            basePath={basePath}
            pageTitles={pageTitles}
          />
        </span>

        {/* The weakest member confidence, as a word. See the note in issue-row. */}
        <span style={{ ...TRUNCATE_CELL, fontSize: 12.5, color: "var(--text-muted)" }}>
          {CONFIDENCE_LABEL[group.confidence]}
        </span>

        {/* The worst reading any member produced, never a total: the number here
            is one of the numbers on the rows below, so the two reconcile
            (rule 19). The effort is the single shared one — the fix is carried
            out once. */}
        <span
          style={{ ...NUMERIC_CELL, fontSize: 12.5, fontWeight: 600, color: impact.measured ? "var(--magnitude-value)" : "var(--text-muted)" }}
          title={impact.measured ? undefined : "Not measured"}
          aria-label={impact.measured ? undefined : "Not measured"}
        >
          {impact.measured ? impact.text : "—"}
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
