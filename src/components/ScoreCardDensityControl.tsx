"use client";

// Density control for ScoreCard (see ScoreCard density handoff §6). A
// segmented control of four glyph-only buttons — each glyph is a set of
// vertical bars standing for the column count that density fits per row —
// that sits in a page's filter row and drives every ScoreCard on that page.
// This is page-level state owned by the caller (not this component and not
// a card group), so two card groups on one page can never disagree.
//
// Colour here is chrome and selection only: nothing in this control is a
// health verdict, a work state, or a trend, so no token from those families
// appears. Selection is the app's uniform selected-state treatment — a raised
// `--surface-raised` ground plus a `--border-strong` outline — which is the
// same answer the tab underlines and the active nav item use.

import { useState } from "react";
import { TOOLTIP_SURFACE, type ScoreCardDensity } from "./ScoreCard";

const DENSITY_OPTIONS: { key: ScoreCardDensity; bars: number; barWidth: number; label: string }[] = [
  { key: "xsmall", bars: 4, barWidth: 2, label: "XSmall" },
  { key: "small", bars: 3, barWidth: 4, label: "Small" },
  { key: "medium", bars: 2, barWidth: 8, label: "Medium" },
  { key: "large", bars: 1, barWidth: 18, label: "Large" },
];

export interface ScoreCardDensityControlProps {
  value: ScoreCardDensity;
  onChange: (next: ScoreCardDensity) => void;
}

export function ScoreCardDensityControl({ value, onChange }: ScoreCardDensityControlProps) {
  return (
    <div
      role="group"
      aria-label="Score card density"
      style={{
        display: "flex",
        gap: 2,
        // The recessed track the raised pill sits in.
        background: "var(--surface-page)",
        border: "1px solid var(--border-hairline)",
        borderRadius: 6,
        padding: 2,
      }}
    >
      {DENSITY_OPTIONS.map((option) => (
        <DensityButton
          key={option.key}
          option={option}
          selected={value === option.key}
          onSelect={() => onChange(option.key)}
        />
      ))}
    </div>
  );
}

function DensityButton({
  option,
  selected,
  onSelect,
}: {
  option: (typeof DENSITY_OPTIONS)[number];
  selected: boolean;
  onSelect: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  const barColor = selected ? "var(--text-body)" : "var(--text-muted)";
  return (
    <button
      type="button"
      aria-label={option.label}
      aria-pressed={selected}
      onClick={onSelect}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        position: "relative",
        appearance: "none",
        cursor: "pointer",
        padding: "8px 12px",
        borderRadius: 4,
        // The selected pill used to be a hand-picked near-black, lighter than
        // every surface in the app, so it read as raised purely by being the
        // brightest thing in the row. There is no token at that value, and
        // inventing one would put a fifth surface into a four-surface scale.
        // `--surface-raised` plus a `--border-strong` outline keeps the raised
        // read with tokens that already exist, and holds up in both themes
        // where a fixed dark grey could not. The outline also means selection
        // survives at all for anyone who cannot see the fill difference; the
        // transparent-but-same-width border on the unselected buttons stops
        // the row from shifting 2px when selection moves.
        background: selected ? "var(--surface-raised)" : "transparent",
        border: `1px solid ${selected ? "var(--border-strong)" : "transparent"}`,
        display: "flex",
        alignItems: "center",
        gap: 2,
        height: 30,
        boxSizing: "border-box",
      }}
    >
      {Array.from({ length: option.bars }).map((_, i) => (
        <span key={i} style={{ width: option.barWidth, height: 12, borderRadius: 1, background: barColor }} />
      ))}
      {hovered && (
        <span
          role="tooltip"
          style={{
            position: "absolute",
            top: "calc(100% + 10px)",
            right: 0,
            zIndex: 5,
            whiteSpace: "nowrap",
            // Shared with ScoreCard's metric tooltip. These two were the same
            // popover with two different hand-picked shadows; one surface
            // constant is what stops them drifting again.
            ...TOOLTIP_SURFACE,
            padding: "8px 10px",
            fontSize: 12,
            fontWeight: 600,
            color: "var(--text-body)",
          }}
        >
          {option.label}
        </span>
      )}
    </button>
  );
}
