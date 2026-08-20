"use client";

// ScoreCard — desktop + mobile Lighthouse scores for one category, at equal
// visual weight, with a scrubbable 24-day chart driving every number in the
// card. Ported pixel-for-pixel from the design reference
// (ScoreCard.reference.html) onto this codebase's conventions: inline
// `style={}` objects with the shared `C` palette (see src/lib/ui.ts), the
// same pattern used by every other card in this app (see bits.tsx / the
// Overview tab in pages/[id]/page.tsx) rather than Tailwind utility classes,
// which this app has wired up but does not use for component styling.
//
// All geometry/color math lives in a separate pure module (src/lib/scoreCard.ts)
// with its own unit tests; this file is only responsible for layout, DOM
// structure, and wiring hover state to that math.

import { useId, useMemo, useState, type CSSProperties, type MouseEvent, type ReactNode } from "react";
import { C } from "@/lib/ui";
import {
  bandColor,
  deltaColor,
  deltaFromStart,
  domain,
  hatchBackgroundImage,
  rgba,
  segmentLine,
  segmentRangeBand,
  seriesPaths,
  shownIndex,
  trustedIndexSegments,
  xFor,
  yFor,
} from "@/lib/scoreCard";
import { metricTooltipFor, SCORE_BANDS_LABEL } from "@/lib/scoreCardTooltip";

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
   * that range control rather than being fixed at 24.
   */
  desktop: number[];
  /** Same length and order as `desktop`. */
  mobile: number[];
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
  /** Default 'dark'. */
  theme?: "dark" | "light";
  /**
   * Default 'small' — today's production card, byte-identical apart from the
   * metric tooltip (see scoreCardTooltip.ts). 'xsmall' is a chromeless row
   * cell for dense overviews/tables. 'medium'/'large' scale the same chart
   * pipeline up for a full-detail read. See the ScoreCard density handoff.
   */
  density?: ScoreCardDensity;
};

// ── Design tokens ────────────────────────────────────────────────────────
// This app's shared palette (src/lib/ui.ts `C`) already carries the dark-theme
// card / border / text tokens and the four status colors used below, so this
// card reuses `C` directly rather than re-declaring them. The light theme has
// no equivalent anywhere in this app (it is exclusively dark-themed), so its
// values are the literal hex from the README with a TODO left in place.
interface MetricTheme {
  page: string;
  card: string;
  hair: string;
  ink1: string;
  ink2: string;
  ink3: string;
  chipText: string;
  chipTint: number;
}

const THEME: Record<"dark" | "light", MetricTheme> = {
  dark: {
    page: "#060606", // TODO: token — no page-background equivalent in `C`; only used behind the demo grid, not the card itself.
    card: C.panel,
    hair: C.border,
    ink1: C.text,
    ink2: "#ABABAB", // TODO: token — close to but distinct from C.dim (#C4C4C8); kept literal to match the reference exactly.
    ink3: C.faint2,
    chipText: "#FFFFFFCB",
    chipTint: 0.16,
  },
  light: {
    // TODO: token — this app has no light theme anywhere; every value below is
    // the literal hex from the README rather than a mapped app token.
    page: "#F0F0F0",
    card: "#FFFFFF",
    hair: "#E0E0E0",
    ink1: "#080808",
    ink2: "#5A5A5A",
    ink3: "#5A5A5A",
    chipText: "#080808CB",
    chipTint: 0.12,
  },
} as const;

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
 * and §5). Do not change its layout, type sizes, colours, chart height,
 * spacing, numeral treatment, delta chips, or hover behaviour here.
 */
