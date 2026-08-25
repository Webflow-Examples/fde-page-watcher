import type { AgentCheck, CategoryKey, Night, PageStatus, PerformanceThresholds, RangeDays, ScoreByCategory, Strategy, WatchPage } from "./types";
import type { Tone, Trend } from "./vocabulary";
import { TREND_LABEL } from "./vocabulary";
import { deltaTrend } from "./scoreCard";

// ── Score band, trend, and delta ──────────────────────────────────────────
//
// Nothing in this file names a colour value. The one place colour values are
// named is the token block in `globals.css`; these helpers return token NAMES,
// vocabulary terms, and numbers, and the caller decides how to paint them.
//
// Three different questions used to arrive here as one hue:
//
//   scoreMeta   "is this good right now?"  -> a health band (R1: hue)
//   statusMeta  "which way is it moving?"  -> a Trend, for <TrendArrow>  (R2: shape)
//   deltaMeta   "by how much?"             -> a number, for <Magnitude>  (R3: weight)
//
// statusMeta and deltaMeta answered the second question in green/amber/red,
// which put a direction into the same visual vocabulary as a verdict — an
// improving arrow and a poor score are both true at once, and painting both
// made them argue. Neither returns colour any more.

/** The three Lighthouse score bands. */
export type ScoreBand = "good" | "warn" | "poor";

/**
 * Token names as closed unions, so a caller cannot quietly widen one back to
 * an arbitrary colour string — that is a compile error now.
 */
export type HealthTextToken = `--health-${ScoreBand}-text`;
export type HealthBgToken = `--health-${ScoreBand}-bg`;
export type HealthBorderToken = `--health-${ScoreBand}-border`;

/** A token name wrapped ready to use as a CSS value. */
export type CssVar<Token extends string> = `var(${Token})`;

/**
 * Token NAMES. `fg`/`line` are the text token, `bg` the ground, `ring` the
 * border. These are names, not CSS values: `color: scoreMeta(v).fg` renders
 * nothing. Use `scoreMetaVars` when assigning straight into a style object.
 */
export interface ScoreMeta {
  readonly band: ScoreBand;
  readonly fg: HealthTextToken;
  readonly line: HealthTextToken;
  readonly bg: HealthBgToken;
  readonly ring: HealthBorderToken;
}

/** The same band, ready to drop into a style object or a template literal. */
export interface ScoreMetaVars {
  readonly band: ScoreBand;
  readonly fg: CssVar<HealthTextToken>;
  readonly line: CssVar<HealthTextToken>;
  readonly bg: CssVar<HealthBgToken>;
  readonly ring: CssVar<HealthBorderToken>;
}

const SCORE_META: Record<ScoreBand, ScoreMeta> = {
  good: { band: "good", fg: "--health-good-text", line: "--health-good-text", bg: "--health-good-bg", ring: "--health-good-border" },
  warn: { band: "warn", fg: "--health-warn-text", line: "--health-warn-text", bg: "--health-warn-bg", ring: "--health-warn-border" },
  poor: { band: "poor", fg: "--health-poor-text", line: "--health-poor-text", bg: "--health-poor-bg", ring: "--health-poor-border" },
};

const SCORE_META_VARS: Record<ScoreBand, ScoreMetaVars> = {
  good: { band: "good", fg: "var(--health-good-text)", line: "var(--health-good-text)", bg: "var(--health-good-bg)", ring: "var(--health-good-border)" },
  warn: { band: "warn", fg: "var(--health-warn-text)", line: "var(--health-warn-text)", bg: "var(--health-warn-bg)", ring: "var(--health-warn-border)" },
  poor: { band: "poor", fg: "var(--health-poor-text)", line: "var(--health-poor-text)", bg: "var(--health-poor-bg)", ring: "var(--health-poor-border)" },
};

/** Lighthouse score bands: >=90 good, >=50 needs work, else poor. */
export function scoreBand(v: number): ScoreBand {
  return v >= 90 ? "good" : v >= 50 ? "warn" : "poor";
}

