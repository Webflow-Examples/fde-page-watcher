import type {
  AgentCheck,
  AgentIssueTaskEvidence,
  AppState,
  CategoryKey,
  ChangeMarker,
  LighthouseCollectionQuality,
  LighthouseOpportunity,
  NativeElementScan,
  Night,
  NightScores,
  PageStatus,
  Rec,
  Strategy,
  StrategyScores,
  WatchPage,
} from "./types";
import type {
  CruxFormFactor,
  CruxPageEvidence,
  CruxScope,
  CruxSnapshot,
} from "./crux";
import type { WebflowConnectionStatus } from "./webflowTypes";
import { DEFAULT_SENSITIVITY, thresholdsFor } from "./sensitivity";
import { DEFAULT_DIGEST_CADENCE } from "./digestCadence";
import { AGENT_CHECK_GROUPS } from "./agentChecks";
import { agentCheckKey, captureAgentReadiness } from "./agentScoring";
import { nativeElementScan, unavailableNativeElementScan } from "./nativeElements";
import { classifyWebflowPerformance } from "./webflowPerformance";

/** Increment when the bundled demo scenarios change materially. */
export const DEMO_DATA_VERSION = 2;

interface Seed {
  id: string;
  title: string;
  url: string;
  flag: "priority" | "watching" | "paused";
  base: Record<CategoryKey, number>;
  scenario: "stable" | "improving" | "regressing";
}

const SEEDS: Seed[] = [
  { id: "home", title: "Homepage", url: "webflow.com", flag: "priority", base: { perf: 78, a11y: 96, bp: 100, seo: 100 }, scenario: "stable" },
  { id: "pricing", title: "Pricing", url: "webflow.com/pricing", flag: "priority", base: { perf: 72, a11y: 93, bp: 96, seo: 100 }, scenario: "regressing" },
  { id: "designer", title: "Designer", url: "webflow.com/product/designer", flag: "priority", base: { perf: 62, a11y: 91, bp: 92, seo: 92 }, scenario: "improving" },
  { id: "enterprise", title: "Enterprise", url: "webflow.com/enterprise", flag: "watching", base: { perf: 84, a11y: 98, bp: 100, seo: 100 }, scenario: "stable" },
  { id: "ai", title: "AI", url: "webflow.com/ai", flag: "watching", base: { perf: 64, a11y: 89, bp: 96, seo: 92 }, scenario: "stable" },
  { id: "hosting", title: "Hosting", url: "webflow.com/hosting", flag: "watching", base: { perf: 74, a11y: 95, bp: 100, seo: 100 }, scenario: "improving" },
  { id: "templates", title: "Templates", url: "webflow.com/templates", flag: "paused", base: { perf: 60, a11y: 88, bp: 92, seo: 85 }, scenario: "regressing" },
];

const CAT_KEYS: CategoryKey[] = ["perf", "a11y", "bp", "seo"];
const N = 45;
const DESKTOP_PERF_BONUS = 18;
const DAY_MS = 24 * 60 * 60 * 1000;
const GLOBAL_IGNORED_GROUP = "Commerce";
const WEBMCP_KEY = agentCheckKey({ group: "API / Auth / MCP", name: "WebMCP" });

const clamp = (value: number) => Math.max(0, Math.min(100, Math.round(value)));

function demoAnchor(now: Date): Date {
  const anchor = new Date(now);
  anchor.setUTCHours(8, 0, 0, 0);
  if (anchor.getTime() > now.getTime()) anchor.setUTCDate(anchor.getUTCDate() - 1);
  return anchor;
}

function isoAt(anchor: Date, dayOffset: number, hourOffset = 0): string {
  return new Date(anchor.getTime() + dayOffset * DAY_MS + hourOffset * 60 * 60 * 1000).toISOString();
}

function dateLabel(iso: string): string {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(iso));
}

function dateKey(iso: string): string {
  return iso.slice(0, 10);
}

function toDesktop(mobile: NightScores): NightScores {
  const bump = (score: { m: number; lo: number; hi: number }) => ({
    m: clamp(score.m + DESKTOP_PERF_BONUS),
    lo: clamp(score.lo + DESKTOP_PERF_BONUS),
    hi: clamp(score.hi + DESKTOP_PERF_BONUS),
  });
  return {
    perf: bump(mobile.perf),
    a11y: { ...mobile.a11y },
    bp: { ...mobile.bp },
    seo: { ...mobile.seo },
  };
}

const AGENT_FAILS: Record<string, string[]> = {
  pricing: ["Markdown negotiation", "WebMCP", "DNS for AI Discovery (DNS-AID)"],
  designer: ["WebMCP", "ACP", "Web Bot Auth"],
  ai: ["UCP", "ACP"],
  templates: ["Markdown negotiation", "A2A Agent Card", "WebMCP", "MCP Server Card", "x402", "MPP"],
  home: ["WebMCP"],
  enterprise: [],
  hosting: ["ACP"],
};

function agentFor(id: string, sequence = N - 1): AgentCheck[] {
  const fails = new Set(AGENT_FAILS[id] ?? []);
  return AGENT_CHECK_GROUPS.flatMap((group) => group.items.map((name) => {
    const fixedRecently = (id === "designer" && name === "Web Bot Auth" && sequence >= N - 3)
      || (id === "pricing" && name === "DNS for AI Discovery (DNS-AID)" && sequence >= N - 2);
    const newlyRegressed = id === "pricing" && name === "Markdown negotiation" && sequence >= N - 4;
    return {
      name,
      group: group.name,
      pass: fixedRecently || !fails.has(name),
      ...(newlyRegressed ? { regressed: true } : {}),
    };
  }));
}

