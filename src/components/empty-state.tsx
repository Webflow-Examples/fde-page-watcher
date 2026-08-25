import Link from "next/link";
import type { ReactNode } from "react";

/**
 * The one empty-state card, and the one action inside it.
 *
 * Two rules travel with it, both from the issues list where it was decided:
 *
 *   - Say what happened. Not "no results" — what state the project is in, and
 *     what would change it.
 *   - At most one action, and often none. The type takes a single node.
 *
 * And one thing it is never used with: a table. An empty table with headers
 * tells the reader their filter is broken rather than that there is nothing to
 * see, which is why a screen with no rows at all shows this instead of its own
 * column headers.
 *
 * It lives here rather than in `issue-empty.tsx` because the pages destination
 * shows the same card when nothing is being measured. The five issue-list
 * sentences stay in that file; the card they sit in is shared.
 */

export interface EmptyStateProps {
  heading: string;
  /** Optional, for a state whose sentence is the whole message. */
  children?: ReactNode;
  /** At most one, by design. */
  action?: ReactNode;
}

export function EmptyState({ heading, children, action }: EmptyStateProps) {
  return (
    <section
      style={{
        margin: "4px 40px 40px",
        padding: "28px 26px",
        border: "1px solid var(--border-hairline)",
        borderRadius: 12,
        background: "var(--surface-card)",
      }}
    >
      <h2 style={{ margin: 0, fontSize: 16, fontWeight: 600, color: "var(--text-body)", letterSpacing: "-0.01em" }}>
        {heading}
      </h2>
      {children ? (
        <p style={{ margin: "8px 0 0", maxWidth: 560, fontSize: 13, lineHeight: 1.6, color: "var(--text-muted)" }}>
          {children}
        </p>
      ) : null}
      {action ? <div style={{ marginTop: 16 }}>{action}</div> : null}
    </section>
  );
}

export function EmptyAction({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link
      href={href}
      style={{
        display: "inline-flex",
        alignItems: "center",
        padding: "7px 13px",
        borderRadius: 8,
        fontSize: 13,
        fontWeight: 550,
        textDecoration: "none",
        color: "var(--action-primary-text)",
        background: "var(--action-primary-bg)",
      }}
    >
      {children}
    </Link>
  );
}
