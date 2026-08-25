import type {
  NativeElementFinding,
  NativeElementControl,
  NativeElementScan,
  NativeWebflowElementType,
  Night,
  Strategy,
  WatchPage,
  WebflowPerformanceClassification,
  WebflowRemediationLevel,
} from "./types";
import type { PerformanceIssueCapture, PerformanceIssueStatus } from "./performanceIssues";
import { EXCLUSION_REASONS, type Applicability, type ExclusionReason } from "./vocabulary";
import { classifyWebflowPerformance, culpritGroupLabel } from "./webflowPerformance";

interface DetectionDefinition {
  id: string;
  element: NativeWebflowElementType;
  title: string;
  detail: (count: number) => string;
  confidence: NativeElementFinding["confidence"];
  signals: string[];
}

function tags(html: string, name: string): string[] {
  return html.match(new RegExp(`<${name}\\b[^>]*>`, "gi")) ?? [];
}

function attribute(tag: string, name: string): string | null {
  const match = new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i").exec(tag);
  return match?.[1] ?? match?.[2] ?? match?.[3] ?? null;
}

function hasClass(tag: string, name: string): boolean {
  return (attribute(tag, "class") ?? "").split(/\s+/).includes(name);
}

function finding(
  definition: DetectionDefinition,
  count: number,
  signals = definition.signals,
  evidence: NativeElementFinding["evidence"] = [{ label: "detected instances", count }],
): NativeElementFinding {
  return {
    id: definition.id,
    element: definition.element,
    title: definition.title,
    detail: definition.detail(count),
    count,
    signals,
    evidence,
    confidence: definition.confidence,
    webflow: classifyWebflowPerformance(definition.id),
  };
}

const BACKGROUND_VIDEO: DetectionDefinition = {
  id: "webflow-background-video",
  element: "background-video",
  title: "Background video loads eagerly",
  detail: (count) => `${count} background video ${count === 1 ? "element" : "elements"} detected without poster-first or lazy-load behavior.`,
  confidence: "high",
  signals: ["w-background-video"],
};

const VIDEO_EMBED: DetectionDefinition = {
  id: "webflow-video-embed-eager",
  element: "video-embed",
  title: "YouTube or Vimeo players load eagerly",
  detail: (count) => `${count} eager video ${count === 1 ? "embed" : "embeds"} detected. Player scripts can delay main-thread responsiveness.`,
  confidence: "high",
  signals: ["YouTube/Vimeo iframe", "missing loading=lazy"],
};

const VIDEO_EMBED_DUPLICATE: DetectionDefinition = {
  id: "webflow-video-embed-duplicate",
  element: "video-embed",
  title: "YouTube or Vimeo player runtime is repeated",
  detail: (count) => `${count} redundant same-provider player ${count === 1 ? "bootstrap was" : "bootstraps were"} detected. Repeated embeds or SDK tags can duplicate script and main-thread cost.`,
  confidence: "high",
  signals: ["repeated same-provider video embeds or scripts"],
};

const LOTTIE: DetectionDefinition = {
  id: "webflow-lottie-eager",
  element: "lottie",
  title: "Lottie animation loads eagerly",
  detail: (count) => `${count} Lottie ${count === 1 ? "element" : "elements"} detected without lazy-load behavior.`,
  confidence: "high",
  signals: ["data-animation-type=lottie"],
};

const SPLINE: DetectionDefinition = {
  id: "webflow-spline-eager",
  element: "spline",
  title: "Spline scene loads eagerly",
  detail: (count) => `${count} Spline ${count === 1 ? "scene" : "scenes"} detected without lazy-load behavior.`,
  confidence: "high",
  signals: ["data-animation-type=spline"],
};

const UNRESPONSIVE_IMAGE: DetectionDefinition = {
  id: "webflow-image-unresponsive",
  element: "image",
  title: "Hosted raster images lack responsive candidates",
  detail: (count) => `${count} hosted raster ${count === 1 ? "image has" : "images have"} no srcset candidates and may download oversized originals.`,
  confidence: "medium",
  signals: ["hosted asset", "raster image", "missing srcset"],
};

