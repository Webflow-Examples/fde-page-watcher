import Link from "next/link";
import type { CSSProperties } from "react";
import type { IssueCase } from "@/lib/issue-case";
import { EFFORT_LABEL, formatGroupImpact, formatImpact } from "@/lib/impact-format";
import { scopeLineOf } from "@/lib/scope-line";
import { CONFIDENCE_LABEL } from "@/lib/vocabulary";
import { caseHref } from "@/lib/paths";
import { StatusChip } from "@/components/status-chip";

/**
 * One case, at the depth the list needs: state, diagnosis, scope, confidence,
 * impact, effort. Six things on one line, in that order.
 *
 * There is no Accept, Dismiss, Start or Mark fixed here, by design. A commitment
 * made from a list is one made without reading the plan, so every transition
 * lives on the case itself; the row's only job is to get you there.
 *
 * The row never wraps. The two free-text cells sit in `minmax(0, …)` tracks so
 * they can shrink below their content and truncate — a plain `1fr` refuses to go
 * under min-content, which with `nowrap` children is the whole string, and the
 * row overflows the viewport instead of the text ellipsing.
 */

/**
 * Shared by the rows, the group headers and the column header above them, so
 * the six columns line up down the whole list. Indentation is padding inside
 * the first cell, never a change to this template — a nested row that shifts
 * the tracks stops lining up with everything else.
 */
export const ISSUE_ROW_COLUMNS = [
  // state — a chip carries meaning, so it keeps a floor and is never clipped
  "minmax(72px, max-content)",
  // diagnosis — takes the space the others do not need, and ellipses
  "minmax(0, 1fr)",
  // scope — shrinks alongside the diagnosis, at a smaller share of it
  "minmax(0, 0.62fr)",
  // confidence, impact, effort — content-sized while there is room, and able to
  // give it back rather than push the row past the viewport
  "minmax(0, max-content)",
  "minmax(88px, max-content)",
  "minmax(0, max-content)",
].join(" ");

export const ISSUE_ROW_GAP = 14;

/** How far a member row sits inside its remediation group. */
export const ISSUE_ROW_NEST_INDENT = 18;

/**
 * Impact formatting moved to `lib/impact-format.ts` when the case detail became
 * a second renderer of the same figure, and the scope phrase moved to
 * `lib/scope-line.ts` when the digest became a second writer of that. Both are
 * re-exported here so the list's existing importers keep one name for each.
 *
 * `EFFORT_LABEL` followed impact into `impact-format.ts` in S5, when "Copy as
 * ticket" became a third reader that is not a component. Same re-export, same
 * reason: the list's importers keep one name for it.
 */
export { EFFORT_LABEL, formatGroupImpact, formatImpact };
export { scopeLineOf };

/** One line, ellipsed. Applied to every free-text cell in the list. */
export const TRUNCATE_CELL: CSSProperties = {
  minWidth: 0,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};

export const NUMERIC_CELL: CSSProperties = {
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
  textAlign: "right",
  fontVariantNumeric: "tabular-nums",
};

/**
 * Where a case lives. Moved to `lib/paths.ts` in S7, because the digest links to
 * the same address from outside the app and the two spellings must be one.
 */
export { caseHref };

export interface IssueRowProps {
  issue: IssueCase;
  basePath: string;
  pageTitles: Record<string, string>;
  /** Set when the row sits under a remediation group it shares with others. */
  nested?: boolean;
}

export function IssueRow({ issue, basePath, pageTitles, nested = false }: IssueRowProps) {
  const impact = formatImpact(issue.impactMs);
  // The case's own plain sentence where it has one. `fromRec` leaves this empty
  // rather than authoring copy, and the stored title is what the source called
  // it — the honest fallback, not a second diagnosis.
  const diagnosis = issue.diagnosis || issue.title;

  return (
    <Link
      href={caseHref(basePath, issue.id)}
      style={{
        display: "grid",
        gridTemplateColumns: ISSUE_ROW_COLUMNS,
        gap: ISSUE_ROW_GAP,
        alignItems: "center",
        padding: "11px 40px",
        borderTop: "1px solid var(--border-hairline)",
        textDecoration: "none",
        color: "var(--text-body)",
        background: nested ? "var(--surface-page)" : "var(--surface-card)",
      }}
    >
      <span style={{ paddingLeft: nested ? ISSUE_ROW_NEST_INDENT : 0 }}>
        <StatusChip state={issue.state} />
      </span>

      <span style={{ ...TRUNCATE_CELL, fontSize: 13, fontWeight: 500 }} title={diagnosis}>
        {diagnosis}
      </span>

      <span style={{ ...TRUNCATE_CELL, fontSize: 12.5, color: "var(--text-muted)" }}>
        {scopeLineOf(issue.pageIds, issue.strategies, pageTitles)}
      </span>

      {/* The word, in the row's secondary text token — never a strength hue.
          `--confidence-weak` under the word "Confirmed" is a token painting
          the opposite of what it says (registry rule 13), and hue here would
          double-encode a value the word already carries. Strength as colour
          belongs where there is no word to read it from. */}
      <span style={{ ...TRUNCATE_CELL, fontSize: 12.5, color: "var(--text-muted)" }}>
        {CONFIDENCE_LABEL[issue.confidence]}
      </span>

      <span style={{ ...NUMERIC_CELL, fontSize: 12.5, color: impact.measured ? "var(--magnitude-value)" : "var(--text-muted)" }}>
        {impact.text}
      </span>

      <span style={{ ...NUMERIC_CELL, fontSize: 12.5, color: "var(--text-muted)" }}>
        {EFFORT_LABEL[issue.effort]}
      </span>
    </Link>
  );
}
