import type { CSSProperties } from "react";

/**
 * The one way to render "how much". Magnitude is WEIGHT, not hue (R3).
 *
 * Savings, deltas, and counts used to arrive in amber, which put them in the
 * same visual family as a warning health verdict — a 1.8 s saving is not a
 * problem, and colouring it like one made every number on the page argue with
 * the health chip beside it. The number now carries its own emphasis: value at
 * `--magnitude-value` and weight 650, unit label at `--magnitude-unit`.
 *
 * Do not pass a hue in. If a number needs a verdict attached, put the verdict
 * on a health chip next to it and leave the number alone.
 */

/** A magnitude carries meaning, so it never renders below 12px. */
const DEFAULT_FONT_SIZE = 13;
const MIN_FONT_SIZE = 12;

/** The value's weight is what does the work here — see R3. */
export const MAGNITUDE_WEIGHT = 650;

export interface MagnitudeProps {
  /** The number, already formatted (e.g. "1.8", "12", "−4"). */
  value: string | number;
  /** The trailing unit or noun (e.g. "s", "pages", "returned"). Optional. */
  unit?: string;
  fontSize?: number;
  style?: CSSProperties;
  className?: string;
}

export function Magnitude({ value, unit, fontSize = DEFAULT_FONT_SIZE, style, className }: MagnitudeProps) {
  const size = Math.max(MIN_FONT_SIZE, fontSize);
  return (
    <span
      className={className}
      style={{
        display: "inline-flex",
        alignItems: "baseline",
        gap: 4,
        fontSize: size,
        lineHeight: 1.35,
        whiteSpace: "nowrap",
        ...style,
      }}
    >
      <span style={{ color: "var(--magnitude-value)", fontWeight: MAGNITUDE_WEIGHT, fontVariantNumeric: "tabular-nums" }}>
        {value}
      </span>
      {unit ? <span style={{ color: "var(--magnitude-unit)", fontWeight: 500 }}>{unit}</span> : null}
    </span>
  );
}
