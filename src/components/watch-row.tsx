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
} from "@/lib/watch-copy";
import { CheckpointMarks } from "@/components/checkpoint-marks";
import { CheckpointTrack } from "@/components/checkpoint-track";
import { IssueRow } from "@/components/issue-row";
import { ChevronDownIcon } from "@/components/icons";

/**
 * One fixed case waiting on evidence, on the shared row shell.
 *
 * The Date column carries the fixed date and the checkpoint marks sit under it.
 * The chevron stays a separate button so the row's link can open the case
 * without expanding the drawer.
 */
export interface WatchRowProps {
  issue: IssueCase;
  basePath: string;
  pageTitles: Record<string, string>;
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
  basePath,
  pageTitles,
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

  const meta = stalled ? (
    <span style={{ display: "inline-flex", gap: 8, alignItems: "center" }}>
      <ActionButton label={WATCH_ACTION_REOPEN} onClick={onReopen} />
      <ActionButton label={WATCH_ACTION_RECHECK} onClick={onRecheck} />
    </span>
  ) : unavailable ? (
    <span>{`The ${daysOf(unavailable)}-day check could not be taken`}</span>
  ) : undefined;

  const checkpoints = (
    <>
      <CheckpointMarks run={run} countdown now={now} locale={locale} />
      <button
        type="button"
        aria-expanded={open}
        aria-controls={drawerId}
        aria-label={open ? "Hide checkpoints" : "Show checkpoints"}
        title={open ? "Hide checkpoints" : "Show checkpoints"}
        onClick={onToggle}
        style={{
          appearance: "none",
          cursor: "pointer",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          flex: "0 0 auto",
          padding: 4,
          border: 0,
          borderRadius: 4,
          background: "transparent",
          color: "var(--text-muted)",
        }}
      >
        <ChevronDownIcon size={12} style={{ transform: open ? "rotate(180deg)" : undefined }} />
      </button>
    </>
  );

  return (
    <div
      style={{
        borderTop: "1px solid var(--border-hairline)",
        ...(stalled
          ? {
            borderLeft: "3px solid var(--status-warning-text)",
            background: "var(--status-warning-bg)",
          }
          : null),
      }}
    >
      <IssueRow
        issue={issue}
        basePath={basePath}
        pageTitles={pageTitles}
        dateMode="watch"
        meta={meta}
        confidenceSlot={checkpoints}
      />

      {open ? (
        <div
          id={drawerId}
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
