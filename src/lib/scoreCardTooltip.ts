// Metric tooltip copy for ScoreCard's title hover (see ScoreCard density
// handoff §5). Identical at every density, including the XSmall row-cell
// label.
//
// The handoff's copy was carried verbatim until S9, which rewrote it: every
// body listed its measurements as bare acronyms — "LCP, Total Blocking Time,
// CLS" — and a reader who does not already know those four letters learns
// nothing from a sentence containing them. The measurements are unchanged and
// still named; each one now arrives after the plain description of what it
// measures.

import { SCORE_BAD, SCORE_GOOD, SCORE_WARN } from "./scoreCard";

export interface MetricTooltipCopy {
  unit: string;
  body: string;
}

/**
 * The score-band key rendered under the tooltip body.
 *
 * `token` is the band's app token NAME — the exact value `bandColor()` returns
 * for a score in that band — not a colour. Previously this table restated
 * SCORE_GOOD/WARN/BAD as three hex literals, so the legend and the chart could
 * drift apart silently; sharing the constants makes them resolve through one
 * token by construction. Callers wrap it: `var(${band.token})`.
 */
export const SCORE_BANDS_LABEL = [
  { token: SCORE_GOOD, text: "90–100 good" },
  { token: SCORE_WARN, text: "50–89 needs work" },
  { token: SCORE_BAD, text: "0–49 poor" },
] as const;

/**
 * Out of 100, and where the number came from.
 *
 * Reordered rather than reworded: it used to read "Lighthouse score · 0–100",
 * which leads with the name of the tool and leaves the reader to guess what the
 * number is. The scale is the fact; the tool is the attribution.
 */
const UNIT_LINE = "Out of 100 · the nightly test (Lighthouse)";

/**
 * What each score is about.
 *
 * Every industry term here is introduced by its plain meaning and follows it in
 * parentheses. That is the whole pattern, and these four bodies are where the
 * spelled-out measurement names are introduced for the score card — the chips
 * elsewhere on the screen carry the acronym alone, which is only honest because
 * the words appear here.
 *
 * These are not the pattern's mechanism, though, and must not become it. A
 * tooltip is unreachable in a digest, a ticket or a screenshot, which is where
 * most of this copy is read; anything a reader genuinely needs in order to act
 * belongs in the sentence that asks them to act, not in a hover.
 *
 * Keyed by the card title so callers can look this up with `data.title`.
 */
export const METRIC_TOOLTIP_COPY: Record<string, MetricTooltipCopy> = {
  Performance: {
    unit: UNIT_LINE,
    body: "How quickly the page becomes usable. Weighted from five readings taken on a deliberately slow connection: when the main content appears (largest contentful paint), how long the page cannot respond to a tap (total blocking time), how much the content jumps about while it loads (cumulative layout shift), when the first text or image appears (first contentful paint), and how quickly the page fills in overall (speed index). Because the connection is simulated, this moves more from night to night than the other three.",
  },
  Accessibility: {
    unit: UNIT_LINE,
    body: "Automated checks for the barriers that stop people using the page: colour contrast, the labels screen readers announce, form field names, and the order keyboard focus moves in. Passing every check does not mean the page is accessible — it means nothing a machine can catch was caught.",
  },
  "Best Practices": {
    unit: UNIT_LINE,
    body: "General web health: whether the page is served securely (HTTPS), errors it logs while loading, browser features it uses that are being withdrawn, images sized correctly, and how it asks permission for things like location. Each check passes or fails outright, so this score steps rather than drifts.",
  },
  SEO: {
    unit: UNIT_LINE,
    body: "Whether a search engine can reach the page and work out what it says (search engine optimisation): its title and summary text (meta description), links it can follow, a valid file telling crawlers what they may read (robots.txt), font sizes big enough to read, and correct markings for other languages (hreflang). It checks the mechanics, not how good the content is or where it will rank.",
  },
};

/** Falls back to the Performance copy's unit line only if a title is unrecognized; never fabricates body copy. */
export function metricTooltipFor(title: string): MetricTooltipCopy | null {
  return METRIC_TOOLTIP_COPY[title] ?? null;
}
