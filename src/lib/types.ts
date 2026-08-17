// Domain types for the Page Performance Dashboard.
//
// Category keys use the dashboard's short internal names (perf/a11y/bp/seo);
// the PSI client maps Lighthouse category ids onto these (see lib/psi.ts).
// Scores are recorded PER STRATEGY (mobile + desktop) throughout — baseline,
// latest snapshot, and every daily history entry (REQ-007).

export type CategoryKey = "perf" | "a11y" | "bp" | "seo";
export type Strategy = "mobile" | "desktop";
export type RangeDays = 3 | 7 | 30 | 90;
export const DEFAULT_RANGE_DAYS: RangeDays = 7;
export type Flag = "priority" | "watching" | "paused";
/** Baseline-relative Performance trend stored on each page. */
export type PageStatus = "stable" | "improving" | "regressing" | "pending";
export type CollectionJobKind = "baseline" | "run" | "nightly";
export type CollectionJobState =
  | "queued"
  | "dispatching"
  | "running"
  | "waiting_for_evidence"
  | "succeeded"
  | "inconclusive"
  | "failed";

export const STRATEGIES: Strategy[] = ["mobile", "desktop"];

export const CATEGORIES: { key: CategoryKey; label: string; short: string; psi: string }[] = [
  { key: "perf", label: "Performance", short: "Perf", psi: "performance" },
  { key: "a11y", label: "Accessibility", short: "A11y", psi: "accessibility" },
  { key: "bp", label: "Best Practices", short: "BP", psi: "best-practices" },
  { key: "seo", label: "SEO", short: "SEO", psi: "seo" },
];

export type ScoreByCategory = Record<CategoryKey, number>;

/** Median score for a category on a given night, with the run-to-run range retained. */
export interface CategoryScore {
  m: number; // median of the nightly runs
  lo: number; // lowest of the runs
  hi: number; // highest of the runs
}

export type NightScores = Record<CategoryKey, CategoryScore>;
/** Median+range per category, split by strategy. */
export type StrategyScores = Record<Strategy, NightScores>;

export type LighthouseFindingConfidence = "high" | "medium" | "intermittent" | "insufficient";

export type WebflowPerformanceMetric = "TBT" | "LCP" | "CLS" | "other";
export type WebflowPerformanceCulprit =
  | "global-javascript"
  | "main-thread-work"
  | "third-party-code"
  | "dom-complexity"
  | "lcp-element"
  | "global-css"
  | "image-delivery"
  | "render-blocking"
  | "custom-javascript"
  | "layout-stability"
  | "background-video"
  | "video-embeds"
  | "interactive-media"
  | "other";
export type WebflowRemediationLevel = "blocked" | "partial" | "available" | "unknown";
export type CustomerActionability = "direct" | "workaround" | "none" | "review";

/** Deterministic Webflow-specific interpretation of a Lighthouse audit. */
export interface WebflowPerformanceClassification {
  version: 1;
  metric: WebflowPerformanceMetric;
  metricWeight: 0 | 25 | 30;
  culprit: WebflowPerformanceCulprit;
  culpritLabel: string;
  remediation: WebflowRemediationLevel;
  remediationLabel: string;
  guidance: string;
  /** Customer-facing disposition. Platform ownership is evaluated separately. */
  actionability?: CustomerActionability;
  source: "published-page-performance" | "crux-field-only";
}

/** One failing Lighthouse audit normalized from a single PSI response. */
export interface LighthouseRunFinding {
  id: string;
  title: string;
  description?: string;
  category: string;
  score?: number;
  scoreDisplayMode?: string;
  savingsMs: number;
  savingsBytes: number;
  actionable: boolean;
  webflow?: WebflowPerformanceClassification;
}

/** Warnings and findings retained for one successful Lighthouse run. */
export interface LighthouseRunEvidence {
  run: number;
  warnings: string[];
  findings: LighthouseRunFinding[];
}

/** A finding aggregated across the warning-free runs for one strategy. */
export interface AggregatedLighthouseFinding extends LighthouseRunFinding {
  observedRuns: number;
  totalObservedRuns: number;
  eligibleRuns: number;
  successfulRuns: number;
  quorum: number;
  frequency: number;
  promoted: boolean;
  confidence: LighthouseFindingConfidence;
  savingsLowMs: number;
  savingsHighMs: number;
  savingsLowBytes: number;
  savingsHighBytes: number;
}

