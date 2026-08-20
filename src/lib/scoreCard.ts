// Pure geometry/color math for the ScoreCard chart. Ported exactly from the
// design reference (ScoreCard.reference.html) — see that file's comments for
// the reasoning behind each non-obvious step. Kept framework-free and testable
// in isolation from the React component.

/** Lighthouse score bands: drive the series color, fills, hatch, and numeral outline. */
export const SCORE_GOOD = "#35D07F";
export const SCORE_WARN = "#FF9A3D";
export const SCORE_BAD = "#FF5C6C";
export const SCORE_NEUTRAL = "#8A8A90";

/** score >= 90 -> good, 50-89 -> warn, < 50 -> bad. */
export function bandColor(value: number): string {
  if (value >= 90) return SCORE_GOOD;
  if (value >= 50) return SCORE_WARN;
  return SCORE_BAD;
}

/** delta > 0 -> good, delta <= -8 -> bad, -8 < delta < 0 -> warn, 0 -> neutral. */
export function deltaColor(delta: number): string {
  if (delta > 0) return SCORE_GOOD;
  if (delta <= -8) return SCORE_BAD;
  if (delta < 0) return SCORE_WARN;
  return SCORE_NEUTRAL;
}

export const DOMAIN_HEADROOM = 0.14;

/**
 * One domain per card, computed from BOTH series so desktop and mobile stay
 * comparable. Padding is added only below the minimum, so the peak of either
 * series always touches the top edge of the chart box.
 */
export function domain(values: number[]): [lo: number, up: number] {
  const lo = Math.min(...values);
  const up = Math.max(...values);
  const pad = (up - lo) * DOMAIN_HEADROOM || 1;
  return [lo - pad, up];
}

/**
 * Map a score to the chart's y (in the authored `0 0 100 40` viewBox). The
 * range is 0..39, not 0..40, so a 2px stroke at the very peak is not clipped.
 */
export function yFor(value: number, [lo, up]: [number, number]): number {
  return 39 - ((value - lo) / (up - lo)) * 39;
}

export function xFor(index: number, lastIndex: number): number {
  // A single-point series (e.g. one collection inside a short date range) has
  // no span to divide by; anchor it at the left edge rather than producing NaN.
  if (lastIndex === 0) return 0;
  return (index / lastIndex) * 100;
}

function round(value: number, precision = 100): number {
  return Math.round(value * precision) / precision;
}

export interface SeriesPaths {
  /** Polyline `d` for the stroke, in the 0 0 100 40 viewBox. */
  line: string;
  /** Closed area `d` (line + baseline), for the gradient fill. */
  area: string;
  /** Same curve in objectBoundingBox units (0..1), closed at the bottom — for clipPath. */
  clip: string;
  /** Percentage (of chart height) for a given score, for absolutely-positioned dots. */
  yPct: (value: number) => string;
}

/** Build the line/area/clip paths for one series against a shared domain. */
export function seriesPaths(values: number[], bounds: [number, number]): SeriesPaths {
  const lastIndex = values.length - 1;
  const points = values.map((value, index) => [xFor(index, lastIndex), yFor(value, bounds)] as const);
  const line = "M " + points.map(([x, y]) => `${round(x)} ${round(y)}`).join(" L ");
  const area = `${line} L 100 40 L 0 40 Z`;
  const clipPoints = points.map(([x, y]) => `${round(x / 100, 1e4)} ${round(y / 40, 1e4)}`);
  const clip = "M " + clipPoints.join(" L ") + " L 1 1 L 0 1 Z";
  return {
    line,
    area,
    clip,
    yPct: (value: number) => `${round((yFor(value, bounds) / 40) * 100)}%`,
  };
}

/** Hatch line width: spread 4px -> max(1, round(4/5.5)*10)/10 == 1px. */
export function hatchLineWidth(spread: number): number {
  const clamped = Math.max(3, spread);
  return Math.max(1, Math.round(clamped / 5.5) * 10) / 10;
}

/**
 * Two hatch directions (desktop 45deg, mobile -45deg) are a redundant channel
 * with color; this is deliberately a DOM `repeating-linear-gradient`, not an
 * SVG <pattern>, because a pattern shears under `preserveAspectRatio="none"`.
 */
export function hatchBackgroundImage(degrees: number, colorRgba: string, spread = 4): string {
  const width = hatchLineWidth(spread);
  return `repeating-linear-gradient(${degrees}deg, ${colorRgba} 0, ${colorRgba} ${width}px, transparent ${width}px, transparent ${spread}px)`;
}

/** Hex (#rgb / #rrggbb, optionally with an existing alpha nibble stripped) to rgba(...). */
export function rgba(hex: string, alpha: number): string {
  let h = hex.replace("#", "");
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

/** Resolve the shown index for hover-scrub, deriving it from `hoverIndex ?? lastIndex`. */
export function shownIndex(hoverIndex: number | null, lastIndex: number): number {
  return hoverIndex ?? lastIndex;
}

/**
 * Split a trusted-flag array into contiguous runs of true indices, so a
 * medium/large chart can break its line/band at a quarantined PSI anomaly
 * (see ScoreCardData.desktopTrusted/mobileTrusted) instead of bridging the
 * gap the way xsmall/small always do. Mirrors trustedHistorySegments in
 * lib/charting.ts, but returns original indices rather than Night objects so
 * the caller can still map into the shared 0..lastIndex domain.
 */
export function trustedIndexSegments(trusted: boolean[] | undefined, length: number): number[][] {
  const segments: number[][] = [];
  let current: number[] = [];
  for (let index = 0; index < length; index += 1) {
    const isTrusted = trusted ? trusted[index] !== false : true;
    if (!isTrusted) {
      if (current.length > 0) segments.push(current);
      current = [];
      continue;
    }
    current.push(index);
  }
  if (current.length > 0) segments.push(current);
  return segments;
}

/**
 * Polyline `d` for an arbitrary subset of indices against the shared domain
 * and lastIndex — used to draw one trusted segment's median line/range edge
 * without re-deriving `seriesPaths`' dense 0..lastIndex assumption.
 */
export function segmentLine(values: number[], indices: number[], lastIndex: number, bounds: [number, number]): string {
  return "M " + indices
    .map((index) => `${round(xFor(index, lastIndex))} ${round(yFor(values[index], bounds))}`)
    .join(" L ");
}

/**
 * Closed run-to-run range-band polygon (high edge forward, low edge back)
 * for one trusted segment, in the shared 0 0 100 40 viewBox. Returns null
 * when every point in the segment has no real spread (lo === hi throughout,
 * e.g. Accessibility/BP/SEO's near-flat single-run series) so the caller can
 * fall back to a bare line instead of drawing a zero-height band.
 */
export function segmentRangeBand(
  range: ScoreCardRangePoint[],
  indices: number[],
  lastIndex: number,
  bounds: [number, number],
): string | null {
  const hasSpread = indices.some((index) => range[index].hi > range[index].lo);
  if (!hasSpread) return null;
  const top = indices.map((index) => `${round(xFor(index, lastIndex))} ${round(yFor(range[index].hi, bounds))}`);
  const bottom = [...indices].reverse().map((index) => `${round(xFor(index, lastIndex))} ${round(yFor(range[index].lo, bounds))}`);
  return "M " + [...top, ...bottom].join(" L ") + " Z";
}

export interface ScoreCardRangePoint {
  lo: number;
  hi: number;
}

/** Delta is always relative to the window start, not a fixed period figure. */
export function deltaFromStart(values: number[], shown: number): number {
  return values[shown] - values[0];
}