/** The health band for a score, as token names. */
export function scoreMeta(v: number): ScoreMeta {
  return SCORE_META[scoreBand(v)];
}

/** The health band for a score, as ready-to-use `var(...)` values. */
export function scoreMetaVars(v: number): ScoreMetaVars {
  return SCORE_META_VARS[scoreBand(v)];
}

/**
 * The accessibility shape that rides along with a direction (REQ-009).
 * Redundancy for the arrow, never a substitute for the label.
 */
export type StatusShapeName = "circle" | "triangle" | "square";

/**
 * A `PageStatus` is two different things wearing one name.
 *
 * `improving` / `stable` / `regressing` are directions, so they come back as
 * an F1 `Trend` for `<TrendArrow>` to render. `pending` is not a fourth
 * direction — it means no verdict has been reached yet — so it comes back as
 * a tone NAME the caller renders as a neutral chip
 * (`--status-neutral-text` on `--status-neutral-bg`).
 *
 * The `kind` discriminant is what stops a caller collapsing the two back into
 * one free-form string and colouring it.
 */
export type StatusMeta =
  | {
    readonly kind: "trend";
    readonly trend: Trend;
    readonly label: string;
    readonly shape: StatusShapeName;
  }
  | {
    readonly kind: "pending";
    readonly tone: Extract<Tone, "neutral">;
    readonly label: string;
    readonly shape: StatusShapeName;
  };

const TREND_SHAPE: Record<Trend, StatusShapeName> = {
  improving: "triangle",
  no_change: "circle",
  regressing: "square",
};

/**
 * Arrow glyphs for a direction. Kept in step with the `TREND_GLYPH` map in
 * `src/components/trend-arrow.tsx`, which is the one renderer — this copy
 * exists only so `deltaMeta().text` can stay a plain string. If the two ever
 * need to change, the honest fix is to hoist one map into `vocabulary.ts`
 * (chunk F1 owns that file).
 */
export const TREND_ARROW: Record<Trend, string> = {
  improving: "↑",
  no_change: "→",
  regressing: "↓",
};

/** Direction of the score line, with its label and shape. Never a colour. */
export function statusMeta(st: PageStatus): StatusMeta {
  if (st === "pending") {
    return { kind: "pending", tone: "neutral", label: "Pending", shape: "circle" };
  }
  const trend: Trend = st === "improving" ? "improving" : st === "regressing" ? "regressing" : "no_change";
  return { kind: "trend", trend, label: TREND_LABEL[trend], shape: TREND_SHAPE[trend] };
}

/**
 * A score delta: direction plus size, with no hue anywhere.
 *
 * The old version also returned a red/amber split at `DROP_THRESHOLD`. That
 * severity judgment was only ever expressed as a colour, and R3 puts size in
 * the numeral's weight; `d` is returned signed, so any caller that still needs
 * the distinction can compare it against the exported `DROP_THRESHOLD`.
 */
export interface DeltaMeta {
  readonly trend: Trend;
  readonly arrow: string;
  /** Arrow plus the unsigned size, e.g. "↑ 3". */
  readonly text: string;
  /** Signed delta. */
  readonly d: number;
}

export function deltaMeta(cur: number, base: number): DeltaMeta {
  const d = cur - base;
  const trend = deltaTrend(d);
  const arrow = TREND_ARROW[trend];
  return { trend, arrow, text: `${arrow} ${Math.abs(d)}`, d };
}

// ── Statistics (real backend) ─────────────────────────────────────────────

export function median(nums: number[]): number {
  if (nums.length === 0) return 0;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
}

export function range(nums: number[]): { lo: number; hi: number } {
  return { lo: Math.min(...nums), hi: Math.max(...nums) };
}

/** Legacy rows contain both devices; new rows explicitly identify the devices that actually completed. */
export function nightHasStrategy(night: Night, strategy: Strategy): boolean {
  return night.availableStrategies === undefined || night.availableStrategies.includes(strategy);
}

export function historyForStrategy(history: Night[], strategy: Strategy): Night[] {
  return history.filter((night) => nightHasStrategy(night, strategy));
}