export type CulpritEvidenceUnit = "count" | "bytes" | "milliseconds" | "percent" | "pixels";

export interface CulpritEvidenceFact {
  key: string;
  label: string;
  value: number;
  unit: CulpritEvidenceUnit;
}

export interface CulpritEvidenceSource {
  /** Hostname only; paths, queries, fragments, and resource names are discarded. */
  host: string;
  transferBytes?: number;
  blockingMs?: number;
}

export interface LcpElementEvidence {
  elementType: string;
  assetHost?: string;
  width?: number;
  height?: number;
}

/** Compact, privacy-safe explanation of one recurring Lighthouse culprit. */
export interface CulpritEvidence {
  auditId: string;
  title: string;
  facts: CulpritEvidenceFact[];
  sources?: CulpritEvidenceSource[];
  lcpElement?: LcpElementEvidence;
  sampleRuns: number;
}

export type LighthouseCollectionQualityStatus = "reliable" | "low-confidence" | "unusable";

/** Compact quality metadata safe to keep in the page history read model. */
export interface LighthouseCollectionQuality {
  requestedRuns: number;
  /** All successful provider responses, including cached/replayed duplicates. */
  attemptRuns?: number;
  successfulRuns: number;
  /** Provider responses representing distinct Lighthouse measurements. */
  uniqueRuns?: number;
  duplicateRuns?: number;
  eligibleRuns: number;
  warnedRuns: number;
  failedRuns: number;
  findingsObserved: number;
  findingsPromoted: number;
  status: LighthouseCollectionQualityStatus;
}

/** A normalized, repeatable Lighthouse opportunity promoted from multiple runs. */
export interface LighthouseOpportunity {
  id: string;
  title: string;
  description?: string;
  category: string;
  savingsMs: number;
  savingsBytes?: number;
  observedRuns?: number;
  eligibleRuns?: number;
  confidence?: Extract<LighthouseFindingConfidence, "high" | "medium">;
  savingsLowMs?: number;
  savingsHighMs?: number;
  webflow?: WebflowPerformanceClassification;
}

export type NativeWebflowElementType = "background-video" | "video-embed" | "lottie" | "spline" | "image";

export interface NativeElementEvidence {
  label: string;
  count: number;
}

export type NativeElementDisposition = "acknowledged" | "suppressed";

export interface NativeElementControl {
  disposition: NativeElementDisposition;
  updatedAt: string;
}

/** Privacy-safe page-content finding for a known Webflow-native element footprint. */
export interface NativeElementFinding {
  id: string;
  element: NativeWebflowElementType;
  title: string;
  detail: string;
  count: number;
  signals: string[];
  /** Aggregate, privacy-safe evidence. Never contains HTML, URLs, selectors, or customer text. */
  evidence?: NativeElementEvidence[];
  confidence: "high" | "medium";
  webflow: WebflowPerformanceClassification;
}

export interface NativeElementScan {
  status: "available" | "unavailable";
  findings: NativeElementFinding[];
  reason?: string;
  /** Privacy-safe document-generator attribution; attribute values are never retained. */
  platform?: {
    name: "webflow";
    confidence: "high";
    signals: Array<"data-wf-site" | "data-wf-page">;
  };
  /** An experiment system may serve different variants across repeated measurements. */
  variationRisk?: {
    source: "webflow-optimize";
    confidence: "high";
    signals: ["data-wf-intellimize-customer-id"];
  };
}

/** Compact, provider-specific evidence from one rendered Kitesurf page probe. */
export interface KitesurfEvidence {
  schemaVersion: 1;
  engine: "kitesurf";
  status: "available" | "unavailable";
  capturedAt: string;
  httpStatus?: number;
  title?: string;
  renderedContentHash?: string;
  accessibilityHash?: string;
  rawReportKey?: string;
  document?: {
    domNodes: number;
    textCharacters: number;
    headings: number;
    links: number;
    buttons: number;
    forms: number;
    images: number;
    iframes: number;
    serializedHtmlCharacters: number;
    htmlRetained: boolean;
  };
  accessibility?: {
    nodes: number;
    interactiveNodes: number;
  };
  network?: {
    requests: number;
    failedRequests: number;
    errorResponses: number;
    thirdPartyHosts: number;
    resourceEntries: number;
    transferBytes: number;
  };
  runtime?: {
    consoleErrors: number;
    pageErrors: number;
  };
  /** Kitesurf-only diagnostics; never used as Chrome lab or visitor metrics. */
  diagnosticTimings?: {
    wallTimeMs: number;
    responseStartMs?: number;
    domContentLoadedMs?: number;
    loadEventMs?: number;
  };
  reason?: string;
}

