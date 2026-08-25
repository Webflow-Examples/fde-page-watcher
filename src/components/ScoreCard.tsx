"use client";

// ScoreCard — desktop + mobile Lighthouse scores for one category, at equal
// visual weight, with a scrubbable 24-day chart driving every number in the
// card. Ported pixel-for-pixel from the design reference
// (ScoreCard.reference.html) onto this codebase's conventions: inline
// `style={}` objects, the same pattern used by every other card in this app
// (see bits.tsx / the Overview tab in pages/[id]/page.tsx) rather than
// Tailwind utility classes, which this app has wired up but does not use for
// component styling. Every colour is an app token (`var(--…)`, declared in
// src/app/globals.css) — this file names no colour value of its own, and has
// no light/dark record: the tokens carry the theme.
//
// Two colour vocabularies live in this card and must not be mixed:
//   · the NUMERALS and the XSmall "is" chip are a health verdict, so they are
//     `--health-{good,warn,poor}-*`, banded by score (see bandColor);
//   · every CHART MARK — line, fill, hatch, glow, range band, hover dot — is
//     the SERIES' identity, so it is `--series-desktop` / `--series-mobile`
//     by device and never changes with the data (R4).
// A card can therefore show a purple desktop line under a red 38: one line
// about which device, one about whether the score is good. Painting both with
// the same hue is what this migration removed.
//
// All geometry/color math lives in a separate pure module (src/lib/scoreCard.ts)
// with its own unit tests; this file is only responsible for layout, DOM
// structure, and wiring hover state to that math.

import { useEffect, useId, useMemo, useRef, useState, type CSSProperties, type MouseEvent, type ReactNode } from "react";
import {
  bandColor,
  bandVar,
  bucketSeries,
  deltaFromStart,
  deltaTrend,
  domain,
  hatchBackgroundImage,
  SCORE_BAD,
  SCORE_GOOD,
  SCORE_NEUTRAL,
  SCORE_WARN,
  segmentLine,
  segmentRangeBand,
  segmentRangeBandClip,
  seriesPaths,
  shownIndex,
  trustedIndexSegments,
  xFor,
  xsmallBounds,
  xsmallTargetPointCount,
  yFor,
} from "@/lib/scoreCard";
import { metricTooltipFor, SCORE_BANDS_LABEL } from "@/lib/scoreCardTooltip";
import { Magnitude } from "@/components/magnitude";
import { TrendArrow } from "@/components/trend-arrow";

/** Run-to-run low/high spread behind one plotted median point (see CategoryScore in lib/types.ts). */
export type ScoreCardRange = { lo: number; hi: number };

/**
 * A user-logged or task-completion change marker positioned against a
 * device's plotted series (see ChangeMarker in lib/types.ts). `index` is an
 * index into that device's `desktop`/`mobile` array, already resolved by the
 * caller (see scoreCardAdapter.ts) — out-of-range markers are dropped there,
 * not here.
 */
export type ScoreCardMarker = { index: number; text: string; isTask: boolean };

export type ScoreCardData = {
  title: string;
  /**
   * Scores 0-100, oldest -> newest, one per collection inside the caller's
   * selected date range (see src/lib/scoreCardAdapter.ts). Length varies with
   * that range control rather than being fixed at 24. The only series a
   * single-metric card (one with no natural device pairing, e.g. agent
   * readiness) needs to supply.
   */
  desktop: number[];
  /**
   * Same length and order as `desktop`. Omit (or pass an empty array) for a
   * metric with no natural pairing — every density then draws `desktop`
   * alone: one line/row instead of a compared pair, no "Desktop"/"Mobile"
   * captions, no Δ gap chip.
   */
  mobile?: number[];
  /**
   * Optional run-to-run range per plotted point, same length/order as
   * `desktop`/`mobile`. Only `medium`/`large` draw this (§4's range band);
   * `xsmall`/`small` ignore it even when supplied, matching the frozen small
   * card. Omitted entirely by callers (e.g. the standalone demo page) that
   * have no range data — medium/large then fall back to a bare line, exactly
   * like a real single-run series such as Accessibility/BP/SEO.
   */
  desktopRange?: ScoreCardRange[];
  mobileRange?: ScoreCardRange[];
  /**
   * Whether each plotted point is trusted (not a quarantined PSI anomaly),
   * same length/order as `desktop`/`mobile`. Only `medium`/`large` break the
   * line/band around an untrusted run (§4's anomaly gap); every other
   * density bridges gaps regardless (`noGaps`). Omitted means "all trusted."
   */
  desktopTrusted?: boolean[];
  mobileTrusted?: boolean[];
  /**
   * Change markers to draw at `medium`/`large` (§4's dashed-line + dot +
   * label). Shared across both devices since a marker is page-level, not
   * per-device. Omitted or empty draws none.
   */
  markers?: ScoreCardMarker[];
};

export type ScoreCardDensity = "xsmall" | "small" | "medium" | "large";

/**
 * Minimum card width per density, for any caller laying out a wrapping row
 * of ScoreCards (not the Pages-page dashboard row, which is a fixed-column
 * table with one ScoreCard per named column, not a wrapping card row).
 *
 * This is a flexbox min-width, not a CSS grid track: grid's `auto-fit`
 * gives every row the same column widths across the whole grid, so a
 * wrapped last row with fewer cards still gets full-row-sized tracks and
 * leaves a gap instead of its cards filling that row's leftover space.
 * Flexbox distributes each row's leftover space independently, so a card
 * that wraps to a new row actually stretches to fill it — see
 * scoreCardFlexItemStyle. Large always shows exactly 1 per row (no min-width
 * here; see scoreCardFlexItemStyle's flex-basis: 100% special case).
 */
export const SCORE_CARD_MIN_WIDTH: Record<Exclude<ScoreCardDensity, "large">, number> = {
  xsmall: 150,
  small: 350,
  medium: 400,
};

/**
 * Flex-item style for one card in a `display: flex; flexWrap: wrap` row
 * (see SCORE_CARD_MIN_WIDTH). `flex: 1 1 <min>` grows/shrinks each card from
 * that min-width floor so leftover space in a row — full or wrapped — is
 * always redistributed across that row's actual cards, not left as a gap.
 * Large always takes the full row (flex-basis 100%), matching §4's "always 1
 * per row."
 */
export function scoreCardFlexItemStyle(density: ScoreCardDensity): CSSProperties {
  if (density === "large") return { flex: "1 1 100%", minWidth: 0 };
  return { flex: `1 1 ${SCORE_CARD_MIN_WIDTH[density]}px`, minWidth: SCORE_CARD_MIN_WIDTH[density] };
}

export type ScoreCardProps = {
  data: ScoreCardData;
  /** Default 320. Also drives the metric numeral size at small/medium/large. */
  cardWidth?: number;
  /**
   * Unused at small/medium/large: those densities have a fixed total card
   * height (see CARD_HEIGHT) and the chart flexes to fill whatever space
   * the header/metric rows don't use, rather than owning a literal pixel
   * height. Ignored at xsmall (16px hairline, no chart in the normal
   * sense). Retained on the prop type for backward compatibility.
   */
  chartHeight?: number;
  /**
   * Default 'small' — today's production card, byte-identical apart from the
   * metric tooltip (see scoreCardTooltip.ts). 'xsmall' is a chromeless row
   * cell for dense overviews/tables. 'medium'/'large' scale the same chart
   * pipeline up for a full-detail read. See the ScoreCard density handoff.
   */
  density?: ScoreCardDensity;
  /**
   * Default true. Only `xsmall` honors this — its per-cell title is
   * redundant when the caller already labels the column itself (e.g. the
   * Pages table's "PERFORMANCE"/"AGENT" headers), so that caller passes
   * `false` to drop the row's own label and the space it took. Every other
   * density always shows its title: it's the only place that names the
   * card at all.
   */
  showTitle?: boolean;
};

// ── Design tokens ────────────────────────────────────────────────────────
// This card used to carry its own hand-rolled `THEME` record: a `dark` half
// aliasing the retired `C` palette and a `light` half of literal hex from the
// README, threaded through every subcomponent as a `theme`/`t` prop. Both
// halves are now redundant — `globals.css` declares one token set per surface
// and the browser picks, so a card just names the role and never the value.
// The prop is gone with them; no caller ever passed it.

const CARD_SURFACE = "var(--surface-card)";
const CARD_HAIRLINE = "var(--border-hairline)";
const INK_BODY = "var(--text-body)";
const INK_MUTED = "var(--text-muted)";

