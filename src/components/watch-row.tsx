"use client";

import { useId } from "react";
import {
  fixedAtOf,
  firstUnavailable,
  noReadingTaken,
  runOf,
} from "@/lib/checkpoint-evaluation";
import { RESOLVING_INTERVAL, type IssueCase } from "@/lib/issue-case";
import {
  WATCH_ACTION_RECHECK,
  WATCH_ACTION_REOPEN,
  WATCH_NO_READING,
  daysOf,
  watchRowFixed,
  watchRowFixedUnavailable,
} from "@/lib/watch-copy";
import { CheckpointMarks } from "@/components/checkpoint-marks";
import { CheckpointTrack } from "@/components/checkpoint-track";

/**
 * One fixed case waiting on evidence (15d), and its drawer (14c).
 *
 * The row is read-only with one exception. Watch is where nothing needs the
 * reader: a check that disagrees moves its case to Decide by itself, and a
 * check that agrees at thirty days resolves it. The exception is the case whose
 * every reading failed — there the evidence never arrived, no transition is
 * coming, and only a person can decide what to do about that.
 *
 * Expansion is on CLICK or TAP, never hover. In a vertical list a hover trigger
 * moves the row the reader is aiming at out from under the pointer, and the
 * rows below it too; the drawer is a deliberate act, so it takes a deliberate
 * gesture. It also has to work on a touch screen, where there is no hover.
 *
 * The drawer opens DOWNWARD and its height is not reserved. Keeping 40px of
 * empty track under every row to save a reflow would cost the list a screenful
 * of nothing. Because it only ever grows below its own row, nothing above the
 * row moves when it opens, and closing it puts the list back exactly as it was
 * without anyone scripting a scroll position.
 */

export interface WatchRowProps {
  issue: IssueCase;
  open: boolean;
  onToggle: () => void;
  /** The row's actions, wired by the queue. Only the actionable row uses them. */
  onReopen?: () => void;
  onRecheck?: () => void;
  now?: Date;
  locale?: string;
}

function ActionButton({ label, onClick }: { label: string; onClick?: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        appearance: "none",
        cursor: "pointer",
        fontSize: 12.5,
        fontWeight: 500,
        padding: "5px 11px",
        borderRadius: 6,
        border: "1px solid var(--border-strong)",
        background: "var(--surface-card)",
        color: "var(--text-body)",
      }}
    >
      {label}
    </button>
  );
}

export function WatchRow({
  issue,
  open,
  onToggle,
  onReopen,
  onRecheck,
  now,
  locale,
}: WatchRowProps) {
  const drawerId = useId();
  const run = runOf(issue);
  const fixedAt = fixedAtOf(issue);
  const stalled = noReadingTaken(issue);
  const unavailable = firstUnavailable(issue);

  // The fixed date stays on the row, always. It is the one date that says how
  // long this has been running, and the drawer is not a substitute for it.
  const fixedLine = !stalled && unavailable
    ? watchRowFixedUnavailable(fixedAt, unavailable, locale)
    : watchRowFixed(fixedAt, locale);

  return (
    <div
      style={{
        borderTop: "1px solid var(--border-hairline)",
        // The only row in Watch that asks for something says so at its edge.
        ...(stalled
          ? {
            borderLeft: "3px solid var(--status-warning-text)",
            background: "var(--status-warning-bg)",
          }
          : null),
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "0 40px" }}>
        {/* The trigger is a real button, and the actions are its siblings rather
            than its children: a control inside a control is invalid, and a
            screen reader reading "Reopen" nested in an expand button cannot say
            which of the two it is about to activate. On every row but the
            stalled one there are no actions, so the trigger is the whole row. */}
        <button
          type="button"
          aria-expanded={open}
          aria-controls={drawerId}
          onClick={onToggle}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 16,
            flex: "1 1 auto",
            minWidth: 0,
            appearance: "none",
            border: 0,
            background: "transparent",
            font: "inherit",
            color: "inherit",
            padding: "13px 0",
            cursor: "pointer",
            textAlign: "left",
          }}
        >
          <span style={{ flex: "1 1 auto", minWidth: 0 }}>
            <span
              style={{
                display: "block",
                fontSize: 13,
                fontWeight: 500,
                color: "var(--text-body)",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
              title={issue.diagnosis}
            >
              {issue.diagnosis}
            </span>
            <span style={{ display: "block", marginTop: 2, fontSize: 12.5, color: "var(--text-muted)" }}>
              {fixedLine}
            </span>
          </span>

          <CheckpointMarks run={run} countdown now={now} locale={locale} />
        </button>

        {stalled ? (
          <span style={{ display: "inline-flex", gap: 8, flex: "0 0 auto" }}>
            <ActionButton label={WATCH_ACTION_REOPEN} onClick={onReopen} />
            <ActionButton label={WATCH_ACTION_RECHECK} onClick={onRecheck} />
          </span>
        ) : null}
      </div>

      {/* Not rendered when closed: the drawer's height is never reserved. */}
      {open ? (
        <div
          id={drawerId}
          // A short crossfade, in the stylesheet so reduced motion can switch
          // it off. Motion is not load-bearing here — the track is the state,
          // and it is fully readable the instant it arrives. The
          // marks-into-track morph (14b) is a transition into this and can be
          // added later without changing what anything means.
          className="watch-drawer"
          style={{ padding: "2px 40px 16px" }}
        >
          {stalled ? (
            <p style={{ margin: "0 0 12px", fontSize: 12.5, color: "var(--text-body)", maxWidth: "62ch" }}>
              {WATCH_NO_READING}
            </p>
          ) : null}
          <CheckpointTrack
            run={run}
            fixedAt={fixedAt}
            span={daysOf(RESOLVING_INTERVAL)}
            now={now}
            locale={locale}
          />
        </div>
      ) : null}
    </div>
  );
}
