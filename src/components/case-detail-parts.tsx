import { useState } from "react";
import { EFFORT_LABEL } from "@/components/issue-row";
import { DISMISS_REASONS, type DismissReason, type IssueAction } from "@/lib/vocabulary";

/**
 * The case header's actions, and the effort words it reuses.
 *
 * One action leads and the rest are quiet. That is not a ranking of how good the
 * answers are — from Decide, Accept and Dismiss are both real answers, and
 * styling Dismiss as an afterthought would put a thumb on the decision. It is a
 * statement about what the header is for: a reader who arrived from a digest line
 * came to do one thing, and the header names it. Dismiss is quiet, not hidden.
 *
 * Which action leads is not decided here. `primaryActionFor` reads it off the
 * registry's transition table, so a state whose legal moves change gets a
 * different button without this component knowing anything about states — and a
 * button for an illegal transition cannot be rendered, because there is no
 * caller that could compose one.
 */

export { EFFORT_LABEL };

export interface CaseAction {
  action: IssueAction;
  /**
   * The word on the button.
   *
   * A prop rather than a lookup, because Accept's label is composed from the
   * page selection — "Accept for 4 pages" is a different commitment from
   * "Accept", and the button is the last place to say so. Every other action
   * takes the registry's own label.
   */
  label: string;
  onClick?: () => void;
}

/**
 * Dismiss, with the reason the registry requires.
 *
 * The reason is not a follow-up prompt: choosing it is the act. The menu opens
 * from the same button so the reader cannot fire a dismissal without deciding
 * why, and Cancel closes it without writing anything.
 */
export function DismissAction({ onChoose }: { onChoose: (reason: DismissReason) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <span style={{ position: "relative", display: "inline-flex" }}>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((wasOpen) => !wasOpen)}
        style={{
          appearance: "none",
          cursor: "pointer",
          whiteSpace: "nowrap",
          fontSize: 13,
          fontWeight: 500,
          padding: "8px 15px",
          borderRadius: 8,
          border: "1px solid var(--border-strong)",
          background: "var(--surface-card)",
          color: "var(--text-body)",
        }}
      >
        Dismiss
      </button>
      {open ? (
        <span
          role="group"
          aria-label="Reason for dismissing"
          style={{
            position: "absolute",
            top: "calc(100% + 8px)",
            right: 0,
            zIndex: 130,
            display: "flex",
            flexDirection: "column",
            gap: 2,
            minWidth: 180,
            padding: 6,
            borderRadius: 8,
            border: "1px solid var(--border-hairline)",
            background: "var(--surface-card)",
            boxShadow: "var(--shadow-popover)",
          }}
        >
          {DISMISS_REASONS.map((reason) => (
            <button
              key={reason}
              type="button"
              onClick={() => {
                setOpen(false);
                onChoose(reason);
              }}
              style={{
                appearance: "none",
                cursor: "pointer",
                textAlign: "left",
                padding: "6px 8px",
                border: 0,
                borderRadius: 4,
                background: "transparent",
                color: "var(--text-body)",
                fontSize: 12.5,
              }}
            >
              {reason}
            </button>
          ))}
          <button
            type="button"
            onClick={() => setOpen(false)}
            style={{
              appearance: "none",
              cursor: "pointer",
              textAlign: "left",
              padding: "6px 8px",
              border: 0,
              borderRadius: 4,
              background: "transparent",
              color: "var(--text-muted)",
              fontSize: 12.5,
            }}
          >
            Cancel
          </button>
        </span>
      ) : null}
    </span>
  );
}

export function ObjectDetailHeaderActions({
  actions,
  quiet = false,
}: {
  actions: readonly CaseAction[];
  /**
   * Render every action as secondary. Used where the leading action was
   * withdrawn (no documented remediation), so the remaining legal move is
   * Dismiss and must not inherit the primary weight by being first.
   */
  quiet?: boolean;
}) {
  return (
    <>
      {actions.map((entry, index) => {
        const primary = !quiet && index === 0;
        return (
          <button
            key={entry.action}
            type="button"
            onClick={entry.onClick}
            style={{
              appearance: "none",
              cursor: "pointer",
              whiteSpace: "nowrap",
              fontSize: 13,
              fontWeight: primary ? 550 : 500,
              padding: "8px 15px",
              borderRadius: 8,
              border: primary ? 0 : "1px solid var(--border-strong)",
              background: primary ? "var(--action-primary-bg)" : "var(--surface-card)",
              color: primary ? "var(--action-primary-text)" : "var(--text-body)",
            }}
          >
            {entry.label}
          </button>
        );
      })}
    </>
  );
}