/**
 * Immutable agent-readiness result captured with the ignore configuration
 * effective for one collection. Keeping this alongside the raw checks prevents
 * later settings changes from rewriting historical readiness percentages.
 */
export interface AgentReadinessSnapshot {
  pass: number;
  fail: number;
  total: number;
  unavailable: number;
  ignored: number;
  percent: number;
  ignoredCheckKeys: string[];
}

/** One night's append-only history entry (sequential storage). */
export interface Night {
  i: number; // ordinal index within the page's history
  runId?: string; // stable collection id; absent only on seed/imported records
  date: string; // display date, e.g. "Jul 16"
  iso?: string; // ISO date if produced by a real run
  scores: StrategyScores;
  /** Undefined on legacy/complete rows; otherwise identifies independently committed PSI devices. */
  availableStrategies?: Strategy[];
  /** Actual completion time for each independently committed PSI device. */
  strategyCapturedAt?: Partial<Record<Strategy, string>>;
  samples?: Partial<Record<Strategy, number>>; // per-strategy successful sample size (REQ-032)
  sampleSize?: number; // min across strategies; kept for older records / quick display
  rawReportKey?: string; // object-storage key for the full PSI payload (REQ-006)
  /** Per-device raw report keys available before a combined run report exists. */
  strategyReportKeys?: Partial<Record<Strategy, string>>;
  agent?: AgentCheck[]; // agent-readiness scan recorded for this night, so history is retained (REQ-008)
  /** Actual completion time for the independently committed agent-readiness scan. */
  agentCapturedAt?: string;
  agentReadiness?: AgentReadinessSnapshot; // immutable score using the ignore settings effective for this run
  /** Legacy mobile-only opportunity list retained for older stored history. */
  opportunities?: LighthouseOpportunity[];
  /** Load-time opportunities retained independently for both Lighthouse devices. */
  opportunitiesByStrategy?: Partial<Record<Strategy, LighthouseOpportunity[]>>;
  /** Repeatable findings, including binary and byte-only diagnostics. */
  diagnostics?: Partial<Record<Strategy, AggregatedLighthouseFinding[]>>;
  /** Median culprit details extracted from warning-free Lighthouse runs. */
  culpritEvidence?: Partial<Record<Strategy, CulpritEvidence[]>>;
  /** Device-neutral findings from the published-page HTML scan. */
  nativeElements?: NativeElementScan;
  /** Rendered, non-Chromium agent/browser evidence retained independently of PSI. */
  kitesurf?: KitesurfEvidence;
  collectionQuality?: Partial<Record<Strategy, LighthouseCollectionQuality>>;
  cohortId?: string;
  evidenceStatus?: "trusted" | "provider-anomaly";
  measurementContext?: Partial<Record<Strategy, PsiMeasurementContext>>;
}

export interface PsiMeasurementContext {
  lighthouseVersion?: string;
  medianBenchmarkIndex?: number;
  medianFirstContentfulPaint?: number;
  medianTotalBlockingTime?: number;
  medianLargestContentfulPaint?: number;
  medianSpeedIndex?: number;
  medianCumulativeLayoutShift?: number;
  medianServerResponseTime?: number;
}

export interface CollectionSchedule {
  /** IANA timezone, such as America/Chicago. */
  timeZone: string;
  /** Local 24-hour time marking the start of the daily collection window. */
  localTime: string;
  /** False only for the midnight default captured from the first user's browser. */
  overridden: boolean;
}

export interface MeasurementIncident {
  id: string;
  cohortId: string;
  status: "suspected" | "confirming" | "recovered" | "verified";
  detectedAt: string;
  affectedPageIds: string[];
  affectedPages: number;
  eligiblePages: number;
  retryAt?: string;
  confirmationCohortId?: string;
  confirmationAttempts?: number;
  recoveredAt?: string;
}

