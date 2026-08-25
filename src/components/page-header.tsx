import type { ReactNode } from "react";

/**
 * The one route header. Every `(app)/` route titles itself through this, so the
 * type scale, spacing, and the "one primary action" rule are decided once
 * instead of per page.
 *
 * Three parts, and only three:
 *
 *   title    what this place is, in the destination's own word
 *   purpose  one line saying what you do here — not a description of the data
 *   action   at most ONE primary action, and often none
 *
 * The single-action rule is deliberate and enforced by the type: `action` takes
 * one node, not an array. A route that seems to need two primary actions has
 * either two jobs or one action that belongs in the body next to the thing it
 * acts on. Secondary controls (filters, toggles, sort) are body chrome and
 * belong under the header, not in it.
 *
 * Colours come from the F3 token layer. Nothing here names a colour value.
 */

export interface PageHeaderProps {
  title: string;
  /** One line. If it needs a second sentence, it belongs in the body. */
  purpose?: string;
  /** At most one primary action, by design. */
  action?: ReactNode;
  /**
   * Set when the header sits directly on top of its own tab strip or toolbar,
   * which supplies the gap instead.
   */
  flush?: boolean;
  className?: string;
}

export function PageHeader({ title, purpose, action, flush = false, className }: PageHeaderProps) {
  return (
    <header
      className={className}
      style={{
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "space-between",
        gap: 24,
        padding: flush ? "30px 40px 0" : "30px 40px 24px",
      }}
    >
      <div style={{ minWidth: 0 }}>
        {/*
          This is the `.pages-header` treatment, promoted to the one route
          header. Three sizes were in use before the extraction — 24px here,
          27px on Watchlist, 22px on Issues — and settling on the most
          established of them is the point of having one component.
        */}
        <h1 style={{ margin: 0, color: "var(--text-body)", fontSize: 24, fontWeight: 650, letterSpacing: "-0.02em", lineHeight: 1.25 }}>
          {title}
        </h1>
        {purpose ? (
          <p style={{ margin: "7px 0 0", maxWidth: 680, color: "var(--text-muted)", fontSize: 13, lineHeight: 1.5 }}>
            {purpose}
          </p>
        ) : null}
      </div>
      {action ? <div style={{ flex: "none" }}>{action}</div> : null}
    </header>
  );
}