function quality(status: LighthouseCollectionQuality["status"] = "reliable"): LighthouseCollectionQuality {
  if (status === "unusable") {
    return {
      requestedRuns: 5, attemptRuns: 5, successfulRuns: 2, uniqueRuns: 2, duplicateRuns: 0,
      eligibleRuns: 1, warnedRuns: 1, failedRuns: 3, findingsObserved: 1, findingsPromoted: 0, status,
    };
  }
  if (status === "low-confidence") {
    return {
      requestedRuns: 5, attemptRuns: 5, successfulRuns: 4, uniqueRuns: 3, duplicateRuns: 1,
      eligibleRuns: 2, warnedRuns: 1, failedRuns: 1, findingsObserved: 3, findingsPromoted: 1, status,
    };
  }
  return {
    requestedRuns: 5, attemptRuns: 5, successfulRuns: 5, uniqueRuns: 5, duplicateRuns: 0,
    eligibleRuns: 5, warnedRuns: 0, failedRuns: 0, findingsObserved: 4, findingsPromoted: 2, status,
  };
}

function measurementContext(perf: number, strategy: Strategy, sequence: number) {
  const desktop = strategy === "desktop";
  const wobble = (sequence % 3) * 35;
  return {
    lighthouseVersion: sequence < N - 8 ? "12.8.2" : "13.0.1",
    medianBenchmarkIndex: desktop ? 1180 + sequence : 940 + sequence,
    medianFirstContentfulPaint: Math.max(700, 4_600 - perf * 38 - (desktop ? 420 : 0) + wobble),
    medianTotalBlockingTime: Math.max(40, 1_080 - perf * 10 - (desktop ? 100 : 0) + wobble / 3),
    medianLargestContentfulPaint: Math.max(1_100, 6_000 - perf * 43 - (desktop ? 480 : 0) + wobble),
    medianSpeedIndex: Math.max(1_300, 7_400 - perf * 52 - (desktop ? 620 : 0) + wobble),
    medianCumulativeLayoutShift: Number(Math.max(0.02, 0.34 - perf * 0.0032 + (sequence % 2) * 0.01).toFixed(3)),
    medianServerResponseTime: Math.max(250, 2_100 - perf * 17 - (desktop ? 110 : 0) + wobble / 2),
  };
}

function performanceOffset(seed: Seed, sequence: number): number {
  if (seed.scenario === "regressing" && sequence >= N - 9) {
    return -Math.min(19, 7 + (sequence - (N - 9)) * 2);
  }
  if (seed.scenario === "improving") return -6 + (sequence / (N - 1)) * 15;
  return 0;
}

function sampleOpportunity(id: string): LighthouseOpportunity {
  const title = id === "unused-javascript" ? "Code the page never runs is costing 1.5 seconds" : "Images were bigger than the space they fill";
  return {
    id,
    title,
    description: "Repeated across the trusted sample set.",
    category: "Performance",
    savingsMs: id === "unused-javascript" ? 1_450 : 620,
    savingsBytes: id === "unused-javascript" ? 188_000 : 420_000,
    observedRuns: 4,
    eligibleRuns: 5,
    confidence: "high",
    savingsLowMs: id === "unused-javascript" ? 1_180 : 510,
    savingsHighMs: id === "unused-javascript" ? 1_720 : 790,
    webflow: classifyWebflowPerformance(id, title),
  };
}

function enrichLighthouseEvidence(night: Night, pageId: string): void {
  const auditId = pageId === "pricing" ? "unused-javascript" : "uses-responsive-images";
  const opportunity = sampleOpportunity(auditId);
  night.opportunitiesByStrategy = { mobile: [opportunity], desktop: pageId === "pricing" ? [opportunity] : [] };
  night.diagnostics = {
    mobile: [{
      ...opportunity,
      savingsBytes: opportunity.savingsBytes ?? 0,
      score: 0.38,
      scoreDisplayMode: "numeric",
      actionable: true,
      observedRuns: 4,
      totalObservedRuns: 5,
      eligibleRuns: 5,
      successfulRuns: 5,
      quorum: 3,
      frequency: 0.8,
      promoted: true,
      confidence: "high",
      savingsLowMs: opportunity.savingsLowMs ?? opportunity.savingsMs,
      savingsHighMs: opportunity.savingsHighMs ?? opportunity.savingsMs,
      savingsLowBytes: Math.round((opportunity.savingsBytes ?? 0) * 0.8),
      savingsHighBytes: Math.round((opportunity.savingsBytes ?? 0) * 1.2),
    }],
  };
  night.culpritEvidence = {
    mobile: [{
      auditId,
      title: opportunity.title,
      facts: [
        { key: "transfer", label: "Avoidable transfer", value: opportunity.savingsBytes ?? 0, unit: "bytes" },
        { key: "blocking", label: "Main-thread blocking", value: opportunity.savingsMs, unit: "milliseconds" },
      ],
      sources: [{ host: "cdn.prod.website-files.com", transferBytes: opportunity.savingsBytes }],
      sampleRuns: 4,
    }],
  };
}