/** A user-logged (or acted-upon) change marker on a page's timeline. */
export interface ChangeMarker {
  id: string; // stable unique id (follow-ups reference this, not the text)
  i: number; // history index the marker sits at — resolved from `date`, not the latest night
  date: string;
  text: string;
  source?: "custom" | "task";
  recKey?: string;
}

/** A single agent-readiness check outcome — recorded per check, never composited (REQ-008). */
export interface AgentCheck {
  name: string;
  group: string;
  pass: boolean;
  regressed?: boolean;
  unavailable?: boolean; // scan could not reach the page (REQ-033)
  detail?: string;
}

export type AgentIgnoreScope = "check" | "group";
export type AgentIgnoreOverrideMode = "inherit" | "ignore" | "restore";

/** Agent-check applicability settings that survive future scans. */
export interface AgentIgnoreSettings {
  checks: string[];
  groups: string[];
}

export type DevicePolicy = "either" | "both" | "preferred";

/** Team-wide tolerances used to classify page-performance conditions. */
export interface PerformanceThresholds {
  /** Scores below this value are considered low Performance. */
  lowPerformance: number;
  /** Point decline required before a change is considered a regression. */
  regression: number;
  /** Point increase required before a change is considered an improvement. */
  improvement: number;
  /** Consecutive qualifying scans required before surfacing a regression. */
  confirmationRuns: number;
  /** Which device results can make a page enter a summary status. */
  devicePolicy: DevicePolicy;
  /** Scores below these values are considered low for each Lighthouse metric. */
  accessibility: number;
  bestPractices: number;
  seo: number;
  /** Ignore regressions whose latest score remains at or above this value. */
  regressionFloor: number;
  /** Agent-readiness percentages below this value are considered gaps. */
  agentReadiness: number;
  /** Completed post-baseline scans required before status classification begins. */
  newPageGraceRuns: number;
  /** Repeatable Lighthouse captures required before a finding enters Inbox. */
  minimumFindingRuns: number;
  /** Ignore quantified findings below this estimated time saving. */
  minimumSavingsMs: number;
  /** Ignore quantified findings below this estimated transfer saving. */
  minimumSavingsKilobytes: number;
}

/** Optional page-specific values layered over the team monitoring defaults. */
export type PagePerformanceThresholdOverrides = Partial<PerformanceThresholds>;

/** Legacy per-page event-delivery state retained for persisted-state compatibility. */
export interface PerformanceAlertState {
  /** Stable device/category condition used to suppress duplicate deliveries. */
  signature: string;
  strategies: Strategy[];
  categories: CategoryKey[];
  sentAt: string;
}

/** One scheduled collection cohort's at-most-once daily webhook delivery. */
export interface DailyAlertDigest {
  cohortId: string;
  date: string;
  expectedPageIds: string[];
  createdAt: string;
  attempts: number;
  claimedAt?: string;
  completedAt?: string;
  sentAt?: string;
  lastAttemptAt?: string;
  lastHttpStatus?: number;
  lastError?: string;
  retryAfterISO?: string;
}

/** A scheduled follow-up comparison after a change marker (REQ-044). */
export interface FollowUp {
  id: string; // stable delivery id so one attempt can be committed atomically
  pageId: string;
  markerId: string; // unique marker reference (lookup no longer relies on text)
  markerText: string; // retained for the Slack message
  markerDate: string;
  interval: "2d" | "7d" | "30d";
  dueISO: string;
  sent: boolean;
  attempts?: number; // delivery attempts; a failed send is retried, not consumed (REQ-045)
  lastAttemptISO?: string;
  lastHttpStatus?: number;
  lastError?: string;
  retryAfterISO?: string;
}

