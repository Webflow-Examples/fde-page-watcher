"use client";

import { useMemo } from "react";
import { attributionOf } from "@/lib/caller";
import {
  RESOLVING_INTERVAL,
  includedPages,
  isTransition,
  personActionsFor,
  primaryActionFor,
  type IssueCase,
} from "@/lib/issue-case";
import { runOf } from "@/lib/checkpoint-evaluation";
import { formatImpact } from "@/lib/impact-format";
import {
  CONFIDENCE_LABEL,
  DESTINATION_LABEL,
  DESTINATION_PATH,
  EVIDENCE_SOURCE_LABEL,
  ISSUE_ACTION_LABEL,
  WORK_STATE_LABEL,
  type ExclusionReason,
  type IssueAction,
} from "@/lib/vocabulary";
import {
  EFFORT_LABEL as IMPACT_EFFORT_WORDS,
  ObjectDetailHeaderActions,
  type CaseAction,
} from "@/components/case-detail-parts";
import {
  EFFORT_LABEL_TEXT,
  IMPACT_LABEL,
  DECISION_STRANDED,
  NO_ACTION_REASON,
  acceptLabel,
  evidenceAgreement,
  evidenceConflict,
  historyDetected,
} from "@/lib/case-copy";
import { ObjectDetailHeader } from "@/components/object-detail-header";
import { StatusChip } from "@/components/status-chip";
import { CasePages } from "@/components/case-pages";
import { CheckpointTrack } from "@/components/checkpoint-track";
import { daysOf, formatDate } from "@/lib/watch-copy";

/**
 * One case, in full.
 *
 * The reading order is fixed, and it is an argument rather than a layout:
 *
 *   1 diagnosis      what is wrong, in a sentence a person would say
 *   2 impact/effort  what it costs and what it takes — the decision inputs
 *   3 taxonomy       category, severity, confidence
 *   4 affected pages which pages, and which of them count
 *   5 evidence       who measured it, never averaged
 *   6 checkpoints    only once there is something to check
 *   7 history        what happened, oldest last
 *
 * Taxonomy never comes first. A row of chips above the diagnosis asks the
 * reader to classify a problem they have not been told about yet — the
 * category means something once you know the symptom, and nothing before.
 */

export interface CaseDetailProps {
  issue: IssueCase;
  pageTitles: Record<string, string>;
  pagePaths?: Record<string, string>;
  impactByPage?: Record<string, number>;
  basePath?: string;
  /**
   * Fire one registry transition on this case.
   *
   * One handler rather than one per verb. The set of legal moves is the
   * registry's, and a prop per verb would mean a caller could wire four of the
   * five and leave the fifth as a button that does nothing — which is exactly
   * the state the per-page exclude control was withheld to avoid.
   */
  onAction?: (action: IssueAction, issue: IssueCase) => void;
  onExclude?: (pageId: string, reason: ExclusionReason) => void;
  onInclude?: (pageId: string) => void;
  now?: Date;
  locale?: string;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ marginTop: 26 }}>
      <h2 style={{ margin: "0 0 10px", fontSize: 14, fontWeight: 600, color: "var(--text-body)" }}>
        {title}
      </h2>
      {children}
    </section>
  );
}

/** One reference figure: a label above, the reading below. */
function Figure({ label, value, muted }: { label: string; value: string; muted?: boolean }) {
  return (
    <div>
      <div style={{ fontSize: 12, color: "var(--text-muted)" }}>{label}</div>
      <div
        style={{
          marginTop: 2,
          fontSize: 14,
          fontWeight: 600,
          fontVariantNumeric: "tabular-nums",
          color: muted ? "var(--text-muted)" : "var(--text-body)",
        }}
      >
        {value}
      </div>
    </div>
  );
}

