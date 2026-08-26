import type {
  CustomerActionability,
  WebflowPerformanceClassification,
  WebflowPerformanceCulprit,
  WebflowPerformanceMetric,
  WebflowRemediationLevel,
} from "./types";
import type { Tone } from "./vocabulary";
import { appositive } from "./plain-language";

type CatalogEntry = Pick<
  WebflowPerformanceClassification,
  "metric" | "culprit" | "culpritLabel" | "remediation" | "guidance"
>;

const REMEDIATION_LABELS: Record<WebflowRemediationLevel, string> = {
  blocked: "No direct action",
  partial: "Workaround available",
  available: "Action available",
  unknown: "Needs review",
};

const WEBFLOW_NO_DIRECT_ACTION = new Set([
  "bootup-time",
  "mainthread-work-breakdown",
  "render-blocking-resources",
  "render-blocking-insight",
  "legacy-javascript",
]);

const METRIC_WEIGHTS: Record<WebflowPerformanceMetric, 0 | 25 | 30> = {
  TBT: 30,
  LCP: 25,
  CLS: 25,
  other: 0,
};

/**
 * What each measurement is about, in words, with the standard name after it.
 *
 * The keys are the industry acronyms and stay so — they are the axis a finding
 * is classified on, and they match what every other tool reports. What changes
 * is the reading order: a chip used to say "TBT · 30%", which leads with three
 * letters a reader cannot act on and buries the only part they can. Now the
 * plain word comes first and the acronym follows it, which is the one pattern.
 *
 * The acronym rather than the spelled-out term, and only here, because a chip
 * is a few characters wide. The spelled-out appositive — "total blocking time"
 * — is introduced once on each screen that shows these, in the prose beside the
 * chips rather than inside them.
 */
export const METRIC_PLAIN: Record<WebflowPerformanceMetric, string> = {
  TBT: "Responsiveness",
  LCP: "Main content",
  CLS: "Content jumping",
  // Never displayed: `metricDisplay` is only reached for a classified metric,
  // and every caller already hides the chip when the metric is `other`.
  other: "",
};

/** "Responsiveness (TBT)". Plain meaning first, standard name after it. */
export function metricDisplay(metric: WebflowPerformanceMetric): string {
  return metric === "other" ? "" : appositive(METRIC_PLAIN[metric], metric);
}

/**
 * The name each culprit group carries on screen.
 *
 * Exported so a test can assert that a rollup resolved the right culprit
 * without restating the words. Rule 21: an assertion holding its own copy of
 * "Site-wide code" proves the two spellings agree, never that the grouping is
 * right, and it fails on a rewording that broke nothing.
 *
 * Short by necessity — these label chips and group headings — so where a
 * measurement needs introducing, the appositive goes in the sentence beside the
 * chip rather than inside it.
 */
export const CULPRIT_GROUP_LABELS: Record<WebflowPerformanceCulprit, string> = {
  "global-javascript": "Site-wide code",
  "main-thread-work": "Work the browser must finish first",
  "third-party-code": "Code from other companies",
  "dom-complexity": "Deeply nested elements",
  "lcp-element": "The main thing visitors wait for",
  "global-css": "Site-wide style rules",
  "image-delivery": "How images are sent",
  "render-blocking": "Files that delay the first text",
  "custom-javascript": "Your own code",
  "layout-stability": "Content that moves while loading",
  "background-video": "Background video",
  "video-embeds": "Video players",
  "interactive-media": "Animations and 3D scenes",
  other: "Everything else the nightly test found",
};