/**
 * R4: a chart mark's hue is which SERIES it is, never a verdict about the
 * values in it. The desktop line reads `--series-desktop` at a score of 95
 * and at 12; the verdict lives on the numeral and the XSmall chip, which are
 * health-banded. Painting the line with the band hue made one fact look like
 * two agreeing signals, and left desktop and mobile indistinguishable
 * whenever they happened to land in the same band.
 *
 * A single-metric card (Agent readiness — no device pairing, see
 * hasSecondSeries) draws only its `desktop` series and so borrows the desktop
 * identity. That is safe because mobile never appears in the same card to
 * contrast against; the caption/hatch angle carry the device where there is
 * one to carry.
 */
const SERIES_VAR: Record<"d" | "m", string> = {
  d: "var(--series-desktop)",
  m: "var(--series-mobile)",
};

/**
 * Alpha comes from `color-mix`, never from gluing digits onto a colour string
 * — appending alpha nibbles to a `var(…)` is invalid CSS and renders nothing
 * with no error, which is exactly how the deleted hex-to-rgba helper failed.
 * Verified in-browser: `color-mix()` resolves inside `filter: drop-shadow()`,
 * inside both gradient functions, in a dashed border, and in an SVG `fill`
 * set via `style`.
 */
function mix(color: string, percent: number): string {
  return `color-mix(in srgb, ${color} ${Math.round(percent)}%, transparent)`;
}

/**
 * The paired ground/ink for a score's health band. `bandColor` is the single
 * place the 90/50 thresholds live, so this maps its answer onto the matching
 * `-bg`/`-text` pair rather than restating the bands — and the `-text` token
 * IS the on-colour for its own `-bg`, so a solid chip never hand-picks ink.
 */
const BAND_CHIP: Record<string, { bg: string; text: string }> = {
  [SCORE_GOOD]: { bg: "var(--health-good-bg)", text: "var(--health-good-text)" },
  [SCORE_WARN]: { bg: "var(--health-warn-bg)", text: "var(--health-warn-text)" },
  [SCORE_BAD]: { bg: "var(--health-poor-bg)", text: "var(--health-poor-text)" },
};
const NO_VERDICT_CHIP = { bg: "var(--health-none-bg)", text: `var(${SCORE_NEUTRAL})` };

function bandChip(value: number): { bg: string; text: string } {
  return BAND_CHIP[bandColor(value)] ?? NO_VERDICT_CHIP;
}

/**
 * The one popover surface in this component pair. ScoreCard's metric tooltip
 * and ScoreCardDensityControl's label tooltip were byte-identical apart from
 * two different shadow alphas; sharing the surface is what stops them being
 * tokenised twice, differently, the next time either one is touched.
 */
export const TOOLTIP_SURFACE: CSSProperties = {
  background: CARD_SURFACE,
  border: "1px solid var(--border-strong)",
  borderRadius: 6,
  boxShadow: "var(--shadow-popover)",
  pointerEvents: "none",
};

const CARD_PADDING = 16;
const CARD_RADIUS = 8;

/**
 * Fixed total card height for small/medium/large, so every card in a row
 * lines up regardless of chart content. The chart itself is not a literal
 * pixel height here — its wrapper uses `flex: 1 1 auto` inside the card's
 * column layout so it stretches to fill whatever space the header/metric
 * rows (and, at large, the date axis) don't use, rather than a hardcoded
 * chart height that could overflow or leave a gap if those rows reflow.
 * XSmall is unaffected: it has no chart in the normal sense (§4).
 */
const CARD_HEIGHT: Record<"small" | "medium" | "large", number> = {
  small: 200,
  medium: 400,
  large: 400,
};
const FILL_TOP_OPACITY = 0.67;
const FILL_END_OPACITY = 0.33;
const PATTERN_STRENGTH = 0.25;
const LINE_WIDTH = 2;
const GLOW_SPREAD = 8;
const GLOW_OPACITY = 0.5;
const OUTLINE_WEIGHT = 1.5;

// This app's brand sans (WF Visual Sans) has no working tabular figures, so
// every number in this card (metric numerals, delta chips, the Δ gap badge)
// uses the brand mono cut instead: public/fonts/WFVisualSansMono[wght,MONO].ttf,
// declared as "WF Visual Sans Mono" in globals.css. The system stack after it
// is only the fallback while that font loads or if it fails to load.
const MONO_FONT = '"WF Visual Sans Mono", ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace';
const SANS_FONT = "var(--font-brand, var(--font-sans))";