/** A watchlisted page and everything tracked about it. */
export interface WatchPage {
  id: string;
  title: string;
  url: string;
  flag: Flag;
  status: PageStatus;
  baseline?: StrategyScores; // exists only after explicit baseline capture
  current: Record<Strategy, ScoreByCategory>; // latest snapshot median per category, per strategy
  history: Night[];
  markers: ChangeMarker[];
  agent: AgentCheck[]; // latest agent-readiness scan (per-check)
  agentIgnores?: AgentIgnoreSettings; // page-specific ignores, applied after global defaults
  agentIgnoreRestores?: AgentIgnoreSettings; // page-specific restores of globally ignored checks/categories
  /** Sparse page-specific calibration; omitted values inherit team defaults. */
  performanceThresholdOverrides?: PagePerformanceThresholdOverrides;
  /** Legacy event-alert state; daily digests use AppState.alertDigests. */
  performanceAlertState?: PerformanceAlertState;
  /** Page-scoped triage controls keyed by stable native-element finding id. */
  nativeElementControls?: Record<string, NativeElementControl>;
  baselineCapturedAt?: string;
  acted?: Record<string, boolean>;
  // Async collection state (REQ-054): a run is queued/executed in the
  // background; the client polls until it settles. Undefined == idle.
  runState?: "queued" | "dispatching" | "running" | "waiting_for_evidence" | "failed";
  runId?: string; // active or most-recent on-demand/nightly collection id
  startedAt?: string;
  lastRunAt?: string;
  /** Independent successful completion time for each PSI device. */
  lastPsiRunAt?: Partial<Record<Strategy, string>>;
  /** Independent successful completion time for agent readiness. */
  lastAgentRunAt?: string;
  lastScheduledAt?: string;
  collectionOffsetMinutes?: number;
  lastCollectionStatus?: "trusted" | "partial" | "inconclusive";
  lastError?: string;
}

/** Durable collection lifecycle surfaced to both the UI and the external collector. */
export interface CollectionJob {
  id: string;
  runId: string;
  pageId: string;
  kind: CollectionJobKind;
  state: CollectionJobState;
  attempts: number;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  completedAt?: string;
  workflowId?: string;
  cohortId?: string;
  /** Strategies already retained in R2 while the other device is still retrying. */
  completedStrategies?: Strategy[];
  /** Total provider attempts made for each device in the current Workflow. */
  strategyAttempts?: Partial<Record<Strategy, number>>;
  /** Latest provider error for each device that still needs evidence. */
  strategyErrors?: Partial<Record<Strategy, string>>;
  cruxCompletedAt?: string;
  cruxError?: string;
  agentCompletedAt?: string;
  agentError?: string;
  /** Durable wake-up time for a Workflow waiting on any missing independent test. */
  nextRetryAt?: string;
  error?: string;
  enrichedAt?: string;
  enrichmentError?: string;
  notifiedAt?: string;
  notificationError?: string;
  finalizationStartedAt?: string;
}

/** Versioned, provider-neutral result committed by a collector job. */
export interface CollectionResult {
  schemaVersion: 1 | 2;
  jobId: string;
  runId: string;
  pageId: string;
  capturedAt: string;
  scores: StrategyScores;
  samples: Record<Strategy, number>;
  agent: AgentCheck[];
  /** Legacy mobile-only list accepted from version-one collectors. */
  opportunities: LighthouseOpportunity[];
  opportunitiesByStrategy?: Partial<Record<Strategy, LighthouseOpportunity[]>>;
  diagnostics?: Partial<Record<Strategy, AggregatedLighthouseFinding[]>>;
  culpritEvidence?: Partial<Record<Strategy, CulpritEvidence[]>>;
  nativeElements?: NativeElementScan;
  kitesurf?: KitesurfEvidence;
  collectionQuality?: Partial<Record<Strategy, LighthouseCollectionQuality>>;
  cohortId?: string;
  measurementContext?: Partial<Record<Strategy, PsiMeasurementContext>>;
}

export type RecStatus = "inbox" | "task" | "ignored";
export type TaskStatus = "todo" | "in-progress" | "done";
export type RecommendationSource = "lighthouse" | "native-elements" | "crux-field-only";
export type FieldOnlyMetricKey = "lcp" | "responsiveness" | "cls" | "ttfb";

/** Exact-URL visitor evidence retained on a synthetic field-only recommendation. */
export interface FieldOnlyRecommendationSignal {
  metricKey: FieldOnlyMetricKey;
  metricLabel: string;
  relationship: "direct" | "proxy";
  labLabel: string;
  labFormatted: string;
  fieldLabel: string;
  fieldValue: number;
  fieldFormatted: string;
  fieldRating: "Needs improvement" | "Poor";
  scope: "url";
  collectionStart: string;
  collectionEnd: string;
  detectedAt: string;
}

export type FieldOnlyLifecycleStatus = "active" | "verifying" | "resolved" | "corroborated" | "regressed";

