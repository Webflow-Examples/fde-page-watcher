import type {
  NativeElementFinding,
  NativeElementControl,
  NativeElementDisposition,
  NativeElementScan,
  NativeWebflowElementType,
  Night,
  Strategy,
  WatchPage,
  WebflowPerformanceClassification,
  WebflowRemediationLevel,
} from "./types";
import type { PerformanceIssueCapture, PerformanceIssueStatus } from "./performanceIssues";
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
  title: "Webflow Background Video loads eagerly",
  detail: (count) => `${count} Background Video ${count === 1 ? "element" : "elements"} detected. Webflow has no native poster-first or lazy-load control.`,
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
  title: "Webflow Lottie has no native lazy loading",
  detail: (count) => `${count} Lottie ${count === 1 ? "element" : "elements"} detected in the published HTML.`,
  confidence: "high",
  signals: ["data-animation-type=lottie"],
};

const SPLINE: DetectionDefinition = {
  id: "webflow-spline-eager",
  element: "spline",
  title: "Webflow Spline has no native lazy loading",
  detail: (count) => `${count} Spline ${count === 1 ? "scene" : "scenes"} detected in the published HTML.`,
  confidence: "high",
  signals: ["data-animation-type=spline"],
};

const UNRESPONSIVE_IMAGE: DetectionDefinition = {
  id: "webflow-image-unresponsive",
  element: "image",
  title: "Webflow-hosted raster images lack responsive candidates",
  detail: (count) => `${count} Webflow-hosted raster ${count === 1 ? "image has" : "images have"} no srcset candidates and may download oversized originals.`,
  confidence: "medium",
  signals: ["Webflow asset host", "raster image", "missing srcset"],
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

export function normalizeNativeElementControls(
  controls: Record<string, NativeElementControl> | undefined,
): Record<string, NativeElementControl> {
  return Object.fromEntries(Object.entries(controls ?? {}).filter(([id, control]) =>
    isKnownNativeElementId(id)
    && (control?.disposition === "acknowledged" || control?.disposition === "suppressed")
    && typeof control.updatedAt === "string"));
}

export function nativeElementDisposition(
  controls: Record<string, NativeElementControl> | undefined,
  id: string,
): NativeElementDisposition | undefined {
  return normalizeNativeElementControls(controls)[id]?.disposition;
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
    { label: "Webflow-hosted raster images", count: unresponsiveImages.length },
    { label: "without responsive candidates", count: unresponsiveImages.length },
  ]));

  return findings;
}

export function unavailableNativeElementScan(reason: string): NativeElementScan {
  return { status: "unavailable", findings: [], reason };
}

export function nativeElementScan(html: string): NativeElementScan {
  return { status: "available", findings: detectNativeWebflowElements(html) };
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
  acknowledgedCount: number;
  pages: { id: string; title: string; url: string }[];
}

export function siteNativeElementRollups(pages: WatchPage[]): SiteNativeElementRollup[] {
  const grouped = new Map<string, Array<NativeElementLifecycle & { page: WatchPage }>>();
  for (const page of pages) {
    for (const issue of nativeElementIssuesForPage(page.history)) {
      if (issue.status !== "active" && issue.status !== "regressed") continue;
      if (nativeElementDisposition(page.nativeElementControls, issue.id) === "suppressed") continue;
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
    acknowledgedCount: issues.filter((issue) => nativeElementDisposition(issue.page.nativeElementControls, issue.id) === "acknowledged").length,
    pages: issues.map((issue) => ({ id: issue.page.id, title: issue.page.title, url: issue.page.url }))
      .sort((left, right) => left.title.localeCompare(right.title)),
  })).sort((left, right) => right.regressedCount - left.regressedCount || right.pageCount - left.pageCount || right.instanceCount - left.instanceCount);
}

export function nativeRecommendationOpportunities(
  scan: NativeElementScan | undefined,
  controls?: Record<string, NativeElementControl>,
) {
  if (scan?.status !== "available") return [];
  return scan.findings.filter((item) => !nativeElementDisposition(controls, item.id)).map((item) => ({
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