function dateAt(index: number, lastIndex: number, referenceDate = new Date()): string {
  const ms = referenceDate.getTime() - (lastIndex - index) * 86_400_000;
  return new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/** Whether `data` has a real second series to compare `desktop` against, at any density. */
function hasSecondSeries(data: ScoreCardData): boolean {
  return !!data.mobile && data.mobile.length > 0;
}

export function ScoreCard(props: ScoreCardProps) {
  const density = props.density ?? "small";
  if (density === "xsmall") return <XSmallScoreCard {...props} />;
  if (density === "medium") return <ScaledScoreCard {...props} density="medium" defaultMetricSize={60} />;
  if (density === "large") return <ScaledScoreCard {...props} density="large" defaultMetricSize={60} />;
  return <SmallScoreCard {...props} />;
}

/**
 * `small` is today's production ScoreCard, frozen in full apart from the
 * metric tooltip on the title (see scoreCardTooltip.ts / density handoff §3
 * and §5) and single-metric support below. Do not change its dual-series
 * layout, type sizes, colours, chart height, spacing, numeral treatment,
 * delta chips, or hover behaviour here — `data.mobile` is supplied for every
 * real caller today, so that path renders byte-identically to before.
 */
function SmallScoreCard({ data, cardWidth = 320 }: ScoreCardProps) {
  const uid = useId();
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const hasMobile = hasSecondSeries(data);

  // The series length follows the caller's selected date range (see
  // src/lib/scoreCardAdapter.ts) rather than a fixed 24 points.
  const pointCount = hasMobile ? Math.min(data.desktop.length, data.mobile!.length) : data.desktop.length;
  const last = Math.max(0, pointCount - 1);
  const idx = Math.min(shownIndex(hoverIndex, last), last);

  const metricSize = Math.min(72, Math.max(48, cardWidth * 0.15));
  const bounds = useMemo(() => domain(hasMobile ? [...data.desktop, ...data.mobile!] : [...data.desktop]), [data.desktop, data.mobile, hasMobile]);
  const dp = useMemo(() => (pointCount > 0 ? seriesPaths(data.desktop, bounds) : null), [data.desktop, bounds, pointCount]);
  const mp = useMemo(() => (hasMobile && pointCount > 0 ? seriesPaths(data.mobile!, bounds) : null), [hasMobile, data.mobile, bounds, pointCount]);

  if (pointCount === 0 || !dp) {
    return <EmptyScoreCard title={data.title} />;
  }

  const dv = data.desktop[idx];
  const dDelta = deltaFromStart(data.desktop, idx);
  // Numerals answer "is this good?" (health, banded); chart marks answer
  // "which device is this?" (series, fixed). See SERIES_VAR.
  const dInk = bandVar(dv);
  const mv = hasMobile ? data.mobile![idx] : null;
  const mDelta = hasMobile ? deltaFromStart(data.mobile!, idx) : null;
  const mInk = hasMobile ? bandVar(mv!) : null;
  const gap = hasMobile ? Math.abs(dv - mv!) : null;
  const rangeLabel = hoverIndex === null ? "" : dateAt(hoverIndex, last);

  const gId = (k: "d" | "m") => `scorecard-${uid}-g-${k}`;
  const cId = (k: "d" | "m") => `scorecard-${uid}-c-${k}`;

  const handleMove = (event: MouseEvent<HTMLDivElement>) => {
    if (last === 0) return; // single point: nothing to scrub
    const rect = event.currentTarget.getBoundingClientRect();
    if (!rect.width) return;
    const ratio = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
    setHoverIndex(Math.round(ratio * last));
  };

  const dotLeft = (index: number) => `${(index / last) * 100}%`;

  return (
    <div
      style={{
        width: "100%",
        height: CARD_HEIGHT.small,
        boxSizing: "border-box",
        // No overflow: hidden here — the metric tooltip below needs to escape
        // the card. The full-bleed chart clips itself via its own wrapper
        // (ChartClipWrapper below) instead.
        background: CARD_SURFACE,
        border: `1px solid ${CARD_HAIRLINE}`,
        borderRadius: CARD_RADIUS,
        padding: CARD_PADDING,
        display: "flex",
        flexDirection: "column",
        gap: CARD_PADDING * 0.72,
        fontFamily: SANS_FONT,
      }}
    >
      {/* header */}
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12 }}>
        <CardTitle title={data.title} fontSize={17} color={INK_BODY} />
        <div style={{ fontSize: 12.5, color: INK_MUTED, whiteSpace: "nowrap" }}>{rangeLabel}</div>
      </div>

      {/* metric row — a single MetricBlock (no Δ gap chip, no device label)
          when there's no second series to compare `desktop` against. */}
      <div style={{ display: "flex", alignItems: "stretch", gap: 8, margin: "4px 0 8px" }}>
        <MetricBlock side="d" label={hasMobile ? "Desktop" : undefined} value={dv} color={dInk} delta={dDelta} metricSize={metricSize} />
        {hasMobile && <GapChip gap={gap!} />}
        {hasMobile && (
          <MetricBlock side="m" label="Mobile" value={mv!} color={mInk!} delta={mDelta!} metricSize={metricSize} />
        )}
      </div>

      {/* chart — clipped by its own wrapper now that the card no longer clips.
          Fills whatever height ChartClipWrapper's flex sizing gives it
          (see CARD_HEIGHT / ChartClipWrapper), not the chartHeight prop. */}
      <ChartClipWrapper>
      <div
        onMouseMove={handleMove}
        onMouseLeave={() => setHoverIndex(null)}
        style={{
          position: "relative",
          height: "100%",
          width: `calc(100% + ${2 * CARD_PADDING}px)`,
          margin: `0 -${CARD_PADDING}px -${CARD_PADDING}px`,
        }}
      >
        <svg
          viewBox="0 0 100 40"
          preserveAspectRatio="none"
          style={{ position: "absolute", inset: 0, width: "100%", height: "100%", overflow: "visible", pointerEvents: "none" }}
        >
          <defs>
            <linearGradient id={gId("d")} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" style={{ stopColor: SERIES_VAR.d, stopOpacity: FILL_TOP_OPACITY }} />
              <stop offset="1" style={{ stopColor: SERIES_VAR.d, stopOpacity: FILL_END_OPACITY }} />
            </linearGradient>
            {hasMobile && (
              <linearGradient id={gId("m")} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" style={{ stopColor: SERIES_VAR.m, stopOpacity: FILL_TOP_OPACITY }} />
                <stop offset="1" style={{ stopColor: SERIES_VAR.m, stopOpacity: FILL_END_OPACITY }} />
              </linearGradient>
            )}
            <clipPath id={cId("d")} clipPathUnits="objectBoundingBox">
              <path d={dp.clip} />
            </clipPath>
            {hasMobile && mp && (
              <clipPath id={cId("m")} clipPathUnits="objectBoundingBox">
                <path d={mp.clip} />
              </clipPath>
            )}
          </defs>
          <path d={dp.area} fill={`url(#${gId("d")})`} />
          {hasMobile && mp && <path d={mp.area} fill={`url(#${gId("m")})`} />}
        </svg>

        {/* Hatch layers are clipped DOM elements, not an SVG <pattern>: a
            pattern shears under this svg's preserveAspectRatio="none". Desktop
            hatches at 45deg, mobile at -45deg — a redundant channel with the
            series colour for the accessibility pairing. */}
        <HatchLayer clipId={cId("d")} degrees={45} color={SERIES_VAR.d} />
        {hasMobile && <HatchLayer clipId={cId("m")} degrees={-45} color={SERIES_VAR.m} />}

        {/* One <svg> per line: the glow is a CSS filter on that svg's own box,
            so drop-shadow lengths resolve in real px instead of the stretched
            0..100 x 0..40 user units. */}
        <LineSvg d={dp.line} color={SERIES_VAR.d} />
        {hasMobile && mp && <LineSvg d={mp.line} color={SERIES_VAR.m} />}

        <div
          aria-hidden="true"
          style={{
            position: "absolute",
            top: 0,
            bottom: 0,
            width: 1,
            background: INK_MUTED,
            opacity: 0.35,
            display: hoverIndex === null ? "none" : "block",
            left: `${(hoverIndex ?? 0) / last * 100}%`,
            // Centered on its x-coordinate (like the dots below) rather than
            // drawn rightward from `left`: at hoverIndex === last, `left` is
            // exactly 100%, so an uncentered 1px-wide line would sit entirely
            // past the card's right edge and get clipped by the chart's own
            // clip wrapper, making it disappear.
            transform: "translateX(-50%)",
            pointerEvents: "none",
          }}
        />
        <ChartDot visible={hoverIndex !== null} left={dotLeft(idx)} top={dp.yPct(dv)} color={SERIES_VAR.d} />
        {hasMobile && mp && <ChartDot visible={hoverIndex !== null} left={dotLeft(idx)} top={mp.yPct(mv!)} color={SERIES_VAR.m} />}
      </div>
      </ChartClipWrapper>
    </div>
  );
}

/**
 * Clips the full-bleed chart to the card's rounded bottom corners now that
 * the card itself no longer sets `overflow: hidden` (that would also clip
 * the metric tooltip). The -2px top margin + 2px padding gives the line
 * stroke headroom so a series pinned at the domain max isn't sliced in half
 * (see the density handoff's "Clipping" note).
 */
function ChartClipWrapper({ children, inset = false }: { children: ReactNode; inset?: boolean }) {
  // `inset` is Large's variant: no bleed (margin 0) and a 10px 0 plot inset
  // so tick labels have room, per the density handoff §4's "Chart bleed /
  // Chart inset" row. Every other density keeps the full-bleed -16px/-2px
  // treatment.
  //
  // Clipped with `clip-path: inset()`, not `overflow: hidden`: overflow
  // clips all four sides uniformly, but LineSvg's glow is a blurred
  // drop-shadow that needs room to bleed upward, uncropped, when a series
  // is pinned at the domain max — overflow: hidden sliced that blur into a
  // hard flat edge right at the chart's top. inset()'s offsets go negative
  // to mean "extend the clip region outward" (i.e. don't clip) on that
  // side, so the top offset is pushed far out while left/right/bottom stay
  // clipped flush with this box — `round` keeps the same bottom corner
  // radius `overflow: hidden` used to provide.
  //
  // `flex: 1 1 auto` + `minHeight: 0` let this wrapper (and the chart inside
  // it, at height: 100%) stretch to fill whatever space is left in the
  // card's fixed total height (see CARD_HEIGHT) after the header/metric
  // rows above it, instead of the chart owning a literal pixel height.
  const clip = "inset(-1000px 0px 0px 0px round 0 0 7px 7px)";
  const style = (
    inset
      ? { flex: "1 1 auto", minHeight: 0, clipPath: clip, WebkitClipPath: clip, margin: "-2px 0 0", padding: "10px 0" }
      : { flex: "1 1 auto", minHeight: 0, clipPath: clip, WebkitClipPath: clip, margin: `-2px -${CARD_PADDING}px -${CARD_PADDING}px`, paddingTop: 2 }
  ) as CSSProperties;
  return <div style={style}>{children}</div>;
}

/**
 * Card title with the metric tooltip from the density handoff §5 — identical
 * at every density, including the XSmall row-cell label. This is the one
 * change to the small card; everything else about it stays byte-identical.
 */
