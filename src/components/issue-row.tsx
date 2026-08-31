"use client";

import Link from "next/link";
import type { CSSProperties } from "react";
import type { IssueCase } from "@/lib/issue-case";
import type { Strategy } from "@/lib/types";
import { EFFORT_LABEL, formatGroupImpact, formatImpact } from "@/lib/impact-format";
import { PAGE_SCOPE_NAME_LIMIT, SCOPE_SEPARATOR, deviceScopeOf, pageScopeNames, scopeLineOf } from "@/lib/scope-line";
import { causeLineOf, diagnosisLineOf } from "@/lib/case-copy";
import { CONFIDENCE_LABEL } from "@/lib/vocabulary";
import { caseHref, pageHref } from "@/lib/paths";
import { StatusChip } from "@/components/status-chip";
import { InfoTip } from "@/components/info-tip";

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
 *
 * NO `max-content` HERE, and that is the point rather than an oversight.
 *
 * Every row is its own grid. `max-content` is resolved per grid, so a template
 * that says "as wide as the content" makes each row as wide as ITS content: the
 * effort column measured 29px on a row reading "Days" and 71px on one reading
 * "No estimate", the state column 72px against 82px, and the two `fr` columns
 * inherited the difference. Sharing the template gave six columns that lined up
 * nowhere except by accident. The fix is tracks whose size does not depend on
 * what is in them.
 *
 * The four fixed widths are the longest label each column can hold, measured
 * from the rendered list and rounded up: nothing is clipped today, and anything
 * longer ellipses through `TRUNCATE_CELL` rather than pushing the row wider.
 * They are `minmax(floor, fixed)` rather than bare pixels so a narrow viewport
 * takes the space back in the same order for every row — deterministic, because
 * the template no longer reads the content.
 */
export const ISSUE_ROW_COLUMNS = [
  // state — a chip carries meaning, so it keeps its floor and is never clipped
  "minmax(72px, 104px)",
  // cause — takes the space the others do not need, and ellipses
  "minmax(0, 1fr)",
  // pages — shrinks alongside the cause, at a smaller share of it
  "minmax(0, 0.62fr)",
  // confidence, impact, effort. Confidence is sized by its HEADER rather than
  // its values: "Probable" is 52px and "CONFIDENCE" is not, and a column header
  // that ellipses is a column nobody can identify.
  "minmax(0, 100px)",
  "minmax(88px, 96px)",
  "minmax(0, 88px)",
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
export { causeLineOf, diagnosisLineOf };

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

/**
 * The pages a case covers, each one a link to its own detail.
 *
 * The naming rule is `scope-line`'s, not this file's: two pages are named, more
 * than two become a count. A count is not a page, so there is nothing to link
 * on that branch — which is the honest outcome rather than a link to whichever
 * page happened to be first.
 */
export function PageScope({
  pageIds,
  strategies,
  basePath,
  pageTitles,
}: {
  pageIds: readonly string[];
  strategies: readonly Strategy[];
  basePath: string;
  pageTitles: Record<string, string>;
}) {
  const names = pageScopeNames(pageIds, pageTitles);
  const devices = deviceScopeOf(strategies);
  const named = names.length > 0 && names.length <= PAGE_SCOPE_NAME_LIMIT;

  return (
    <>
      {named
        ? names.map((page, index) => (
            <span key={page.id}>
              {index > 0 ? ", " : null}
              <Link className="issue-row__page" href={pageHref(basePath, page.id)}>
                {page.title}
              </Link>
            </span>
          ))
        : names.length > 0
          ? `${names.length} pages`
          : null}
      {names.length > 0 && devices ? SCOPE_SEPARATOR : null}
      {devices}
    </>
  );
}

export function IssueRow({ issue, basePath, pageTitles, nested = false }: IssueRowProps) {
  const impact = formatImpact(issue.impactMs);
  // What KIND of problem this is, in three or four words — the column a list of
  // four dozen rows is actually scanned on.
  const cause = causeLineOf(issue);
  // The sentence itself, behind the tip rather than truncated at the column
  // edge. `case-copy` owns the title fallback, because the cause sort and this
  // both read it.
  const diagnosis = diagnosisLineOf(issue);
  // Where the classifier did not recognise the audit, `causeLineOf` already
  // fell back to this same sentence — so there is nothing further to say, and a
  // control that shows you the text you are looking at is worse than no
  // control. The 18px is still reserved, so the labels start on one line down
  // the whole list whether or not a row has more to give.
  const hasSecondLayer = diagnosis !== "" && diagnosis !== cause;

  return (
    /*
      The row is no longer one big `<Link>`.

      It could not stay one: the pages in it are links to somewhere else, and an
      anchor inside an anchor is invalid — the browser closes the outer one and
      the row silently becomes two links with a gap between them. The tip's
      trigger is a button, which has the same problem.

      So the case link is a normal link on the cause, and `.issue-row__open`
      stretches its hit area over the whole row in CSS. One focusable link per
      row rather than a row-sized target that reads its six cells aloud, which
      is the announcement the UX audit called out; the page links and the tip
      sit above it and keep their own targets.

      The background and the rule above it are CSS rather than inline, because
      an inline background beats a `:hover` rule in the stylesheet and the row
      would never light up.
    */
    <div
      className={nested ? "issue-row issue-row--nested" : "issue-row"}
      style={{
        display: "grid",
        gridTemplateColumns: ISSUE_ROW_COLUMNS,
        gap: ISSUE_ROW_GAP,
        alignItems: "center",
        padding: "11px 40px",
      }}
    >
      <span style={{ paddingLeft: nested ? ISSUE_ROW_NEST_INDENT : 0 }}>
        <StatusChip state={issue.state} />
      </span>

      {/* NOT `TRUNCATE_CELL` on this cell or on the link inside it. The
          stretched hit area is a positioned `::after` on the link, and
          `overflow: hidden` anywhere above it clips that box back to the
          cell — which is a whole-row target that only covers one column.
          The truncation moves to the span around the text instead, where it
          still ellipses and no longer clips anything. */}
      <span style={{ minWidth: 0, display: "flex", alignItems: "center", gap: 7 }}>
        {hasSecondLayer ? (
          <InfoTip label={cause} text={diagnosis} />
        ) : (
          <span aria-hidden="true" className="issue-row__tip-spacer" />
        )}
        <Link
          className="issue-row__open"
          href={caseHref(basePath, issue.id)}
          style={{ minWidth: 0, fontSize: 13, fontWeight: 500 }}
          // The tooltip is the VISIBLE text, not the diagnosis behind it.
          // `title` becomes the accessible name, so a diagnosis here would
          // announce and voice-target the link as something other than what
          // it reads as on screen. The diagnosis has a disclosure now; that
          // is where it belongs.
          title={cause}
        >
          <span style={{ ...TRUNCATE_CELL, display: "block" }}>{cause}</span>
        </Link>
      </span>

      <span style={{ ...TRUNCATE_CELL, fontSize: 12.5, color: "var(--text-muted)" }}>
        <PageScope pageIds={issue.pageIds} strategies={issue.strategies} basePath={basePath} pageTitles={pageTitles} />
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
    </div>
  );
}