export interface FieldOnlyStrategyLifecycle {
  status: FieldOnlyLifecycleStatus;
  firstDetectedAt: string;
  lastDetectedAt: string;
  lastEvaluatedCollectionEnd: string;
  consecutiveGoodWindows: number;
  resolvedAt?: string;
  returnedAt?: string;
}

/** A recommendation that flows Inbox -> Task, unified as in the source design (REQ-047). */
export interface Rec {
  key: string; // `${pageId}:${id}`
  pageId: string;
  pageTitle: string;
  url: string;
  id: string; // recommendation id (stable per audit)
  /** Evidence system that created this recommendation. Legacy records omit it. */
  source?: RecommendationSource;
  /** Devices on which this recommendation was independently promoted. */
  strategies?: Strategy[];
  /** Per-device evidence for recommendations created from visitor-only CrUX signals. */
  fieldSignals?: Partial<Record<Strategy, FieldOnlyRecommendationSignal>>;
  /** Per-device lifecycle; two distinct good CrUX windows confirm resolution. */
  fieldLifecycle?: Partial<Record<Strategy, FieldOnlyStrategyLifecycle>>;
  sourceRunId?: string;
  title: string;
  category: string;
  webflow?: WebflowPerformanceClassification;
  savings: string; // Lighthouse load-time estimate, e.g. "1.8 s"
  estTime: string; // coarse effort band, e.g. "2 days" (REQ-055)
  status: RecStatus;
  taskStatus: TaskStatus;
  added: string;
  doneDate: string | null;
  aiSummary?: string; // Claude-written plain-English explanation, generated once when the rec is created
}

/** A failing Lighthouse audit / opportunity shown on the page detail. */
export interface Audit {
  id: string;
  title: string;
  desc: string;
  category: string;
  savings: string;
  dot: string;
  evidence?: string;
  confidence?: LighthouseFindingConfidence;
  webflow: WebflowPerformanceClassification;
}

/** The Watcher's Claude-written dashboard narrative, refreshed once per nightly run. */
export interface WatcherNote {
  text: string;
  generatedAt: string; // ISO
  /** Guards the UI from showing prose generated with an obsolete summary model. */
  modelVersion?: number;
}

/** Server-owned project metadata persisted in the private admin tenant. */
export interface ManagedProjectRecord {
  id: string;
  name: string;
  customer?: string;
  tenant: string;
  createdAt: string;
  archivedAt?: string;
}

export type ProjectRole = "project_admin" | "project_viewer";

/** Mutable app-admin grants. Bootstrap admins live in code and never appear here. */
export interface AppAdminGrant {
  email: string;
  invitedBy: string;
  invitedAt: string;
}

/** One email's explicit access to one project. App admins do not need records. */
export interface ProjectMembership {
  projectId: string;
  email: string;
  role: ProjectRole;
  invitedBy: string;
  invitedAt: string;
}

/** The full application state — the single source of truth persisted per tenant. */
export interface AppState {
  /** Internal persistence marker: page histories are stored in the tenant-keyed history table. */
  historyStorageVersion?: 1;
  /** Project-level archive marker. Archived tenants retain data but reject collection work. */
  projectArchivedAt?: string;
  /** Monitoring flags captured before archiving so restore can reinstate the watchlist exactly. */
  projectArchivePageFlags?: Record<string, Flag>;
  pages: WatchPage[];
  recs: Rec[];
  /** Workspace-owned HTTPS endpoint for confirmed performance-regression alerts. */
  alertWebhookUrl?: string | null;
  /** Recent scheduled digest claims/deliveries, retained for idempotency and retries. */
  alertDigests?: DailyAlertDigest[];
  /** Presentation-only feature flag. CrUX collection continues while hidden. */
  visitorExperienceVisible?: boolean;
  agentIgnoreDefaults?: AgentIgnoreSettings;
  performanceThresholds?: PerformanceThresholds;
  collectionSchedule?: CollectionSchedule;
  measurementIncident?: MeasurementIncident;
  jobs?: CollectionJob[];
  followUps?: FollowUp[];
  watcherNote?: WatcherNote;
  /** Present only in the private admin registry state, never in project state. */
  managedProjects?: ManagedProjectRecord[];
  /** Present only in the private admin registry state. */
  appAdmins?: AppAdminGrant[];
  /** Present only in the private admin registry state. */
  projectMemberships?: ProjectMembership[];
}

export const TENANT = "brand-studio" as const;
export type Tenant = string;