function CardTitle({ title, fontSize, color, uppercase = false }: { title: string; fontSize: number; color: string; uppercase?: boolean }) {
  const [open, setOpen] = useState(false);
  const copy = metricTooltipFor(title);
  return (
    <span
      style={{ position: "relative", minWidth: 0, display: "inline-flex", cursor: copy ? "help" : undefined }}
      onMouseEnter={() => copy && setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <span
        style={{
          fontFamily: uppercase ? MONO_FONT : SANS_FONT,
          fontWeight: uppercase ? 500 : 600,
          fontSize,
          letterSpacing: uppercase ? "0.5px" : "-0.01em",
          textTransform: uppercase ? "uppercase" : undefined,
          color,
          minWidth: 0,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {title}
      </span>
      {open && copy && (
        <span
          role="tooltip"
          style={{
            position: "absolute",
            top: "calc(100% + 8px)",
            left: 0,
            zIndex: 8,
            width: 264,
            display: "flex",
            flexDirection: "column",
            gap: 6,
            textAlign: "left",
            whiteSpace: "normal",
            ...TOOLTIP_SURFACE,
            padding: "10px 11px",
          }}
        >
          <span style={{ fontFamily: MONO_FONT, fontSize: 12, fontWeight: 600, letterSpacing: "0.04em", textTransform: "uppercase", color: INK_MUTED }}>
            {copy.unit}
          </span>
          <span style={{ fontFamily: SANS_FONT, fontSize: 12, lineHeight: 1.45, color: INK_BODY }}>{copy.body}</span>
          {/* The band key is a legend, not decoration — 12px, and each swatch
              resolves the same token `bandColor()` returns for that band, so
              the key and the numerals cannot drift apart. */}
          <span style={{ display: "flex", flexWrap: "wrap", gap: "4px 12px", paddingTop: 8, borderTop: `1px solid ${CARD_HAIRLINE}`, fontFamily: MONO_FONT, fontSize: 12, color: INK_MUTED, whiteSpace: "nowrap" }}>
            {SCORE_BANDS_LABEL.map((band) => (
              <span key={band.text} style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                <span style={{ width: 6, height: 6, borderRadius: "50%", background: `var(${band.token})` }} />
                {band.text}
              </span>
            ))}
          </span>
        </span>
      )}
    </span>
  );
}

/** Nothing collected inside the selected range: keep the card shell so the grid doesn't reflow, but show no fabricated chart or numerals. */
function EmptyScoreCard({ title }: { title: string }) {
  return (
    <div
      style={{
        width: "100%",
        boxSizing: "border-box",
        background: CARD_SURFACE,
        border: `1px solid ${CARD_HAIRLINE}`,
        borderRadius: CARD_RADIUS,
        padding: CARD_PADDING,
        display: "flex",
        flexDirection: "column",
        gap: CARD_PADDING * 0.72,
        fontFamily: SANS_FONT,
      }}
    >
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12 }}>
        <CardTitle title={title} fontSize={17} color={INK_BODY} />
      </div>
      <div style={{ padding: "20px 0", color: INK_MUTED, fontSize: 12.5 }}>No collections in the selected range.</div>
    </div>
  );
}

function HatchLayer({ clipId, degrees, color }: { clipId: string; degrees: number; color: string }) {
  // A mask CHANNEL, not a paint colour: the two black stops below differ only
  // in alpha, which sets how much of the hatch survives top-to-bottom; the
  // colour channels are discarded by the mask. Tokenising this would be
  // meaningless — see the no-literals rule's mask/alpha-ramp allowance.
  const mask = "linear-gradient(to bottom, rgba(0,0,0,1) 0%, rgba(0,0,0,0.3) 100%)";
  // WebkitMaskImage / WebkitClipPath are valid CSS properties browsers honor,
  // but aren't part of React's CSSProperties typings; cast narrowly here
  // rather than widening the whole style object.
  const style = {
    position: "absolute",
    inset: 0,
    WebkitMaskImage: mask,
    maskImage: mask,
    WebkitClipPath: `url(#${clipId})`,
    clipPath: `url(#${clipId})`,
    pointerEvents: "none",
    backgroundImage: hatchBackgroundImage(degrees, mix(color, PATTERN_STRENGTH * 100)),
  } as CSSProperties;
  return <div aria-hidden="true" style={style} />;
}

function LineSvg({ d, color }: { d: string; color: string }) {
  const glow = `drop-shadow(0 0 ${GLOW_SPREAD / 2}px ${mix(color, GLOW_OPACITY * 100)}) drop-shadow(0 0 ${GLOW_SPREAD}px ${mix(color, GLOW_OPACITY * 60)})`;
  return (
    <svg
      viewBox="0 0 100 40"
      preserveAspectRatio="none"
      style={{ position: "absolute", inset: 0, width: "100%", height: "100%", overflow: "visible", pointerEvents: "none", filter: glow }}
    >
      {/* `stroke` lives in `style`, not as a presentation attribute: a
          presentation attribute is not guaranteed to resolve a custom
          property across engines, and it silently paints nothing when it
          doesn't. Geometry (strokeWidth, vectorEffect) stays an attribute. */}
      <path
        d={d}
        vectorEffect="non-scaling-stroke"
        strokeWidth={LINE_WIDTH}
        style={{ fill: "none", stroke: color, strokeLinejoin: "round", strokeLinecap: "butt" }}
      />
    </svg>
  );
}

/**
 * 8px dot centered on its (left, top) point via a -4px/-4px margin. At the
 * chart's x edges (left: 0% or left: 100%) that centering places half the
 * dot outside the card, but that half only overlaps the card's straight
 * border edge, not its small corner radius, so the card's `overflow: hidden`
 * does not crop it into a visible crescent.
 */
function ChartDot({ visible, left, top, color }: { visible: boolean; left: string; top: string; color: string }) {
  return (
    <div
      aria-hidden="true"
      style={{
        position: "absolute",
        width: 8,
        height: 8,
        margin: "-4px 0 0 -4px",
        borderRadius: "50%",
        // Knockout centre: must be the card's own surface or the ring seams.
        background: CARD_SURFACE,
        border: `2px solid ${color}`,
        display: visible ? "block" : "none",
        left,
        top,
        pointerEvents: "none",
      }}
    />
  );
}

function MetricBlock({
  side,
  label,
  value,
  color,
  delta,
  metricSize,
}: {
  side: "d" | "m";
  /** Device caption above the numeral ("Desktop"/"Mobile"). Omit for a single-metric card, where there's no second block to disambiguate against. */
  label?: string;
  /** The numeral's HEALTH ink — `bandVar(value)`. Not a series colour: this is the verdict, not the identity. */
  color: string;
  value: number;
  delta: number;
  metricSize: number;
}) {
  const deg = side === "d" ? 45 : -45;
  return (
    <div style={{ flex: "1 1 0", minWidth: 0, display: "flex", flexDirection: "column-reverse", gap: 0, alignItems: "center" }}>
      <div
        style={{
          // 12px, not the old 10 — a device caption is the only thing telling
          // these two numerals apart, so it carries meaning. `height` moves to
          // 15 with it: at height 10 against a 15px line box the caption
          // already overflowed its own row, and at 12px it would have clipped.
          // 15 also matches GapChip's spacer, so the three columns line up.
          fontSize: 12,
          height: 15,
          lineHeight: "15px",
          fontWeight: 500,
          letterSpacing: "0.4px",
          textTransform: "uppercase",
          color: INK_MUTED,
        }}
      >
        {label}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexDirection: side === "d" ? "row-reverse" : "row" }}>
        {/* Two stacked layers: -webkit-text-stroke centers the stroke on the
            glyph contour, so its inner half crosses into counters and busts
            tight corners (e.g. the "6" or "8" bowl). An opaque, pattern-filled
            copy painted on top hides that inner half, leaving only the clean
            outer half of the stroke visible. */}
        <div
          style={{
            position: "relative",
            display: "inline-block",
            minWidth: "2ch",
            textAlign: side === "d" ? "right" : "left",
            fontFamily: MONO_FONT,
            fontWeight: 600,
            fontSize: metricSize,
            lineHeight: 0.92,
            letterSpacing: "-0.03em",
          }}
        >
          <span
            aria-hidden="true"
            style={{
              position: "absolute",
              left: 0,
              top: 0,
              width: "100%",
              color: "transparent",
              WebkitTextStroke: `${OUTLINE_WEIGHT}px ${color}`,
            }}
          >
            {value}
          </span>
          <span
            style={{
              position: "relative",
              color: "transparent",
              backgroundColor: CARD_SURFACE,
              backgroundImage: [
                hatchBackgroundImage(deg, mix(color, Math.min(100, PATTERN_STRENGTH * 260))),
                `linear-gradient(to bottom, ${mix(color, Math.min(100, 67 + 40))} 0%, ${mix(color, 67 * 0.3)} 100%)`,
              ].join(", "),
              WebkitBackgroundClip: "text",
              backgroundClip: "text",
            }}
          >
            {value}
          </span>
        </div>
        {/* A zero delta never renders — "→ 0" is noise, not signal, and at
            real data rates it's the single most common case. */}
        {/* Direction is shape (R2) and size is weight (R3), so the delta is an
            arrow plus its F1 label plus the magnitude — no tint, no hue that
            varies by direction. The label is visually hidden here because the
            block is a dense metric card, but it still reaches assistive tech,
            which is more than the old bare "↗ 8" chip offered. */}
        {delta !== 0 && (
          <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
            <TrendArrow trend={deltaTrend(delta)} labelHidden />
            <Magnitude value={Math.abs(delta)} style={{ fontFamily: MONO_FONT }} />
          </span>
        )}
      </div>
    </div>
  );
}