function availableKitesurf(capturedAt: string, pageId: string) {
  return {
    schemaVersion: 1 as const,
    engine: "kitesurf" as const,
    status: "available" as const,
    capturedAt,
    httpStatus: 200,
    title: `${pageId} demo capture`,
    renderedContentHash: `demo-${pageId}-rendered`,
    accessibilityHash: `demo-${pageId}-a11y`,
    document: {
      domNodes: pageId === "pricing" ? 2_180 : 940, textCharacters: 14_200, headings: 18, links: 84,
      buttons: 12, forms: 1, images: pageId === "pricing" ? 46 : 18, iframes: pageId === "hosting" ? 2 : 0,
      serializedHtmlCharacters: 188_000, htmlRetained: false,
    },
    accessibility: { nodes: 420, interactiveNodes: 96 },
    network: {
      requests: pageId === "pricing" ? 146 : 82, failedRequests: pageId === "pricing" ? 2 : 0,
      errorResponses: 0, thirdPartyHosts: pageId === "pricing" ? 11 : 5, resourceEntries: 78,
      transferBytes: pageId === "pricing" ? 5_800_000 : 2_100_000,
    },
    runtime: { consoleErrors: pageId === "pricing" ? 2 : 0, pageErrors: 0 },
    diagnosticTimings: { wallTimeMs: 4_820, responseStartMs: 220, domContentLoadedMs: 1_140, loadEventMs: 2_080 },
  };
}

function seedNativeScan(html: string): NativeElementScan {
  // Match JSON-backed D1/filesystem persistence by omitting undefined fields.
  return JSON.parse(JSON.stringify(nativeElementScan(html))) as NativeElementScan;
}

function nativeScans(pageId: string): { previous?: NativeElementScan; latest?: NativeElementScan } {
  const root = '<html data-wf-site="demo" data-wf-page="page">';
  if (pageId === "pricing") {
    const scan = seedNativeScan(`${root}<div class="w-background-video" data-video-urls="hero.mp4,hero.webm"></div><img src="https://cdn.prod.website-files.com/hero.jpg">`);
    return { previous: scan, latest: scan };
  }
  if (pageId === "designer") {
    return { previous: seedNativeScan(`${root}<div data-animation-type="lottie"></div>`), latest: seedNativeScan(root) };
  }
  if (pageId === "hosting") {
    return {
      previous: seedNativeScan(`${root}<spline-viewer></spline-viewer>`),
      latest: seedNativeScan('<html data-wf-site="demo" data-wf-page="page" data-wf-intellimize-customer-id="optimize"><spline-viewer></spline-viewer>'),
    };
  }
  if (pageId === "templates") {
    return {
      previous: seedNativeScan(`${root}<iframe src="https://www.youtube.com/embed/demo"></iframe>`),
      latest: unavailableNativeElementScan("published page returned a temporary 503"),
    };
  }
  return { latest: seedNativeScan(root) };
}

function marker(id: string, history: Night[], index: number, text: string): ChangeMarker {
  const night = history[index];
  return { id, i: night.i, date: dateKey(night.iso!), text, source: "custom" };
}

function pageStatus(scenario: Seed["scenario"]): PageStatus {
  return scenario === "improving" ? "improving" : scenario === "regressing" ? "regressing" : "stable";
}

/**
 * Scenario-rich local/demo state. Dates are anchored to the most recent past
 * 08:00 UTC so every 3/7/30-day view remains populated whenever it is seeded.
 */
/**
 * The one remediation two seeded cases share.
 *
 * `groupByRemediation` keys on the steps and the actionability together, so the
 * steps must be IDENTICAL for the two to group — which is exactly the property
 * worth exercising in a browser. Built from one function rather than written
 * twice for that reason: two hand-copied arrays would drift on the first edit
 * and the group would quietly become two groups of one.
 */
function sharedHeadFix(caseKey: string, title: string, capturedAt: string): AgentIssueTaskEvidence {
  return {
    caseKey,
    title,
    scope: "page",
    capturedAt,
    remediation: [
      "Open Site settings → Custom code and find the site-wide head.",
      "Move the stylesheet out of the head and let Webflow bundle it.",
      "Republish and wait for the next nightly collection.",
    ],
    successCriteria: "The stylesheet no longer blocks first paint on any page that loads the site-wide head.",
    verificationCheckIds: [],
  };
}

