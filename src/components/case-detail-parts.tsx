import { EFFORT_LABEL } from "@/components/issue-row";
import { ISSUE_ACTION_LABEL } from "@/lib/vocabulary";

/**
 * The case header's action pair, and the effort words it reuses.
 *
 * Accept and Dismiss are a pair rather than a primary and a secondary: the
 * whole point of the case is that both are real answers, and styling one as an
 * afterthought puts a thumb on the decision. Accept leads because it is the
 * commitment; Dismiss is quiet, not hidden.
 */

export { EFFORT_LABEL };

export function ObjectDetailHeaderActions({
  acceptLabel,
  onAccept,
  onDismiss,
}: {
  acceptLabel: string;
  onAccept?: () => void;
  onDismiss?: () => void;
}) {
  return (
    <>
      <button
        type="button"
        onClick={onAccept}
        style={{
          appearance: "none",
          cursor: "pointer",
          whiteSpace: "nowrap",
          fontSize: 13,
          fontWeight: 550,
          padding: "8px 15px",
          borderRadius: 8,
          border: 0,
          background: "var(--action-primary-bg)",
          color: "var(--action-primary-text)",
        }}
      >
        {acceptLabel}
      </button>
      <button
        type="button"
        onClick={onDismiss}
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
        {/* The registry names the verb. Accept's label is composed from the
            selection, so it arrives as a prop; Dismiss has no count in it. */}
        {ISSUE_ACTION_LABEL.dismiss}
      </button>
    </>
  );
}
