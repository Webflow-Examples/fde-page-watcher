import Link from "next/link";
import type { ReactNode } from "react";

/**
 * The header for one object — a case here, a page in S3.
 *
 * This is the SECOND of exactly two header patterns in the app, and the line
 * between them is what the thing is rather than what it looks like:
 *
 *   PageHeader           a destination. "Issues", "Pages". Says what this place
 *                        is and what you do here. One primary action.
 *   ObjectDetailHeader   one object inside a destination. Says what this thing
 *                        is, what state it is in, and what you can do to it.
 *
 * A third pattern is a bug, and the way a third arrives is someone needing a
 * breadcrumb on a destination or a state chip on a route — at which point the
 * question is which of these two it is, not what a new one should look like.
 *
 * The order is fixed and it is the reading order, not a layout preference:
 *
 *   breadcrumb    where this sits, and the way back
 *   state + date  what it is now, and since when
 *   title         the object in its own words, at most two lines
 *   explanation   one paragraph — why this is here, in prose
 *   actions       right of the title, in a row, so they never separate the
 *                 title from its text
 *   metadata      directly under the explanation, in the title's own column
 *
 * Metadata sits after the prose on purpose. A strip of chips above the title
 * makes the reader parse a taxonomy before they have been told what the
 * problem is, and the taxonomy only means anything once they have. It shares
 * the title's column rather than spanning the header, so it stays beneath the
 * sentence it qualifies instead of being pushed below the actions.
 */

export interface ObjectDetailHeaderProps {
  breadcrumb: { label: string; href: string };
  /** The state chip. Rendered as given so each object can use its own. */
  state?: ReactNode;
  /** When it reached that state, already in the reader's words. */
  stateDate?: string;
  /** The object in its own words. Clamped to two lines. */
  title: string;
  /** One paragraph. If it needs two, one of them belongs in the body. */
  explanation?: string;
  /**
   * In a row at the right. Unlike `PageHeader` this takes a node rather than
   * one action, because an object legitimately offers a decision and its
   * opposite — Accept and Dismiss are a pair, not a primary and a runner-up.
   * A pair reads as a pair side by side; stacked, the second looked like a
   * consequence of the first.
   */
  actions?: ReactNode;
  /** Reference detail, rendered below the paragraph. */
  metadata?: ReactNode;
}

export function ObjectDetailHeader({
  breadcrumb,
  state,
  stateDate,
  title,
  explanation,
  actions,
  metadata,
}: ObjectDetailHeaderProps) {
  return (
    <header style={{ padding: "20px 40px 0" }}>
      <nav aria-label="Breadcrumb" style={{ marginBottom: 12 }}>
        <Link
          href={breadcrumb.href}
          style={{ fontSize: 12.5, color: "var(--action-primary-ink)", textDecoration: "none" }}
        >
          ← {breadcrumb.label}
        </Link>
      </nav>

      <div style={{ display: "flex", alignItems: "flex-start", gap: 24 }}>
        <div style={{ flex: "1 1 auto", minWidth: 0 }}>
          {state || stateDate ? (
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
              {state}
              {stateDate ? (
                <span style={{ fontSize: 12.5, color: "var(--text-muted)" }}>{stateDate}</span>
              ) : null}
            </div>
          ) : null}

          <h1
            style={{
              margin: 0,
              fontSize: 21,
              lineHeight: 1.32,
              fontWeight: 600,
              letterSpacing: "-0.015em",
              color: "var(--text-body)",
              // Two lines, then ellipsis. A diagnosis is one sentence by
              // decision, so a third line means the sentence grew a clause it
              // should not have — clamping shows that rather than reflowing the
              // whole header around it.
              display: "-webkit-box",
              WebkitLineClamp: 2,
              WebkitBoxOrient: "vertical",
              overflow: "hidden",
            }}
            title={title}
          >
            {title}
          </h1>

          {explanation ? (
            <p
              style={{
                margin: "10px 0 0",
                maxWidth: "68ch",
                fontSize: 13,
                lineHeight: 1.6,
                color: "var(--text-muted)",
              }}
            >
              {explanation}
            </p>
          ) : null}

          {metadata ? <div style={{ marginTop: 18 }}>{metadata}</div> : null}
        </div>

        {actions ? (
          <div
            style={{
              display: "flex",
              flexDirection: "row",
              alignItems: "center",
              // Wraps rather than squeezing: two actions plus a long title on a
              // narrow viewport is the case that would otherwise clip one.
              flexWrap: "wrap",
              justifyContent: "flex-end",
              gap: 8,
              flex: "0 0 auto",
            }}
          >
            {actions}
          </div>
        ) : null}
      </div>
    </header>
  );
}
