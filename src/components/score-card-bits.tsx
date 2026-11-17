"use client";

import { useState, type CSSProperties, type ReactNode } from "react";
import {
  bandColor,
  deltaTrend,
  hatchBackgroundImage,
  SCORE_BAD,
  SCORE_GOOD,
  SCORE_NEUTRAL,
  SCORE_WARN,
} from "@/lib/scoreCard";
import { metricTooltipFor, SCORE_BANDS_LABEL } from "@/lib/scoreCardTooltip";
import { Magnitude } from "@/components/magnitude";
import { TrendArrow } from "@/components/trend-arrow";
import { seriesToken } from "@/components/charts";
import type { ScoreCardData, ScoreCardDensity } from "./ScoreCard";

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
export const CARD_SURFACE = "var(--surface-card)";
export const CARD_HAIRLINE = "var(--border-hairline)";
export const INK_BODY = "var(--text-body)";
export const INK_MUTED = "var(--text-muted)";

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
 *
 * The token names come from `seriesToken` in `charts.tsx` — this card, the
 * charts and the device labels beside them are one identity, and three literal
 * copies of it could disagree about which hue a device is.
 */
export const SERIES_VAR: Record<"d" | "m", string> = {
  d: `var(${seriesToken("desktop")})`,
  m: `var(${seriesToken("mobile")})`,
};

/**
 * Alpha comes from `color-mix`, never from gluing digits onto a colour string
 * — appending alpha nibbles to a `var(…)` is invalid CSS and renders nothing
 * with no error, which is exactly how the deleted hex-to-rgba helper failed.
 * Verified in-browser: `color-mix()` resolves inside `filter: drop-shadow()`,
 * inside both gradient functions, in a dashed border, and in an SVG `fill`
 * set via `style`.
 */
export function mix(color: string, percent: number): string {
  return `color-mix(in srgb, ${color} ${Math.round(percent)}%, transparent)`;
}

/**
 * The paired ground/ink for a score's health band. `bandColor` is the single
 * place the 90/50 thresholds live, so this maps its answer onto the matching
 * `-bg`/`-text` pair rather than restating the bands — and the `-text` token
 * IS the on-colour for its own `-bg`, so a solid chip never hand-picks ink.
 */
export const BAND_CHIP: Record<string, { bg: string; text: string }> = {
  [SCORE_GOOD]: { bg: "var(--health-good-bg)", text: "var(--health-good-text)" },
  [SCORE_WARN]: { bg: "var(--health-warn-bg)", text: "var(--health-warn-text)" },
  [SCORE_BAD]: { bg: "var(--health-poor-bg)", text: "var(--health-poor-text)" },
};
export const NO_VERDICT_CHIP = { bg: "var(--health-none-bg)", text: `var(${SCORE_NEUTRAL})` };

export function bandChip(value: number): { bg: string; text: string } {
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

export const CARD_PADDING = 16;
export const CARD_RADIUS = 8;

/**
 * Fixed total card height for small/medium/large, so every card in a row
 * lines up regardless of chart content. The chart itself is not a literal
 * pixel height here — its wrapper uses `flex: 1 1 auto` inside the card's
 * column layout so it stretches to fill whatever space the header/metric
 * rows (and, at large, the date axis) don't use, rather than a hardcoded
 * chart height that could overflow or leave a gap if those rows reflow.
 * XSmall is unaffected: it has no chart in the normal sense (§4).
 */
export const CARD_HEIGHT: Record<"small" | "medium" | "large", number> = {
  small: 200,
  medium: 400,
  large: 400,
};
export const FILL_TOP_OPACITY = 0.67;
export const FILL_END_OPACITY = 0.33;
export const PATTERN_STRENGTH = 0.25;
export const LINE_WIDTH = 2;
export const GLOW_SPREAD = 8;
export const GLOW_OPACITY = 0.5;
export const OUTLINE_WEIGHT = 1.5;

// This app's brand sans (WF Visual Sans) has no working tabular figures, so
// every number in this card (metric numerals, delta chips, the Δ gap badge)
// uses the brand mono cut instead: public/fonts/WFVisualSansMono[wght,MONO].ttf,
// declared as "WF Visual Sans Mono" in globals.css. The system stack after it
// is only the fallback while that font loads or if it fails to load.
export const MONO_FONT = '"WF Visual Sans Mono", ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace';
export const SANS_FONT = "var(--font-brand, var(--font-sans))";

export function dateAt(index: number, lastIndex: number, referenceDate = new Date()): string {
  const ms = referenceDate.getTime() - (lastIndex - index) * 86_400_000;
  return new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/** Whether `data` has a real second series to compare `desktop` against, at any density. */
export function hasSecondSeries(data: ScoreCardData): boolean {
  return !!data.mobile && data.mobile.length > 0;
}
/**
 * Clips the full-bleed chart to the card's rounded bottom corners now that
 * the card itself no longer sets `overflow: hidden` (that would also clip
 * the metric tooltip). The -2px top margin + 2px padding gives the line
 * stroke headroom so a series pinned at the domain max isn't sliced in half
 * (see the density handoff's "Clipping" note).
 */
export function ChartClipWrapper({ children, inset = false }: { children: ReactNode; inset?: boolean }) {
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
export function CardTitle({ title, fontSize, color, uppercase = false }: { title: string; fontSize: number; color: string; uppercase?: boolean }) {
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
export function EmptyScoreCard({ title }: { title: string }) {
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

export function HatchLayer({ clipId, degrees, color }: { clipId: string; degrees: number; color: string }) {
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

export function LineSvg({ d, color }: { d: string; color: string }) {
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
export function ChartDot({ visible, left, top, color }: { visible: boolean; left: string; top: string; color: string }) {
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

export function MetricBlock({
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
export function GapChip({ gap }: { gap: number }) {
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

