"use client";

import Link from "next/link";
import { caseImpactReading, impactOriginLabel } from "@/lib/impact-format";
import { causeLineOf, diagnosisLineOf, startHereReason } from "@/lib/case-copy";
import type { IssueCase } from "@/lib/issue-case";
import { caseHref } from "@/lib/paths";
import { scopeLineOf } from "@/lib/scope-line";
import { DismissAction } from "@/components/case-detail-parts";
import type { DismissReason } from "@/lib/vocabulary";

/**
 * The three decisions a first session asks for.
 *
 * The Decide queue is a table of sixteen equal rows, and a table is the right
 * shape once a reader knows what to do with it. A first-time reader does not, so
 * the three cases the rank puts first are shown as three decisions, above the
 * full table rather than instead of it.
 *
 * Accessibility, stated because it is easy to lose in a card:
 *
 *   - One link per case. The cause is the link; the pages and the diagnosis are
 *     text. A card that is itself clickable would announce six cells as one
 *     target and put a second stop on the same address.
 *   - The block has its own heading, and the section is labelled by it, so a
 *     screen reader announces "Start here" before the first item rather than
 *     arriving in a list of unexplained links.
 *   - No control here is smaller than the app's 12px floor, and the buttons are
 *     the same components the case header uses, so the focus ring is the app's.
 *
 * The three actions are the registry's: Accept when there is a plan to accept,
 * Take on when there is not, and Dismiss with the reason it requires. Where
 * neither Accept nor Take on is the point, the case link is the action — it
 * opens the case, which is the only honest next step for a finding with no plan,
 * and the button that would have said Accept is simply absent rather than dead.
 */

export interface StartHereProps {
  cases: readonly IssueCase[];
  basePath: string;
  pageTitles: Record<string, string>;
  onAccept: (issue: IssueCase) => void;
  onTakeOn: (issue: IssueCase) => void;
  onDismiss: (issue: IssueCase, reason: DismissReason) => void;
}

const SECONDARY_BUTTON = {
  appearance: "none" as const,
  cursor: "pointer" as const,
  boxSizing: "border-box" as const,
  whiteSpace: "nowrap" as const,
  fontSize: 13,
  fontWeight: 500,
  padding: "7px 14px",
  borderRadius: 8,
  border: "1px solid var(--border-strong)",
  background: "var(--surface-card)",
  color: "var(--text-body)",
};

const PRIMARY_BUTTON = {
  ...SECONDARY_BUTTON,
  fontWeight: 550,
  border: "1px solid transparent",
  background: "var(--action-primary-bg)",
  color: "var(--action-primary-text)",
};

export function StartHere({ cases, basePath, pageTitles, onAccept, onTakeOn, onDismiss }: StartHereProps) {
  if (cases.length === 0) return null;

  return (
    <section
      aria-labelledby="start-here-heading"
      style={{ padding: "18px 40px 4px" }}
    >
      <h2
        id="start-here-heading"
        style={{ margin: "0 0 4px", fontSize: 14, fontWeight: 600, color: "var(--text-body)" }}
      >
        Start here
      </h2>
      <p style={{ margin: "0 0 12px", maxWidth: "72ch", fontSize: 12.5, lineHeight: 1.5, color: "var(--text-muted)" }}>
        {cases.length === 1
          ? "The one case worth deciding first."
          : `The ${cases.length} cases worth deciding first.`}{" "}
        Everything else is in the table below.
      </p>

      <ol style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 10 }}>
        {cases.map((issue) => {
          const impact = caseImpactReading(issue);
          const origin = impactOriginLabel(impact.origin);
          const cause = causeLineOf(issue);
          const diagnosis = diagnosisLineOf(issue);
          const hasPlan = issue.remediation.steps.length > 0;
          return (
            <li
              key={issue.id}
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 8,
                padding: "12px 14px",
                border: "1px solid var(--border-hairline)",
                borderRadius: 10,
                background: "var(--surface-card)",
              }}
            >
              <div style={{ display: "flex", alignItems: "baseline", gap: 14, flexWrap: "wrap" }}>
                {/* The one link to this case. */}
                <Link
                  href={caseHref(basePath, issue.id)}
                  className="issue-row__open"
                  aria-label={`Review ${cause}`}
                  style={{ minWidth: 0, fontSize: 13, fontWeight: 600, color: "var(--action-primary-ink)" }}
                >
                  {cause}
                </Link>
                <span style={{ fontSize: 12.5, color: "var(--text-muted)" }}>
                  {scopeLineOf(issue.pageIds, issue.strategies, pageTitles)}
                </span>
                <span
                  style={{ marginLeft: "auto", fontSize: 12.5, fontWeight: 600, color: impact.measured ? "var(--magnitude-value)" : "var(--text-muted)" }}
                >
                  {impact.text}
                  {origin ? (
                    <span style={{ marginLeft: 6, fontWeight: 400, color: "var(--text-muted)" }}>{origin}</span>
                  ) : null}
                </span>
              </div>

              {diagnosis && diagnosis !== cause ? (
                <p style={{ margin: 0, maxWidth: "72ch", fontSize: 12.5, lineHeight: 1.55, color: "var(--text-body)" }}>
                  {diagnosis}
                </p>
              ) : null}

              <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
                <span style={{ fontSize: 12.5, color: "var(--text-muted)" }}>
                  {startHereReason(issue, pageTitles)}
                </span>
                <span style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 8 }}>
                  {hasPlan ? (
                    <button type="button" onClick={() => onAccept(issue)} style={PRIMARY_BUTTON}>
                      Accept
                    </button>
                  ) : (
                    <button type="button" onClick={() => onTakeOn(issue)} style={SECONDARY_BUTTON}>
                      Take on
                    </button>
                  )}
                  <DismissAction onChoose={(reason) => onDismiss(issue, reason)} />
                </span>
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
