import type {
  WebflowPerformanceClassification,
  WebflowPerformanceCulprit,
  WebflowPerformanceMetric,
  WebflowRemediationLevel,
} from "./types";

type CatalogEntry = Pick<
  WebflowPerformanceClassification,
  "metric" | "culprit" | "culpritLabel" | "remediation" | "guidance"
>;

const REMEDIATION_LABELS: Record<WebflowRemediationLevel, string> = {
  blocked: "Product gap",
  partial: "Partial remediation",
  available: "Fixable in Webflow",
  unknown: "Needs review",
};

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
    guidance: "Webflow's global JavaScript bundle cannot currently be scoped or code-split per page.",
  },
  "mainthread-work-breakdown": {
    metric: "TBT",
    culprit: "main-thread-work",
    culpritLabel: "Main-thread work",
    remediation: "blocked",
    guidance: "Global JavaScript and CSS frequently drive this work, with no complete in-product remediation today.",
  },
  "third-party-summary": {
    metric: "TBT",
    culprit: "third-party-code",
    culpritLabel: "Third-party code",
    remediation: "partial",
    guidance: "Remove, defer, or conditionally load nonessential tags and embeds; Webflow's own bundle may also appear here.",
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
    guidance: "Reduce nesting or page length; lazy-loading page sections currently requires custom code.",
  },
  "largest-contentful-paint-element": {
    metric: "LCP",
    culprit: "lcp-element",
    culpritLabel: "LCP element",
    remediation: "partial",
    guidance: "Identify and simplify the hero asset; advanced progressive or poster-based loading may require custom code.",
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
    guidance: "Class cleanup can help, but Webflow still ships one site-wide CSS file without page-level scoping.",
  },
  "uses-responsive-images": {
    metric: "LCP",
    culprit: "image-delivery",
    culpritLabel: "Image sizing",
    remediation: "available",
    guidance: "Resize the source asset and use Webflow's responsive image controls for the rendered size.",
  },
  "uses-optimized-images": {
    metric: "LCP",
    culprit: "image-delivery",
    culpritLabel: "Image optimization",
    remediation: "available",
    guidance: "Compress oversized source assets and use Webflow's available image conversion controls.",
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
    guidance: "Resize and compress the flagged assets, then use the most efficient format available in Webflow.",
  },
  "render-blocking-resources": {
    metric: "LCP",
    culprit: "render-blocking",
    culpritLabel: "Render-blocking resources",
    remediation: "blocked",
    guidance: "Webflow's global CSS is a common contributor and cannot currently be scoped per page.",
  },
  "render-blocking-insight": {
    metric: "LCP",
    culprit: "render-blocking",
    culpritLabel: "Render-blocking resources",
    remediation: "blocked",
    guidance: "Webflow's global CSS is a common contributor and cannot currently be scoped per page.",
  },
  "unminified-javascript": {
    metric: "LCP",
    culprit: "custom-javascript",
    culpritLabel: "Unminified custom JavaScript",
    remediation: "partial",
    guidance: "Minify customer-authored custom code before adding it to the site; Webflow's own bundle is already minified.",
  },
  "legacy-javascript": {
    metric: "LCP",
    culprit: "global-javascript",
    culpritLabel: "Legacy JavaScript",
    remediation: "blocked",
    guidance: "Legacy code and polyfills in the generated bundle cannot currently be removed by page authors.",
  },
  "unused-javascript": {
    metric: "LCP",
    culprit: "global-javascript",
    culpritLabel: "Unused global JavaScript",
    remediation: "blocked",
    guidance: "Remove optional custom scripts where possible; Webflow's site-wide bundle cannot be code-split per page.",
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
    guidance: "Use a poster or static hero where possible; lazy-loading Webflow Background Video currently requires custom code.",
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
    guidance: "Use a static fallback where possible or custom-load the Spline scene only when it approaches the viewport.",
  },
  "webflow-image-unresponsive": {
    metric: "LCP",
    culprit: "image-delivery",
    culpritLabel: "Unresponsive raster image",
    remediation: "available",
    guidance: "Resize the source asset and enable Webflow responsive image candidates so browsers do not fetch the full original unnecessarily.",
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
  guidance: "Review the Lighthouse evidence before assigning this finding to a customer or product owner.",
};

function normalizedTitle(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

export function classifyWebflowPerformance(auditId: string, title?: string): WebflowPerformanceClassification {
  const normalizedId = auditId.trim().toLowerCase();
  const aliasedId = title ? TITLE_ALIASES[normalizedTitle(title)] : undefined;
  const entry = CATALOG[normalizedId] ?? (aliasedId ? CATALOG[aliasedId] : undefined) ?? UNKNOWN;
  return {
    version: 1,
    ...entry,
    metricWeight: METRIC_WEIGHTS[entry.metric],
    remediationLabel: REMEDIATION_LABELS[entry.remediation],
    source: "published-page-performance",
  };
}

export function webflowClassificationFor(item: {
  id: string;
  title?: string;
  webflow?: WebflowPerformanceClassification;
}): WebflowPerformanceClassification {
  return item.webflow?.version === 1 ? item.webflow : classifyWebflowPerformance(item.id, item.title);
}

export function remediationTone(level: WebflowRemediationLevel): { color: string; background: string } {
  if (level === "blocked") return { color: "#FF9A9F", background: "rgba(255,92,108,0.13)" };
  if (level === "partial") return { color: "#FFB766", background: "rgba(255,154,61,0.13)" };
  if (level === "available") return { color: "#61D996", background: "rgba(53,208,127,0.13)" };
  return { color: "#9A9AA0", background: "rgba(255,255,255,0.06)" };
}

export function formatDiagnosticImpact(item: { savingsMs: number; savingsBytes?: number }): string {
  if (item.savingsMs > 0) return `${(item.savingsMs / 1000).toFixed(1)} s`;
  if ((item.savingsBytes ?? 0) > 0) return `${Math.round((item.savingsBytes ?? 0) / 1024)} KB`;
  return "Detected";
}

export function effortLabel(item: { estTime: string; id: string; title?: string; webflow?: WebflowPerformanceClassification }): string {
  return webflowClassificationFor(item).remediation === "blocked" ? "Product gap" : item.estTime;
}

export function triageActionLabel(item: { id: string; title?: string; webflow?: WebflowPerformanceClassification }): string {
  const remediation = webflowClassificationFor(item).remediation;
  if (remediation === "blocked") return "Create escalation";
  if (remediation === "partial") return "Escalate workaround";
  if (remediation === "available") return "Save fix as task";
  return "Save as task";
}

export const DOCUMENTED_WEBFLOW_AUDIT_IDS = Object.freeze(Object.keys(CATALOG));

export function culpritKey(item: { id: string; title?: string; webflow?: WebflowPerformanceClassification }): WebflowPerformanceCulprit {
  return webflowClassificationFor(item).culprit;
}

export function culpritGroupLabel(item: { id: string; title?: string; webflow?: WebflowPerformanceClassification }): string {
  return CULPRIT_GROUP_LABELS[culpritKey(item)];
}
