import type { CSSProperties } from "react";
import type { Trend } from "@/lib/vocabulary";
import { TREND_LABEL } from "@/lib/vocabulary";

/**
 * The one trend indicator. Trend is SHAPE, not hue (R2): an arrow glyph plus
 * the F1 label, in a single colour that never varies by direction.
 *
 * This exists because a coloured trend and a coloured health chip collide —
 * green "improving" next to red "Poor" reads as one contradictory signal
 * rather than two independent true ones. Health keeps the hue; trend keeps
 * the arrow. A row showing both is correct and expected.
 *
 * Do not add a per-direction colour here. If a caller wants to stress that a
 * regression is bad, that is a health verdict and belongs on the health chip.
 */

/** Trend text carries meaning, so it never renders below 12px. */
const DEFAULT_FONT_SIZE = 12;
const MIN_FONT_SIZE = 12;

const TREND_GLYPH: Record<Trend, string> = {
  improving: "↑",
  no_change: "→",
  regressing: "↓",
};

export interface TrendArrowProps {
  trend: Trend;
  /** Clamped to no smaller than 12px — the arrow and its label carry meaning. */
  fontSize?: number;
  /** Hide the word, keep the arrow. The label still reaches assistive tech. */
  labelHidden?: boolean;
  style?: CSSProperties;
  className?: string;
}

export function TrendArrow({
  trend,
  fontSize = DEFAULT_FONT_SIZE,
  labelHidden = false,
  style,
  className,
}: TrendArrowProps) {
  const label = TREND_LABEL[trend];
  return (
    <span
      className={className}
      data-trend={trend}
      title={labelHidden ? label : undefined}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        color: "var(--trend-glyph)",
        fontSize: Math.max(MIN_FONT_SIZE, fontSize),
        lineHeight: 1.35,
        whiteSpace: "nowrap",
        ...style,
      }}
    >
      <span aria-hidden="true" style={{ fontWeight: 650 }}>
        {TREND_GLYPH[trend]}
      </span>
      <span className={labelHidden ? "sr-only" : undefined}>{label}</span>
    </span>
  );
}
