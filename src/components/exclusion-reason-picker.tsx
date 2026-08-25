"use client";

import { EXCLUSION_REASONS, type ExclusionReason } from "@/lib/vocabulary";

/**
 * The reasons applicability requires, asked for before the exclusion happens.
 *
 * The reason is not optional and it is not a follow-up: excluding without one is
 * the thing the registry forbids, and a prompt that appears afterwards is a
 * prompt nobody completes. So the act of excluding IS choosing the reason —
 * there is no separate confirm.
 *
 * Extracted from the case's pages table when the page detail needed the same
 * question about a native-element finding. Two copies of a three-button reason
 * list would be two places for a fourth reason to fail to appear (rule 20), and
 * the list itself is the registry's rather than either caller's.
 */

export interface ExclusionReasonPickerProps {
  onChoose: (reason: ExclusionReason) => void;
  onCancel: () => void;
  /** Names what is being excluded, for the group's accessible name. */
  label?: string;
}

export function ExclusionReasonPicker({
  onChoose,
  onCancel,
  label = "Reason for excluding",
}: ExclusionReasonPickerProps) {
  return (
    <div
      role="group"
      aria-label={label}
      style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}
    >
      {EXCLUSION_REASONS.map((reason) => (
        <button
          key={reason}
          type="button"
          onClick={() => onChoose(reason)}
          style={{
            appearance: "none",
            cursor: "pointer",
            fontSize: 12,
            padding: "4px 9px",
            borderRadius: 6,
            border: "1px solid var(--border-strong)",
            background: "var(--surface-card)",
            color: "var(--text-body)",
          }}
        >
          {reason}
        </button>
      ))}
      <button
        type="button"
        onClick={onCancel}
        style={{
          appearance: "none",
          cursor: "pointer",
          fontSize: 12,
          padding: "4px 6px",
          border: 0,
          background: "transparent",
          color: "var(--text-muted)",
        }}
      >
        Cancel
      </button>
    </div>
  );
}
