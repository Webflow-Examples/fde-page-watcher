import { EFFORT_LABEL } from "@/components/issue-row";
import type { IssueAction } from "@/lib/vocabulary";

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

export function ObjectDetailHeaderActions({ actions }: { actions: readonly CaseAction[] }) {
  return (
    <>
      {actions.map((entry, index) => (
        <button
          key={entry.action}
          type="button"
          onClick={entry.onClick}
          style={{
            appearance: "none",
            cursor: "pointer",
            whiteSpace: "nowrap",
            fontSize: 13,
            fontWeight: index === 0 ? 550 : 500,
            padding: "8px 15px",
            borderRadius: 8,
            border: index === 0 ? 0 : "1px solid var(--border-strong)",
            background: index === 0 ? "var(--action-primary-bg)" : "var(--surface-card)",
            color: index === 0 ? "var(--action-primary-text)" : "var(--text-body)",
          }}
        >
          {entry.label}
        </button>
      ))}
    </>
  );
}