export function buildSeedState(now = new Date()): AppState {
  const anchor = demoAnchor(now);
  let randomState = 20240716;
  const random = () => {
    randomState = (randomState * 1664525 + 1013904223) % 4294967296;
    return randomState / 4294967296;
  };

  const pages: WatchPage[] = SEEDS.map((seed) => {
    const history: Night[] = [];
    for (let sequence = 0; sequence < N; sequence += 1) {
      const mobile = {} as NightScores;
      for (const key of CAT_KEYS) {
        const offset = key === "perf" ? performanceOffset(seed, sequence) : 0;
        const noise = (random() - 0.5) * (key === "perf" ? 4 : 2.5);
        const median = clamp(seed.base[key] + offset + noise);
        const spread = key === "perf" ? 3 + random() * 3 : 1 + random() * 1.5;
        mobile[key] = { m: median, lo: clamp(median - spread), hi: clamp(median + spread) };
      }
      const scores: StrategyScores = { mobile, desktop: toDesktop(mobile) };
      const iso = isoAt(anchor, sequence - (N - 1));
      const agent = sequence >= N - 9 || sequence % 7 === 0 ? agentFor(seed.id, sequence) : undefined;
      history.push({
        i: sequence,
        runId: `demo-${seed.id}-${String(sequence + 1).padStart(2, "0")}`,
        date: dateLabel(iso),
        iso,
        scores,
        availableStrategies: ["mobile", "desktop"],
        strategyCapturedAt: { mobile: isoAt(anchor, sequence - (N - 1), 0.1), desktop: isoAt(anchor, sequence - (N - 1), 0.2) },
        samples: { mobile: 5, desktop: 5 },
        sampleSize: 5,
        ...(agent ? { agent, agentCapturedAt: isoAt(anchor, sequence - (N - 1), 0.3) } : {}),
        collectionQuality: { mobile: quality(), desktop: quality() },
        cohortId: `nightly:${dateKey(iso)}`,
        evidenceStatus: "trusted",
        measurementContext: {
          mobile: measurementContext(scores.mobile.perf.m, "mobile", sequence),
          desktop: measurementContext(scores.desktop.perf.m, "desktop", sequence),
        },
      });
    }

    // Keep an extra same-day manual collection for date grouping in the audit trail.
    if (seed.id === "home") {
      const night = history[N - 2];
      night.iso = isoAt(anchor, 0, -2);
      night.date = dateLabel(night.iso);
      night.cohortId = `manual:${dateKey(night.iso)}:after-publish`;
      night.strategyCapturedAt = { mobile: isoAt(anchor, 0, -1.9), desktop: isoAt(anchor, 0, -1.8) };
      night.agentCapturedAt = isoAt(anchor, 0, -1.7);
    }

    const last = history.at(-1)!;
    const medians = (scores: NightScores) => ({ perf: scores.perf.m, a11y: scores.a11y.m, bp: scores.bp.m, seo: scores.seo.m });
    const baseMobile: NightScores = {
      perf: { m: seed.base.perf, lo: clamp(seed.base.perf - 3), hi: clamp(seed.base.perf + 3) },
      a11y: { m: seed.base.a11y, lo: clamp(seed.base.a11y - 1), hi: clamp(seed.base.a11y + 1) },
      bp: { m: seed.base.bp, lo: clamp(seed.base.bp - 1), hi: clamp(seed.base.bp + 1) },
      seo: { m: seed.base.seo, lo: clamp(seed.base.seo - 1), hi: clamp(seed.base.seo + 1) },
    };
    const scans = nativeScans(seed.id);
    if (scans.previous) history[N - 2].nativeElements = scans.previous;
    if (scans.latest) last.nativeElements = scans.latest;
    last.kitesurf = seed.id === "ai"
      ? { schemaVersion: 1, engine: "kitesurf", status: "unavailable", capturedAt: last.iso!, reason: "browser probe timed out after navigation" }
      : availableKitesurf(last.iso!, seed.id);
    if (["pricing", "hosting", "templates"].includes(seed.id)) enrichLighthouseEvidence(last, seed.id);

    return {
      id: seed.id,
      title: seed.title,
      url: seed.url,
      flag: seed.flag,
      status: pageStatus(seed.scenario),
      baseline: { mobile: baseMobile, desktop: toDesktop(baseMobile) },
      current: { mobile: medians(last.scores.mobile), desktop: medians(last.scores.desktop) },
      history,
      markers: [],
      agent: agentFor(seed.id),
      agentIgnores: { checks: seed.id === "ai" ? [WEBMCP_KEY] : [], groups: [] },
      agentIgnoreRestores: { checks: [], groups: seed.id === "hosting" ? [GLOBAL_IGNORED_GROUP] : [] },
      baselineCapturedAt: isoAt(anchor, -(N - 1) - 1),
      acted: {},
      lastRunAt: last.iso,
      lastPsiRunAt: { mobile: last.iso, desktop: last.iso },
      lastAgentRunAt: last.iso,
      lastScheduledAt: last.iso,
      collectionOffsetMinutes: SEEDS.indexOf(seed) * 15,
      lastCollectionStatus: "trusted",
    };
  });

  const page = (id: string) => pages.find((candidate) => candidate.id === id)!;
  const anomalyIndices = [N - 6, N - 5];
  for (const pageId of ["home", "pricing", "designer", "enterprise"]) {
    for (const index of anomalyIndices) {
      const night = page(pageId).history[index];
      night.evidenceStatus = "provider-anomaly";
      night.cohortId = "nightly:demo-psi-outage";
      night.measurementContext!.mobile!.lighthouseVersion = "13.0.0-provider-rollout";
      night.measurementContext!.desktop!.lighthouseVersion = "13.0.0-provider-rollout";
    }
  }

  // Independent evidence can complete even when one or both PSI devices do not.
  const partial = page("ai").history[N - 2];
  partial.availableStrategies = ["mobile"];
  partial.samples = { mobile: 3 };
  partial.collectionQuality = { mobile: quality("low-confidence"), desktop: quality("unusable") };
  delete partial.strategyCapturedAt?.desktop;
  page("ai").lastCollectionStatus = "partial";
  delete page("ai").lastPsiRunAt?.desktop;

  const agentOnly = page("enterprise").history[N - 3];
  agentOnly.availableStrategies = [];
  agentOnly.samples = {};
  agentOnly.collectionQuality = {};
  agentOnly.cohortId = `manual:${dateKey(agentOnly.iso!)}:agent-only`;
  delete agentOnly.strategyCapturedAt;

  page("templates").runState = "failed";
  page("templates").runId = "demo-templates-failed";
  page("templates").lastRunAt = isoAt(anchor, 0, 1);
  page("templates").lastCollectionStatus = "inconclusive";
  page("templates").lastError = "Run exceeded the 30 minute stale limit";
  // The two dispositions, in the two concepts that cover them: a real finding
  // the reader has seen and set aside (dismissed), and one that does not apply
  // to this site at all (excluded, with the reason applicability requires).
  page("templates").nativeElementControls = {
    "webflow-video-embed-eager": { dismissed: true, updatedAt: isoAt(anchor, -2) },
  };
  page("pricing").nativeElementControls = {
    "webflow-image-unresponsive": {
      excluded: { reason: "Not applicable to this site" },
      updatedAt: isoAt(anchor, -1),
    },
  };

  page("pricing").markers = [
    marker("pricing-hero", page("pricing").history, N - 15, "Published new pricing hero video"),
    marker("pricing-experiment", page("pricing").history, N - 8, "Started checkout copy experiment"),
  ];
  page("designer").markers = [marker("designer-assets", page("designer").history, N - 18, "Compressed hero imagery")];
  page("home").markers = [
    marker("home-nav", page("home").history, N - 12, "Shipped navigation redesign"),
    marker("home-cache", page("home").history, N - 12, "Enabled longer asset caching"),
  ];

  const recs: Rec[] = [
    {
      key: "pricing:unused-javascript", pageId: "pricing", pageTitle: "Pricing", url: page("pricing").url,
      id: "unused-javascript", source: "lighthouse", strategies: ["mobile", "desktop"], sourceRunId: page("pricing").history.at(-1)!.runId,
      title: "Code the page never runs is costing 1.5 seconds", category: "Performance", webflow: classifyWebflowPerformance("unused-javascript"),
      savings: "1.5 s", estTime: "2 days", status: "task", taskStatus: "in-progress", added: dateKey(isoAt(anchor, -12)), doneDate: null,
      aiSummary: "Site-wide code keeps the browser busy, so the page cannot respond to a tap. Measured on both phone and desktop.",
    },
    {
      key: "designer:uses-responsive-images", pageId: "designer", pageTitle: "Designer", url: page("designer").url,
      id: "uses-responsive-images", source: "lighthouse", strategies: ["mobile"], sourceRunId: page("designer").history.at(-1)!.runId,
      title: "Images were bigger than the space they fill", category: "Performance", webflow: classifyWebflowPerformance("uses-responsive-images"),
      savings: "0.6 s", estTime: "3 hours", status: "task", taskStatus: "done", added: dateKey(isoAt(anchor, -20)), doneDate: dateKey(isoAt(anchor, -8)),
      aiSummary: "The page now sends each image at the size it is shown, and later measurements are improving.",
    },
    {
      key: "hosting:webflow-spline-eager", pageId: "hosting", pageTitle: "Hosting", url: page("hosting").url,
      id: "webflow-spline-eager", source: "native-elements", strategies: ["mobile", "desktop"], sourceRunId: page("hosting").history.at(-1)!.runId,
      title: "A 3D scene starts loading before anyone scrolls to it", category: "Native elements", webflow: classifyWebflowPerformance("webflow-spline-eager"),
      savings: "Observed", estTime: "1 day", status: "inbox", taskStatus: "todo", added: dateKey(isoAt(anchor, -3)), doneDate: null,
      aiSummary: "The published page starts loading a 3D scene before it comes into view.",
    },
    {
      key: "templates:webflow-video-embed-eager", pageId: "templates", pageTitle: "Templates", url: page("templates").url,
      id: "webflow-video-embed-eager", source: "native-elements", strategies: ["mobile"], sourceRunId: page("templates").history[N - 2].runId,
      title: "Video players load before anyone plays them", category: "Native elements", webflow: classifyWebflowPerformance("webflow-video-embed-eager"),
      savings: "Observed", estTime: "1 day", status: "ignored", taskStatus: "todo", added: dateKey(isoAt(anchor, -7)), doneDate: null,
    },
    {
      key: "hosting:crux-field-only-inp", pageId: "hosting", pageTitle: "Hosting", url: page("hosting").url,
      id: "crux-field-only-inp", source: "crux-field-only", strategies: ["mobile"],
      title: "Real visitors wait longer for a tap to register than our test does", category: "Visitor experience",
      webflow: { ...classifyWebflowPerformance("third-party-summary"), source: "crux-field-only" },
      savings: "620 ms for real visitors", estTime: "Needs review", status: "inbox", taskStatus: "todo", added: dateKey(isoAt(anchor, -2)), doneDate: null,
      fieldSignals: { mobile: { metricKey: "responsiveness", metricLabel: "Responsiveness", relationship: "proxy", labLabel: "Nightly test (TBT)", labFormatted: "120 ms", fieldLabel: "Real visitors (INP)", fieldValue: 620, fieldFormatted: "620 ms", fieldRating: "Poor", scope: "url", collectionStart: dateKey(isoAt(anchor, -29)), collectionEnd: dateKey(isoAt(anchor, -2)), detectedAt: isoAt(anchor, -2) } },
      fieldLifecycle: { mobile: { status: "active", firstDetectedAt: isoAt(anchor, -9), lastDetectedAt: isoAt(anchor, -2), lastEvaluatedCollectionEnd: dateKey(isoAt(anchor, -2)), consecutiveGoodWindows: 0 } },
    },
    // Two causes, one fix. These exist so the remediation GROUP renders in the
    // browser: `groupByRemediation` keys on the steps and the actionability, so
    // two cases only group when both match exactly. Until these landed the
    // multi-member group was reachable only from a unit test, which meant
    // nobody had ever looked at one.
    //
    // Different audits on different pages, deliberately: a group whose members
    // share a cause would have been folded by `groupByCause` first and never
    // reached the remediation step.
    {
      key: "enterprise:render-blocking-resources", pageId: "enterprise", pageTitle: "Enterprise", url: page("enterprise").url,
      id: "render-blocking-resources", source: "lighthouse", strategies: ["mobile"], sourceRunId: page("enterprise").history.at(-1)!.runId,
      title: "A stylesheet delays the first text on the page", category: "Performance", webflow: classifyWebflowPerformance("render-blocking-resources"),
      savings: "0.9 s", estTime: "1 day", status: "inbox", taskStatus: "todo", added: dateKey(isoAt(anchor, -4)), doneDate: null,
      aiSummary: "A site-wide stylesheet has to finish loading before any text appears on Enterprise.",
      agentIssue: sharedHeadFix("enterprise:render-blocking-resources", "A stylesheet delays the first text on the page", isoAt(anchor, -4)),
    },
    {
      key: "ai:unused-css-rules", pageId: "ai", pageTitle: "AI", url: page("ai").url,
      id: "unused-css-rules", source: "lighthouse", strategies: ["mobile"], sourceRunId: page("ai").history.at(-1)!.runId,
      title: "Most of a stylesheet this page loads goes unused", category: "Performance", webflow: classifyWebflowPerformance("unused-css-rules"),
      savings: "0.4 s", estTime: "1 day", status: "inbox", taskStatus: "todo", added: dateKey(isoAt(anchor, -4)), doneDate: null,
      aiSummary: "Most of the same site-wide stylesheet goes unused on this page.",
      agentIssue: sharedHeadFix("ai:unused-css-rules", "Most of a stylesheet this page loads goes unused", isoAt(anchor, -4)),
    },
    {
      key: "pricing:crux-field-only-lcp", pageId: "pricing", pageTitle: "Pricing", url: page("pricing").url,
      id: "crux-field-only-lcp", source: "crux-field-only", strategies: ["mobile"],
      title: "The main content still takes too long for real visitors", category: "Visitor experience",
      webflow: { ...classifyWebflowPerformance("largest-contentful-paint-element"), source: "crux-field-only" },
      savings: "4.8 s for real visitors", estTime: "Needs review", status: "task", taskStatus: "done", added: dateKey(isoAt(anchor, -22)), doneDate: dateKey(isoAt(anchor, -5)),
      fieldLifecycle: { mobile: { status: "verifying", firstDetectedAt: isoAt(anchor, -22), lastDetectedAt: isoAt(anchor, -9), lastEvaluatedCollectionEnd: dateKey(isoAt(anchor, -2)), consecutiveGoodWindows: 1 } },
    },
  ];

  // Done tasks create task-linked markers on the same chart as custom markers.
  for (const rec of recs.filter((candidate) => candidate.status === "task" && candidate.taskStatus === "done" && candidate.doneDate)) {
    const target = page(rec.pageId);
    const index = [...target.history].reverse().find((night) => dateKey(night.iso!) <= rec.doneDate!)?.i ?? target.history.at(-1)!.i;
    target.markers.push({ id: `task:${rec.key}`, i: index, date: rec.doneDate!, text: `Completed: ${rec.title}`, source: "task", recKey: rec.key });
  }

  pages.push({
    id: "localization",
    title: "Localization (new)",
    url: "webflow.com/localization",
    flag: "watching",
    status: "pending",
    current: {
      mobile: { perf: 0, a11y: 0, bp: 0, seo: 0 }, desktop: { perf: 0, a11y: 0, bp: 0, seo: 0 },
    },
    history: [],
    markers: [],
    agent: [],
    agentIgnores: { checks: [], groups: [] },
    agentIgnoreRestores: { checks: [], groups: [] },
    acted: {},
    collectionOffsetMinutes: SEEDS.length * 15,
  });

  const state: AppState = {
    demoDataVersion: DEMO_DATA_VERSION,
    pages,
    recs,
    visitorExperienceVisible: true,
    agentIgnoreDefaults: { checks: [], groups: [GLOBAL_IGNORED_GROUP] },
    // A position, and the limits it resolves to. The fixture used to carry a
    // hand-tuned threshold set, which would now make every demo project a
    // migrated one and put the migration notice in every demo digest — true,
    // but a fixture should show the ordinary case and let the tests exercise
    // the migration.
    sensitivity: DEFAULT_SENSITIVITY,
    performanceThresholds: thresholdsFor(DEFAULT_SENSITIVITY),
    digestCadence: DEFAULT_DIGEST_CADENCE,
    digestRecipients: ["performance@brandstudio.example"],
    collectionSchedule: { timeZone: "America/Chicago", localTime: "02:30", overridden: true },
    measurementIncident: {
      id: "demo-psi-provider-incident",
      cohortId: "nightly:demo-psi-outage",
      status: "verified",
      detectedAt: isoAt(anchor, -6, 0.5),
      affectedPageIds: ["home", "pricing", "designer", "enterprise"],
      affectedPages: 4,
      eligiblePages: 7,
      confirmationCohortId: "confirmation:demo-psi-outage",
      confirmationAttempts: 1,
      recoveredAt: isoAt(anchor, -4),
    },
    jobs: [{
      id: "demo-templates-failed", runId: "demo-templates-failed", pageId: "templates", kind: "nightly", state: "failed", attempts: 3,
      createdAt: isoAt(anchor, 0), updatedAt: isoAt(anchor, 0, 1), startedAt: isoAt(anchor, 0, 0.1), completedAt: isoAt(anchor, 0, 1),
      completedStrategies: ["mobile"], strategyAttempts: { mobile: 5, desktop: 15 },
      strategyErrors: { desktop: "PageSpeed Insights remained unavailable after durable retries" },
      cruxCompletedAt: isoAt(anchor, 0, 0.2), agentCompletedAt: isoAt(anchor, 0, 0.3), error: "Run exceeded the 30 minute stale limit",
    }],
    followUps: [
      { id: "demo-followup-sent", pageId: "designer", markerId: "task:designer:uses-responsive-images", markerText: "Completed: Images were bigger than the space they fill", markerDate: dateKey(isoAt(anchor, -8)), interval: "2d", dueISO: isoAt(anchor, -6), sent: true, attempts: 1, lastAttemptISO: isoAt(anchor, -6, 1), lastHttpStatus: 200 },
      { id: "demo-followup-pending", pageId: "designer", markerId: "task:designer:uses-responsive-images", markerText: "Completed: Images were bigger than the space they fill", markerDate: dateKey(isoAt(anchor, -8)), interval: "30d", dueISO: isoAt(anchor, 22), sent: false, attempts: 0 },
      { id: "demo-followup-retry", pageId: "pricing", markerId: "task:pricing:crux-field-only-lcp", markerText: "Completed: The main content still takes too long for real visitors", markerDate: dateKey(isoAt(anchor, -5)), interval: "2d", dueISO: isoAt(anchor, -3), sent: false, attempts: 1, lastAttemptISO: isoAt(anchor, -3, 1), lastHttpStatus: 429, lastError: "rate_limited", retryAfterISO: isoAt(anchor, 2) },
    ],
    watcherNote: {
      text: "Pricing is the clearest sustained regression, while Designer and Hosting are improving. Two nights of readings were left out as a confirmed problem at the testing service, and real visitors to Hosting are waiting longer for a tap to register even though the nightly test finds nothing wrong.",
      generatedAt: isoAt(anchor, 0, 0.5), modelVersion: 2,
    },
  };

  for (const watchedPage of pages) {
    for (const night of watchedPage.history) {
      if (night.agent) {
        night.agentReadiness = captureAgentReadiness(night.agent, watchedPage.agentIgnores, state.agentIgnoreDefaults, watchedPage.agentIgnoreRestores);
      }
    }
  }
  return state;
}

