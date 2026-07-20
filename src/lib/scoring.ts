import type { CategoryKey, Night, PageStatus, ScoreByCategory, Strategy } from "./types";

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
  if (st === "healthy") return { label: "Healthy", fg: "#35D07F", bg: "rgba(53,208,127,0.13)", shape: "circle" };
  if (st === "improvable") return { label: "Improvable", fg: "#FF9A3D", bg: "rgba(255,154,61,0.13)", shape: "triangle" };
  if (st === "pending") return { label: "Pending", fg: "#8A8A90", bg: "rgba(255,255,255,0.06)", shape: "circle" };
  return { label: "Degraded", fg: "#FF5C6C", bg: "rgba(255,92,108,0.13)", shape: "square" };
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

/** Points below baseline that count as a real drop rather than noise. */
export const DROP_THRESHOLD = 8;

/**
 * Classify a page from its baseline and recorded history for a strategy
 * (REQ-020/021/022/030). Performance drives status, per the source design.
 *  - degraded: latest median beyond the drop threshold below baseline on the
 *    two most recent nights (persistent), not a single-night dip.
 *  - improvable: below baseline but with headroom.
 *  - healthy: within the historical noise band.
 */
export function classifyStatus(
  baselineMedian: ScoreByCategory,
  history: Night[],
  strategy: Strategy,
  key: CategoryKey = "perf",
): PageStatus {
  if (history.length === 0) return "healthy";
  const base = baselineMedian[key];
  const band = noiseBand(history, strategy, key);
  const last = history[history.length - 1].scores[strategy][key].m;
  const prev = history.length > 1 ? history[history.length - 2].scores[strategy][key].m : last;
  const persistentDrop = base - last >= DROP_THRESHOLD && base - prev >= DROP_THRESHOLD;
  if (persistentDrop) return "degraded";
  if (base - last > band) return "improvable";
  return "healthy";
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