/** Median series for a category over the last `days` nights, for one strategy. */
export function categorySeries(history: Night[], strategy: Strategy, key: CategoryKey, days: number): number[] {
  return historyForStrategy(history, strategy).slice(-days).map((n) => n.scores[strategy][key].m);
}

/** Collections inside a real calendar range; undated demo data uses one point per day. */
export function historyForRange(history: Night[], days: RangeDays, now = Date.now()): Night[] {
  const hasLiveHistory = history.some((night) => night.iso && Number.isFinite(Date.parse(night.iso)));
  if (!hasLiveHistory) return history.slice(-days);
  const cutoff = now - days * 24 * 60 * 60 * 1000;
  return history.filter((night) => {
    const recordedAt = night.iso ? Date.parse(night.iso) : Number.NaN;
    return Number.isFinite(recordedAt) && recordedAt >= cutoff && recordedAt <= now;
  });
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Successful collections in the non-overlapping range immediately before the selected range. */
export function historyForPreviousRange(history: Night[], days: RangeDays, now = Date.now()): Night[] {
  const hasLiveHistory = history.some((night) => night.iso && Number.isFinite(Date.parse(night.iso)));
  if (!hasLiveHistory) return history.slice(-(days * 2), -days);

  const currentRangeStartsAt = now - days * DAY_MS;
  const previousRangeStartsAt = now - days * 2 * DAY_MS;
  return history.filter((night) => {
    const recordedAt = night.iso ? Date.parse(night.iso) : Number.NaN;
    return Number.isFinite(recordedAt) && recordedAt >= previousRangeStartsAt && recordedAt < currentRangeStartsAt;
  });
}

export interface PreviousPeriodMedian {
  value: number;
  sampleCount: number;
  days: RangeDays;
}

/**
 * Median for the immediately preceding range. The reference stays hidden until
 * that range contains at least one successful collection per selected day.
 */
export function previousPeriodMedian(
  history: Night[],
  strategy: Strategy,
  key: CategoryKey,
  days: RangeDays,
  now = Date.now(),
): PreviousPeriodMedian | null {
  const previousHistory = historyForPreviousRange(historyForStrategy(history, strategy), days, now);
  if (previousHistory.length < days) return null;
  return {
    value: median(previousHistory.map((night) => night.scores[strategy][key].m)),
    sampleCount: previousHistory.length,
    days,
  };
}

export interface RangeComparison {
  from: number;
  to: number;
  delta: number;
  windowSize: number;
}

/** Compare the oldest and newest non-overlapping three-night medians in a range. */
export function rangeComparison(history: Night[], strategy: Strategy, key: CategoryKey): RangeComparison | null {
  history = historyForStrategy(history, strategy);
  if (history.length < 2) return null;
  const windowSize = Math.min(3, Math.floor(history.length / 2));
  const from = median(history.slice(0, windowSize).map((night) => night.scores[strategy][key].m));
  const to = median(history.slice(-windowSize).map((night) => night.scores[strategy][key].m));
  return { from, to, delta: to - from, windowSize };
}

/**
 * Compact status charts start at the explicit baseline and exclude earlier
 * exploratory runs. Seed/demo history has no ISO timestamps, so it retains
 * its original full-series behavior.
 */
export function categoryTrendSeries(
  history: Night[],
  strategy: Strategy,
  key: CategoryKey,
  days: number,
  baseline?: number,
  baselineCapturedAt?: string,
): number[] {
  history = historyForStrategy(history, strategy);
  const capturedAt = baselineCapturedAt && /^\d{4}-\d{2}-\d{2}T/.test(baselineCapturedAt)
    ? Date.parse(baselineCapturedAt)
    : Number.NaN;
  const hasLiveHistory = history.some((night) => night.iso && Number.isFinite(Date.parse(night.iso)));
  if (baseline === undefined || !Number.isFinite(capturedAt) || !hasLiveHistory) {
    return categorySeries(history, strategy, key, days);
  }

  const afterBaseline = history.filter((night) => {
    const captured = night.iso ? Date.parse(night.iso) : Number.NaN;
    return Number.isFinite(captured) && captured > capturedAt;
  });
  const laterPoints = days > 1 ? categorySeries(afterBaseline, strategy, key, days - 1) : [];
  return [baseline, ...laterPoints];
}

/**
 * A page's historical noise band for a category (one strategy): how much the
 * median naturally wobbles night to night. Mean absolute run-to-run delta,
 * floored so a flat history still tolerates normal PSI jitter.
 */
export function noiseBand(history: Night[], strategy: Strategy, key: CategoryKey): number {
  history = historyForStrategy(history, strategy);
  const meds = history.map((n) => n.scores[strategy][key].m);
  if (meds.length < 2) return 5;
  let sum = 0;
  for (let i = 1; i < meds.length; i++) sum += Math.abs(meds[i] - meds[i - 1]);
  return Math.max(4, Math.round((sum / (meds.length - 1)) * 2));
}

/** Typical within-night PSI spread, used to judge selected-range movement. */
export function rangeNoiseBand(history: Night[], strategy: Strategy, key: CategoryKey): number {
  history = historyForStrategy(history, strategy);
  const halfRanges = history.map((night) => {
    const score = night.scores[strategy][key];
    return Math.ceil((score.hi - score.lo) / 2);
  });
  return Math.max(4, median(halfRanges));
}

/** Points below baseline that count as a real drop rather than noise. */
export const DROP_THRESHOLD = 8;

export type TrendTolerances = Pick<
  PerformanceThresholds,
  "regression" | "improvement" | "confirmationRuns" | "regressionFloor" | "newPageGraceRuns"
>;

const DEFAULT_TREND_TOLERANCES: TrendTolerances = {
  regression: DROP_THRESHOLD,
  improvement: 1,
  confirmationRuns: 1,
  regressionFloor: 100,
  newPageGraceRuns: 0,
};

function trendTolerances(
  value: number | Partial<TrendTolerances> | undefined,
  confirmationRuns = DEFAULT_TREND_TOLERANCES.confirmationRuns,
): TrendTolerances {
  if (typeof value === "number") {
    return { ...DEFAULT_TREND_TOLERANCES, regression: value, confirmationRuns };
  }
  return { ...DEFAULT_TREND_TOLERANCES, ...value };
}

function hasConfirmedDrop(
  history: Night[],
  strategy: Strategy,
  key: CategoryKey,
  reference: number,
  tolerances: TrendTolerances,
): boolean {
  history = historyForStrategy(history, strategy);
  if (history.length < tolerances.confirmationRuns) return false;
  return history.slice(-tolerances.confirmationRuns).every((night) => {
    const score = night.scores[strategy][key].m;
    return reference - score >= tolerances.regression && score < tolerances.regressionFloor;
  });
}

/**
 * Classify the latest Performance result relative to its stored baseline.
 * This is deliberately a trend, not an overall health score: absolute quality
 * is communicated independently by each metric's Lighthouse health band.
 *  - improving: above baseline by more than normal historical noise.
 *  - regressing: below baseline by more than normal historical noise.
 *  - stable: within the historical noise band.
 */
export function classifyStatus(
  baselineMedian: ScoreByCategory,
  history: Night[],
  strategy: Strategy,
  key: CategoryKey = "perf",
  toleranceInput: number | Partial<TrendTolerances> = DROP_THRESHOLD,
): PageStatus {
  history = historyForStrategy(history, strategy);
  if (history.length === 0) return "stable";
  const tolerances = trendTolerances(toleranceInput);
  if (history.length < tolerances.newPageGraceRuns) return "pending";
  const base = baselineMedian[key];
  // The point being classified cannot also teach us what "normal" noise is;
  // otherwise a new jump inflates its own tolerance and hides the change.
  const band = noiseBand(history.slice(0, -1), strategy, key);
  const last = history[history.length - 1].scores[strategy][key].m;
  if (last - base >= tolerances.improvement && last - base > band) return "improving";
  if (hasConfirmedDrop(history, strategy, key, base, tolerances)) return "regressing";
  return "stable";
}

/** Persistent drops retain a stricter threshold for outbound alerting. */
export function hasPersistentRegression(
  baselineMedian: ScoreByCategory,
  history: Night[],
  strategy: Strategy,
  key: CategoryKey = "perf",
  toleranceInput: number | Partial<TrendTolerances> = DROP_THRESHOLD,
): boolean {
  history = historyForStrategy(history, strategy);
  const tolerances = trendTolerances(toleranceInput, 2);
  if (history.length < Math.max(tolerances.newPageGraceRuns, tolerances.confirmationRuns)) return false;
  const base = baselineMedian[key];
  return hasConfirmedDrop(history, strategy, key, base, tolerances);
}

function postBaselineHistory(
  page: WatchPage,
  includeProviderAnomalies = false,
  strategy?: Strategy,
): Night[] {
  const baselineCapturedAt = page.baselineCapturedAt ?? "";
  const capturedAt = /^\d{4}-\d{2}-\d{2}T/.test(baselineCapturedAt)
    ? Date.parse(baselineCapturedAt)
    : Number.NaN;
  const hasLiveHistory = page.history.some((night) => night.iso && Number.isFinite(Date.parse(night.iso)));
  const trustedHistory = includeProviderAnomalies
    ? page.history
    : page.history.filter((night) => night.evidenceStatus !== "provider-anomaly");
  const postBaseline = Number.isFinite(capturedAt) && hasLiveHistory
    ? trustedHistory.filter((night) => {
      const recordedAt = night.iso ? Date.parse(night.iso) : Number.NaN;
      return Number.isFinite(recordedAt) && recordedAt > capturedAt;
    })
    : trustedHistory;
  return strategy ? historyForStrategy(postBaseline, strategy) : postBaseline;
}

/** Range-limited monitoring history, excluding exploratory runs before baseline. */
export function pageHistoryForRange(page: WatchPage, days: RangeDays, now = Date.now()): Night[] {
  if (!page.baseline || !page.baselineCapturedAt) return [];
  return historyForRange(postBaselineHistory(page), days, now);
}

/**
 * Every recorded collection in the selected range, including quarantined PSI
 * measurements. Use this only for provenance displays; scoring and status
 * calculations must continue to use pageHistoryForRange.
 */
export function pageRecordedHistoryForRange(page: WatchPage, days: RangeDays, now = Date.now()): Night[] {
  return historyForRange(page.history, days, now);
}

/** Independent agent/readiness evidence does not require a successful PSI baseline. */
export function pageAgentHistoryForRange(page: WatchPage, days: RangeDays, now = Date.now()): Night[] {
  return historyForRange(page.history, days, now).filter((night) =>
    Array.isArray(night.agent) || !!night.agentReadiness || !!night.kitesurf);
}

/** Previous-period chart reference for one device and metric. */
export function pagePreviousPeriodMedian(
  page: WatchPage,
  strategy: Strategy,
  key: CategoryKey,
  days: RangeDays,
  now = Date.now(),
): PreviousPeriodMedian | null {
  if (!page.baseline || !page.baselineCapturedAt) return null;
  return previousPeriodMedian(postBaselineHistory(page, false, strategy), strategy, key, days, now);
}

/** Latest recorded collection inside the selected range. */
export function pageRangeLatestNight(page: WatchPage, days: RangeDays, now = Date.now()): Night | null {
  return pageHistoryForRange(page, days, now).at(-1) ?? null;
}

export function pageRangeLatestNightForStrategy(
  page: WatchPage,
  days: RangeDays,
  strategy: Strategy,
  now = Date.now(),
): Night | null {
  return historyForStrategy(pageHistoryForRange(page, days, now), strategy).at(-1) ?? null;
}

/** Latest median for one category inside the selected range. */
export function pageRangeLatestScore(
  page: WatchPage,
  strategy: Strategy,
  key: CategoryKey,
  days: RangeDays,
  now = Date.now(),
): number | null {
  return pageRangeLatestNightForStrategy(page, days, strategy, now)?.scores[strategy][key].m ?? null;
}

export interface PageAgentSnapshot {
  checks: AgentCheck[];
  date: string;
}

/**
 * Latest agent-readiness scan inside the selected range.
 *
 * Older imported/demo histories did not retain checks per night. For those
 * pages only, fall back to the page-level snapshot so the legacy data remains
 * useful. Once per-night agent history exists, an empty range stays empty.
 */
export function pageAgentSnapshotForRange(
  page: WatchPage,
  days: RangeDays,
  now = Date.now(),
): PageAgentSnapshot | null {
  const rangeHistory = pageAgentHistoryForRange(page, days, now);
  const night = [...rangeHistory].reverse().find((entry) => Array.isArray(entry.agent));
  if (night) return { checks: night.agent ?? [], date: night.date };

  const hasRecordedAgentHistory = page.history.some((entry) => Array.isArray(entry.agent));
  if (hasRecordedAgentHistory || page.agent.length === 0) return null;

  return {
    checks: page.agent,
    date: page.history.at(-1)?.date ?? "latest collection",
  };
}

export function pageRangeComparison(
  page: WatchPage,
  strategy: Strategy,
  key: CategoryKey,
  days: RangeDays,
  now = Date.now(),
): RangeComparison | null {
  return rangeComparison(pageHistoryForRange(page, days, now), strategy, key);
}

export function pageRangeSeries(
  page: WatchPage,
  strategy: Strategy,
  key: CategoryKey,
  days: RangeDays,
  now = Date.now(),
): number[] {
  return historyForStrategy(pageHistoryForRange(page, days, now), strategy)
    .map((night) => night.scores[strategy][key].m);
}

/** Display trend across the selected range, independent of the original baseline score. */
export function pageRangeTrend(
  page: WatchPage,
  strategy: Strategy,
  days: RangeDays,
  toleranceInput: number | Partial<TrendTolerances> = DROP_THRESHOLD,
  now = Date.now(),
): PageStatus {
  const tolerances = trendTolerances(toleranceInput);
  if (postBaselineHistory(page, false, strategy).length < tolerances.newPageGraceRuns) return "pending";
  const history = historyForStrategy(pageHistoryForRange(page, days, now), strategy);
  const comparison = rangeComparison(history, strategy, "perf");
  if (!comparison) return "pending";
  const band = rangeNoiseBand(history, strategy, "perf");
  if (comparison.delta >= tolerances.improvement && comparison.delta > band) return "improving";
  if (hasConfirmedDrop(history, strategy, "perf", comparison.from, tolerances)) return "regressing";
  return "stable";
}

/** Derive the display trend for the currently selected strategy. */
export function pageTrend(
  page: WatchPage,
  strategy: Strategy,
  toleranceInput: number | Partial<TrendTolerances> = DROP_THRESHOLD,
): PageStatus {
  if (!page.baseline || !page.baselineCapturedAt) return "pending";
  return classifyStatus(mediansOf(page.baseline[strategy]), postBaselineHistory(page, false, strategy), strategy, "perf", toleranceInput);
}

/** Apply the alert threshold only to collections recorded after the baseline. */
export function pageHasPersistentRegression(
  page: WatchPage,
  strategy: Strategy,
  toleranceInput: number | Partial<TrendTolerances> = DROP_THRESHOLD,
): boolean {
  if (!page.baseline || !page.baselineCapturedAt) return false;
  return hasPersistentRegression(mediansOf(page.baseline[strategy]), postBaselineHistory(page, false, strategy), strategy, "perf", toleranceInput);
}

/** Deltas per category, latest snapshot vs baseline (both already single-strategy medians). */
export function deltas(current: ScoreByCategory, base: ScoreByCategory): Record<CategoryKey, number> {
  return {
    perf: current.perf - base.perf,
    a11y: current.a11y - base.a11y,
    bp: current.bp - base.bp,
    seo: current.seo - base.seo,
  };
}

/** Median-only snapshot for a strategy from a night's scores. */
export function mediansOf(scores: Record<CategoryKey, { m: number }>): ScoreByCategory {
  return { perf: scores.perf.m, a11y: scores.a11y.m, bp: scores.bp.m, seo: scores.seo.m };
}
