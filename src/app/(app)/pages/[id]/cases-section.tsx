"use client";

import { Fragment, useMemo, useState } from "react";
import Link from "next/link";
import type { WatchPage } from "@/lib/types";
import { APPLICABILITY_LABEL, CONFIDENCE_LABEL, applicabilityActionLabel, type ExclusionReason } from "@/lib/vocabulary";
import { queueOf, type IssueCase } from "@/lib/issue-case";
import { runOf } from "@/lib/checkpoint-evaluation";
import { causeLineOf, diagnosisLineOf, excludedNote } from "@/lib/case-copy";
import { caseImpactReading } from "@/lib/impact-format";
import { caseHref } from "@/lib/paths";
import { StatusChip } from "@/components/status-chip";
import { CheckpointMarks } from "@/components/checkpoint-marks";
import { ExclusionReasonPicker } from "@/components/exclusion-reason-picker";
import { EFFORT_LABEL, NUMERIC_CELL, TRUNCATE_CELL } from "@/components/issue-row";
import { Magnitude } from "@/components/magnitude";
import { isKnownNativeElementId, nativeElementApplicability, nativeElementExclusionReason, nativeElementIssuesForPage } from "@/lib/nativeElements";
import type { NativeElementLifecycle } from "@/lib/nativeElements";
import { Section } from "./page-detail-bits";


/**
 * The columns of a case row on this page.
 *
 * Narrower than the issues list's six, and for a reason rather than for space:
 * the list's scope column says which pages a case covers, and here the answer is
 * always this one. A column whose value never changes is a column that teaches
 * the reader to stop reading it.
 */
const CASE_ROW_COLUMNS = [
  "minmax(72px, max-content)",
  "minmax(0, 1fr)",
  "minmax(0, max-content)",
  "minmax(88px, max-content)",
  "minmax(0, max-content)",
].join(" ");

/**
 * One case; the title is the link.
 *
 * A case in Watch carries W1's marks, imported rather than redrawn: the run is
 * three 16px marks with the next scheduled check stretched into a countdown, and
 * changing W1's mark set changes this row without an edit here. They are not
 * dots — a dot cannot say whether a check agreed, disagreed, or could not be
 * taken, and those are the three things the reader is here for.
 *
 * Where the case is a native-element finding, the applicability control is a
 * SIBLING of the link rather than a child: a control inside a control is invalid,
 * and a screen reader cannot say which of the two it is about to activate.
 * Applicability is also not one of S2's decisions — Exclude answers "does this
 * count for this site", which is a different question from Accept and Dismiss.
 */
function CaseRow({
  issue,
  basePath,
  now,
  applicability,
}: {
  issue: IssueCase;
  basePath: string;
  now?: Date;
  applicability?: React.ReactNode;
}) {
  const impact = caseImpactReading(issue);
  const title = causeLineOf(issue);
  const diagnosis = diagnosisLineOf(issue);
  const run = queueOf(issue.state) === "watch" ? runOf(issue) : [];

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 14,
        borderTop: "1px solid var(--border-hairline)",
        background: "var(--surface-card)",
      }}
    >
      <div
        style={{
          display: "grid",
          gridTemplateColumns: CASE_ROW_COLUMNS,
          gap: 14,
          alignItems: "center",
          flex: "1 1 auto",
          minWidth: 0,
          padding: "11px 14px",
          color: "var(--text-body)",
        }}
      >
        <span>
          <StatusChip state={issue.state} />
        </span>

        <Link
          href={caseHref(basePath, issue.id)}
          title={diagnosis}
          style={{ minWidth: 0, color: "inherit", textDecoration: "none", fontSize: 13, fontWeight: 500 }}
        >
          <span style={{ ...TRUNCATE_CELL, display: "block" }}>{title}</span>
        </Link>

        {run.length > 0 ? (
          <CheckpointMarks run={run} countdown now={now} />
        ) : (
          <span style={{ ...TRUNCATE_CELL, fontSize: 12.5, color: "var(--text-muted)" }}>
            {CONFIDENCE_LABEL[issue.confidence]}
          </span>
        )}

        <span
          style={{
            ...NUMERIC_CELL,
            fontSize: 12.5,
            color: impact.measured ? "var(--magnitude-value)" : "var(--text-muted)",
          }}
        >
          {impact.text}
        </span>

        <span style={{ ...NUMERIC_CELL, fontSize: 12.5, color: "var(--text-muted)" }}>
          {EFFORT_LABEL[issue.effort]}
        </span>
      </div>

      {applicability ? <span style={{ flex: "0 0 auto", paddingRight: 14 }}>{applicability}</span> : null}
    </div>
  );
}

