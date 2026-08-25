import type { CSSProperties } from "react";
import { NOT_MEASURED } from "@/lib/impact-format";
import type { ScoreBand } from "@/lib/scoring";
import { BAND_HEALTH } from "@/lib/scoring";
import { HEALTH_LABEL } from "@/lib/vocabulary";

/**
 * The one health chip. Health is HUE (R1): it answers "is this good right
 * now?" and nothing else.
 *
 * It sits beside a `<TrendArrow>` on the same row wherever both are known, and
 * the split is deliberate (F1 rule 4): the verdict carries the colour, the
 * direction carries the word and the glyph. A green "Improving" next to a red
 * "Poor" reads as one contradictory signal; a red "Poor" next to an "Improving"
 * arrow reads as two true ones.
 *
 * `none` is a real band, not a fallback. "No verdict yet" is an answer, and it
 * is not a warning — so it takes the neutral pair rather than warn's amber, and
 * its default word is the app's one way of saying a reading is absent.
 */

export type HealthChipBand = ScoreBand | "none";

/** The chip's treatment, for callers that need to label it themselves. */
export function healthChipStyle(band: HealthChipBand): CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    padding: "3px 8px",
    borderRadius: 6,
    // Registry rule 8: a status chip is 12px, weight 600, and never smaller.
    fontSize: 12,
    fontWeight: 600,
    whiteSpace: "nowrap",
    color: `var(--health-${band}-text)`,
    background: `var(--health-${band}-bg)`,
  };
}

export interface HealthChipProps {
  band: HealthChipBand;
  /**
   * Overrides the word. Only for a chip that is answering a narrower question
   * than "how is this page doing" — the vocabulary's three health words are
   * otherwise the labels, and they are not chosen here.
   */
  label?: string;
  title?: string;
}

export function HealthChip({ band, label, title }: HealthChipProps) {
  const word = label ?? (band === "none" ? NOT_MEASURED : HEALTH_LABEL[BAND_HEALTH[band]]);
  return (
    <span style={healthChipStyle(band)} title={title}>
      {word}
    </span>
  );
}