const NATIVE_ELEMENT_IDS = new Set([
  BACKGROUND_VIDEO.id,
  VIDEO_EMBED.id,
  VIDEO_EMBED_DUPLICATE.id,
  LOTTIE.id,
  SPLINE.id,
  UNRESPONSIVE_IMAGE.id,
]);

export function isKnownNativeElementId(id: string): boolean {
  return NATIVE_ELEMENT_IDS.has(id);
}

/**
 * The retired shape, read only so it can be migrated out of.
 *
 * One field held two concepts. `suppressed` skipped hotspots and stopped the
 * finding counting; `acknowledged` left it counting and recorded that a person
 * had seen it. Those are applicability and lifecycle, which is why no single
 * word ever covered both.
 */
interface RetiredNativeElementControl {
  disposition?: "acknowledged" | "suppressed";
  updatedAt?: string;
}

/**
 * The reason a retired `suppressed` record carries forward.
 *
 * Not a reason invented on the reader's behalf: it is the definition of the
 * state the old button put the finding into. `APPLICABILITY_MEANS.excluded` is
 * "Deliberately not counted, because it does not apply to this site", and the
 * retired control offered exactly that one meaning, unlabelled, with nowhere to
 * record anything narrower. Migrating it to the reason that restates the state
 * keeps the exclusion the reader asked for; dropping the record instead would
 * quietly put the finding back in the count.
 */
const RETIRED_SUPPRESSED_REASON: ExclusionReason = "Not applicable to this site";

/**
 * The gate between a stored string and the registry's reason list.
 *
 * `types.ts` cannot import the registry, so the stored field is a string and
 * this is where it becomes one of the three decided reasons or nothing at all.
 */
function isExclusionReason(value: string | undefined): value is ExclusionReason {
  return value !== undefined && (EXCLUSION_REASONS as readonly string[]).includes(value);
}

function controlFrom(raw: NativeElementControl | undefined): NativeElementControl | null {
  if (!raw || typeof raw !== "object") return null;
  const retired = raw as RetiredNativeElementControl;
  const updatedAt = typeof raw.updatedAt === "string" ? raw.updatedAt : undefined;
  if (!updatedAt) return null;

  if (retired.disposition === "suppressed") {
    return { excluded: { reason: RETIRED_SUPPRESSED_REASON }, updatedAt };
  }
  if (retired.disposition === "acknowledged") return { dismissed: true, updatedAt };

  // An exclusion whose reason is not one the registry blesses is not an
  // exclusion — applicability requires a reason, and a reason nobody decided is
  // the absence of one.
  const reason = raw.excluded?.reason;
  const excluded = isExclusionReason(reason) ? { excluded: { reason } } : null;
  const dismissed = raw.dismissed === true ? { dismissed: true } : null;
  if (!excluded && !dismissed) return null;
  return { ...excluded, ...dismissed, updatedAt };
}

export function normalizeNativeElementControls(
  controls: Record<string, NativeElementControl> | undefined,
): Record<string, NativeElementControl> {
  return Object.fromEntries(Object.entries(controls ?? {}).flatMap(([id, control]) => {
    if (!isKnownNativeElementId(id)) return [];
    const normalized = controlFrom(control);
    return normalized ? [[id, normalized] as const] : [];
  }));
}

/**
 * Whether this finding counts toward the site's results.
 *
 * Included is the default and it is not stored: absence of a record is the
 * default, exactly as an issue case with no `excludedPages` counts all of them.
 */
export function nativeElementApplicability(
  controls: Record<string, NativeElementControl> | undefined,
  id: string,
): Applicability {
  return normalizeNativeElementControls(controls)[id]?.excluded ? "excluded" : "included";
}

