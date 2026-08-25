import type { Trend } from "./vocabulary";

// Pure geometry/color math for the ScoreCard chart. Ported exactly from the
// design reference (ScoreCard.reference.html) — see that file's comments for
// the reasoning behind each non-obvious step. Kept framework-free and testable
// in isolation from the React component.

/**
 * Lighthouse score bands, as app token NAMES rather than colour values. The
 * only place a colour value is named is the token block in `globals.css`, so
 * this returns the custom property and callers wrap it in `var(...)`.
 *
 * These are the R1 health tokens: hue answers "is this good right now?" and
 * nothing else.
 */
export const SCORE_GOOD = "--health-good-text";
export const SCORE_WARN = "--health-warn-text";
export const SCORE_BAD = "--health-poor-text";
export const SCORE_NEUTRAL = "--health-none-text";

/** score >= 90 -> good, 50-89 -> warn, < 50 -> bad. */
export function bandColor(value: number): string {
  if (value >= 90) return SCORE_GOOD;
  if (value >= 50) return SCORE_WARN;
  return SCORE_BAD;
}

/** `bandColor` as a ready-to-use CSS value. */
export function bandVar(value: number): string {
  return `var(${bandColor(value)})`;
}

/**
 * Direction of a score delta, as an F1 trend rather than a colour.
 *
 * This replaced `deltaColor`. R2 says direction is shape, not hue, so the
 * delta renders as an arrow glyph plus its label; R3 says the size of the
 * delta is carried by weight, not hue. The old function additionally folded a
 * -8 "this drop is bad" severity judgment into the colour — that is a health
 * verdict, and R1 puts health on the health chip (`bandColor` of the current
 * value), never on the delta. A row can now show a poor health chip and an
 * improving arrow at once, which is the point.
 */
export function deltaTrend(delta: number): Trend {
  if (delta > 0) return "improving";
  if (delta < 0) return "regressing";
  return "no_change";
}

export const DOMAIN_HEADROOM = 0.14;

/**
 * Floor on a chart's plotted span (in score points). Real values that all
 * sit within a few points of each other (e.g. Accessibility 95-97) would
 * otherwise fill the entire 0..39 y-range with that few-point wobble,
 * reading as a shapeless blob with no sense of scale — this guarantees at
 * least a 20-point window so small, real movement stays legible.
 */
export const MIN_DOMAIN_SPAN = 20;

/**
 * One domain per card, computed from BOTH series so desktop and mobile stay
 * comparable. Padding is added only below the minimum, so the peak of either
 * series always touches the top edge of the chart box — unless the data's
 * own span is under `MIN_DOMAIN_SPAN`, in which case the domain is widened
 * to that floor, centered on the data (and clamped to the valid 0-100 score
 * range), since there's no real peak worth pinning to the top at that point.
 */
export function domain(values: number[]): [lo: number, up: number] {
  const dataLo = Math.min(...values);
  const dataUp = Math.max(...values);
  const span = dataUp - dataLo;
  if (span < MIN_DOMAIN_SPAN) {
    const mid = (dataLo + dataUp) / 2;
    let lo = mid - MIN_DOMAIN_SPAN / 2;
    let up = mid + MIN_DOMAIN_SPAN / 2;
    if (up > 100) {
      lo -= up - 100;
      up = 100;
    }
    if (lo < 0) {
      up += -lo;
      lo = 0;
    }
    return [Math.max(0, lo), Math.min(100, up)];
  }
  const pad = span * DOMAIN_HEADROOM;
  return [dataLo - pad, dataUp];
}

/**
 * Fixed scale for every XSmall sparkline in the app: 1 score point is
 * always this many px of vertical travel. A per-series floor (the earlier
 * approach) still lets two different cards in the same row draw at two
 * different scales, so their slopes can't be compared; a fixed
 * points-per-pixel makes the same visual slope mean the same score change
 * everywhere in the table, at every selected time range. Calibrated so a
 * 1-point wobble is invisible, a 4-point move is perceptible, and a
 * 10-point move clearly reads as a slope — tune this constant alone if
 * that stops holding, never bring back per-series auto-fit.
 */
export const XSMALL_PX_PER_POINT = 0.5;
/** XSmall's sparkline slot height (px) — see XSmallDeviceRow's fixed `height: 16` — the other half of the calculation below. */
export const XSMALL_SLOT_HEIGHT = 16;
/** Score-point span that exactly fills the 16px slot at `XSMALL_PX_PER_POINT`. */
export const XSMALL_VISIBLE_SPAN = XSMALL_SLOT_HEIGHT / XSMALL_PX_PER_POINT;
/** Headroom added on each side ONLY when a series' own spread exceeds `XSMALL_VISIBLE_SPAN` and has to be compressed to fit. */
export const XSMALL_OVERFLOW_PADDING = 0.08;