const CATALOG: Record<string, CatalogEntry> = {
  "bootup-time": {
    metric: "TBT",
    culprit: "global-javascript",
    culpritLabel: "Code running at startup",
    remediation: "blocked",
    guidance: "Cut back or delay the code that runs as the page starts, beginning with your own and with anything this page does not need.",
  },
  "mainthread-work-breakdown": {
    metric: "TBT",
    culprit: "main-thread-work",
    culpritLabel: "Work the browser must finish first",
    remediation: "blocked",
    guidance: "Find the longest jobs the browser had to finish before it could respond, and deal with the scripts, styles or page structure behind them.",
  },
  "third-party-summary": {
    metric: "TBT",
    culprit: "third-party-code",
    culpritLabel: "Code from other companies",
    remediation: "partial",
    guidance: "Remove the tags and embeds you do not need, or load them later, or only on the pages that use them.",
  },
  "third-party-facades": {
    metric: "TBT",
    culprit: "third-party-code",
    culpritLabel: "Embeds from other companies",
    remediation: "partial",
    guidance: "Show a still image in place of the embed and load the real thing when somebody clicks it.",
  },
  "dom-size": {
    metric: "TBT",
    culprit: "dom-complexity",
    culpritLabel: "Deeply nested elements",
    remediation: "partial",
    guidance: "Flatten nesting you do not need and shorten the page, or load the sections below the first screenful later.",
  },
  "largest-contentful-paint-element": {
    metric: "LCP",
    culprit: "lcp-element",
    culpritLabel: "The main thing visitors wait for",
    remediation: "partial",
    guidance: "Find the biggest thing visible without scrolling, then simplify it, resize it, load it sooner, or replace it.",
  },
  "lcp-discovery-insight": {
    metric: "LCP",
    culprit: "lcp-element",
    culpritLabel: "The main image found late",
    remediation: "partial",
    guidance: "Make sure the browser can find the main image straight away, and do not set anything visible without scrolling to load late.",
  },
  "prioritize-lcp-image": {
    metric: "LCP",
    culprit: "lcp-element",
    culpritLabel: "The main image loaded last",
    remediation: "partial",
    guidance: "Load the main image first, and do not reach it through a script or a style that arrives late.",
  },
  "lcp-lazy-loaded": {
    metric: "LCP",
    culprit: "lcp-element",
    culpritLabel: "The main image set to load late",
    remediation: "partial",
    guidance: "Do not set the main image to load late when it is visible without scrolling.",
  },
  "unused-css-rules": {
    metric: "LCP",
    culprit: "global-css",
    culpritLabel: "Style rules the site never uses",
    remediation: "blocked",
    guidance: "Delete the classes and style rules nothing uses, and stop sending one page’s styles to pages that do not need them.",
  },
  "uses-responsive-images": {
    metric: "LCP",
    culprit: "image-delivery",
    culpritLabel: "Images bigger than they are shown",
    remediation: "available",
    guidance: "Resize the original, and offer it at several sizes so a browser can take the one it needs.",
  },
  "uses-optimized-images": {
    metric: "LCP",
    culprit: "image-delivery",
    culpritLabel: "Images heavier than they need to be",
    remediation: "available",
    guidance: "Compress the originals, and save them in a format that holds the quality you need at a smaller size.",
  },
  "modern-image-formats": {
    metric: "LCP",
    culprit: "image-delivery",
    culpritLabel: "Images in an older format",
    remediation: "available",
    guidance: "Save the images that suit it in a newer format (WebP), and keep the original close to the size it is shown at.",
  },
  "image-delivery-insight": {
    metric: "LCP",
    culprit: "image-delivery",
    culpritLabel: "How images are sent",
    remediation: "available",
    guidance: "Resize and compress the images named here, then save them in the smallest format the site supports.",
  },
  "render-blocking-resources": {
    metric: "LCP",
    culprit: "render-blocking",
    culpritLabel: "Render-blocking resources",
    remediation: "blocked",
    guidance: "Put the styles the first screenful needs directly in the page, and delay or split the rest of your own.",
  },
  "render-blocking-insight": {
    metric: "LCP",
    culprit: "render-blocking",
    culpritLabel: "Render-blocking resources",
    remediation: "blocked",
    guidance: "Put the styles the first screenful needs directly in the page, and delay or split the rest of your own.",
  },
  "unminified-javascript": {
    metric: "LCP",
    culprit: "custom-javascript",
    culpritLabel: "Your own code shipped unshrunk",
    remediation: "partial",
    guidance: "Shrink your own code before publishing it, and keep the parts you only use while building out of the live site.",
  },
  "legacy-javascript": {
    metric: "LCP",
    culprit: "global-javascript",
    culpritLabel: "Code written for browsers nobody uses",
    remediation: "blocked",
    guidance: "Send current browsers the modern version of your code, and drop the extra code added for browsers nobody uses.",
  },
  "unused-javascript": {
    metric: "LCP",
    culprit: "global-javascript",
    culpritLabel: "Code the site never runs",
    remediation: "blocked",
    guidance: "Drop the optional scripts, split the code up by page, or load each part only where it is used.",
  },
  "unsized-images": {
    metric: "CLS",
    culprit: "layout-stability",
    culpritLabel: "Images with no space reserved",
    remediation: "available",
    guidance: "Give every image a width and height so the space it needs is held open before it arrives.",
  },
  "webflow-background-video": {
    metric: "LCP",
    culprit: "background-video",
    culpritLabel: "Background video",
    remediation: "partial",
    guidance: "Use a still image instead where you can, or load the background video only as it comes into view.",
  },
  "webflow-video-embed-eager": {
    metric: "TBT",
    culprit: "video-embeds",
    culpritLabel: "Video players loading too early",
    remediation: "partial",
    guidance: "Show a still image in place of the YouTube or Vimeo player, and load the player when somebody clicks or as it comes into view.",
  },
  "webflow-video-embed-duplicate": {
    metric: "TBT",
    culprit: "video-embeds",
    culpritLabel: "The same video player loaded twice",
    remediation: "partial",
    guidance: "Load one player for the whole page, and show a still image for the rest until somebody clicks.",
  },
  "webflow-lottie-eager": {
    metric: "TBT",
    culprit: "interactive-media",
    culpritLabel: "Animations loading too early",
    remediation: "partial",
    guidance: "Make the animation files smaller, and load them only as they come into view when they start below the first screenful.",
  },
  "webflow-spline-eager": {
    metric: "TBT",
    culprit: "interactive-media",
    culpritLabel: "3D scenes loading too early",
    remediation: "partial",
    guidance: "Show a still image instead where you can, or load the 3D scene only as it comes into view.",
  },
  "webflow-image-unresponsive": {
    metric: "LCP",
    culprit: "image-delivery",
    culpritLabel: "One image size sent to every screen",
    remediation: "available",
    guidance: "Resize the original, and offer several sizes so a browser does not download the full one for no reason.",
  },
};

