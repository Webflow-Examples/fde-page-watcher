// Metric tooltip copy for ScoreCard's title hover (see ScoreCard density
// handoff §5). Identical at every density, including the XSmall row-cell
// label. Copy is verbatim from the handoff — do not paraphrase it.

export interface MetricTooltipCopy {
  unit: string;
  body: string;
}

export const SCORE_BANDS_LABEL = [
  { color: "#35D07F", text: "90–100 good" },
  { color: "#FF9A3D", text: "50–89 needs work" },
  { color: "#FF5C6C", text: "0–49 poor" },
] as const;

const UNIT_LINE = "Lighthouse score · 0–100";

/** Keyed by the card title so callers can look this up with `data.title`. */
export const METRIC_TOOLTIP_COPY: Record<string, MetricTooltipCopy> = {
  Performance: {
    unit: UNIT_LINE,
    body: "How quickly the page renders and becomes usable. Weighted from five lab metrics — LCP, Total Blocking Time, CLS, First Contentful Paint and Speed Index — collected on a throttled connection, so it moves more night to night than the other three.",
  },
  Accessibility: {
    unit: UNIT_LINE,
    body: "Automated checks for common accessibility failures: colour contrast, ARIA usage, form labels, names and focus order. Passing every check does not guarantee the page is accessible — it means nothing automated could be caught.",
  },
  "Best Practices": {
    unit: UNIT_LINE,
    body: "General web health: HTTPS, console errors, deprecated APIs, correctly sized images and browser permission prompts. Scored from a flat set of pass/fail audits, so it steps rather than drifts.",
  },
  SEO: {
    unit: UNIT_LINE,
    body: "Whether a crawler can reach and understand the page: title and meta description, crawlable links, valid robots.txt, legible font sizes, valid hreflang. It checks mechanics, not content quality or ranking.",
  },
};

/** Falls back to the Performance copy's unit line only if a title is unrecognized; never fabricates body copy. */
export function metricTooltipFor(title: string): MetricTooltipCopy | null {
  return METRIC_TOOLTIP_COPY[title] ?? null;
}
