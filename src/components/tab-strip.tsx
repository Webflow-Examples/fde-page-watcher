import Link from "next/link";
import type { ReactNode } from "react";

/**
 * The one tab strip: a row of links directly under a route header, one of them
 * current.
 *
 * The treatment was decided on the issues list's queue tabs and is now shared,
 * because a second strip styled independently is a second answer to "what does
 * a tab look like here" — and the pages destination's view switch is exactly
 * that second strip. `QueueTabs` renders through this and keeps what is its own:
 * the registry's queue names and the count badges.
 *
 * Every tab is a link, never a button. A tab is a place, so it belongs in the
 * URL and in the browser's history — a person should be able to send someone
 * the view they are looking at.
 */

export interface TabStripTab {
  key: string;
  label: string;
  href: string;
  current: boolean;
  /** Rendered after the label. A count, or nothing at all. */
  badge?: ReactNode;
}

export function TabStrip({ ariaLabel, tabs }: { ariaLabel: string; tabs: readonly TabStripTab[] }) {
  return (
    <nav
      aria-label={ariaLabel}
      style={{
        display: "flex",
        gap: 2,
        alignItems: "center",
        padding: "18px 40px 0",
        borderBottom: "1px solid var(--border-hairline)",
        margin: "0 0 20px",
        overflowX: "auto",
      }}
    >
      {tabs.map((tab) => (
        <Link
          key={tab.key}
          href={tab.href}
          aria-current={tab.current ? "page" : undefined}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 7,
            padding: "8px 12px 11px",
            fontSize: 13,
            fontWeight: 500,
            whiteSpace: "nowrap",
            textDecoration: "none",
            color: tab.current ? "var(--text-body)" : "var(--text-muted)",
            borderBottom: `2px solid ${tab.current ? "var(--action-primary-bg)" : "transparent"}`,
            marginBottom: -1,
          }}
        >
          {tab.label}
          {tab.badge}
        </Link>
      ))}
    </nav>
  );
}