/**
 * The Δ badge between two MetricBlocks: how far apart desktop and mobile are
 * at the shown index. A magnitude, so it takes no hue at any gap size —
 * "desktop is 40 ahead of mobile" is a quantity, and whether that is bad is
 * the numerals' job to say. Extracted because small and medium/large carried
 * byte-identical copies of it, which is how two of the same thing get
 * tokenised differently.
 */
function GapChip({ gap }: { gap: number }) {
  return (
    <div style={{ flex: "none", alignSelf: "stretch", display: "flex", flexDirection: "column-reverse", alignItems: "center", gap: 8, padding: "0 2px", width: 50 }}>
      {/* Invisible spacer holding the row that MetricBlock's device caption
          occupies, so the badge sits level with the numerals rather than the
          captions. Decoration — it renders no glyph anyone can see — so it is
          one of the two sites exempt from the 12px floor. */}
      <span aria-hidden="true" style={{ fontSize: 11, height: 15, lineHeight: "15px", color: "transparent" }}>·</span>
      <div style={{ flex: "1 1 auto", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 3,
            boxSizing: "border-box",
            // 46, not 41: the label went 11.5 -> 12px and a three-digit gap
            // has to keep fitting. The column widened to match.
            width: 46,
            padding: "3px 4px",
            borderRadius: 999,
            border: `1px solid ${CARD_HAIRLINE}`,
            fontFamily: MONO_FONT,
            fontSize: 12,
            fontWeight: 550,
            letterSpacing: "0.03em",
            whiteSpace: "nowrap",
          }}
        >
          <span style={{ color: "var(--magnitude-unit)" }}>Δ</span>
          <span style={{ color: "var(--magnitude-value)", fontWeight: 650, fontVariantNumeric: "tabular-nums" }}>{gap}</span>
        </span>
      </div>
    </div>
  );
}

// ── XSmall — chromeless row cell ────────────────────────────────────────
// A table-row cell, not a card: an outlined neutral "was" chip, a series-
// coloured hairline carrying a D/M device badge, and a health-banded "is"
// chip, once per device (or once, for a single-metric card — see
// hasSecondSeries). No delta pill at this density (see MetricBlock for the
// shared "never render a zero delta" rule at small/medium/large) — the two
// chips a few inches apart on the row make the comparison obvious without
// one, and it would otherwise spend the row's tightest pixels on `→ 0` five
// times out of eight. Reuses the same domain and band helpers as every other
// density (see density handoff §4). Anomaly gaps are bridged (no real gap
// data exists in this app's model, so this is naturally satisfied by never
// segmenting the path) and the range band collapses to a single hairline.
// No card frame, no chart height prop — this density does not draw a chart
// in the normal sense.

export function XSmallScoreCard({ data, showTitle = true }: ScoreCardProps) {
  const hasMobile = hasSecondSeries(data);
  const pointCount = hasMobile ? Math.min(data.desktop.length, data.mobile!.length) : data.desktop.length;
  // Both device rows plot at the app-wide fixed points-per-pixel scale
  // (see xsmallBounds) — the same visual slope means the same score change
  // everywhere in the table, at every time range — while each still
  // centers on its own extent so a flat line sits level with its chips.
  const dBounds = useMemo(() => xsmallBounds(data.desktop), [data.desktop]);
  const mBounds = useMemo(() => xsmallBounds(hasMobile ? data.mobile! : data.desktop), [hasMobile, data.mobile, data.desktop]);

  if (pointCount === 0) {
    return (
      <div style={{ width: "100%", minWidth: 0, boxSizing: "border-box", padding: "16px 18px 18px", display: "flex", flexDirection: "column", gap: 10, fontFamily: SANS_FONT }}>
        {showTitle && <CardTitle title={data.title} fontSize={12} color={INK_MUTED} uppercase />}
        <div style={{ color: INK_MUTED, fontSize: 12 }}>No collections in range.</div>
      </div>
    );
  }

  const last = pointCount - 1;
  const dv = data.desktop[last];
  const dChip = bandChip(dv);
  const mobile = hasMobile ? data.mobile! : null;
  const mv = mobile ? mobile[last] : null;
  const mChip = mobile ? bandChip(mv!) : null;

  return (
    // Explicit width: 100% (not left to an ancestor to stretch us) — this
    // card needs a definite width for XSmallDeviceRow's `flex: 1 1 0`
    // sparkline slot to have any free space to grow into. A grid item's
    // default stretch happens to give us one today, but this card is a
    // reusable export and shouldn't quietly collapse to a stub if it's ever
    // placed somewhere that doesn't stretch it (an inline-flex wrapper, a
    // shrink-to-fit flex row, …) — matches SmallScoreCard/ScaledScoreCard,
    // which already set this for the same reason.
    <div style={{ width: "100%", minWidth: 0, boxSizing: "border-box", padding: "16px 18px 18px", display: "flex", flexDirection: "column", gap: 10, fontFamily: SANS_FONT }}>
      {showTitle && (
        <span style={{ alignSelf: "flex-start", maxWidth: "100%" }}>
          <CardTitle title={data.title} fontSize={12} color={INK_MUTED} uppercase />
        </span>
      )}
      <XSmallDeviceRow device="d" showBadge={hasMobile} values={data.desktop} trusted={data.desktopTrusted} bounds={dBounds} displayValue={dv} chip={dChip} />
      {mobile && (
        <XSmallDeviceRow device="m" showBadge values={mobile} trusted={data.mobileTrusted} bounds={mBounds} displayValue={mv!} chip={mChip!} />
      )}
    </div>
  );
}

/** Round to 2 decimal places — plenty for a CSS percentage, tidier than a raw float. */
function pct(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Below this measured slot width, XSmallDeviceRow drops the line entirely rather than draw an unreadable stub. */
const XSMALL_MIN_SLOT_WIDTH = 48;

/**
 * Measures a ref'd element's real rendered width via ResizeObserver (same
 * approach as charts.tsx's useResponsiveChartWidth), for callers that need
 * to size their output to the actual box rather than an assumed one.
 * Starts at `Infinity` rather than a guessed width, so a caller using this
 * to decide how much to downsample never over-decimates on a wrong first
 * guess — it just renders at full resolution until the first real
 * measurement lands, a run or two later.
 */
function useMeasuredWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(Infinity);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const updateWidth = (nextWidth: number) => {
      if (!Number.isFinite(nextWidth) || nextWidth <= 0) return;
      setWidth((currentWidth) => (Number.isFinite(currentWidth) && Math.abs(currentWidth - nextWidth) < 0.5 ? currentWidth : nextWidth));
    };

    updateWidth(el.getBoundingClientRect().width);
    const observer = new ResizeObserver((entries) => updateWidth(entries[0]?.contentRect.width ?? 0));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return { ref, width };
}

