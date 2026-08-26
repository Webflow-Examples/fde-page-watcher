import Link from "next/link";
import { includedPages, enteredAt, type IssueCase } from "@/lib/issue-case";
import { formatCaseImpact } from "@/lib/impact-format";
import { FIX_NO_OWNER, fixOwnerMeta, fixTodoMeta, startedLongAgo } from "@/lib/fix-copy";
import { caseHref } from "@/lib/paths";

/**
 * One case in the Fix queue.
 *
 * Two shapes, because the two groups answer different questions. A To do row is
 * being chosen from, so it says how big the job is, when it was committed to and
 * what it costs. An In progress row is being checked on, so it says who has it
 * and since when. Neither carries the other's line: a To do row with an owner
 * field would be an empty field on every row, and an In progress row still
 * showing its accepted date would bury the one date that matters under one that
 * has stopped mattering.
 *
 * There is no Start and no Mark fixed here. Both live on the case, for the same
 * reason Accept and Dismiss do: a transition fired from a list is one fired
 * without reading the plan. The row's job is to get you to the case.
 */

/**
 * The owner, as a circle with their initials.
 *
 * Initials rather than a photograph because there is no photograph — an owner is
 * whoever fired `start`, which is a name and nothing else. A silhouette
 * placeholder would be a picture of not knowing, which takes the same space as
 * the name it is standing next to and says less than it.
 *
 * `aria-hidden`, because the name is rendered in full immediately to its right.
 * A screen reader that announced both would read the owner twice, once as
 * letters.
 *
 * The letters sit at the registry's 12px floor rather than under it. Rule 8
 * exempts an element carrying no meaning to lose, and these qualify — but taking
 * the exemption would have bought a two-pixel circle at the cost of the one
 * place in the app where an initial is the only thing identifying a person on a
 * row. The circle grew instead.
 */
function OwnerAvatar({ name }: { name: string }) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]!.toUpperCase())
    .join("");

  return (
    <span
      aria-hidden
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        flex: "0 0 auto",
        width: 26,
        height: 26,
        borderRadius: "50%",
        border: "1px solid var(--border-hairline)",
        background: "var(--surface-raised)",
        color: "var(--text-muted)",
        fontSize: 12,
        fontWeight: 600,
        letterSpacing: ".01em",
      }}
    >
      {initials || "?"}
    </span>
  );
}

export interface FixRowProps {
  issue: IssueCase;
  basePath: string;
  now?: Date;
}

export function FixRow({ issue, basePath, now }: FixRowProps) {
  const impact = formatCaseImpact(issue);
  const diagnosis = issue.diagnosis || issue.title;
  const inProgress = issue.state === "in_progress";
  // Amber past thirty days, and amber is the whole of it: the text changes
  // colour and nothing else happens. No background wash, no border, no icon, no
  // second threshold behind it. It is a fact about how long this has been open,
  // rendered so you can see it without reading every row.
  const stale = inProgress && startedLongAgo(issue.startedAt, now ?? new Date());

  return (
    <Link
      href={caseHref(basePath, issue.id)}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 14,
        padding: "11px 40px",
        borderTop: "1px solid var(--border-hairline)",
        textDecoration: "none",
        color: "var(--text-body)",
        background: "var(--surface-card)",
      }}
    >
      <span style={{ flex: "1 1 auto", minWidth: 0 }}>
        <span
          style={{
            display: "block",
            fontSize: 13,
            fontWeight: 500,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
          title={diagnosis}
        >
          {diagnosis}
        </span>

        <span
          style={{
            display: "flex",
            alignItems: "center",
            gap: 7,
            marginTop: 3,
            fontSize: 12.5,
            color: stale ? "var(--status-warning-text)" : "var(--text-muted)",
          }}
        >
          {inProgress
            ? issue.owner
              ? (
                <>
                  <OwnerAvatar name={issue.owner} />
                  <span
                    style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                  >
                    {fixOwnerMeta(issue.owner, issue.startedAt, now)}
                  </span>
                </>
              )
              // No avatar for a case nobody is recorded against. A circle with a
              // question mark in it would be a picture of an owner where there
              // is none.
              : <span>{FIX_NO_OWNER}</span>
            : (
              <span
                style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
              >
                {fixTodoMeta(includedPages(issue).length, enteredAt(issue, "todo"), issue.effort, now)}
              </span>
            )}
        </span>
      </span>

      {/* The figure the group is ordered by. A list sorted on something it does
          not show is a list the reader cannot check. */}
      <span
        style={{
          flex: "0 0 auto",
          fontSize: 12.5,
          fontWeight: 600,
          fontVariantNumeric: "tabular-nums",
          textAlign: "right",
          color: impact.measured ? "var(--magnitude-value)" : "var(--text-muted)",
        }}
      >
        {impact.text}
      </span>
    </Link>
  );
}