/**
 * One device's XSmall y-domain, centered on THIS series' own extent (so a
 * flat or near-flat line still sits level with its chips) at the app-wide
 * fixed `XSMALL_VISIBLE_SPAN` — every card in every row uses this same
 * span, so slopes are comparable across the whole table. Only when the
 * series' own real spread genuinely exceeds that span does this fall back
 * to fitting the series (padded `XSMALL_OVERFLOW_PADDING` on each side) —
 * never per-series fitting for a series that already fits.
 */
export function xsmallBounds(values: number[]): [number, number] {
  const lo = Math.min(...values);
  const up = Math.max(...values);
  const actual = up - lo;
  if (actual > XSMALL_VISIBLE_SPAN) {
    const pad = actual * XSMALL_OVERFLOW_PADDING;
    return [lo - pad, up + pad];
  }
  const mid = (lo + up) / 2;
  return [mid - XSMALL_VISIBLE_SPAN / 2, mid + XSMALL_VISIBLE_SPAN / 2];
}

/** At most one point rendered per ~3px of slot width, floored at 2 so a sparkline never collapses to a single point. */
export function xsmallTargetPointCount(slotWidthPx: number): number {
  return Math.max(2, Math.floor(slotWidthPx / 3));
}

function median(sortedAscendingInput: number[]): number {
  const sorted = [...sortedAscendingInput].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Downsamples `values` to `target` contiguous buckets (median of each,
 * not the mean — one bad night shouldn't move the line, and the series is
 * already a median) for a slot too narrow to plot every point without
 * aliasing into noise. `trusted[i] === false` drops that night from its
 * bucket; a bucket left with nothing trusted inherits the previous
 * bucket's value, bridging the gap rather than breaking the line (XSmall
 * never breaks its line — see the density handoff §4). The true first and
 * last values always survive as the first and last output point no matter
 * what their buckets computed, so the line's endpoints always match the
 * chips exactly. A no-op when there's nothing to collapse.
 */
export function bucketSeries(values: number[], target: number, trusted?: boolean[]): number[] {
  if (target < 2 || values.length <= target) return values;
  const buckets: number[][] = Array.from({ length: target }, () => []);
  values.forEach((value, index) => {
    if (trusted && trusted[index] === false) return;
    const bucketIndex = Math.min(target - 1, Math.floor((index / values.length) * target));
    buckets[bucketIndex].push(value);
  });
  const out: number[] = [];
  let previous = values[0];
  buckets.forEach((bucket) => {
    previous = bucket.length ? median(bucket) : previous;
    out.push(previous);
  });
  out[0] = values[0];
  out[out.length - 1] = values[values.length - 1];
  return out;
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
 *
 * `color` is any CSS colour value the caller has already resolved — today a
 * `color-mix(in srgb, var(--series-desktop) 25%, transparent)`. It was named
 * `colorRgba` while the deleted hex-to-alpha helper below was its only source.
 */
export function hatchBackgroundImage(degrees: number, color: string, spread = 4): string {
  const width = hatchLineWidth(spread);
  return `repeating-linear-gradient(${degrees}deg, ${color} 0, ${color} ${width}px, transparent ${width}px, transparent ${spread}px)`;
}

// A hex-to-rgba helper used to live here: it stripped a leading hash and ran
// a pair of two-char parseInts over what was left. Once bandColor started
// returning a token NAME instead of a colour value, every one of its callers
// would have produced three NaN channels — a value the browser drops
// silently, so the hatch pattern, both line glows, the numeral gradient and
// the range-band fill would all have rendered as nothing, with no console
// error and no failing test.
// Alpha now comes from `color-mix(in srgb, var(--token) N%, transparent)` at
// the call site, which fails loudly instead of invisibly. Do not reintroduce
// a colour parser here.

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

/**
 * Same band as `segmentRangeBand`, normalized to 0..1 (objectBoundingBox
 * units) instead of the raw 0 0 100 40 viewBox. `segmentRangeBand`'s path is
 * drawn inside an `<svg viewBox="0 0 100 40">`, where those raw units are
 * correct; this one is for the CSS `clip-path: url(#id)` on the plain HTML
 * div that paints the band's hatch pattern (see RangeBandLayer) — a
 * `clipPathUnits="userSpaceOnUse"` clip built from the raw path doesn't
 * scale to that div's box, so it clips to a tiny region pinned at the
 * viewBox's literal 100x40 px instead of the div's actual size. Mirrors how
 * `seriesPaths().clip` normalizes the median line's own clip path.
 */
export function segmentRangeBandClip(
  range: ScoreCardRangePoint[],
  indices: number[],
  lastIndex: number,
  bounds: [number, number],
): string | null {
  const hasSpread = indices.some((index) => range[index].hi > range[index].lo);
  if (!hasSpread) return null;
  const top = indices.map((index) => `${round(xFor(index, lastIndex) / 100, 1e4)} ${round(yFor(range[index].hi, bounds) / 40, 1e4)}`);
  const bottom = [...indices].reverse().map((index) => `${round(xFor(index, lastIndex) / 100, 1e4)} ${round(yFor(range[index].lo, bounds) / 40, 1e4)}`);
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