function cruxMetric(value: number | null, good: number, poor: number) {
  if (value === null) return undefined;
  return {
    p75: value,
    histogram: [
      { start: 0, end: good, density: value <= good ? 0.82 : 0.42 },
      { start: good, end: poor, density: value > good && value <= poor ? 0.42 : 0.13 },
      { start: poor, density: value > poor ? 0.31 : 0.05 },
    ],
  };
}

function cruxSeries(
  anchor: Date,
  pageId: string,
  requestedUrl: string,
  formFactor: CruxFormFactor,
  scope: CruxScope,
  values: Array<[number | null, number | null, number | null, number | null]>,
): CruxPageEvidence {
  const effectiveUrl = scope === "origin" ? "https://webflow.com" : `https://${requestedUrl}`;
  const snapshots: CruxSnapshot[] = values.map(([lcp, inp, cls, ttfb], index) => {
    const collectionEnd = dateKey(isoAt(anchor, -2 - (values.length - 1 - index) * 7));
    const collectionStart = dateKey(new Date(Date.parse(`${collectionEnd}T00:00:00.000Z`) - 27 * DAY_MS).toISOString());
    return {
      formFactor, scope, requestedUrl: `https://${requestedUrl}`, effectiveUrl, collectionStart, collectionEnd,
      fetchedAt: isoAt(anchor, -1, 22), lcpP75Ms: lcp, inpP75Ms: inp, clsP75: cls, ttfbP75Ms: ttfb,
      metrics: {
        ...(cruxMetric(lcp, 2_500, 4_000) ? { largest_contentful_paint: cruxMetric(lcp, 2_500, 4_000)! } : {}),
        ...(cruxMetric(inp, 200, 500) ? { interaction_to_next_paint: cruxMetric(inp, 200, 500)! } : {}),
        ...(cruxMetric(cls, 0.1, 0.25) ? { cumulative_layout_shift: cruxMetric(cls, 0.1, 0.25)! } : {}),
        ...(cruxMetric(ttfb, 800, 1_800) ? { experimental_time_to_first_byte: cruxMetric(ttfb, 800, 1_800)! } : {}),
      },
    };
  });
  const latest = snapshots.at(-1)!;
  const isPartial = [latest.lcpP75Ms, latest.inpP75Ms, latest.clsP75, latest.ttfbP75Ms].some((value) => value === null);
  return {
    pageId, formFactor, snapshots,
    status: {
      pageId, formFactor, status: isPartial ? "partial" : "available", effectiveScope: scope,
      latestCollectionEnd: latest.collectionEnd, lastAttemptedAt: isoAt(anchor, -1, 22), lastSucceededAt: isoAt(anchor, -1, 22),
      errorCode: null, errorMessage: null,
    },
  };
}

