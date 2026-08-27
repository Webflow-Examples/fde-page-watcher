"use client";

import { useMemo, useState } from "react";
import { attributionOf } from "@/lib/caller";
import {
  RESOLVING_INTERVAL,
  includedPages,
  isTransition,
  personActionsFor,
  primaryActionFor,
  type IssueCase,
} from "@/lib/issue-case";
import { fixedAtOf, runOf } from "@/lib/checkpoint-evaluation";
import { formatCaseImpact } from "@/lib/impact-format";
import { ticketMarkdown } from "@/lib/fix-ticket";
import { FIX_NOTES_PLACEHOLDER } from "@/lib/fix-copy";
import {
  CONFIDENCE_LABEL,
  DESTINATION_LABEL,
  DESTINATION_PATH,
  EVIDENCE_SOURCE_LABEL,
  ISSUE_ACTION_LABEL,
  WORK_STATE_LABEL,
  queueHoldsState,
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
import { CopyTicketButton } from "@/components/copy-ticket-button";
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
 *   5 notes          free text, for whoever picks this up
 *   6 evidence       who measured it, never averaged
 *   7 checkpoints    only once there is something to check
 *   8 history        what happened, oldest last
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
  /**
   * Persist the case's notes.
   *
   * Withheld the same way `onExclude` is, and for the same reason: a notes box
   * that accepts what you type, shows it, and loses it on reload is worse than
   * no notes box. The section renders read-only when there is a note and no
   * handler, and not at all when there is neither.
   */
  onNotesChange?: (notes: string) => void;
  /**
   * The deployment's public URL, for the link in a copied ticket.
   *
   * Absent yields the root-relative `/issues/{id}`, which is wrong in a ticket
   * visibly rather than silently. See `absoluteUrl`.
   */
  appUrl?: string;
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

/**
 * Free text, for whoever picks this up.
 *
 * No schema, no required fields, no length limit and nothing derived from what
 * is written here. That is the point of it: the other eight sections of a case
 * are shapes the app imposed on a finding, and every one of them is occasionally
 * the wrong shape for the thing somebody needs to say. This is where that goes.
 *
 * Three states, and the middle one is the one worth explaining. With a handler
 * it is editable. With a note and no handler it is shown but not editable — a
 * box that takes what you type and loses it on reload is worse than a box that
 * does not take it, and hiding a note that exists because nothing can save a new
 * one would be hiding evidence. With neither it is not rendered at all.
 *
 * Committed on blur rather than on every keystroke. A case is derived from
 * stored records, so a write is a round trip; per-keystroke saving would put one
 * in flight per character and reorder them under any latency at all.
 */
function CaseNotes({
  notes,
  onNotesChange,
}: {
  notes?: string;
  onNotesChange?: (notes: string) => void;
}) {
  const [draft, setDraft] = useState(notes ?? "");
  const [seen, setSeen] = useState(notes);

  // A case re-derived by a later run brings its own note, and the draft follows
  // it so an edit made elsewhere is not overwritten by a stale buffer.
  //
  // Adjusted during render rather than in an effect. An effect would paint the
  // old note first and correct it on the next pass, which is a visible flash of
  // the wrong text; React re-runs this component before committing anything, so
  // the reader only ever sees the new one.
  if (notes !== seen) {
    setSeen(notes);
    setDraft(notes ?? "");
  }

  if (!onNotesChange) {
    if (!notes) return null;
    return (
      <Section title="Notes">
        <p
          style={{
            margin: 0,
            maxWidth: "72ch",
            fontSize: 12.5,
            lineHeight: 1.6,
            color: "var(--text-body)",
            // Whatever they typed, laid out the way they typed it.
            whiteSpace: "pre-wrap",
          }}
        >
          {notes}
        </p>
      </Section>
    );
  }

  return (
    <Section title="Notes">
      <textarea
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => {
          if (draft !== (notes ?? "")) onNotesChange(draft);
        }}
        placeholder={FIX_NOTES_PLACEHOLDER}
        rows={3}
        style={{
          display: "block",
          width: "100%",
          maxWidth: "72ch",
          padding: "9px 11px",
          borderRadius: 8,
          border: "1px solid var(--border-strong)",
          background: "var(--surface-card)",
          color: "var(--text-body)",
          font: "inherit",
          fontSize: 12.5,
          lineHeight: 1.6,
          resize: "vertical",
        }}
      />
    </Section>
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
  onNotesChange,
  appUrl,
  now,
  locale,
}: CaseDetailProps) {
  const included = includedPages(issue);
  const run = useMemo(() => runOf(issue), [issue]);
  const fixedAt = useMemo(() => fixedAtOf(issue), [issue]);

  // Impact is the worst reading on a page this case counts — the same statistic
  // as the group header above it and the row beside it, never a sum (rule 19).
  // Adding four pages' savings would invent a figure no run produced.
  //
  // The derivation moved into `formatCaseImpact` in S5, when "Copy as ticket"
  // became a reader of the same figure that renders off screen. The brief asks
  // for the ticket's string to be byte-identical to this one, and the only way
  // to promise that is for there to be one string rather than two that agree.
  const impact = formatCaseImpact(issue, impactByPage);

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

  /**
   * The ticket, offered on the two states the Fix queue holds.
   *
   * Asked of the registry rather than written as `todo || in_progress`, so a
   * state that joins the fix queue gets the button without anyone remembering.
   * It is not offered from Decide, where the case has not been committed to and
   * a ticket would be a plan for work nobody has agreed to do, nor from Watch,
   * where the work is done and what is outstanding is evidence rather than
   * effort.
   */
  const inFixQueue = queueHoldsState("fix", issue.state);
  const ticket = useMemo(
    () => (inFixQueue ? ticketMarkdown(issue, { pageTitles, impactByPage, appUrl }) : ""),
    [appUrl, impactByPage, inFixQueue, issue, pageTitles],
  );

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
            {/* Below the transitions, because copying is not one. Start and
                Mark fixed change what is true about the work; this takes a
                copy of what is already true and changes nothing. */}
            {inFixQueue ? <CopyTicketButton ticket={ticket} /> : null}
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

        <CaseNotes notes={issue.notes} onNotesChange={onNotesChange} />

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
