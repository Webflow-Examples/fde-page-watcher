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
  observedRuns?: number;
  eligibleRuns?: number;
  confidence?: Extract<LighthouseFindingConfidence, "high" | "medium">;
  savingsLowMs?: number;
  savingsHighMs?: number;
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
  samples?: Partial<Record<Strategy, number>>; // per-strategy successful sample size (REQ-032)
  sampleSize?: number; // min across strategies; kept for older records / quick display
  rawReportKey?: string; // object-storage key for the full PSI payload (REQ-006)
  agent?: AgentCheck[]; // agent-readiness scan recorded for this night, so history is retained (REQ-008)
  agentReadiness?: AgentReadinessSnapshot; // immutable score using the ignore settings effective for this run
  opportunities?: LighthouseOpportunity[]; // real Lighthouse opportunities for this capture
  collectionQuality?: Partial<Record<Strategy, LighthouseCollectionQuality>>;
  cohortId?: string;
  evidenceStatus?: "trusted" | "provider-anomaly";
  measurementContext?: Partial<Record<Strategy, PsiMeasurementContext>>;
}

export interface PsiMeasurementContext {
  lighthouseVersion?: string;
  medianBenchmarkIndex?: number;
  medianTotalBlockingTime?: number;
  medianLargestContentfulPaint?: number;
  medianSpeedIndex?: number;
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
  baselineCapturedAt?: string;
  acted?: Record<string, boolean>;
  // Async collection state (REQ-054): a run is queued/executed in the
  // background; the client polls until it settles. Undefined == idle.
  runState?: "queued" | "dispatching" | "running" | "waiting_for_evidence" | "failed";
  runId?: string; // active or most-recent on-demand/nightly collection id
  startedAt?: string;
  lastRunAt?: string;
  lastScheduledAt?: string;
  collectionOffsetMinutes?: number;
  lastCollectionStatus?: "trusted" | "inconclusive";
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
  opportunities: LighthouseOpportunity[];
  collectionQuality?: Partial<Record<Strategy, LighthouseCollectionQuality>>;
  cohortId?: string;
  measurementContext?: Partial<Record<Strategy, PsiMeasurementContext>>;
}

export type RecStatus = "inbox" | "task" | "ignored";
export type TaskStatus = "todo" | "in-progress" | "done";

/** A recommendation that flows Inbox -> Task, unified as in the source design (REQ-047). */
export interface Rec {
  key: string; // `${pageId}:${id}`
  pageId: string;
  pageTitle: string;
  url: string;
  id: string; // recommendation id (stable per audit)
  sourceRunId?: string;
  title: string;
  category: string;
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
  title: string;
  desc: string;
  category: string;
  savings: string;
  dot: string;
}

/** The Watcher's Claude-written dashboard narrative, refreshed once per nightly run. */
export interface WatcherNote {
  text: string;
  generatedAt: string; // ISO
  /** Guards the UI from showing prose generated with an obsolete summary model. */
  modelVersion?: number;
}

/** The full application state — the single source of truth persisted per tenant. */
export interface AppState {
  pages: WatchPage[];
  recs: Rec[];
  /** Presentation-only feature flag. CrUX collection continues while hidden. */
  visitorExperienceVisible?: boolean;
  agentIgnoreDefaults?: AgentIgnoreSettings;
  performanceThresholds?: PerformanceThresholds;
  collectionSchedule?: CollectionSchedule;
  measurementIncident?: MeasurementIncident;
  jobs?: CollectionJob[];
  followUps?: FollowUp[];
  watcherNote?: WatcherNote;
}

export const TENANT = "brand-studio" as const;
export type Tenant = string;
