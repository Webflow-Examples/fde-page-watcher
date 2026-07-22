import type { CategoryKey, Night, PageStatus, RangeDays, ScoreByCategory, Strategy, WatchPage } from "./types";

// ── Colors (dark-theme Lighthouse bands) ──────────────────────────────────

export interface ScoreMeta {
  fg: string;
  line: string;
  bg: string;
  ring: string;
}

/** Lighthouse score bands: >=90 green, >=50 amber, else red. */
export function scoreMeta(v: number): ScoreMeta {
  if (v >= 90) return { fg: "#35D07F", line: "#35D07F", bg: "rgba(53,208,127,0.14)", ring: "#35D07F" };
  if (v >= 50) return { fg: "#FF9A3D", line: "#FF9A3D", bg: "rgba(255,154,61,0.14)", ring: "#FF9A3D" };
  return { fg: "#FF5C6C", line: "#FF5C6C", bg: "rgba(255,92,108,0.14)", ring: "#FF5C6C" };
}

export interface StatusMeta {
  label: string;
  fg: string;
  bg: string;
  shape: "circle" | "triangle" | "square";
}

/** Status vocabulary with its accessibility shape (REQ-009). */
export function statusMeta(st: PageStatus): StatusMeta {
  if (st === "stable") return { label: "Stable", fg: "#5EA0FF", bg: "rgba(59,137,255,0.13)", shape: "circle" };
  if (st === "improving") return { label: "Improving", fg: "#35D07F", bg: "rgba(53,208,127,0.13)", shape: "triangle" };
  if (st === "pending") return { label: "Pending", fg: "#8A8A90", bg: "rgba(255,255,255,0.06)", shape: "circle" };
  return { label: "Regressing", fg: "#FF5C6C", bg: "rgba(255,92,108,0.13)", shape: "square" };
}

export interface DeltaMeta {
  text: string;
  fg: string;
  chip: string;
  d: number;
}