function SmallScoreCard({ data, cardWidth = 320, theme = "dark" }: ScoreCardProps) {
  const t: MetricTheme = THEME[theme];
  const uid = useId();
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  // The series length follows the caller's selected date range (see
  // src/lib/scoreCardAdapter.ts) rather than a fixed 24 points.
  const pointCount = Math.min(data.desktop.length, data.mobile.length);
  const last = Math.max(0, pointCount - 1);
  const idx = Math.min(shownIndex(hoverIndex, last), last);

  const metricSize = Math.min(72, Math.max(48, cardWidth * 0.15));
  const bounds = useMemo(() => domain([...data.desktop, ...data.mobile]), [data.desktop, data.mobile]);
  const dp = useMemo(() => (pointCount > 0 ? seriesPaths(data.desktop, bounds) : null), [data.desktop, bounds, pointCount]);
  const mp = useMemo(() => (pointCount > 0 ? seriesPaths(data.mobile, bounds) : null), [data.mobile, bounds, pointCount]);

  if (pointCount === 0 || !dp || !mp) {
    return <EmptyScoreCard title={data.title} theme={t} />;
  }

  const dv = data.desktop[idx];
  const mv = data.mobile[idx];
  const dDelta = deltaFromStart(data.desktop, idx);
  const mDelta = deltaFromStart(data.mobile, idx);
  const dCol = bandColor(dv);
  const mCol = bandColor(mv);
  const dChipCol = deltaColor(dDelta);
  const mChipCol = deltaColor(mDelta);
  const gap = Math.abs(dv - mv);
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
        background: t.card,
        border: `1px solid ${t.hair}`,
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
        <CardTitle title={data.title} fontSize={17} color={t.ink1} />
        <div style={{ fontSize: 12.5, color: t.ink3, whiteSpace: "nowrap" }}>{rangeLabel}</div>
      </div>

      {/* metric row */}
      <div style={{ display: "flex", alignItems: "stretch", gap: 8, margin: "4px 0 8px" }}>
        <MetricBlock side="d" value={dv} color={dCol} chipColor={dChipCol} delta={dDelta} metricSize={metricSize} theme={t} />
        <div style={{ flex: "none", alignSelf: "stretch", display: "flex", flexDirection: "column-reverse", alignItems: "center", gap: 8, padding: "0 2px", width: 45 }}>
          <span aria-hidden="true" style={{ fontSize: 10, height: 15, lineHeight: "15px", color: "transparent" }}>·</span>
          <div style={{ flex: "1 1 auto", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 3,
                boxSizing: "border-box",
                width: 41,
                padding: "3px 4px",
                borderRadius: 999,
                border: `1px solid ${t.hair}`,
                color: t.ink3,
                fontFamily: MONO_FONT,
                fontSize: 11.5,
                fontWeight: 550,
                letterSpacing: "0.03em",
                whiteSpace: "nowrap",
              }}
            >
              <span>Δ</span>
              <span>{gap}</span>
            </span>
          </div>
        </div>
        <MetricBlock side="m" value={mv} color={mCol} chipColor={mChipCol} delta={mDelta} metricSize={metricSize} theme={t} />
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
              <stop offset="0" style={{ stopColor: dCol, stopOpacity: FILL_TOP_OPACITY }} />
              <stop offset="1" style={{ stopColor: dCol, stopOpacity: FILL_END_OPACITY }} />
            </linearGradient>
            <linearGradient id={gId("m")} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" style={{ stopColor: mCol, stopOpacity: FILL_TOP_OPACITY }} />
              <stop offset="1" style={{ stopColor: mCol, stopOpacity: FILL_END_OPACITY }} />
            </linearGradient>
            <clipPath id={cId("d")} clipPathUnits="objectBoundingBox">
              <path d={dp.clip} />
            </clipPath>
            <clipPath id={cId("m")} clipPathUnits="objectBoundingBox">
              <path d={mp.clip} />
            </clipPath>
          </defs>
          <path d={dp.area} fill={`url(#${gId("d")})`} />
          <path d={mp.area} fill={`url(#${gId("m")})`} />
        </svg>

        {/* Hatch layers are clipped DOM elements, not an SVG <pattern>: a
            pattern shears under this svg's preserveAspectRatio="none". Desktop
            hatches at 45deg, mobile at -45deg — a redundant channel with color
            for the accessibility pairing. */}
        <HatchLayer clipId={cId("d")} degrees={45} color={dCol} />
        <HatchLayer clipId={cId("m")} degrees={-45} color={mCol} />

        {/* One <svg> per line: the glow is a CSS filter on that svg's own box,
            so drop-shadow lengths resolve in real px instead of the stretched
            0..100 x 0..40 user units. */}
        <LineSvg d={dp.line} color={dCol} />
        <LineSvg d={mp.line} color={mCol} />

        <div
          aria-hidden="true"
          style={{
            position: "absolute",
            top: 0,
            bottom: 0,
            width: 1,
            background: t.ink2,
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
        <ChartDot visible={hoverIndex !== null} left={dotLeft(idx)} top={dp.yPct(dv)} color={dCol} cardBg={t.card} />
        <ChartDot visible={hoverIndex !== null} left={dotLeft(idx)} top={mp.yPct(mv)} color={mCol} cardBg={t.card} />
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
  // `flex: 1 1 auto` + `minHeight: 0` let this wrapper (and the chart inside
  // it, at height: 100%) stretch to fill whatever space is left in the
  // card's fixed total height (see CARD_HEIGHT) after the header/metric
  // rows above it, instead of the chart owning a literal pixel height.
  return (
    <div
      style={
        inset
          ? { flex: "1 1 auto", minHeight: 0, overflow: "hidden", margin: "-2px 0 0", padding: "10px 0", borderRadius: "0 0 7px 7px" }
          : { flex: "1 1 auto", minHeight: 0, overflow: "hidden", margin: `-2px -${CARD_PADDING}px -${CARD_PADDING}px`, paddingTop: 2, borderRadius: "0 0 7px 7px" }
      }
    >
      {children}
    </div>
  );
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
            background: "#1A1A1A",
            border: "1px solid #2E2E2E",
            borderRadius: 6,
            padding: "10px 11px",
            boxShadow: "0 10px 30px rgba(0,0,0,0.6)",
            pointerEvents: "none",
          }}
        >
          <span style={{ fontFamily: MONO_FONT, fontSize: 10, fontWeight: 600, letterSpacing: "0.04em", textTransform: "uppercase", color: "#8A8A90" }}>
            {copy.unit}
          </span>
          <span style={{ fontFamily: SANS_FONT, fontSize: 11.5, lineHeight: 1.45, color: "#C9C9C9" }}>{copy.body}</span>
          <span style={{ display: "flex", flexWrap: "wrap", gap: "4px 12px", paddingTop: 8, borderTop: "1px solid #2A2A2A", fontFamily: MONO_FONT, fontSize: 10, color: "#8A8A90", whiteSpace: "nowrap" }}>
            {SCORE_BANDS_LABEL.map((band) => (
              <span key={band.text} style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                <span style={{ width: 6, height: 6, borderRadius: "50%", background: band.color }} />
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
function EmptyScoreCard({ title, theme }: { title: string; theme: MetricTheme }) {
  return (
    <div
      style={{
        width: "100%",
        boxSizing: "border-box",
        background: theme.card,
        border: `1px solid ${theme.hair}`,
        borderRadius: CARD_RADIUS,
        padding: CARD_PADDING,
        display: "flex",
        flexDirection: "column",
        gap: CARD_PADDING * 0.72,
        fontFamily: SANS_FONT,
      }}
    >
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12 }}>
        <CardTitle title={title} fontSize={17} color={theme.ink1} />
      </div>
      <div style={{ padding: "20px 0", color: theme.ink3, fontSize: 12.5 }}>No collections in the selected range.</div>
    </div>
  );
}

function HatchLayer({ clipId, degrees, color }: { clipId: string; degrees: number; color: string }) {
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
    backgroundImage: hatchBackgroundImage(degrees, rgba(color, PATTERN_STRENGTH)),
  } as CSSProperties;
  return <div aria-hidden="true" style={style} />;
}

function LineSvg({ d, color }: { d: string; color: string }) {
  const glow = `drop-shadow(0 0 ${GLOW_SPREAD / 2}px ${rgba(color, GLOW_OPACITY)}) drop-shadow(0 0 ${GLOW_SPREAD}px ${rgba(color, GLOW_OPACITY * 0.6)})`;
  return (
    <svg
      viewBox="0 0 100 40"
      preserveAspectRatio="none"
      style={{ position: "absolute", inset: 0, width: "100%", height: "100%", overflow: "visible", pointerEvents: "none", filter: glow }}
    >
      <path d={d} vectorEffect="non-scaling-stroke" fill="none" stroke={color} strokeWidth={LINE_WIDTH} strokeLinejoin="round" strokeLinecap="butt" />
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
function ChartDot({ visible, left, top, color, cardBg }: { visible: boolean; left: string; top: string; color: string; cardBg: string }) {
  return (
    <div
      aria-hidden="true"
      style={{
        position: "absolute",
        width: 8,
        height: 8,
        margin: "-4px 0 0 -4px",
        borderRadius: "50%",
        background: cardBg,
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
  value,
  color,
  chipColor,
  delta,
  metricSize,
  theme,
}: {
  side: "d" | "m";
  value: number;
  color: string;
  chipColor: string;
  delta: number;
  metricSize: number;
  theme: MetricTheme;
}) {
  const deg = side === "d" ? 45 : -45;
  const arrow = delta < 0 ? "↘" : delta > 0 ? "↗" : "→";
  return (
    <div style={{ flex: "1 1 0", minWidth: 0, display: "flex", flexDirection: "column-reverse", gap: 0, alignItems: "center" }}>
      <div
        style={{
          fontSize: 10,
          height: 10,
          lineHeight: "15px",
          fontWeight: 500,
          letterSpacing: "0.4px",
          textTransform: "uppercase",
          color: C.muted,
        }}
      >
        {side === "d" ? "Desktop" : "Mobile"}
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
              backgroundColor: theme.card,
              backgroundImage: [
                hatchBackgroundImage(deg, rgba(color, Math.min(1, PATTERN_STRENGTH * 2.6))),
                `linear-gradient(to bottom, ${rgba(color, Math.min(1, 0.67 + 0.4))} 0%, ${rgba(color, 0.67 * 0.3)} 100%)`,
              ].join(", "),
              WebkitBackgroundClip: "text",
              backgroundClip: "text",
            }}
          >
            {value}
          </span>
        </div>
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 5,
            padding: "2px 4px",
            borderRadius: 4,
            fontFamily: MONO_FONT,
            fontSize: 13,
            fontWeight: 600,
            color: theme.chipText,
            background: rgba(chipColor, theme.chipTint),
            border: "1px solid transparent",
          }}
        >
          <span>{arrow}</span>
          <span>{Math.abs(delta)}</span>
        </span>
      </div>
    </div>
  );
}

// ── XSmall — chromeless row cell ────────────────────────────────────────
// A table-row cell, not a card: start value — hairline with the delta pill
// riding it — current value, once per device. Reuses the same domain, band
// color, and delta helpers as every other density (see density handoff §4).
// Anomaly gaps are bridged (no real gap data exists in this app's model, so
// this is naturally satisfied) and the range band collapses to a single
// hairline. No card frame, no chart height prop — this density does not draw
// a chart in the normal sense.

export function XSmallScoreCard({ data, theme = "dark" }: ScoreCardProps) {
  const t: MetricTheme = THEME[theme];
  const pointCount = Math.min(data.desktop.length, data.mobile.length);
  const bounds = useMemo(() => domain([...data.desktop, ...data.mobile]), [data.desktop, data.mobile]);

  if (pointCount === 0) {
    return (
      <div style={{ minWidth: 0, padding: "16px 18px 18px", display: "flex", flexDirection: "column", gap: 8, fontFamily: SANS_FONT }}>
        <CardTitle title={data.title} fontSize={10} color="#8A8A90" uppercase />
        <div style={{ color: t.ink3, fontSize: 11 }}>No collections in range.</div>
      </div>
    );
  }

  const last = pointCount - 1;
  const dv = data.desktop[last];
  const mv = data.mobile[last];
  const dDelta = deltaFromStart(data.desktop, last);
  const mDelta = deltaFromStart(data.mobile, last);
  const dCol = bandColor(dv);
  const mCol = bandColor(mv);
  const dChipCol = deltaColor(dDelta);
  const mChipCol = deltaColor(mDelta);
  const dp = seriesPaths(data.desktop, bounds);
  const mp = seriesPaths(data.mobile, bounds);

  return (
    <div style={{ minWidth: 0, padding: "16px 18px 18px", display: "flex", flexDirection: "column", gap: 8, fontFamily: SANS_FONT }}>
      <span style={{ alignSelf: "flex-start", maxWidth: "100%" }}>
        <CardTitle title={data.title} fontSize={10} color="#8A8A90" uppercase />
      </span>
      <XSmallDeviceRow value={dv} startValue={data.desktop[0]} delta={dDelta} color={dCol} chipColor={dChipCol} path={dp.line} />
      <XSmallDeviceRow value={mv} startValue={data.mobile[0]} delta={mDelta} color={mCol} chipColor={mChipCol} path={mp.line} />
    </div>
  );
}

function XSmallDeviceRow({
  value,
  startValue,
  delta,
  color,
  chipColor,
  path,
}: {
  value: number;
  startValue: number;
  delta: number;
  color: string;
  chipColor: string;
  path: string;
}) {
  const arrow = delta < 0 ? "↘" : delta > 0 ? "↗" : "→";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
      <span style={{ flex: "none", minWidth: 24, textAlign: "right", fontFamily: MONO_FONT, fontSize: 16, fontVariantNumeric: "tabular-nums", color: "#ABABAB" }}>
        {startValue}
      </span>
      <div style={{ flex: "1 1 0", minWidth: 0, position: "relative", height: 16 }}>
        <svg viewBox="0 0 100 40" preserveAspectRatio="none" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", overflow: "visible" }}>
          <path d={path} vectorEffect="non-scaling-stroke" style={{ fill: "none", stroke: color, strokeWidth: 1.5, strokeLinejoin: "round" }} />
        </svg>
        <span
          style={{
            position: "absolute",
            left: "50%",
            top: "50%",
            transform: "translate(-50%,-50%)",
            display: "inline-flex",
            alignItems: "center",
            gap: 3,
            fontFamily: MONO_FONT,
            fontSize: 10,
            fontWeight: 550,
            fontVariantNumeric: "tabular-nums",
            color: "#101010",
            backgroundColor: chipColor,
            border: `1px solid ${chipColor}`,
            borderRadius: 999,
            padding: "1px 3px",
            whiteSpace: "nowrap",
          }}
        >
          {arrow} {Math.abs(delta)}
        </span>
      </div>
      <span style={{ flex: "none", minWidth: 26, textAlign: "right", fontFamily: MONO_FONT, fontSize: 16, fontWeight: 600, lineHeight: 1, fontVariantNumeric: "tabular-nums", color }}>
        {value}
      </span>
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
  theme = "dark",
}: ScoreCardProps & { density: "medium" | "large"; defaultMetricSize: number }) {
  const t: MetricTheme = THEME[theme];
  const uid = useId();
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const isLarge = density === "large";

  const pointCount = Math.min(data.desktop.length, data.mobile.length);
  const last = Math.max(0, pointCount - 1);
  const idx = Math.min(shownIndex(hoverIndex, last), last);
  const metricSize = Math.max(defaultMetricSize, Math.min(72, cardWidth * 0.15));
  const bounds = useMemo(() => domain([...data.desktop, ...data.mobile]), [data.desktop, data.mobile]);
  const dp = useMemo(() => (pointCount > 0 ? seriesPaths(data.desktop, bounds) : null), [data.desktop, bounds, pointCount]);
  const mp = useMemo(() => (pointCount > 0 ? seriesPaths(data.mobile, bounds) : null), [data.mobile, bounds, pointCount]);
  const dSegments = useMemo(() => trustedIndexSegments(data.desktopTrusted, pointCount), [data.desktopTrusted, pointCount]);
  const mSegments = useMemo(() => trustedIndexSegments(data.mobileTrusted, pointCount), [data.mobileTrusted, pointCount]);

  if (pointCount === 0 || !dp || !mp) {
    return <EmptyScoreCard title={data.title} theme={t} />;
  }

  const dv = data.desktop[idx];
  const mv = data.mobile[idx];
  const dDelta = deltaFromStart(data.desktop, idx);
  const mDelta = deltaFromStart(data.mobile, idx);
  const dCol = bandColor(dv);
  const mCol = bandColor(mv);
  const dChipCol = deltaColor(dDelta);
  const mChipCol = deltaColor(mDelta);
  const gap = Math.abs(dv - mv);
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
  const bandFor = (device: "d" | "m", segment: number[]) => {
    const range = device === "d" ? data.desktopRange : data.mobileRange;
    if (!range) return null;
    return segmentRangeBand(range, segment, last, bounds);
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
        background: t.card,
        border: `1px solid ${t.hair}`,
        borderRadius: CARD_RADIUS,
        padding: CARD_PADDING,
        display: "flex",
        flexDirection: "column",
        gap: 11.5,
        fontFamily: SANS_FONT,
      }}
    >
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10 }}>
        <CardTitle title={data.title} fontSize={17} color={t.ink1} />
        <span style={{ fontFamily: MONO_FONT, fontSize: 12, fontVariantNumeric: "tabular-nums", color: "#898989", whiteSpace: "nowrap" }}>{rangeLabel}</span>
      </div>

      <div style={{ display: "flex", alignItems: "stretch", gap: 8, margin: "4px 0 8px" }}>
        <MetricBlock side="d" value={dv} color={dCol} chipColor={dChipCol} delta={dDelta} metricSize={metricSize} theme={t} />
        <div style={{ flex: "none", alignSelf: "stretch", display: "flex", flexDirection: "column-reverse", alignItems: "center", gap: 8, padding: "0 2px", width: 45 }}>
          <span aria-hidden="true" style={{ fontSize: 10, height: 15, lineHeight: "15px", color: "transparent" }}>·</span>
          <div style={{ flex: "1 1 auto", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 3,
                boxSizing: "border-box",
                width: 41,
                padding: "3px 4px",
                borderRadius: 999,
                border: `1px solid ${t.hair}`,
                color: t.ink3,
                fontFamily: MONO_FONT,
                fontSize: 11.5,
                fontWeight: 550,
                letterSpacing: "0.03em",
                whiteSpace: "nowrap",
              }}
            >
              <span>Δ</span>
              <span>{gap}</span>
            </span>
          </div>
        </div>
        <MetricBlock side="m" value={mv} color={mCol} chipColor={mChipCol} delta={mDelta} metricSize={metricSize} theme={t} />
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
                <stop offset="0" style={{ stopColor: dCol, stopOpacity: FILL_TOP_OPACITY }} />
                <stop offset="1" style={{ stopColor: dCol, stopOpacity: FILL_END_OPACITY }} />
              </linearGradient>
              <linearGradient id={gId("m")} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" style={{ stopColor: mCol, stopOpacity: FILL_TOP_OPACITY }} />
                <stop offset="1" style={{ stopColor: mCol, stopOpacity: FILL_END_OPACITY }} />
              </linearGradient>
              <clipPath id={cId("d")} clipPathUnits="objectBoundingBox">
                <path d={dp.clip} />
              </clipPath>
              <clipPath id={cId("m")} clipPathUnits="objectBoundingBox">
                <path d={mp.clip} />
              </clipPath>
            </defs>
          </svg>

          {isLarge && <LargeChartAxes bounds={bounds} last={last} data={data} />}

          {/* Run-to-run range band per trusted segment, one hatch layer per band —
              replaces small's area-under-the-median fill (§4). */}
          {dSegments.map((segment) => {
            const band = bandFor("d", segment);
            if (!band) return null;
            const clipId = `${cId("d")}-band-${segment[0]}`;
            return (
              <RangeBandLayer key={`d-band-${segment[0]}`} clipId={clipId} path={band} degrees={45} color={dCol} />
            );
          })}
          {mSegments.map((segment) => {
            const band = bandFor("m", segment);
            if (!band) return null;
            const clipId = `${cId("m")}-band-${segment[0]}`;
            return (
              <RangeBandLayer key={`m-band-${segment[0]}`} clipId={clipId} path={band} degrees={-45} color={mCol} />
            );
          })}

          {/* Anomaly gap: a dashed amber block between two trusted segments,
              matching HistoryChart's anomaly presentation (§4). */}
          {Array.from({ length: pointCount }, (_, index) => index)
            .filter((index) => !isTrusted("d", index) || !isTrusted("m", index))
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
              <LineOrDot key={`d-line-${segment[0]}`} segment={segment} values={data.desktop} bounds={bounds} last={last} color={dCol} width={isLarge ? 2.5 : 2.5} />
            ))}
            {mSegments.map((segment) => (
              <LineOrDot key={`m-line-${segment[0]}`} segment={segment} values={data.mobile} bounds={bounds} last={last} color={mCol} width={1.5} />
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
              background: t.ink2,
              opacity: 0.35,
              display: hoverIndex === null ? "none" : "block",
              left: `${(hoverIndex ?? 0) / last * 100}%`,
              transform: "translateX(-50%)",
              pointerEvents: "none",
            }}
          />
          <ChartDot visible={hoverIndex !== null && isTrusted("d", idx)} left={dotLeft(idx)} top={dp.yPct(dv)} color={dCol} cardBg={t.card} />
          <ChartDot visible={hoverIndex !== null && isTrusted("m", idx)} left={dotLeft(idx)} top={mp.yPct(mv)} color={mCol} cardBg={t.card} />
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
function RangeBandLayer({ clipId, path, degrees, color }: { clipId: string; path: string; degrees: number; color: string }) {
  const style = {
    position: "absolute",
    inset: 0,
    WebkitClipPath: `url(#${clipId})`,
    clipPath: `url(#${clipId})`,
    pointerEvents: "none",
    backgroundImage: hatchBackgroundImage(degrees, rgba(color, PATTERN_STRENGTH)),
  } as CSSProperties;
  return (
    <>
      <svg viewBox="0 0 100 40" preserveAspectRatio="none" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none" }}>
        <defs>
          <clipPath id={clipId} clipPathUnits="userSpaceOnUse">
            <path d={path} />
          </clipPath>
        </defs>
        <path d={path} fill={rgba(color, 0.16)} />
      </svg>
      <div aria-hidden="true" style={style} />
    </>
  );
}

/** Dashed amber block between two trusted segments — the anomaly gap (§4), one 0..100 unit wide per point. */
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
        background: "rgba(255,154,61,0.08)",
        borderLeft: "1px dashed rgba(255,154,61,0.65)",
        borderRight: "1px dashed rgba(255,154,61,0.65)",
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
    return <circle cx={xFor(index, last)} cy={yFor(values[index], bounds)} r={0.9} fill={color} />;
  }
  return (
    <path
      d={segmentLine(values, segment, last, bounds)}
      vectorEffect="non-scaling-stroke"
      fill="none"
      stroke={color}
      strokeWidth={width}
      strokeLinejoin="round"
      style={{ filter: `drop-shadow(0 0 ${GLOW_SPREAD / 2}px ${rgba(color, GLOW_OPACITY)}) drop-shadow(0 0 ${GLOW_SPREAD}px ${rgba(color, GLOW_OPACITY * 0.6)})` }}
    />
  );
}

