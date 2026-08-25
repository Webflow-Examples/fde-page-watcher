import type { CSSProperties } from "react";
import type { WorkState } from "@/lib/vocabulary";
import { WORK_STATE_LABEL, WORK_STATE_TONE } from "@/lib/vocabulary";

/**
 * The one status chip. Every work state in the app renders through this
 * component, so the label and the tone always come from the vocabulary
 * registry rather than from call sites.
 *
 * The tone resolves through `--status-<tone>-text` and `--status-<tone>-bg`,
 * defined for all five tones in both theme blocks of `globals.css` (chunk F3).
 * Those two blocks are the only place a colour value is named — do not add a
 * hex fallback here, and do not reach for the `--health-*` tokens. A work
 * state is not a health verdict, and R1 reserves those hues for health.
 */

/**
 * A status chip is 12px and weight 600. Nothing carrying meaning renders
 * below 12px (F3 rule 10), and a work-state label is meaning, so 12 is both
 * the default and the floor.
 */
const DEFAULT_FONT_SIZE = 12;
const MIN_FONT_SIZE = 12;

export interface StatusChipProps {
  state: WorkState;
  /** Clamped to no smaller than 12px, per the vocabulary registry's rules. */
  fontSize?: number;
  style?: CSSProperties;
  className?: string;
}

export function StatusChip({ state, fontSize = DEFAULT_FONT_SIZE, style, className }: StatusChipProps) {
  const tone = WORK_STATE_TONE[state];
  return (
    <span
      className={className}
      // Exposed so F3 can also style by attribute selector if it prefers that
      // to the custom properties below, and so tests can assert the tone.
      data-status-tone={tone}
      data-work-state={state}
      style={{
        display: "inline-flex",
        alignItems: "center",
        fontWeight: 600,
        lineHeight: 1.35,
        padding: "1px 8px",
        borderRadius: 20,
        whiteSpace: "nowrap",
        ...style,
        // After the spread on purpose: a caller may adjust layout, never the
        // tone or the type floor. Letting `style` win here is how a hex gets
        // back into the app one chip at a time.
        fontSize: Math.max(MIN_FONT_SIZE, fontSize),
        color: `var(--status-${tone}-text)`,
        background: `var(--status-${tone}-bg)`,
      }}
    >
      {WORK_STATE_LABEL[state]}
    </span>
  );
}