export function CaseDetail({
  issue,
  pageTitles,
  pagePaths,
  impactByPage,
  onAction,
  onExclude,
  onInclude,
  now,
  locale,
}: CaseDetailProps) {
  const included = includedPages(issue);
  const run = useMemo(() => runOf(issue), [issue]);
  const fixedAt = useMemo(
    () => [...issue.history].reverse().find((entry) => entry.to === "fixed")?.at,
    [issue.history],
  );

  // Impact is the worst reading on a page this case counts — the same statistic
  // as the group header above it and the row beside it, never a sum (rule 19).
  // Adding four pages' savings would invent a figure no run produced.
  const worst = useMemo(() => {
    const readings = included.map((pageId) => impactByPage?.[pageId] ?? 0);
    return readings.length ? Math.max(...readings, 0) : issue.impactMs;
  }, [included, impactByPage, issue.impactMs]);
  const impact = formatImpact(worst || issue.impactMs);

  /**
   * The state's own legal moves, in the order the header offers them.
   *
   * Derived rather than fixed at Accept and Dismiss, which was true only of the
   * two states Decide holds. A Fixed case was previously offered Accept — a
   * transition the registry does not have from that state — so the header was
   * showing a button that could not have worked. `primaryActionFor` reads the
   * table, and everything else the state allows follows it.
   */
  const actions = useMemo<CaseAction[]>(() => {
    const primary = primaryActionFor(issue.state);
    if (!primary) return [];
    const ordered = [primary, ...personActionsFor(issue.state).filter((action) => action !== primary)];
    return ordered.map((action) => ({
      action,
      label: action === "accept"
        ? acceptLabel(included.length, issue.pageIds.length)
        : ISSUE_ACTION_LABEL[action],
      onClick: onAction ? () => onAction(action, issue) : undefined,
    }));
  }, [included.length, issue, onAction]);

  /**
   * Rule 17's sentence, and only where it is true.
   *
   * It says there is nothing to accept, so it stands in for Accept and for
   * nothing else. On a state whose move is Start or Reopen the sentence would be
   * describing a button that was never going to be there, which is a different
   * and untrue explanation.
   */
  const noAction = actions[0]?.action !== "accept"
    ? null
    : issue.remediation.actionability === "none"
      ? NO_ACTION_REASON.none
      : issue.remediation.actionability === "platform"
        ? NO_ACTION_REASON.platform
        : null;

  const sources = issue.evidence.length;
  const conflicting = issue.confidence === "unclear" && sources >= 2;

  return (
    <div style={{ minWidth: 0, paddingBottom: 48 }}>
      <ObjectDetailHeader
        breadcrumb={{ label: DESTINATION_LABEL.issues, href: DESTINATION_PATH.issues }}
        state={<StatusChip state={issue.state} />}
        stateDate={formatDate(issue.detectedAt, locale)}
        title={issue.diagnosis}
        explanation={issue.successCriteria}
        actions={
          <>
            {/* Registry rule 17: where there is nothing to accept, the case says
                why in a sentence. A disabled Accept is the thing this replaces —
                it tells the reader they lack permission, which is not what is
                true; there is simply nothing documented to commit to. */}
            {noAction ? (
              <p
                style={{
                  margin: 0,
                  maxWidth: "34ch",
                  fontSize: 12.5,
                  lineHeight: 1.55,
                  color: "var(--text-muted)",
                }}
              >
                {noAction}
              </p>
            ) : (
              <ObjectDetailHeaderActions actions={actions} />
            )}
            {/* A decision was taken about this remediation and no longer applies
                to it, because a reclassification changed the remediation's key
                under it. The case is undecided and the buttons above are the
                real question; this says why the reader is being asked a
                question they remember answering, so it reads as the fix having
                moved rather than as their decision having been lost. */}
            {issue.strandedDecision ? (
              <p
                style={{
                  margin: 0,
                  maxWidth: "34ch",
                  fontSize: 12.5,
                  lineHeight: 1.55,
                  color: "var(--text-muted)",
                }}
              >
                {DECISION_STRANDED}
              </p>
            ) : null}
          </>
        }
        metadata={
          <div style={{ display: "flex", flexWrap: "wrap", gap: 28 }}>
            <Figure label={IMPACT_LABEL} value={impact.text} muted={!impact.measured} />
            <Figure label={EFFORT_LABEL_TEXT} value={IMPACT_EFFORT_WORDS[issue.effort]} />
            <Figure label="Confidence" value={CONFIDENCE_LABEL[issue.confidence]} />
          </div>
        }
      />

      <div style={{ padding: "0 40px" }}>
        {/* `CasePages` carries its own heading and count, because the count
            belongs beside the title rather than under it. */}
        <div style={{ marginTop: 26 }}>
          <CasePages
            issue={issue}
            pageTitles={pageTitles}
            pagePaths={pagePaths}
            impactByPage={impactByPage}
            onExclude={onExclude}
            onInclude={onInclude}
          />
        </div>

        <Section title="Evidence">
          <p style={{ margin: "0 0 10px", fontSize: 12.5, color: "var(--text-muted)", maxWidth: "72ch" }}>
            {conflicting
              ? evidenceConflict(
                EVIDENCE_SOURCE_LABEL[issue.evidence[0]!.source],
                EVIDENCE_SOURCE_LABEL[issue.evidence[1]!.source],
              )
              : evidenceAgreement(sources, issue.confidence)}
          </p>
          <ul style={{ margin: 0, padding: 0, listStyle: "none" }}>
            {issue.evidence.map((entry) => (
              <li
                key={`${entry.source}-${entry.observedAt}`}
                style={{
                  display: "flex",
                  gap: 12,
                  padding: "7px 0",
                  borderTop: "1px solid var(--border-hairline)",
                  fontSize: 12.5,
                }}
              >
                <span style={{ flex: "0 0 160px", color: "var(--text-body)" }}>
                  {EVIDENCE_SOURCE_LABEL[entry.source]}
                </span>
                <span style={{ flex: "1 1 auto", color: "var(--text-muted)" }}>
                  {entry.supports ? "Supports the diagnosis" : "Does not support it"}
                </span>
                <span style={{ flex: "0 0 auto", color: "var(--text-muted)" }}>
                  {formatDate(entry.observedAt, locale)}
                </span>
              </li>
            ))}
          </ul>
        </Section>

        {/* Absent before mark_fixed, not blank. There are no checkpoints to
            show, and an empty track would read as three checks that all came
            back with nothing. */}
        {run.length > 0 ? (
          <Section title="Checkpoints">
            {/* The same component the Watch drawer opens, rendered permanently.
                W1 built it for exactly these two contexts. */}
            <CheckpointTrack
              run={run}
              fixedAt={fixedAt}
              span={daysOf(RESOLVING_INTERVAL)}
              now={now}
              locale={locale}
            />
          </Section>
        ) : null}

        <Section title="History">
          <ol style={{ margin: 0, padding: 0, listStyle: "none" }}>
            <li style={{ padding: "7px 0", fontSize: 12.5, color: "var(--text-muted)" }}>
              {historyDetected(issue.pageIds.length)} · {formatDate(issue.detectedAt, locale)}
            </li>
            {issue.history.map((entry, index) => {
              /* Attribution is a field of its own beside the date, never
                 joined onto the line. Both person-fired lines lead with a page
                 — "/archive/2019 excluded — Intentional" — so "{line} by
                 {name}" turns the name into part of the reason. A system-fired
                 line leaves the field out entirely rather than naming the job
                 that ran, which is the implementation talking. */
              const attribution = attributionOf(entry.by);
              return (
                <li
                  key={`${entry.at}-${index}`}
                  style={{
                    display: "flex",
                    gap: 12,
                    padding: "7px 0",
                    borderTop: "1px solid var(--border-hairline)",
                    fontSize: 12.5,
                  }}
                >
                  <span style={{ flex: "0 0 auto", color: "var(--text-muted)" }}>
                    {formatDate(entry.at, locale)}
                  </span>
                  <span style={{ flex: "1 1 auto", color: "var(--text-body)" }}>
                    {/* A note carries the same state on both sides, so it gets no
                        arrow — "Fixed → Fixed" is worse than no line. `isTransition`
                        is the one place that knows the difference. */}
                    {entry.reason
                      ?? (isTransition(entry)
                        ? `${entry.from ? `${WORK_STATE_LABEL[entry.from]} → ` : ""}${WORK_STATE_LABEL[entry.to]}`
                        : WORK_STATE_LABEL[entry.to])}
                  </span>
                  {attribution ? (
                    <span style={{ flex: "0 0 auto", color: "var(--text-muted)" }}>
                      {attribution}
                    </span>
                  ) : null}
                </li>
              );
            })}
          </ol>
        </Section>
      </div>
    </div>
  );
}
