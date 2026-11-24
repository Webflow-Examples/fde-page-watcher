"use client";

import type { IssueCase } from "@/lib/issue-case";
import { FIX_NO_OWNER, fixOwnerMeta, startedLongAgo } from "@/lib/fix-copy";
import { IssueRow } from "@/components/issue-row";

/**
 * One case in the Fix queue, on the shared row shell.
 *
 * The columns carry pages, the accepted/started date, confidence, impact and
 * effort. The only extra line is the owner, which exists only once somebody has
 * fired Start; an imported in-progress record says so rather than inventing a
 * name.
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
        width: 18,
        height: 18,
        borderRadius: "50%",
        background: "var(--surface-input)",
        color: "var(--text-muted)",
        fontSize: 12,
        fontWeight: 600,
        flex: "0 0 auto",
      }}
    >
      {initials}
    </span>
  );
}

export interface FixRowProps {
  issue: IssueCase;
  basePath: string;
  pageTitles: Record<string, string>;
  now?: Date;
  selection?: { selected: boolean; onToggle: () => void; label: string };
}

export function FixRow({ issue, basePath, pageTitles, now, selection }: FixRowProps) {
  const inProgress = issue.state === "in_progress";
  const noPlan = issue.remediation.steps.length === 0;
  const stale = inProgress && startedLongAgo(issue.startedAt, now ?? new Date());
  const meta = noPlan ? (
    <span>Plan needed</span>
  ) : inProgress ? (
    issue.owner ? (
      <span style={{ display: "inline-flex", alignItems: "center", gap: 6, minWidth: 0 }}>
        <OwnerAvatar name={issue.owner} />
        <span
          style={{
            minWidth: 0,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            color: stale ? "var(--status-warning-text)" : "var(--text-muted)",
          }}
        >
          {fixOwnerMeta(issue.owner, issue.startedAt, now)}
        </span>
      </span>
    ) : (
      <span>{FIX_NO_OWNER}</span>
    )
  ) : undefined;

  return (
    <IssueRow
      issue={issue}
      basePath={basePath}
      pageTitles={pageTitles}
      dateMode="fix"
      meta={meta}
      {...(selection ? { selection } : {})}
    />
  );
}