export function deltaMeta(cur: number, base: number): DeltaMeta {
  const d = cur - base;
  const arrow = d > 0 ? "↗" : d < 0 ? "↘" : "→";
  const text = `${arrow} ${Math.abs(d)}`;
  let fg: string, chip: string;
  if (d > 0) {
    fg = "#35D07F";
    chip = "rgba(53,208,127,0.14)";
  } else if (d <= -8) {
    fg = "#FF5C6C";
    chip = "rgba(255,92,108,0.14)";
  } else if (d < 0) {
    fg = "#FF9A3D";
    chip = "rgba(255,154,61,0.14)";
  } else {
    fg = "#8A8A90";
    chip = "rgba(255,255,255,0.06)";
  }
  return { text, fg, chip, d };
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

/** Median series for a category over the last `days` nights, for one strategy. */
export function categorySeries(history: Night[], strategy: Strategy, key: CategoryKey, days: number): number[] {
  return history.slice(-days).map((n) => n.scores[strategy][key].m);
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

export interface RangeComparison {
  from: number;
  to: number;
  delta: number;
  windowSize: number;
}

/** Compare the oldest and newest non-overlapping three-night medians in a range. */
export function rangeComparison(history: Night[], strategy: Strategy, key: CategoryKey): RangeComparison | null {
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
  const meds = history.map((n) => n.scores[strategy][key].m);
  if (meds.length < 2) return 5;
  let sum = 0;
  for (let i = 1; i < meds.length; i++) sum += Math.abs(meds[i] - meds[i - 1]);
  return Math.max(4, Math.round((sum / (meds.length - 1)) * 2));
}

/** Typical within-night PSI spread, used to judge selected-range movement. */
export function rangeNoiseBand(history: Night[], strategy: Strategy, key: CategoryKey): number {
  const halfRanges = history.map((night) => {
    const score = night.scores[strategy][key];
    return Math.ceil((score.hi - score.lo) / 2);
  });
  return Math.max(4, median(halfRanges));
}

/** Points below baseline that count as a real drop rather than noise. */
export const DROP_THRESHOLD = 8;

/**
 * Classify the latest Performance result relative to its stored baseline.
 * This is deliberately a trend, not an overall health score: absolute quality
 * is communicated independently by each metric's Lighthouse color band.
 *  - improving: above baseline by more than normal historical noise.
 *  - regressing: below baseline by more than normal historical noise.
 *  - stable: within the historical noise band.
 */
export function classifyStatus(
  baselineMedian: ScoreByCategory,
  history: Night[],
  strategy: Strategy,
  key: CategoryKey = "perf",
): PageStatus {
  if (history.length === 0) return "stable";
  const base = baselineMedian[key];
  // The point being classified cannot also teach us what "normal" noise is;
  // otherwise a new jump inflates its own tolerance and hides the change.
  const band = noiseBand(history.slice(0, -1), strategy, key);
  const last = history[history.length - 1].scores[strategy][key].m;
  if (last - base > band) return "improving";
  if (base - last > band) return "regressing";
  return "stable";
}

/** Persistent drops retain a stricter threshold for Slack alerting. */
export function hasPersistentRegression(
  baselineMedian: ScoreByCategory,
  history: Night[],
  strategy: Strategy,
  key: CategoryKey = "perf",
): boolean {
  if (history.length < 2) return false;
  const base = baselineMedian[key];
  const last = history[history.length - 1].scores[strategy][key].m;
  const prev = history[history.length - 2].scores[strategy][key].m;
  return base - last >= DROP_THRESHOLD && base - prev >= DROP_THRESHOLD;
}

function postBaselineHistory(page: WatchPage): Night[] {
  const baselineCapturedAt = page.baselineCapturedAt ?? "";
  const capturedAt = /^\d{4}-\d{2}-\d{2}T/.test(baselineCapturedAt)
    ? Date.parse(baselineCapturedAt)
    : Number.NaN;
  const hasLiveHistory = page.history.some((night) => night.iso && Number.isFinite(Date.parse(night.iso)));
  return Number.isFinite(capturedAt) && hasLiveHistory
    ? page.history.filter((night) => {
      const recordedAt = night.iso ? Date.parse(night.iso) : Number.NaN;
      return Number.isFinite(recordedAt) && recordedAt > capturedAt;
    })
    : page.history;
}

/** Range-limited monitoring history, excluding exploratory runs before baseline. */
export function pageHistoryForRange(page: WatchPage, days: RangeDays, now = Date.now()): Night[] {
  if (!page.baseline || !page.baselineCapturedAt) return [];
  return historyForRange(postBaselineHistory(page), days, now);
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
  return pageHistoryForRange(page, days, now).map((night) => night.scores[strategy][key].m);
}

/** Display trend across the selected range, independent of the original baseline score. */
export function pageRangeTrend(page: WatchPage, strategy: Strategy, days: RangeDays, now = Date.now()): PageStatus {
  const history = pageHistoryForRange(page, days, now);
  const comparison = rangeComparison(history, strategy, "perf");
  if (!comparison) return "pending";
  const band = rangeNoiseBand(history, strategy, "perf");
  if (comparison.delta > band) return "improving";
  if (comparison.delta < -band) return "regressing";
  return "stable";
}

/** Derive the display trend for the currently selected strategy. */
export function pageTrend(page: WatchPage, strategy: Strategy): PageStatus {
  if (!page.baseline || !page.baselineCapturedAt) return "pending";
  return classifyStatus(mediansOf(page.baseline[strategy]), postBaselineHistory(page), strategy);
}

/** Apply the alert threshold only to collections recorded after the baseline. */
export function pageHasPersistentRegression(page: WatchPage, strategy: Strategy): boolean {
  if (!page.baseline || !page.baselineCapturedAt) return false;
  return hasPersistentRegression(mediansOf(page.baseline[strategy]), postBaselineHistory(page), strategy);
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