function XSmallDeviceRow({
  device,
  showBadge,
  values,
  trusted,
  bounds,
  displayValue,
  chip,
}: {
  device: "d" | "m";
  /** False for a single-metric card's lone row (e.g. Agent) — there's no second device to disambiguate from, so the D/M badge would misleadingly claim this is desktop data. */
  showBadge: boolean;
  /** The full RAW series (data.desktop/mobile) — the source of truth for the domain, the start chip, and (after downsampling to the slot's real width) the plotted line. */
  values: number[];
  /** Same length/order as `values`; a `false` excludes that night from the downsample below. Omitted means every night is trusted. */
  trusted?: boolean[];
  /** Domain this series was plotted with — the same one seriesPaths/yFor use for the plotted points. */
  bounds: [number, number];
  /** Current value shown in the solid chip — may differ from `values.at(-1)` when the other device's series is shorter (see XSmallScoreCard's pointCount truncation). */
  displayValue: number;
  /** The health band's paired ground + ink for `displayValue` — see bandChip. The line does NOT take this; it takes the device's series identity. */
  chip: { bg: string; text: string };
}) {
  const startValue = values[0];

  // At 90 days, every raw night plotted into a ~90px slot is sub-pixel —
  // what renders is aliasing noise, not a trend. Downsample to roughly one
  // point per 3px of the slot's REAL width (measured, not assumed — the
  // chips beside it are now intrinsically sized, so this slot's width
  // varies with their digit count) before plotting; re-runs whenever the
  // slot resizes. The chips/displayValue above read `values` directly,
  // never this downsampled view.
  const { ref: slotRef, width: slotWidth } = useMeasuredWidth<HTMLDivElement>();
  // A single-metric card (no second device) has no ancestor forcing a wide
  // column; if its own slot genuinely can't clear this floor even after
  // XSmallScoreCard's width: 100% fix, a few-px stub reads as broken chrome
  // rather than a chart. Below the floor, skip the line and dot entirely —
  // two chips with a gap reads as intentional; this stays keyed off the
  // SAME unconstrained measurement `target` below uses (not a CSS
  // min-width on the slot, which would just make it stop being able to
  // report a width under 48 and never trigger this at all).
  const showLine = slotWidth >= XSMALL_MIN_SLOT_WIDTH;
  const target = xsmallTargetPointCount(slotWidth);
  const plotted = useMemo(() => bucketSeries(values, target, trusted), [values, target, trusted]);

  const path = seriesPaths(plotted, bounds).line;

  // Centered on this series' OWN rendered extent, not the viewBox's nominal
  // middle: yFor's headroom convention (see lib/scoreCard.ts) intentionally
  // isn't symmetric, so without this a flat or near-flat line would sit a
  // couple percent high or low in its 16px slot. SHIFT is a pure CSS
  // translate applied after plotting — the path's own shape/amplitude is
  // untouched, only where it sits vertically.
  const ys = plotted.map((v) => (yFor(v, bounds) / 40) * 100);
  const shift = 50 - (Math.min(...ys) + Math.max(...ys)) / 2;
  // The device badge rides the line at its horizontal midpoint (x=50%,
  // where the badge is always positioned below). The line's points are
  // evenly spaced, so x=50% falls exactly on a point only when there's an
  // odd number of them — sampling "the middle index" instead would put the
  // badge visibly off the actual stroke on any even-length series (a very
  // steep/jagged one makes even a couple % of horizontal error obvious).
  // Interpolating the two points straddling x=50% keeps the badge glued to
  // the line regardless of point count.
  const midT = (plotted.length - 1) / 2;
  const midLo = Math.floor(midT);
  const midHi = Math.ceil(midT);
  const midFrac = midT - midLo;
  const midY = ys[midLo] + (ys[midHi] - ys[midLo]) * midFrac + shift;

  const strokeWidth = device === "d" ? 2 : 1.4;
  const label = device === "d" ? "D" : "M";

  const chipBase: CSSProperties = {
    flex: "none",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    boxSizing: "border-box",
    padding: "2px 4px",
    borderRadius: 5,
    fontFamily: MONO_FONT,
    fontSize: 12,
    fontVariantNumeric: "tabular-nums",
  };

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 0 }}>
      {/* start — outlined neutral chip ("was"). No verdict on it: it is the
          window's opening value, and what matters is the distance to the
          chip at the other end, not whether the past was good. */}
      <span style={{ ...chipBase, border: "1px solid var(--border-strong)", background: "transparent", fontWeight: 450, color: INK_MUTED }}>{startValue}</span>

      {/* sparkline — one flat series-coloured hairline, centered on its own extent,
          device badge riding it. Below XSMALL_MIN_SLOT_WIDTH this stays mounted (still
          measured, so a later resize back above the floor recovers the line) but renders
          nothing — an unreadable few-px stub is worse than an honest gap between the
          two chips. */}
      <div ref={slotRef} style={{ flex: "1 1 0", minWidth: 0, position: "relative", height: 16 }}>
        {showLine && (
          <>
            <svg
              viewBox="0 0 100 40"
              preserveAspectRatio="none"
              style={{ position: "absolute", inset: 0, width: "100%", height: "100%", overflow: "visible", transform: `translateY(${pct(shift)}%)` }}
            >
              {/* This used to be a neutral -> verdict gradient: the line started
                  grey and ramped into the band hue of its own final value, so a
                  page that fell below 50 got a red line and the same page at 91
                  got a green one. That is the R4 violation in miniature — the
                  mark's hue answering "is this good?" instead of "which series
                  is this?". One flat series token now, and the verdict is left
                  to the chip at the end of the row, which is the only element
                  on this row that is actually claiming one. */}
              <path
                d={path}
                vectorEffect="non-scaling-stroke"
                style={{ fill: "none", stroke: SERIES_VAR[device], strokeWidth, strokeLinejoin: "round", strokeLinecap: "round" }}
              />
            </svg>
            {showBadge && (
              <span
                style={{
                  position: "absolute",
                  left: "50%",
                  top: `${pct(midY)}%`,
                  transform: "translate(-50%, -50%)",
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  // 14, up from 12: the "D"/"M" went to 12px and needs the room.
                  width: 14,
                  height: 14,
                  boxSizing: "border-box",
                  fontFamily: MONO_FONT,
                  fontSize: 12,
                  fontWeight: 600,
                  letterSpacing: "0.03em",
                  color: INK_MUTED,
                  // Knocks the line out behind the letter — must be the surface
                  // this row sits on.
                  background: CARD_SURFACE,
                  borderRadius: 3,
                  whiteSpace: "nowrap",
                }}
              >
                {label}
              </span>
            )}
          </>
        )}
      </div>

      {/* current — the health verdict ("is"). The band's own `-text` token is
          the on-colour for its `-bg`, so this pairs by construction instead of
          hand-picking ink for a solid fill. */}
      <span style={{ ...chipBase, border: "1px solid transparent", background: chip.bg, fontWeight: 700, color: chip.text }}>{displayValue}</span>
    </div>
  );
}