/** CrUX is a separate storage stream, so its demo fixture is exported separately. */
export function buildSeedCruxEvidence(now = new Date()): CruxPageEvidence[] {
  const anchor = demoAnchor(now);
  const results: CruxPageEvidence[] = [
    cruxSeries(anchor, "home", "webflow.com", "PHONE", "url", [[2_260, 180, 0.08, 690], [2_320, 185, 0.08, 710], [2_280, 178, 0.07, 700], [2_310, 182, 0.08, 720]]),
    cruxSeries(anchor, "home", "webflow.com", "DESKTOP", "url", [[1_720, 120, 0.05, 520], [1_740, 118, 0.05, 530], [1_700, 115, 0.04, 510], [1_730, 116, 0.05, 525]]),
    cruxSeries(anchor, "pricing", "webflow.com/pricing", "PHONE", "url", [[2_900, 240, 0.11, 920], [3_300, 310, 0.15, 1_050], [4_100, 430, 0.21, 1_280], [4_820, 560, 0.29, 1_620]]),
    cruxSeries(anchor, "pricing", "webflow.com/pricing", "DESKTOP", "url", [[2_100, 160, 0.07, 700], [2_240, 180, 0.08, 760], [2_520, 230, 0.11, 840], [2_760, null, 0.12, 910]]),
    cruxSeries(anchor, "designer", "webflow.com/product/designer", "PHONE", "origin", [[3_900, 410, 0.19, 1_280], [3_500, 340, 0.16, 1_120], [3_080, 270, 0.13, 980], [2_680, 220, 0.11, 860]]),
    cruxSeries(anchor, "designer", "webflow.com/product/designer", "DESKTOP", "origin", [[2_700, 230, 0.11, 880], [2_430, 195, 0.09, 790], [2_180, 170, 0.08, 720], [1_980, 150, 0.07, 680]]),
    cruxSeries(anchor, "hosting", "webflow.com/hosting", "PHONE", "url", [[2_180, 360, 0.08, 710], [2_140, 440, 0.08, 700], [2_100, 540, 0.07, 690], [2_080, 620, 0.07, 680]]),
    cruxSeries(anchor, "hosting", "webflow.com/hosting", "DESKTOP", "url", [[1_680, 180, 0.04, 510], [1_650, 175, 0.04, 500], [1_640, 170, 0.04, 490], [1_620, 168, 0.04, 480]]),
    cruxSeries(anchor, "templates", "webflow.com/templates", "PHONE", "url", [[3_600, 410, 0.18, 1_200], [3_900, 470, 0.22, 1_350], [4_200, 530, 0.27, 1_600], [4_500, 590, 0.31, 1_920]]),
    cruxSeries(anchor, "templates", "webflow.com/templates", "DESKTOP", "url", [[2_650, 260, 0.11, 880], [2_820, 290, 0.13, 930], [3_050, 340, 0.16, 1_020], [3_240, 390, 0.18, 1_100]]),
  ];
  const unavailable = (pageId: string, formFactor: CruxFormFactor, status: "insufficient" | "error", errorCode: string, errorMessage: string): CruxPageEvidence => ({
    pageId, formFactor, snapshots: [],
    status: { pageId, formFactor, status, effectiveScope: null, latestCollectionEnd: null, lastAttemptedAt: isoAt(anchor, -1, 22), lastSucceededAt: null, errorCode, errorMessage },
  });
  results.push(
    unavailable("enterprise", "PHONE", "insufficient", "NOT_FOUND", "No usable URL- or origin-level CrUX data"),
    unavailable("enterprise", "DESKTOP", "insufficient", "NOT_FOUND", "No usable URL- or origin-level CrUX data"),
    unavailable("ai", "PHONE", "error", "RATE_LIMITED", "The provider rate-limited the latest weekly request"),
    unavailable("ai", "DESKTOP", "error", "UPSTREAM_TIMEOUT", "The latest CrUX request timed out"),
  );
  return results;
}

