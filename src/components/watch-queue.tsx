"use client";

import { useState } from "react";
import { byNextDue } from "@/lib/checkpoint-evaluation";
import type { IssueCase } from "@/lib/issue-case";
import { watchIntro } from "@/lib/watch-copy";
import { WatchRow } from "@/components/watch-row";

/**
 * The Watch tab (15d, and the ordering in item 6).
 *
 * Ordered by the next check due, ascending — the question a reader brings to
 * this list is "what am I hearing about next", and nothing else it could be
 * sorted by answers that. It deliberately does not take the list's sort
 * control: impact and effort are decisions about work, and there is no work
 * here to decide about.
 *
 * One row open at a time. Two open drawers in a vertical list means the second
 * one pushes the first one's contents away from the marks they belong to, and
 * the reader loses track of which track is which.
 */

export interface WatchQueueProps {
  cases: readonly IssueCase[];
  onReopen?: (issue: IssueCase) => void;
  onRecheck?: (issue: IssueCase) => void;
  now?: Date;
  locale?: string;
}

export function WatchQueue({ cases, onReopen, onRecheck, now, locale }: WatchQueueProps) {
  const [openId, setOpenId] = useState<string | null>(null);
  const ordered = [...cases].sort(byNextDue);

  return (
    <div>
      {/* One line, under the tabs. It says what the list is and that it does
          not need anyone — which is the whole reason a person can leave it
          alone. */}
      <p
        style={{
          margin: "0 0 16px",
          padding: "0 40px",
          fontSize: 12.5,
          color: "var(--text-muted)",
          maxWidth: "78ch",
        }}
      >
        {watchIntro(ordered.length)}
      </p>

      <div style={{ borderBottom: "1px solid var(--border-hairline)" }}>
        {ordered.map((issue) => (
          <WatchRow
            key={issue.id}
            issue={issue}
            open={openId === issue.id}
            onToggle={() => setOpenId((previous) => (previous === issue.id ? null : issue.id))}
            onReopen={onReopen ? () => onReopen(issue) : undefined}
            onRecheck={onRecheck ? () => onRecheck(issue) : undefined}
            now={now}
            locale={locale}
          />
        ))}
      </div>
    </div>
  );
}