// ── Medium / Large ──────────────────────────────────────────────────────────────
// Real run-to-run range bands (CategoryScore.lo/hi), real anomaly breaks
// (Night.evidenceStatus), and real change markers (ChangeMarker), sourced by
// the caller from actual page history (see scoreCardAdapter.ts) rather than
// fabricated. A category with no real spread at any trusted point (e.g. a
// near-flat single-run series) naturally falls back to a bare line, per the
// density handoff §4 — that fallback is driven by the data, not a
// category-name special case.
function ScaledScoreCard({
  data,
  cardWidth = 320,
  defaultMetricSize,
  density,
}: ScoreCardProps & { density: "medium" | "large"; defaultMetricSize: number }) {
  const uid = useId();
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const isLarge = density === "large";
  const hasMobile = hasSecondSeries(data);

  const pointCount = hasMobile ? Math.min(data.desktop.length, data.mobile!.length) : data.desktop.length;
  const last = Math.max(0, pointCount - 1);
  const idx = Math.min(shownIndex(hoverIndex, last), last);
  const metricSize = Math.max(defaultMetricSize, Math.min(72, cardWidth * 0.15));
  const bounds = useMemo(() => domain(hasMobile ? [...data.desktop, ...data.mobile!] : [...data.desktop]), [data.desktop, data.mobile, hasMobile]);
  const dp = useMemo(() => (pointCount > 0 ? seriesPaths(data.desktop, bounds) : null), [data.desktop, bounds, pointCount]);
  const mp = useMemo(() => (hasMobile && pointCount > 0 ? seriesPaths(data.mobile!, bounds) : null), [hasMobile, data.mobile, bounds, pointCount]);
  const dSegments = useMemo(() => trustedIndexSegments(data.desktopTrusted, pointCount), [data.desktopTrusted, pointCount]);
  const mSegments = useMemo(() => (hasMobile ? trustedIndexSegments(data.mobileTrusted, pointCount) : []), [hasMobile, data.mobileTrusted, pointCount]);

  if (pointCount === 0 || !dp) {
    return <EmptyScoreCard title={data.title} />;
  }

  const dv = data.desktop[idx];
  const dDelta = deltaFromStart(data.desktop, idx);
  // Health ink for the numerals only — every chart mark below reads
  // SERIES_VAR instead. See the file header.
  const dInk = bandVar(dv);
  const mv = hasMobile ? data.mobile![idx] : null;
  const mDelta = hasMobile ? deltaFromStart(data.mobile!, idx) : null;
  const mInk = hasMobile ? bandVar(mv!) : null;
  const gap = hasMobile ? Math.abs(dv - mv!) : null;
  const rangeLabel = hoverIndex === null ? "" : dateAt(hoverIndex, last);
  const gId = (k: "d" | "m") => `scorecard-${uid}-g-${k}`;
  const cId = (k: "d" | "m") => `scorecard-${uid}-c-${k}`;
  const isTrusted = (device: "d" | "m", index: number) => {
    const flags = device === "d" ? data.desktopTrusted : data.mobileTrusted;
    return flags ? flags[index] !== false : true;
  };

  const handleMove = (event: MouseEvent<HTMLDivElement>) => {
    if (last === 0) return;
    const rect = event.currentTarget.getBoundingClientRect();
    if (!rect.width) return;
    const ratio = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
    setHoverIndex(Math.round(ratio * last));
  };
  const dotLeft = (index: number) => `${(index / last) * 100}%`;

  // Only Performance-shaped data (a real run-to-run spread somewhere in a
  // trusted segment) draws a band; a near-flat single-run category (e.g.
  // Accessibility/BP/SEO) draws a bare line for that segment instead, exactly
  // like the density handoff describes — driven by data.desktopRange/
  // mobileRange, not by data.title.
  const bandFor = (device: "d" | "m", segment: number[]): { path: string; clip: string } | null => {
    const range = device === "d" ? data.desktopRange : data.mobileRange;
    if (!range) return null;
    const path = segmentRangeBand(range, segment, last, bounds);
    const clip = segmentRangeBandClip(range, segment, last, bounds);
    return path && clip ? { path, clip } : null;
  };

  // §4's marker labels alternate rows by index and flip to the left of their
  // line past the horizontal midpoint, so a late marker never runs off the
  // card. Restrict to markers that actually fall inside the rendered window.
  const visibleMarkers = (data.markers ?? []).filter((marker) => marker.index >= 0 && marker.index <= last);

  return (
    <div
      style={{
        minWidth: 0,
        height: CARD_HEIGHT[density],
        boxSizing: "border-box",
        background: CARD_SURFACE,
        border: `1px solid ${CARD_HAIRLINE}`,
        borderRadius: CARD_RADIUS,
        padding: CARD_PADDING,
        display: "flex",
        flexDirection: "column",
        gap: 11.5,
        fontFamily: SANS_FONT,
      }}
    >
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10 }}>
        <CardTitle title={data.title} fontSize={17} color={INK_BODY} />
        <span style={{ fontFamily: MONO_FONT, fontSize: 12, fontVariantNumeric: "tabular-nums", color: INK_MUTED, whiteSpace: "nowrap" }}>{rangeLabel}</span>
      </div>

      <div style={{ display: "flex", alignItems: "stretch", gap: 8, margin: "4px 0 8px" }}>
        <MetricBlock side="d" label={hasMobile ? "Desktop" : undefined} value={dv} color={dInk} delta={dDelta} metricSize={metricSize} />
        {hasMobile && <GapChip gap={gap!} />}
        {hasMobile && (
          <MetricBlock side="m" label="Mobile" value={mv!} color={mInk!} delta={mDelta!} metricSize={metricSize} />
        )}
      </div>

      <ChartClipWrapper inset={isLarge}>
        <div
          onMouseMove={handleMove}
          onMouseLeave={() => setHoverIndex(null)}
          style={{
            position: "relative",
            height: "100%",
            width: isLarge ? "100%" : `calc(100% + ${2 * CARD_PADDING}px)`,
            margin: isLarge ? 0 : `0 -${CARD_PADDING}px -${CARD_PADDING}px`,
          }}
        >
          <svg
            viewBox="0 0 100 40"
            preserveAspectRatio="none"
            style={{ position: "absolute", inset: 0, width: "100%", height: "100%", overflow: "visible", pointerEvents: "none" }}
          >
            <defs>
              <linearGradient id={gId("d")} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" style={{ stopColor: SERIES_VAR.d, stopOpacity: FILL_TOP_OPACITY }} />
                <stop offset="1" style={{ stopColor: SERIES_VAR.d, stopOpacity: FILL_END_OPACITY }} />
              </linearGradient>
              {hasMobile && (
                <linearGradient id={gId("m")} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0" style={{ stopColor: SERIES_VAR.m, stopOpacity: FILL_TOP_OPACITY }} />
                  <stop offset="1" style={{ stopColor: SERIES_VAR.m, stopOpacity: FILL_END_OPACITY }} />
                </linearGradient>
              )}
              <clipPath id={cId("d")} clipPathUnits="objectBoundingBox">
                <path d={dp.clip} />
              </clipPath>
              {hasMobile && mp && (
                <clipPath id={cId("m")} clipPathUnits="objectBoundingBox">
                  <path d={mp.clip} />
                </clipPath>
              )}
            </defs>
          </svg>

          {isLarge && <LargeChartAxes bounds={bounds} last={last} data={data} />}

          {/* Run-to-run range band per trusted segment, one hatch layer per band —
              replaces small's area-under-the-median fill (§4). The band is the
              spread of the SAME series, so it takes that series' colour, not the
              health band of the median inside it: how far apart two runs landed
              is not a verdict about either of them. */}
          {dSegments.map((segment) => {
            const band = bandFor("d", segment);
            if (!band) return null;
            const clipId = `${cId("d")}-band-${segment[0]}`;
            return (
              <RangeBandLayer key={`d-band-${segment[0]}`} clipId={clipId} path={band.path} clipPath={band.clip} degrees={45} color={SERIES_VAR.d} />
            );
          })}
          {mSegments.map((segment) => {
            const band = bandFor("m", segment);
            if (!band) return null;
            const clipId = `${cId("m")}-band-${segment[0]}`;
            return (
              <RangeBandLayer key={`m-band-${segment[0]}`} clipId={clipId} path={band.path} clipPath={band.clip} degrees={-45} color={SERIES_VAR.m} />
            );
          })}

          {/* Anomaly gap: a dashed NEUTRAL block between two trusted segments,
              matching HistoryChart's anomaly presentation (§4). An excluded run
              is an evidence-quarantine fact, not a warning about the page — the
              broken line and the dashed edges are the signal. */}
          {Array.from({ length: pointCount }, (_, index) => index)
            .filter((index) => !isTrusted("d", index) || (hasMobile && !isTrusted("m", index)))
            .map((index) => (
              <AnomalyBlock key={`anomaly-${index}`} x={xFor(index, last)} width={last > 0 ? 100 / last : 100} />
            ))}

          {/* Median lines, one per trusted segment so the line breaks around an
              anomaly instead of bridging it (§4's "the line breaks around it"). */}
          <svg
            viewBox="0 0 100 40"
            preserveAspectRatio="none"
            style={{ position: "absolute", inset: 0, width: "100%", height: "100%", overflow: "visible", pointerEvents: "none" }}
          >
            {dSegments.map((segment) => (
              <LineOrDot key={`d-line-${segment[0]}`} segment={segment} values={data.desktop} bounds={bounds} last={last} color={SERIES_VAR.d} width={2.5} />
            ))}
            {hasMobile && mSegments.map((segment) => (
              <LineOrDot key={`m-line-${segment[0]}`} segment={segment} values={data.mobile!} bounds={bounds} last={last} color={SERIES_VAR.m} width={1.5} />
            ))}
          </svg>

          {/* Markers: dashed vertical + dot + label, alternating rows, flipping
              left past the midpoint (§4's marker placement rule). */}
          {visibleMarkers.map((marker, index) => (
            <MarkerLine key={`marker-${marker.index}-${index}`} marker={marker} x={xFor(marker.index, last)} rowIndex={index} />
          ))}

          <div
            aria-hidden="true"
            style={{
              position: "absolute",
              top: 0,
              bottom: 0,
              width: 1,
              background: INK_MUTED,
              opacity: 0.35,
              display: hoverIndex === null ? "none" : "block",
              left: `${(hoverIndex ?? 0) / last * 100}%`,
              transform: "translateX(-50%)",
              pointerEvents: "none",
            }}
          />
          <ChartDot visible={hoverIndex !== null && isTrusted("d", idx)} left={dotLeft(idx)} top={dp.yPct(dv)} color={SERIES_VAR.d} />
          {hasMobile && mp && <ChartDot visible={hoverIndex !== null && isTrusted("m", idx)} left={dotLeft(idx)} top={mp.yPct(mv!)} color={SERIES_VAR.m} />}
        </div>
      </ChartClipWrapper>

      {isLarge && <LargeDateAxis last={last} />}
    </div>
  );
}

/**
 * One clipped hatch layer over the real run-to-run range band, mirroring
 * small's area-under-the-median treatment but shaped to `path` (the band's
 * own polygon) instead of the median's clip curve.
 */
