// Domain types for the Page Performance Dashboard.
//
// Category keys use the dashboard's short internal names (perf/a11y/bp/seo);
// the PSI client maps Lighthouse category ids onto these (see lib/psi.ts).
// Scores are recorded PER STRATEGY (mobile + desktop) throughout — baseline,
// latest snapshot, and every daily history entry (REQ-007).

export type CategoryKey = "perf" | "a11y" | "bp" | "seo";
export type Strategy = "mobile" | "desktop";
export type Flag = "priority" | "watching";
export type PageStatus = "healthy" | "improvable" | "degraded";

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

/** One night's append-only history entry (sequential storage). */
export interface Night {
  i: number; // ordinal index within the page's history
  date: string; // display date, e.g. "Jul 16"
  iso?: string; // ISO date if produced by a real run
  scores: StrategyScores;
  sampleSize?: number; // how many of the 5 runs succeeded (REQ-032)
  rawReportKey?: string; // object-storage key for the full PSI payload (REQ-006)
}

/** A user-logged (or acted-upon) change marker on a page's timeline. */
export interface ChangeMarker {
  i: number; // history index the marker sits at
  date: string;
  text: string;
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

/** A scheduled follow-up comparison after a change marker (REQ-044). */
export interface FollowUp {
  pageId: string;
  markerText: string;
  markerDate: string;
  interval: "2d" | "7d" | "30d";
  dueISO: string;
  sent: boolean;
}

/** A watchlisted page and everything tracked about it. */
export interface WatchPage {
  id: string;
  title: string;
  url: string;
  flag: Flag;
  status: PageStatus;
  baseline: StrategyScores; // baseline median+range per category, per strategy
  current: Record<Strategy, ScoreByCategory>; // latest snapshot median per category, per strategy
  history: Night[];
  markers: ChangeMarker[];
  agent: AgentCheck[]; // latest agent-readiness scan (per-check)
  baselineCapturedAt?: string;
  acted?: Record<string, boolean>;
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
}

/** The full application state — the single source of truth persisted per tenant. */
export interface AppState {
  pages: WatchPage[];
  recs: Rec[];
  followUps?: FollowUp[];
  watcherNote?: WatcherNote;
}

export const TENANT = "brand-studio" as const;
export type Tenant = string;