/** The reason it is not counted. Present whenever it is excluded. */
export function nativeElementExclusionReason(
  controls: Record<string, NativeElementControl> | undefined,
  id: string,
): ExclusionReason | undefined {
  const reason = normalizeNativeElementControls(controls)[id]?.excluded?.reason;
  return isExclusionReason(reason) ? reason : undefined;
}

/** Whether the reader has seen this finding and chosen not to act on it. */
export function nativeElementIsDismissed(
  controls: Record<string, NativeElementControl> | undefined,
  id: string,
): boolean {
  return normalizeNativeElementControls(controls)[id]?.dismissed === true;
}

/** Inspect published HTML without retaining customer URLs, text, or attributes. */
export function detectNativeWebflowElements(html: string): NativeElementFinding[] {
  if (!html.trim()) return [];
  const divs = tags(html, "div");
  const backgroundVideos = divs.filter((tag) => hasClass(tag, "w-background-video"));
  const findings: NativeElementFinding[] = [];
  if (backgroundVideos.length > 0) {
    const hasMp4 = /(?:data-video-urls|<source\b)[^>]*\.mp4/i.test(html);
    const hasWebm = /(?:data-video-urls|<source\b)[^>]*\.webm/i.test(html);
    const signals = [...BACKGROUND_VIDEO.signals, ...(hasMp4 && hasWebm ? ["MP4 and WebM sources"] : [])];
    findings.push(finding(BACKGROUND_VIDEO, backgroundVideos.length, signals, [
      { label: "Background Video elements", count: backgroundVideos.length },
      { label: "eager-loading instances", count: backgroundVideos.length },
      ...(hasMp4 && hasWebm ? [{ label: "pages with MP4 + WebM sources", count: 1 }] : []),
    ]));
  }

  const eagerVideoEmbeds = tags(html, "iframe").filter((tag) => {
    const source = attribute(tag, "src") ?? "";
    const videoProvider = /(?:youtube(?:-nocookie)?\.com\/embed|player\.vimeo\.com\/video)/i.test(source);
    return videoProvider && attribute(tag, "loading")?.toLowerCase() !== "lazy";
  });
  if (eagerVideoEmbeds.length > 0) findings.push(finding(VIDEO_EMBED, eagerVideoEmbeds.length, undefined, [
    { label: "video embeds", count: eagerVideoEmbeds.length },
    { label: "without loading=lazy", count: eagerVideoEmbeds.length },
  ]));

  const providerForEmbed = (tag: string): "YouTube" | "Vimeo" | null => {
    const source = attribute(tag, "src") ?? "";
    if (/youtube(?:-nocookie)?\.com\/embed/i.test(source)) return "YouTube";
    if (/player\.vimeo\.com\/video/i.test(source)) return "Vimeo";
    return null;
  };
  const providerForScript = (tag: string): "YouTube" | "Vimeo" | null => {
    const source = attribute(tag, "src") ?? "";
    if (/youtube(?:-nocookie)?\.com\/.*(?:iframe_api|player)/i.test(source)) return "YouTube";
    if (/player\.vimeo\.com\/api\/player(?:\.min)?\.js/i.test(source)) return "Vimeo";
    return null;
  };
  const embedsByProvider = new Map<string, number>();
  for (const tag of tags(html, "iframe")) {
    const provider = providerForEmbed(tag);
    if (provider) embedsByProvider.set(provider, (embedsByProvider.get(provider) ?? 0) + 1);
  }
  const scriptsByProvider = new Map<string, number>();
  for (const tag of tags(html, "script")) {
    const provider = providerForScript(tag);
    if (provider) scriptsByProvider.set(provider, (scriptsByProvider.get(provider) ?? 0) + 1);
  }
  const redundantEmbeds = [...embedsByProvider.values()].reduce((sum, count) => sum + Math.max(0, count - 1), 0);
  const redundantScripts = [...scriptsByProvider.values()].reduce((sum, count) => sum + Math.max(0, count - 1), 0);
  const duplicatedProviders = new Set([
    ...[...embedsByProvider.entries()].filter(([, count]) => count > 1).map(([provider]) => provider),
    ...[...scriptsByProvider.entries()].filter(([, count]) => count > 1).map(([provider]) => provider),
  ]).size;
  const redundantBootstraps = redundantEmbeds + redundantScripts;
  if (redundantBootstraps > 0) findings.push(finding(VIDEO_EMBED_DUPLICATE, redundantBootstraps, undefined, [
    { label: "redundant same-provider embeds", count: redundantEmbeds },
    { label: "duplicate provider SDK tags", count: redundantScripts },
    { label: "providers repeated", count: duplicatedProviders },
  ].filter((item) => item.count > 0)));

  const lottieCount = divs.filter((tag) => attribute(tag, "data-animation-type")?.toLowerCase() === "lottie").length;
  if (lottieCount > 0) findings.push(finding(LOTTIE, lottieCount, undefined, [
    { label: "Lottie elements", count: lottieCount },
    { label: "without native lazy loading", count: lottieCount },
  ]));

  const splineDivs = divs.filter((tag) =>
    attribute(tag, "data-animation-type")?.toLowerCase() === "spline"
    || attribute(tag, "data-spline-url") !== null
    || hasClass(tag, "spline-scene"));
  const splineViewers = tags(html, "spline-viewer");
  const splineCount = splineDivs.length + splineViewers.length;
  if (splineCount > 0) findings.push(finding(SPLINE, splineCount, undefined, [
    { label: "Spline scenes", count: splineCount },
    { label: "without native lazy loading", count: splineCount },
  ]));

  const unresponsiveImages = tags(html, "img").filter((tag) => {
    const source = attribute(tag, "src") ?? "";
    const webflowHosted = /(?:cdn\.prod\.website-files\.com|assets\.website-files\.com)/i.test(source);
    const raster = /\.(?:avif|gif|jpe?g|png|webp)(?:[?#]|$)/i.test(source);
    const responsive = !!(attribute(tag, "srcset") ?? attribute(tag, "data-srcset") ?? "").trim();
    const trackingPixel = attribute(tag, "width") === "1" && attribute(tag, "height") === "1";
    return webflowHosted && raster && !responsive && !trackingPixel;
  });
  if (unresponsiveImages.length > 0) findings.push(finding(UNRESPONSIVE_IMAGE, unresponsiveImages.length, undefined, [
    { label: "hosted raster images", count: unresponsiveImages.length },
    { label: "without responsive candidates", count: unresponsiveImages.length },
  ]));

  return findings;
}

export function unavailableNativeElementScan(reason: string): NativeElementScan {
  return { status: "unavailable", findings: [], reason };
}

/** Detect Webflow-generated documents without retaining site/page identifiers. */
export function webflowDocumentSignals(html: string): Array<"data-wf-site" | "data-wf-page"> {
  const root = /<html\b[^>]*>/i.exec(html)?.[0] ?? "";
  return (["data-wf-site", "data-wf-page"] as const).filter((attributeName) =>
    new RegExp(`\\b${attributeName}(?:\\s*=|\\s|>)`, "i").test(root));
}

export function hasWebflowOptimizeSignal(html: string): boolean {
  const root = /<html\b[^>]*>/i.exec(html)?.[0] ?? "";
  return /\bdata-wf-intellimize-customer-id(?:\s*=|\s|>)/i.test(root);
}

export function isWebflowGenerated(scan: NativeElementScan | undefined): boolean {
  return scan?.platform?.name === "webflow" && scan.platform.confidence === "high";
}

export function nativeElementScan(html: string): NativeElementScan {
  const signals = webflowDocumentSignals(html);
  const optimize = hasWebflowOptimizeSignal(html);
  return {
    status: "available",
    findings: detectNativeWebflowElements(html),
    platform: signals.length ? { name: "webflow", confidence: "high", signals } : undefined,
    variationRisk: optimize
      ? { source: "webflow-optimize", confidence: "high", signals: ["data-wf-intellimize-customer-id"] }
      : undefined,
  };
}

/** Preserve server-HTML findings while adding anything visible only after rendering. */
export function mergeNativeElementScans(...scans: Array<NativeElementScan | undefined>): NativeElementScan {
  const available = scans.filter((scan): scan is NativeElementScan => scan?.status === "available");
  if (available.length === 0) {
    return scans.find((scan): scan is NativeElementScan => !!scan)
      ?? unavailableNativeElementScan("published page could not be inspected");
  }
  const findings = new Map<string, NativeElementFinding>();
  for (const scan of available) {
    for (const next of scan.findings) {
      const current = findings.get(next.id);
      if (!current) {
        findings.set(next.id, next);
        continue;
      }
      const source = next.count > current.count ? next : current;
      const evidence = new Map<string, number>();
      for (const item of [...(current.evidence ?? []), ...(next.evidence ?? [])]) {
        evidence.set(item.label, Math.max(evidence.get(item.label) ?? 0, item.count));
      }
      findings.set(next.id, {
        ...source,
        signals: [...new Set([...current.signals, ...next.signals])],
        evidence: [...evidence].map(([label, count]) => ({ label, count })),
      });
    }
  }
  const platformSignals = [...new Set(available.flatMap((scan) => scan.platform?.signals ?? []))];
  const optimize = available.some((scan) => scan.variationRisk?.source === "webflow-optimize");
  return {
    status: "available",
    findings: [...findings.values()],
    platform: platformSignals.length
      ? { name: "webflow", confidence: "high", signals: platformSignals }
      : undefined,
    variationRisk: optimize
      ? { source: "webflow-optimize", confidence: "high", signals: ["data-wf-intellimize-customer-id"] }
      : undefined,
  };
}

export interface NativeElementLifecycle extends NativeElementFinding {
  key: string;
  status: PerformanceIssueStatus;
  firstDetected: PerformanceIssueCapture;
  lastDetected: PerformanceIssueCapture;
  resolvedAt?: PerformanceIssueCapture;
  returnedAt?: PerformanceIssueCapture;
  observedCaptures: number;
  eligibleCaptures: number;
  consecutiveDetections: number;
  trailingAbsences: number;
  resolutionCount: number;
}

function captureOf(night: Night): PerformanceIssueCapture {
  return { i: night.i, date: night.date, iso: night.iso };
}

function confirmedResolutionStarts(presence: boolean[], firstDetection: number): number[] {
  const starts: number[] = [];
  for (let index = firstDetection + 1; index < presence.length; index += 1) {
    if (presence[index] || presence[index - 1] === false) continue;
    if (presence[index + 1] === false) starts.push(index);
  }
  return starts;
}

export function nativeElementIssuesForPage(history: Night[]): NativeElementLifecycle[] {
  const captures = [...history]
    .sort((left, right) => left.i - right.i)
    .filter((night) => night.nativeElements?.status === "available");
  const ids = new Set(captures.flatMap((night) => night.nativeElements!.findings.map((item) => item.id)));
  return [...ids].map((id): NativeElementLifecycle => {
    const presence = captures.map((night) => night.nativeElements!.findings.some((item) => item.id === id));
    const firstIndex = presence.indexOf(true);
    const lastIndex = presence.lastIndexOf(true);
    const latestPresent = presence.at(-1) === true;
    let trailingAbsences = 0;
    for (let index = presence.length - 1; index >= 0 && !presence[index]; index -= 1) trailingAbsences += 1;
    let consecutiveDetections = 0;
    for (let index = presence.length - 1; index >= 0 && presence[index]; index -= 1) consecutiveDetections += 1;
    const resolutionStarts = confirmedResolutionStarts(presence, firstIndex);
    const confirmedBeforeLatest = resolutionStarts.some((start) => start < lastIndex);
    const status: PerformanceIssueStatus = latestPresent
      ? confirmedBeforeLatest ? "regressed" : "active"
      : trailingAbsences >= 2 ? "resolved" : "verifying";
    const resolutionIndex = !latestPresent && trailingAbsences >= 2 ? presence.length - trailingAbsences : undefined;
    const returnedIndex = status === "regressed" ? presence.length - consecutiveDetections : undefined;
    const source = captures[lastIndex].nativeElements!.findings.find((item) => item.id === id)!;
    return {
      ...source,
      key: `native:${id}`,
      status,
      firstDetected: captureOf(captures[firstIndex]),
      lastDetected: captureOf(captures[lastIndex]),
      resolvedAt: resolutionIndex === undefined ? undefined : captureOf(captures[resolutionIndex]),
      returnedAt: returnedIndex === undefined ? undefined : captureOf(captures[returnedIndex]),
      observedCaptures: presence.slice(firstIndex).filter(Boolean).length,
      eligibleCaptures: presence.length - firstIndex,
      consecutiveDetections,
      trailingAbsences,
      resolutionCount: resolutionStarts.length,
    };
  });
}

export interface SiteNativeElementRollup {
  id: string;
  title: string;
  webflow: WebflowPerformanceClassification;
  pageCount: number;
  instanceCount: number;
  regressedCount: number;
  /** Findings a reader has seen and chosen not to act on. Still counted. */
  dismissedCount: number;
  pages: { id: string; title: string; url: string }[];
}

export function siteNativeElementRollups(pages: WatchPage[]): SiteNativeElementRollup[] {
  const grouped = new Map<string, Array<NativeElementLifecycle & { page: WatchPage }>>();
  for (const page of pages) {
    for (const issue of nativeElementIssuesForPage(page.history)) {
      if (issue.status !== "active" && issue.status !== "regressed") continue;
      // Excluded, not dismissed: applicability decides whether a finding counts
      // toward the site's results, and a dismissed one still does.
      if (nativeElementApplicability(page.nativeElementControls, issue.id) === "excluded") continue;
      grouped.set(issue.id, [...(grouped.get(issue.id) ?? []), { ...issue, page }]);
    }
  }
  return [...grouped.entries()].map(([id, issues]) => ({
    id,
    title: culpritGroupLabel(issues[0]),
    webflow: issues[0].webflow,
    pageCount: new Set(issues.map((issue) => issue.page.id)).size,
    instanceCount: issues.reduce((sum, issue) => sum + issue.count, 0),
    regressedCount: issues.filter((issue) => issue.status === "regressed").length,
    dismissedCount: issues.filter((issue) => nativeElementIsDismissed(issue.page.nativeElementControls, issue.id)).length,
    pages: issues.map((issue) => ({ id: issue.page.id, title: issue.page.title, url: issue.page.url }))
      .sort((left, right) => left.title.localeCompare(right.title)),
  })).sort((left, right) => right.regressedCount - left.regressedCount || right.pageCount - left.pageCount || right.instanceCount - left.instanceCount);
}

export function nativeRecommendationOpportunities(
  scan: NativeElementScan | undefined,
  controls?: Record<string, NativeElementControl>,
) {
  if (scan?.status !== "available") return [];
  // Set aside either way, and for different reasons: an excluded footprint does
  // not count for this site, and a dismissed one already has a case the reader
  // decided on. Neither should arrive again as a fresh recommendation. The two
  // conditions are written out because there is no one word for both, and
  // inventing one is what the registry forbids.
  return scan.findings.filter((item) =>
    nativeElementApplicability(controls, item.id) === "included"
    && !nativeElementIsDismissed(controls, item.id)).map((item) => ({
    id: item.id,
    title: item.title,
    category: "Native elements",
    savingsMs: 0,
    savingsBytes: 0,
    strategies: ["mobile", "desktop"] as Strategy[],
    webflow: item.webflow,
  }));
}

export function nativeRemediationCounts(issues: NativeElementLifecycle[]): Record<WebflowRemediationLevel, number> {
  const counts: Record<WebflowRemediationLevel, number> = { blocked: 0, partial: 0, available: 0, unknown: 0 };
  for (const issue of issues) counts[issue.webflow.remediation] += 1;
  return counts;
}