const TITLE_ALIASES: Record<string, string> = {
  "reduce javascript execution time": "bootup-time",
  "minimize main thread work": "mainthread-work-breakdown",
  "reduce the impact of third party code": "third-party-summary",
  "avoid an excessive dom size": "dom-size",
  "largest contentful paint element": "largest-contentful-paint-element",
  "reduce unused css": "unused-css-rules",
  "properly size images": "uses-responsive-images",
  "eliminate render blocking resources": "render-blocking-resources",
  "minify javascript": "unminified-javascript",
  "avoid serving legacy javascript": "legacy-javascript",
  "reduce unused javascript": "unused-javascript",
  "image elements do not have explicit width and height": "unsized-images",
  "serve images in next gen formats": "modern-image-formats",
};

const UNKNOWN: CatalogEntry = {
  metric: "other",
  culprit: "other",
  culpritLabel: "Something else the nightly test found",
  remediation: "unknown",
  guidance: "Read the evidence and settle on one concrete change before anybody takes this on.",
};

function normalizedTitle(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function catalogEntryFor(auditId: string, title?: string): CatalogEntry {
  const normalizedId = auditId.trim().toLowerCase();
  const aliasedId = title ? TITLE_ALIASES[normalizedTitle(title)] : undefined;
  return CATALOG[normalizedId] ?? (aliasedId ? CATALOG[aliasedId] : undefined) ?? UNKNOWN;
}

/**
 * Single source of truth for the default customer disposition of a
 * catalog entry, before any page-level platform-ownership override
 * (see `classificationForPage`). `mainthread-work-breakdown` has no
 * customer-controllable guidance even absent platform confirmation, so
 * it defaults to "review" like a genuinely unmapped audit; every other
 * catalog entry defaults from its remediation level alone.
 */
function defaultActionability(remediation: WebflowRemediationLevel, normalizedId: string): CustomerActionability {
  if (remediation === "available") return "direct";
  if (remediation === "partial") return "workaround";
  if (remediation === "unknown" || normalizedId === "mainthread-work-breakdown") return "review";
  return "workaround";
}

/** True when an audit ID (or its exact legacy title alias) is in the documented remediation table. */
export function isDocumentedWebflowAudit(auditId: string, title?: string): boolean {
  return catalogEntryFor(auditId, title) !== UNKNOWN;
}

export function classifyWebflowPerformance(auditId: string, title?: string): WebflowPerformanceClassification {
  const normalizedId = auditId.trim().toLowerCase();
  const entry = catalogEntryFor(auditId, title);
  return {
    version: 1,
    ...entry,
    metricWeight: METRIC_WEIGHTS[entry.metric],
    remediationLabel: REMEDIATION_LABELS[entry.remediation],
    actionability: defaultActionability(entry.remediation, normalizedId),
    source: "published-page-performance",
  };
}

export function webflowClassificationFor(item: {
  id: string;
  title?: string;
  webflow?: WebflowPerformanceClassification;
}): WebflowPerformanceClassification {
  if (item.webflow?.version === 1 && item.webflow.source === "crux-field-only") return item.webflow;
  const current = classifyWebflowPerformance(item.id, item.title);
  return item.webflow?.actionability ? { ...current, actionability: item.webflow.actionability } : current;
}

/**
 * The tones remediation and actionability can take. A subset of the five
 * vocabulary tones: "what can the customer do about this?" is a system state,
 * not a health verdict, so it never reaches for `--health-*`, and no
 * remediation level is informational.
 */
export type RemediationTone = Extract<Tone, "danger" | "warning" | "success" | "neutral">;

/**
 * The tone for a remediation level — a NAME, never a colour value.
 *
 * Callers resolve it themselves, exactly as `status-chip.tsx` does:
 * `color: var(--status-${tone}-text)`, `background: var(--status-${tone}-bg)`,
 * `border-color: var(--status-${tone}-border)`. Those tokens are defined for
 * all five tones in both theme blocks of `globals.css`.
 *
 * Do not map these onto `--health-*`. A page with an available remediation is
 * by definition still broken, so green here would answer the wrong question.
 * The lighter orange and green this helper used to return were near-duplicates
 * of the health palette and are deliberately not carried over as tokens, so the
 * remediation chips change appearance slightly.
 */
export function remediationTone(level: WebflowRemediationLevel): RemediationTone {
  if (level === "blocked") return "danger";
  if (level === "partial") return "warning";
  if (level === "available") return "success";
  return "neutral";
}

/** The tone for a customer actionability, delegating to its remediation equivalent. */
export function actionabilityTone(actionability: CustomerActionability): RemediationTone {
  if (actionability === "none") return remediationTone("blocked");
  if (actionability === "workaround") return remediationTone("partial");
  if (actionability === "direct") return remediationTone("available");
  return remediationTone("unknown");
}

export function customerActionabilityFor(item: {
  id: string;
  title?: string;
  webflow?: WebflowPerformanceClassification;
}): NonNullable<WebflowPerformanceClassification["actionability"]> {
  const classification = webflowClassificationFor(item);
  // Falls back here only for classifications persisted before `actionability`
  // existed (e.g. legacy crux-field-only evidence returned as-is above).
  return classification.actionability
    ?? defaultActionability(classification.remediation, item.id.trim().toLowerCase());
}

/**
 * A finding's measured impact, split so a renderer can weight the magnitude
 * and the unit separately (`--magnitude-value` at weight 650, `--magnitude-unit`)
 * without parsing a display string back apart.
 */
export interface DiagnosticImpact {
  /** The magnitude when `measured`, otherwise the plain fallback label. */
  value: string;
  /** The unit paired with `value`; empty when `value` is a label, not a number. */
  unit: string;
  /** False when nothing was measured — render `value` as plain text, not a magnitude. */
  measured: boolean;
}

/** Structured impact for renderers. Prefer this over parsing `formatDiagnosticImpact`. */
export function diagnosticImpact(item: { savingsMs: number; savingsBytes?: number }): DiagnosticImpact {
  if (item.savingsMs > 0) return { value: (item.savingsMs / 1000).toFixed(1), unit: "s", measured: true };
  if ((item.savingsBytes ?? 0) > 0) return { value: String(Math.round((item.savingsBytes ?? 0) / 1024)), unit: "KB", measured: true };
  return { value: "Detected", unit: "", measured: false };
}

/**
 * Display form of {@link diagnosticImpact}, for the stored `savings` string on
 * a recommendation or audit. UI that styles the number should call
 * `diagnosticImpact` instead.
 */
export function formatDiagnosticImpact(item: { savingsMs: number; savingsBytes?: number }): string {
  const impact = diagnosticImpact(item);
  return impact.unit ? `${impact.value} ${impact.unit}` : impact.value;
}

export function effortLabel(item: { estTime: string; id: string; title?: string; webflow?: WebflowPerformanceClassification }): string {
  const actionability = customerActionabilityFor(item);
  if (actionability === "none") return "No direct action";
  if (actionability === "review") return "Needs review";
  return item.estTime;
}

export function triageActionLabel(item: { id: string; title?: string; webflow?: WebflowPerformanceClassification }): string {
  return customerActionabilityFor(item) === "workaround" ? "Add workaround to tasks" : "Add to tasks";
}

export function classificationForPage(
  item: { id: string; title?: string },
  webflowGenerated: boolean,
): WebflowPerformanceClassification {
  const classification = classifyWebflowPerformance(item.id, item.title);
  if (webflowGenerated && WEBFLOW_NO_DIRECT_ACTION.has(item.id)) {
    return { ...classification, actionability: "none", remediationLabel: "No direct action" };
  }
  return classification;
}

/**
 * True unless the finding is a confirmed platform-owned gap with no
 * customer-side action at all (`"none"`). Findings still awaiting
 * classification (`"review"` — including any audit ID this catalog
 * doesn't recognize yet) stay visible so they don't silently disappear;
 * they surface with a "Needs review" effort label instead of an estimate.
 */
export function recommendationIsCustomerActionable(item: {
  id: string;
  title?: string;
  webflow?: WebflowPerformanceClassification;
}): boolean {
  return customerActionabilityFor(item) !== "none";
}

export function isKnownWebflowIssue(item: {
  id: string;
  title?: string;
  webflow?: WebflowPerformanceClassification;
}): boolean {
  const classification = webflowClassificationFor(item);
  return classification.remediation === "blocked" || item.id.startsWith("webflow-");
}

export const DOCUMENTED_WEBFLOW_AUDIT_IDS = Object.freeze(Object.keys(CATALOG));

export function culpritKey(item: { id: string; title?: string; webflow?: WebflowPerformanceClassification }): WebflowPerformanceCulprit {
  return webflowClassificationFor(item).culprit;
}

export function culpritGroupLabel(item: { id: string; title?: string; webflow?: WebflowPerformanceClassification }): string {
  return CULPRIT_GROUP_LABELS[culpritKey(item)];
}