/**
 * One change marker: dashed vertical line, dot, and label. Neutral
 * ("#ABABAB", square dot) for a user marker, violet ("#9564FF", round dot)
 * for a task/completion marker (§4's marker kinds). Labels alternate between
 * two rows by index and flip to the line's left past the horizontal
 * midpoint so a late marker never runs off the card.
 */
function MarkerLine({ marker, x, rowIndex }: { marker: ScoreCardMarker; x: number; rowIndex: number }) {
  const color = marker.isTask ? "#9564FF" : "#ABABAB";
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
        <span style={{ fontFamily: MONO_FONT, fontSize: 10.5, fontWeight: 600, color, background: "#0D0D0DE0", padding: "1px 4px", borderRadius: 3 }}>
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
          <div style={{ position: "absolute", left: 0, right: 0, top: `${tick.pct}%`, borderTop: "1px solid #1C1C1C", pointerEvents: "none" }} />
          <span style={{ position: "absolute", left: 0, top: `${tick.pct}%`, transform: "translateY(-50%)", background: "#0D0D0D", paddingRight: 5, fontFamily: MONO_FONT, fontSize: 10.5, fontVariantNumeric: "tabular-nums", color: "#6A6A6A", pointerEvents: "none" }}>
            {tick.value}
          </span>
        </div>
      ))}
      {last > 0 && (
        <div style={{ position: "absolute", left: 0, right: 0, top: `${benchmarkPct}%`, borderTop: "1px dashed #6A6A6A66", pointerEvents: "none" }} aria-hidden="true" />
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
    <div style={{ flex: "none", display: "flex", alignItems: "baseline", gap: 24, marginTop: 8, fontFamily: MONO_FONT, fontSize: 10.5, color: "#6A6A6A" }}>
      <span style={{ flex: "1 1 0", display: "flex", justifyContent: "flex-start" }}>{first}</span>
      <span style={{ flex: "1 1 0", display: "flex", justifyContent: "center" }}>{middle}</span>
      <span style={{ flex: "1 1 0", display: "flex", justifyContent: "flex-end" }}>{end}</span>
    </div>
  );
}