/** The same button treatment on both sides of the applicability toggle. */
function QuietButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        appearance: "none",
        cursor: "pointer",
        fontSize: 12,
        padding: "4px 9px",
        borderRadius: 6,
        border: "1px solid var(--border-strong)",
        background: "var(--surface-card)",
        color: "var(--text-body)",
        whiteSpace: "nowrap",
      }}
    >
      {label}
    </button>
  );
}

/**
 * The last reading of an excluded native-element finding, kept.
 *
 * Excluding is not deleting. The reading stays, greyed and struck, with the
 * reason beside it — the audit is explicit that hiding evidence without saying
 * why is how the agent tab lost its reader's trust. The sentence is S2's, not a
 * second version of it: the two consequences it names are the same two here.
 */
function ExcludedFinding({
  finding,
  reason,
  onInclude,
}: {
  finding: NativeElementLifecycle;
  reason: ExclusionReason;
  onInclude: () => void;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 14,
        padding: "11px 14px",
        borderTop: "1px solid var(--border-hairline)",
        background: "var(--surface-raised)",
      }}
    >
      <div style={{ flex: "1 1 auto", minWidth: 0 }}>
        <div style={{ fontSize: 13, color: "var(--text-muted)", textDecoration: "line-through" }}>
          {finding.title}
        </div>
        <div style={{ marginTop: 3, fontSize: 12, color: "var(--text-muted)" }}>
          <Magnitude value={finding.count} unit={finding.count === 1 ? "instance" : "instances"} fontSize={12} />
          {" · last seen "}
          {finding.lastDetected.date}
        </div>
        <div style={{ marginTop: 4, fontSize: 12, color: "var(--text-muted)", maxWidth: "70ch" }}>
          {excludedNote(reason)}
        </div>
      </div>
      <span style={{ flex: "0 0 auto" }}>
        <QuietButton label={applicabilityActionLabel("excluded")} onClick={onInclude} />
      </span>
    </div>
  );
}

export function CasesSection({
  page,
  cases,
  basePath,
  canManage,
  onExclude,
  onInclude,
}: {
  page: WatchPage;
  cases: IssueCase[];
  basePath: string;
  canManage: boolean;
  onExclude: (findingId: string, reason: ExclusionReason) => void;
  onInclude: (findingId: string) => void;
}) {
  const [choosingFor, setChoosingFor] = useState<string | null>(null);

  // Excluded findings are read off the page's own scans rather than off the
  // cases: an excluded finding stops being promoted, so waiting for a case to
  // carry it would be waiting for the thing exclusion prevents.
  const excluded = useMemo(
    () => nativeElementIssuesForPage(page.history).filter((finding) =>
      nativeElementApplicability(page.nativeElementControls, finding.id) === "excluded"),
    [page.history, page.nativeElementControls],
  );

  const empty = cases.length === 0 && excluded.length === 0;

  return (
    <Section id="cases">
      <div style={{ border: "1px solid var(--border-hairline)", borderRadius: 11, overflow: "hidden" }}>
        {empty ? (
          <div style={{ padding: "26px 18px", fontSize: 12.5, color: "var(--text-muted)" }}>
            Nothing is open on this page.
          </div>
        ) : null}

        {cases.map((issue) => {
          // `cause` is the finding id a case was derived from, and it survives
          // grouping — which is why applicability is read from it rather than
          // from a case id that a merge can change.
          const findingId = isKnownNativeElementId(issue.cause) ? issue.cause : null;
          const choosing = findingId !== null && choosingFor === findingId;
          return (
            <Fragment key={issue.id}>
              <CaseRow
                issue={issue}
                basePath={basePath}
                applicability={findingId && canManage && !choosing ? (
                  <QuietButton
                    label={applicabilityActionLabel("included")}
                    onClick={() => setChoosingFor(findingId)}
                  />
                ) : undefined}
              />
              {choosing && findingId ? (
                <div style={{ padding: "0 14px 12px 14px", background: "var(--surface-card)" }}>
                  <ExclusionReasonPicker
                    label={`Reason for excluding ${issue.title}`}
                    onChoose={(reason) => {
                      setChoosingFor(null);
                      onExclude(findingId, reason);
                    }}
                    onCancel={() => setChoosingFor(null)}
                  />
                </div>
              ) : null}
            </Fragment>
          );
        })}

        {excluded.length > 0 ? (
          <div
            style={{
              padding: "9px 14px",
              borderTop: "1px solid var(--border-hairline)",
              background: "var(--surface-raised)",
              fontSize: 12,
              fontWeight: 600,
              color: "var(--text-muted)",
            }}
          >
            {APPLICABILITY_LABEL.excluded}
          </div>
        ) : null}
        {excluded.map((finding) => (
          <ExcludedFinding
            key={finding.key}
            finding={finding}
            reason={nativeElementExclusionReason(page.nativeElementControls, finding.id)!}
            onInclude={() => onInclude(finding.id)}
          />
        ))}
      </div>
    </Section>
  );
}