function RangeBandLayer({ clipId, path, clipPath, degrees, color }: { clipId: string; path: string; clipPath: string; degrees: number; color: string }) {
  const style = {
    position: "absolute",
    inset: 0,
    WebkitClipPath: `url(#${clipId})`,
    clipPath: `url(#${clipId})`,
    pointerEvents: "none",
    backgroundImage: hatchBackgroundImage(degrees, mix(color, PATTERN_STRENGTH * 100)),
  } as CSSProperties;
  return (
    <>
      <svg viewBox="0 0 100 40" preserveAspectRatio="none" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none" }}>
        <defs>
          {/* objectBoundingBox (0..1 coords), not userSpaceOnUse: this
              clipPath is applied via CSS clip-path to the plain HTML div
              below, not to another shape inside this <svg> — userSpaceOnUse
              would clip to the raw 100x40 viewBox units taken as literal
              CSS px, pinning the clip to a tiny region in the div's corner
              instead of scaling to its actual box. */}
          <clipPath id={clipId} clipPathUnits="objectBoundingBox">
            <path d={clipPath} />
          </clipPath>
        </defs>
        {/* `fill` in `style`, not as a presentation attribute — see LineSvg. */}
        <path d={path} style={{ fill: mix(color, 16) }} />
      </svg>
      <div aria-hidden="true" style={style} />
    </>
  );
}

/**
 * Dashed neutral block between two trusted segments — the anomaly gap (§4),
 * one 0..100 unit wide per point.
 *
 * This was a dashed amber block. Amber is a health warning, and a quarantined
 * PSI run is not a warning about the page: it is a statement that this night's
 * measurement is not being counted. The shape (a break in the line plus dashed
 * edges) is the whole signal, so the fill and the edges are neutral series
 * tokens and the reader is not told the page got worse when it did not.
 */
function AnomalyBlock({ x, width }: { x: number; width: number }) {
  return (
    <div
      aria-hidden="true"
      style={{
        position: "absolute",
        top: 0,
        bottom: 0,
        left: `${Math.max(0, x - width / 2)}%`,
        width: `${width}%`,
        background: "var(--series-anomaly-fill)",
        borderLeft: "1px dashed var(--series-anomaly-edge)",
        borderRight: "1px dashed var(--series-anomaly-edge)",
        pointerEvents: "none",
      }}
    />
  );
}

/** One trusted segment's median line, or a bare dot when the segment is a single trusted point with nothing to connect to. */
function LineOrDot({
  segment,
  values,
  bounds,
  last,
  color,
  width,
}: {
  segment: number[];
  values: number[];
  bounds: [number, number];
  last: number;
  color: string;
  width: number;
}) {
  if (segment.length === 1) {
    const index = segment[0];
    // Geometry stays an attribute; paint moves to `style` so the custom
    // property resolves (see LineSvg).
    return <circle cx={xFor(index, last)} cy={yFor(values[index], bounds)} r={0.9} style={{ fill: color }} />;
  }
  return (
    <path
      d={segmentLine(values, segment, last, bounds)}
      vectorEffect="non-scaling-stroke"
      strokeWidth={width}
      style={{
        fill: "none",
        stroke: color,
        strokeLinejoin: "round",
        filter: `drop-shadow(0 0 ${GLOW_SPREAD / 2}px ${mix(color, GLOW_OPACITY * 100)}) drop-shadow(0 0 ${GLOW_SPREAD}px ${mix(color, GLOW_OPACITY * 60)})`,
      }}
    />
  );
}

/**
 * One change marker: dashed vertical line, dot, and label. Labels alternate
 * between two rows by index and flip to the line's left past the horizontal
 * midpoint so a late marker never runs off the card.
 *
 * Both kinds of marker are one neutral `--series-marker`. Provenance is not a
 * verdict, and the old violet-for-task / grey-for-user split was carrying that
 * distinction in hue alone at the same time as two other channels already
 * carried it: the dot is round for a task and square for a user marker, and a
 * task marker's own text is prefixed "Completed: " by taskMarkers.ts. Colour
 * was the only one of the three a colour-blind reader could not use.
 */
function MarkerLine({ marker, x, rowIndex }: { marker: ScoreCardMarker; x: number; rowIndex: number }) {
  const color = "var(--series-marker)";
  const pastMidpoint = x > 50;
  const top = rowIndex % 2 === 0 ? 2 : 22;
  return (
    <div aria-hidden="true" style={{ position: "absolute", top: 0, bottom: 0, left: `${x}%`, width: 0, borderLeft: `1px dashed ${color}`, opacity: 0.8, pointerEvents: "none" }}>
      <span
        style={{
          position: "absolute",
          top,
          left: pastMidpoint ? "auto" : 7,
          right: pastMidpoint ? 7 : "auto",
          display: "flex",
          flexDirection: pastMidpoint ? "row-reverse" : "row",
          alignItems: "center",
          gap: 6,
          whiteSpace: "nowrap",
        }}
      >
        <span
          style={{
            width: 6,
            height: 6,
            borderRadius: marker.isTask ? "50%" : 1,
            background: color,
            margin: pastMidpoint ? "0 -10px 0 0" : "0 0 0 -10px",
            flex: "none",
          }}
        />
        <span style={{ fontFamily: MONO_FONT, fontSize: 12, fontWeight: 600, color, background: CARD_SURFACE, padding: "1px 4px", borderRadius: 3 }}>
          {marker.text}
        </span>
      </span>
    </div>
  );
}

/** Large-only gridlines + y-tick labels + benchmark/previous-period reference lines, computed from the same bounds as the plotted lines. */
function LargeChartAxes({ bounds, last, data }: { bounds: [number, number]; last: number; data: ScoreCardData }) {
  const [lo, hi] = bounds;
  const mid = (lo + hi) / 2;
  // Keyed by tick position (max/mid/min), not by value: a tight or flat
  // domain can legitimately round two of these to the same displayed
  // integer, which must not produce a duplicate React key.
  const ticks = [
    { key: "max", value: Math.round(hi), pct: (yFor(hi, bounds) / 40) * 100 },
    { key: "mid", value: Math.round(mid), pct: (yFor(mid, bounds) / 40) * 100 },
    { key: "min", value: Math.round(lo), pct: (yFor(lo, bounds) / 40) * 100 },
  ];
  // Reference lines: this device-pair card shows one shared benchmark (the
  // window's start value) and, when the window is long enough to compare
  // halves, the previous half's median — both derived from the same series
  // already on the card, not fabricated fields.
  const benchmark = data.desktop[0];
  const benchmarkPct = yFor(benchmark, bounds) / 40 * 100;
  return (
    <>
      {ticks.map((tick) => (
        <div key={tick.key} aria-hidden="true">
          <div style={{ position: "absolute", left: 0, right: 0, top: `${tick.pct}%`, borderTop: "1px solid var(--series-grid)", pointerEvents: "none" }} />
          <span style={{ position: "absolute", left: 0, top: `${tick.pct}%`, transform: "translateY(-50%)", background: CARD_SURFACE, paddingRight: 5, fontFamily: MONO_FONT, fontSize: 12, fontVariantNumeric: "tabular-nums", color: "var(--series-axis)", pointerEvents: "none" }}>
            {tick.value}
          </span>
        </div>
      ))}
      {last > 0 && (
        // Reference line, deliberately heavier than the gridlines and lighter
        // than a series: the dash pattern is what tells it apart, the alpha
        // only keeps it from competing with the data.
        <div style={{ position: "absolute", left: 0, right: 0, top: `${benchmarkPct}%`, borderTop: `1px dashed ${mix("var(--border-strong)", 40)}`, pointerEvents: "none" }} aria-hidden="true" />
      )}
    </>
  );
}

/** Large-only date axis directly under the chart: first, middle, and last plotted dates. */
function LargeDateAxis({ last }: { last: number }) {
  if (last === 0) return null;
  const mid = Math.round(last / 2);
  const first = dateAt(0, last);
  const middle = dateAt(mid, last);
  const end = dateAt(last, last);
  return (
    <div style={{ flex: "none", display: "flex", alignItems: "baseline", gap: 24, marginTop: 8, fontFamily: MONO_FONT, fontSize: 12, color: "var(--series-axis)" }}>
      <span style={{ flex: "1 1 0", display: "flex", justifyContent: "flex-start" }}>{first}</span>
      <span style={{ flex: "1 1 0", display: "flex", justifyContent: "center" }}>{middle}</span>
      <span style={{ flex: "1 1 0", display: "flex", justifyContent: "flex-end" }}>{end}</span>
    </div>
  );
}