/** Connected Webflow activity fixture used only when local demo mode has no collector. */
export function buildSeedWebflowConnectionStatus(now = new Date()): WebflowConnectionStatus {
  const anchor = demoAnchor(now);
  return {
    connected: true,
    siteId: "64b84f0123456789abcdef01",
    displayName: "Webflow.com demo site",
    shortName: "webflow-demo",
    domains: ["webflow.com", "www.webflow.com"],
    timeZone: "America/Los_Angeles",
    lastPublished: isoAt(anchor, -1, 8),
    connectedAt: isoAt(anchor, -40),
    lastValidatedAt: isoAt(anchor, -1, 22),
    lastSyncedAt: isoAt(anchor, -1, 22),
    syncStatus: "succeeded",
    syncError: null,
    activityEventCount: 186,
    latestPublish: {
      id: "demo-publish-high-change", publishedAt: isoAt(anchor, -1, 8), previousPublishedAt: isoAt(anchor, -4, 8),
      detectedAt: isoAt(anchor, -1, 8.1), publisherName: "Avery Chen", domains: ["webflow.com", "www.webflow.com"],
      activityCount: 28, changeCount: 74, pageCount: 6, actorCount: 4, resourceCount: 19, changeDensity: "high-change",
    },
    latestActivity: {
      event: "page_updated", operation: "MODIFIED", actorName: "Jordan Lee", createdOn: isoAt(anchor, -1, 7.8), resourceName: "Pricing",
    },
  };
}

/**
 * A project with nothing in it.
 *
 * This is the same shape `"live"` starts from, named so it can be asked for on
 * purpose. Every empty state in the app — "No pages are being watched", the
 * first-run pending copy, the queue empties — was reachable before this only by
 * deploying with `DATASET_MODE=live`, which meant they were reviewed as unit
 * tests and never actually looked at. A named state costs nothing and lets the
 * empty screens be read the way a customer reads them.
 */
export function buildEmptySeedState(): AppState {
  return {
    pages: [], recs: [], visitorExperienceVisible: false, agentIgnoreDefaults: { checks: [], groups: [] },
    sensitivity: DEFAULT_SENSITIVITY,
    performanceThresholds: thresholdsFor(DEFAULT_SENSITIVITY), jobs: [], followUps: [],
  };
}

/**
 * Live environments begin empty; demo/local environments use the full fixture.
 *
 * `"empty"` is the demo equivalent of `"live"`'s starting point — the same
 * state, requested deliberately rather than as a side effect of pointing the
 * app at production.
 */
export function buildInitialState(mode: string | undefined = process.env.DATASET_MODE): AppState {
  if (mode === "live" || mode === "empty") return buildEmptySeedState();
  return buildSeedState();
}
