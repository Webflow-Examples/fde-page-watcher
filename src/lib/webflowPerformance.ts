import type {
  CustomerActionability,
  WebflowPerformanceClassification,
  WebflowPerformanceCulprit,
  WebflowPerformanceMetric,
  WebflowRemediationLevel,
} from "./types";
import type { Tone } from "./vocabulary";

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

const CULPRIT_GROUP_LABELS: Record<WebflowPerformanceCulprit, string> = {
  "global-javascript": "Global JavaScript",
  "main-thread-work": "Main-thread work",
  "third-party-code": "Third-party code",
  "dom-complexity": "DOM complexity",
  "lcp-element": "LCP element",
  "global-css": "Global CSS",
  "image-delivery": "Image delivery",
  "render-blocking": "Render-blocking resources",
  "custom-javascript": "Custom JavaScript",
  "layout-stability": "Layout stability",
  "background-video": "Background Video",
  "video-embeds": "Video embeds",
  "interactive-media": "Lottie and Spline",
  other: "Other Lighthouse findings",
};

const CATALOG: Record<string, CatalogEntry> = {
  "bootup-time": {
    metric: "TBT",
    culprit: "global-javascript",
    culpritLabel: "JavaScript execution",
    remediation: "blocked",
    guidance: "Reduce or defer JavaScript that runs during startup, prioritizing code you control and scripts that are not required on this page.",
  },
  "mainthread-work-breakdown": {
    metric: "TBT",
    culprit: "main-thread-work",
    culpritLabel: "Main-thread work",
    remediation: "blocked",
    guidance: "Inspect the longest main-thread tasks and address the scripts, styles, or page structures responsible for them.",
  },
  "third-party-summary": {
    metric: "TBT",
    culprit: "third-party-code",
    culpritLabel: "Third-party code",
    remediation: "partial",
    guidance: "Remove, defer, or conditionally load nonessential third-party tags and embeds.",
  },
  "third-party-facades": {
    metric: "TBT",
    culprit: "third-party-code",
    culpritLabel: "Third-party embeds",
    remediation: "partial",
    guidance: "Replace eager embeds with poster-image facades or load-on-interaction behavior where possible.",
  },
  "dom-size": {
    metric: "TBT",
    culprit: "dom-complexity",
    culpritLabel: "DOM complexity",
    remediation: "partial",
    guidance: "Reduce unnecessary nesting and page length, or defer below-the-fold sections where the site implementation allows it.",
  },
  "largest-contentful-paint-element": {
    metric: "LCP",
    culprit: "lcp-element",
    culpritLabel: "LCP element",
    remediation: "partial",
    guidance: "Identify the largest above-the-fold element and simplify, resize, preload, or replace the asset where appropriate.",
  },
  "lcp-discovery-insight": {
    metric: "LCP",
    culprit: "lcp-element",
    culpritLabel: "LCP discovery",
    remediation: "partial",
    guidance: "Keep the primary hero resource discoverable early and avoid lazy-loading the above-the-fold LCP asset.",
  },
  "prioritize-lcp-image": {
    metric: "LCP",
    culprit: "lcp-element",
    culpritLabel: "LCP image priority",
    remediation: "partial",
    guidance: "Prioritize the hero image and avoid loading it indirectly through scripts or late-applied styles.",
  },
  "lcp-lazy-loaded": {
    metric: "LCP",
    culprit: "lcp-element",
    culpritLabel: "LCP lazy loading",
    remediation: "partial",
    guidance: "Do not lazy-load the above-the-fold image that Lighthouse identifies as the LCP element.",
  },
  "unused-css-rules": {
    metric: "LCP",
    culprit: "global-css",
    culpritLabel: "Unused global CSS",
    remediation: "blocked",
    guidance: "Remove unused classes and stylesheet rules you control, and avoid loading page-specific styles on pages that do not need them.",
  },
  "uses-responsive-images": {
    metric: "LCP",
    culprit: "image-delivery",
    culpritLabel: "Image sizing",
    remediation: "available",
    guidance: "Resize the source asset and provide responsive image candidates appropriate for the rendered size.",
  },
  "uses-optimized-images": {
    metric: "LCP",
    culprit: "image-delivery",
    culpritLabel: "Image optimization",
    remediation: "available",
    guidance: "Compress oversized source assets and use an efficient image format for the required quality.",
  },
  "modern-image-formats": {
    metric: "LCP",
    culprit: "image-delivery",
    culpritLabel: "Image format",
    remediation: "available",
    guidance: "Convert suitable assets to WebP and keep source dimensions close to their rendered size.",
  },
  "image-delivery-insight": {
    metric: "LCP",
    culprit: "image-delivery",
    culpritLabel: "Image delivery",
    remediation: "available",
    guidance: "Resize and compress the flagged assets, then use the most efficient format supported by the site.",
  },
  "render-blocking-resources": {
    metric: "LCP",
    culprit: "render-blocking",
    culpritLabel: "Render-blocking resources",
    remediation: "blocked",
    guidance: "Inline critical styles where appropriate and defer or split noncritical stylesheets that you control.",
  },
  "render-blocking-insight": {
    metric: "LCP",
    culprit: "render-blocking",
    culpritLabel: "Render-blocking resources",
    remediation: "blocked",
    guidance: "Inline critical styles where appropriate and defer or split noncritical stylesheets that you control.",
  },
  "unminified-javascript": {
    metric: "LCP",
    culprit: "custom-javascript",
    culpritLabel: "Unminified custom JavaScript",
    remediation: "partial",
    guidance: "Minify custom JavaScript before publishing it and remove development-only code from production bundles.",
  },
  "legacy-javascript": {
    metric: "LCP",
    culprit: "global-javascript",
    culpritLabel: "Legacy JavaScript",
    remediation: "blocked",
    guidance: "Serve modern JavaScript to current browsers and remove unnecessary legacy transforms or polyfills from code you control.",
  },
  "unused-javascript": {
    metric: "LCP",
    culprit: "global-javascript",
    culpritLabel: "Unused global JavaScript",
    remediation: "blocked",
    guidance: "Remove optional scripts, split bundles by page, or conditionally load code only where it is needed.",
  },
  "unsized-images": {
    metric: "CLS",
    culprit: "layout-stability",
    culpritLabel: "Missing image dimensions",
    remediation: "available",
    guidance: "Set explicit image dimensions or use a consistent image reset so space is reserved before assets load.",
  },
  "webflow-background-video": {
    metric: "LCP",
    culprit: "background-video",
    culpritLabel: "Background Video",
    remediation: "partial",
    guidance: "Use a poster or static hero where possible, or load background video only when it approaches the viewport.",
  },
  "webflow-video-embed-eager": {
    metric: "TBT",
    culprit: "video-embeds",
    culpritLabel: "Eager video embeds",
    remediation: "partial",
    guidance: "Replace eager YouTube or Vimeo players with poster-image facades that load the player on click or near the viewport.",
  },
  "webflow-video-embed-duplicate": {
    metric: "TBT",
    culprit: "video-embeds",
    culpritLabel: "Repeated video player runtime",
    remediation: "partial",
    guidance: "Use one shared player bootstrap and replace repeated eager embeds with poster-image facades that load on interaction.",
  },
  "webflow-lottie-eager": {
    metric: "TBT",
    culprit: "interactive-media",
    culpritLabel: "Eager Lottie",
    remediation: "partial",
    guidance: "Reduce animation payloads and use custom viewport-based loading when the Lottie element is below the fold.",
  },
  "webflow-spline-eager": {
    metric: "TBT",
    culprit: "interactive-media",
    culpritLabel: "Eager Spline",
    remediation: "partial",
    guidance: "Use a static fallback where possible or load the Spline scene only when it approaches the viewport.",
  },
  "webflow-image-unresponsive": {
    metric: "LCP",
    culprit: "image-delivery",
    culpritLabel: "Unresponsive raster image",
    remediation: "available",
    guidance: "Resize the source asset and provide responsive image candidates so browsers do not fetch the full original unnecessarily.",
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
  culpritLabel: "Other Lighthouse finding",
  remediation: "unknown",
  guidance: "Review the Lighthouse evidence and identify a concrete change before assigning this finding as a task.",
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
