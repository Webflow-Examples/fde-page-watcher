"use client";

import { useEffect, useRef, useState, type MouseEvent } from "react";
import type { AgentIgnoreSettings, CategoryKey, ChangeMarker, Night, Strategy } from "@/lib/types";
import { agentReadinessHistoryPoints } from "@/lib/agentHistory";
import type { PreviousPeriodMedian } from "@/lib/scoring";
import { formatHistoryTooltipDate, placeMarkerLabelRows, plottedSparklineSeries, snappedHistoryIndex } from "@/lib/charting";
import { C } from "@/lib/ui";

const HISTORY_CHART_DEFAULT_WIDTH = 900;
const HISTORY_CATEGORY_LABELS: Record<CategoryKey, string> = {
  perf: "Performance",
  a11y: "Accessibility",
  bp: "Best practices",
  seo: "SEO",
};

function useResponsiveChartWidth(defaultWidth: number) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(defaultWidth);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const updateWidth = (nextWidth: number) => {
      if (!Number.isFinite(nextWidth) || nextWidth <= 0) return;
      setWidth((currentWidth) => (Math.abs(currentWidth - nextWidth) < 0.5 ? currentWidth : nextWidth));
    };

    updateWidth(container.getBoundingClientRect().width);
    const observer = new ResizeObserver((entries) => {
      updateWidth(entries[0]?.contentRect.width ?? 0);
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  return { containerRef, width };
}

/** Compact area sparkline (ported from the design's buildSpark). */
export function Sparkline({
  series,
  color,
  w = 70,
  h = 30,
  pad = 3,
  sw = 1.8,
  dot = 2.6,
}: {
  series: number[];
  color: string;
  w?: number;
  h?: number;
  pad?: number;
  sw?: number;
  dot?: number;
}) {
  if (series.length === 0) return null;
  const plotted = plottedSparklineSeries(series);
  let lo = Math.min(...plotted);
  let hi = Math.max(...plotted);
  if (hi - lo < 6) {
    const m = (hi + lo) / 2;
    lo = m - 4;
    hi = m + 4;
  }
  lo -= 1;
  hi += 1;
  const n = plotted.length;
  const x = (i: number) => pad + (n > 1 ? (i / (n - 1)) * (w - 2 * pad) : 0);
  const y = (v: number) => pad + (1 - (v - lo) / (hi - lo)) * (h - 2 * pad);
  const pts = plotted.map((v, i) => `${x(i)},${y(v)}`).join(" ");
  const last = plotted[n - 1];
  const area = `${x(0)},${h - pad} ${pts} ${x(n - 1)},${h - pad}`;
  return (
    <div style={{ position: "relative", width: "100%", height: h }}>
      <svg viewBox={`0 0 ${w} ${h}`} width="100%" height={h} preserveAspectRatio="none" style={{ display: "block" }}>
        <polygon points={area} fill={color} opacity={0.13} />
        <polyline points={pts} fill="none" stroke={color} strokeWidth={sw} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
      </svg>
      <FixedChartDot kind="sparkline" x={x(n - 1)} y={y(last)} viewWidth={w} viewHeight={h} radius={dot} color={color} />
    </div>
  );
}

/** Score-over-time chart with the run-to-run range band, baseline, and markers (ported from buildChart). */
export function HistoryChart({
  history,
  strategy,
  catKey,
  baseline,
  previousPeriod,
  markers,
}: {
  history: Night[];
  strategy: Strategy;
  catKey: CategoryKey;
  baseline: number;
  previousPeriod: PreviousPeriodMedian | null;
  markers: ChangeMarker[];
}) {
  const { containerRef, width: W } = useResponsiveChartWidth(HISTORY_CHART_DEFAULT_WIDTH);
  const [hoveredPoint, setHoveredPoint] = useState<{ index: number; pointerY: number } | null>(null);
  const h = history;
  const n = h.length;
  if (n < 2) return null;
  const visibleMarkers = (markers || [])
    .map((marker) => ({ marker, markerIndex: h.findIndex((night) => night.i === marker.i) }))
    .filter(({ markerIndex }) => markerIndex >= 0);
  const H = 264;
  const padL = 38;
  const padR = 20;
  const padT = 22;
  const padB = 30;
  const at = (d: Night, which: "m" | "lo" | "hi") => d.scores[strategy][catKey][which];
  const vals: number[] = [baseline];
  if (previousPeriod) vals.push(previousPeriod.value);
  h.forEach((d) => vals.push(at(d, "lo"), at(d, "hi")));
  let lo = Math.floor(Math.min(...vals) / 5) * 5 - 3;
  let hi = Math.ceil(Math.max(...vals) / 5) * 5 + 3;
  lo = Math.max(0, lo);
  hi = Math.min(100, Math.max(hi, lo + 10));
  const x = (i: number) => padL + (i / (n - 1)) * (W - padL - padR);
  const y = (v: number) => padT + (1 - (v - lo) / (hi - lo)) * (H - padT - padB);
  const line = strategy === "desktop" ? C.violetSoft : C.accentBright;
  const band = strategy === "desktop" ? "rgba(183,156,255,0.15)" : "rgba(59,137,255,0.16)";
  const bandTop = h.map((d, index) => `${x(index)},${y(at(d, "hi"))}`).join(" ");
  const bandBot = h
    .map((d, index) => `${x(index)},${y(at(d, "lo"))}`)
    .reverse()
    .join(" ");
  const medPts = h.map((d, index) => `${x(index)},${y(at(d, "m"))}`).join(" ");
  const ticks = [lo, Math.round((lo + hi) / 2), hi];
  const xLabels = [...new Set([0, Math.round((n - 1) / 2), n - 1])];
  const ld = h[n - 1];
  const clampLabelY = (value: number) => Math.min(H - padB - 7, Math.max(padT + 7, value));
  const baselineLabelY = clampLabelY(y(baseline) - 6);
  const previousPeriodLabelY = previousPeriod
    ? clampLabelY(
        Math.abs(y(previousPeriod.value) - y(baseline)) < 18
          ? y(previousPeriod.value) + 14
          : y(previousPeriod.value) - 6,
      )
    : 0;
  const markerLabelYs = placeMarkerLabelRows(
    visibleMarkers.length,
    [baselineLabelY, ...(previousPeriod ? [previousPeriodLabelY] : [])],
    padT + 7,
    H - padB - 7,
  );
  const hoveredNight = hoveredPoint ? h[hoveredPoint.index] : null;
  const hoveredMedian = hoveredNight ? at(hoveredNight, "m") : null;
  const hoveredX = hoveredPoint ? x(hoveredPoint.index) : null;
  const tooltipOnLeft = hoveredX !== null && hoveredX > W - 190;
  const tooltipAbove = hoveredPoint ? hoveredPoint.pointerY > H - 125 : false;
  const handleMouseMove = (event: MouseEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const pointerX = ((event.clientX - rect.left) / rect.width) * W;
    const pointerY = ((event.clientY - rect.top) / rect.height) * H;
    setHoveredPoint({
      index: snappedHistoryIndex(pointerX, W, n, padL, padR),
      pointerY: Math.min(H - padB, Math.max(padT, pointerY)),
    });
  };

  return (
    <div
      ref={containerRef}
      data-history-chart
      onMouseMove={handleMouseMove}
      onMouseLeave={() => setHoveredPoint(null)}
      onWheel={() => setHoveredPoint(null)}
      style={{ position: "relative", width: "100%", height: H, cursor: "crosshair" }}
    >
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} style={{ display: "block" }}>
        {ticks.map((t, k) => (
          <g key={`g${k}`}>
            <line x1={padL} x2={W - padR} y1={y(t)} y2={y(t)} stroke="#24242A" strokeWidth={1} />
            <text x={padL - 8} y={y(t) + 3.5} textAnchor="end" fontSize={10} fill={C.faint}>
              {t}
            </text>
          </g>
        ))}
        {xLabels.map((i, k) => (
          <text key={`x${k}`} x={x(i)} y={H - 10} textAnchor="middle" fontSize={10} fill={C.faint}>
            {h[i].date}
          </text>
        ))}
        <polygon points={`${bandTop} ${bandBot}`} fill={band} />
        <line x1={padL} x2={W - padR} y1={y(baseline)} y2={y(baseline)} stroke="#5A5A62" strokeWidth={1.2} strokeDasharray="5 4" />
        <text x={W - padR} y={baselineLabelY} textAnchor="end" fontSize={10} fill={C.muted}>
          original benchmark {baseline}
        </text>
        {previousPeriod && (
          <>
            <line
              x1={padL}
              x2={W - padR}
              y1={y(previousPeriod.value)}
              y2={y(previousPeriod.value)}
              stroke={C.faint2}
              strokeWidth={1.2}
              strokeDasharray="2 4"
            />
            <text x={W - padR} y={previousPeriodLabelY} textAnchor="end" fontSize={10} fill={C.faint2}>
              previous {previousPeriod.days}-day period {previousPeriod.value}
            </text>
          </>
        )}
        <polyline points={medPts} fill="none" stroke={line} strokeWidth={2.4} strokeLinejoin="round" strokeLinecap="round" />
        {visibleMarkers.map(({ marker: mk, markerIndex }, k) => {
          const markerX = x(markerIndex);
          const plotWidth = W - padL - padR;
          const nearRightEdge = markerX >= padL + plotWidth * 0.75;
          const custom = mk.source !== "task" && !mk.recKey && !mk.text.startsWith("Acted:");
          const markerColor = custom ? C.green : "#9564FF";
          return (
            <g key={`mk${k}`}>
              <line x1={markerX} x2={markerX} y1={padT - 4} y2={H - padB} stroke={markerColor} strokeWidth={1.4} strokeDasharray="4 3" />
              <text
                x={markerX + (nearRightEdge ? -7 : 7)}
                y={markerLabelYs[k]}
                textAnchor={nearRightEdge ? "end" : "start"}
                fontSize={10.5}
                fontWeight={600}
                fill={custom ? C.green : C.violetSoft}
              >
                {mk.text}
              </text>
            </g>
          );
        })}
        {hoveredNight && hoveredMedian !== null && hoveredX !== null && (
          <g aria-hidden="true">
            <line x1={hoveredX} x2={hoveredX} y1={padT} y2={H - padB} stroke={C.text} strokeWidth={1} opacity={0.55} />
            <circle cx={hoveredX} cy={y(hoveredMedian)} r={4.5} fill={line} stroke={C.panel} strokeWidth={2} />
          </g>
        )}
      </svg>
      <FixedChartDot kind="history-line" x={x(n - 1)} y={y(at(ld, "m"))} viewWidth={W} viewHeight={H} radius={4} color={line} borderColor={C.panel} borderWidth={2} />
      {(markers || []).map((mk) => {
        const markerIndex = h.findIndex((night) => night.i === mk.i);
        if (markerIndex < 0) return null;
        const custom = mk.source !== "task" && !mk.recKey && !mk.text.startsWith("Acted:");
        return <FixedChartDot key={mk.id} kind="history-marker" x={x(markerIndex)} y={padT - 4} viewWidth={W} viewHeight={H} radius={3.5} color={custom ? C.green : "#9564FF"} />;
      })}
      {hoveredNight && hoveredMedian !== null && hoveredX !== null && (
        <div
          role="tooltip"
          style={{
            position: "absolute",
            zIndex: 3,
            left: `${(hoveredX / W) * 100}%`,
            top: hoveredPoint?.pointerY ?? padT,
            width: 154,
            padding: "10px 12px",
            borderRadius: 8,
            border: `1px solid ${C.border2}`,
            background: "rgba(24,24,28,0.97)",
            boxShadow: "0 10px 28px rgba(0,0,0,0.38)",
            color: C.text,
            pointerEvents: "none",
            transform: `translate(${tooltipOnLeft ? "calc(-100% - 10px)" : "10px"}, ${tooltipAbove ? "calc(-100% - 10px)" : "10px"})`,
          }}
        >
          <div style={{ fontSize: 11.5, fontWeight: 650 }}>{HISTORY_CATEGORY_LABELS[catKey]}</div>
          <div style={{ marginTop: 2, fontSize: 10.5, color: C.faint }}>{formatHistoryTooltipDate(hoveredNight.date, hoveredNight.iso)}</div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 6, marginTop: 9 }}>
            <span style={{ fontSize: 10.5, color: C.muted }}>Median</span>
            <span style={{ fontSize: 22, lineHeight: 1, fontWeight: 650, color: line }}>{hoveredMedian}</span>
          </div>
          <div style={{ marginTop: 6, paddingTop: 6, borderTop: `1px solid ${C.rowBorder}`, fontSize: 10.5, color: C.muted }}>
            Range <span style={{ color: C.dim, fontWeight: 600 }}>{at(hoveredNight, "lo")}–{at(hoveredNight, "hi")}</span>
          </div>
        </div>
      )}
    </div>
  );
}

/** Agent-readiness history using the immutable score captured with each run. */
export function AgentReadinessChart({
  history,
  threshold,
  ignores,
  defaults,
  restores,
}: {
  history: Night[];
  threshold: number;
  ignores?: AgentIgnoreSettings;
  defaults?: AgentIgnoreSettings;
  restores?: AgentIgnoreSettings;
}) {
  const { containerRef, width: W } = useResponsiveChartWidth(HISTORY_CHART_DEFAULT_WIDTH);
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const points = agentReadinessHistoryPoints(history, ignores, defaults, restores);

  if (points.length === 0) return null;

  const H = 220;
  const padL = 38;
  const padR = 20;
  const padT = 22;
  const padB = 30;
  const n = points.length;
  const clampedThreshold = Math.max(0, Math.min(100, threshold));
  const lowestValue = Math.min(clampedThreshold, ...points.map((point) => point.snapshot.percent));
  const lo = Math.max(0, Math.min(90, Math.floor(lowestValue / 10) * 10 - 5));
  const hi = 100;
  const x = (index: number) => n === 1
    ? W - padR
    : padL + (index / (n - 1)) * (W - padL - padR);
  const y = (value: number) => padT + (1 - (value - lo) / (hi - lo)) * (H - padT - padB);
  const linePoints = points.map((point, index) => `${x(index)},${y(point.snapshot.percent)}`).join(" ");
  const ticks = [...new Set([lo, Math.round((lo + hi) / 2), hi])];
  const xLabels = [...new Set([0, Math.round((n - 1) / 2), n - 1])];
  const active = activeIndex === null ? null : points[activeIndex];
  const activeX = activeIndex === null ? 0 : x(activeIndex);
  const activeY = active ? y(active.snapshot.percent) : 0;
  const tooltipTransform = activeIndex === n - 1
    ? "translate(-100%, calc(-100% - 10px))"
    : activeIndex === 0
      ? "translate(0, calc(-100% - 10px))"
      : "translate(-50%, calc(-100% - 10px))";

  const pointLabel = (point: (typeof points)[number]) => {
    const parts = [
      `${point.night.date}: ${point.snapshot.percent}% agent readiness`,
      `${point.snapshot.pass} of ${point.snapshot.total} passing`,
    ];
    if (point.snapshot.ignored) parts.push(`${point.snapshot.ignored} ignored`);
    if (point.snapshot.unavailable) parts.push(`${point.snapshot.unavailable} unavailable`);
    if (point.fixedNames.length) parts.push(`fixed since prior run: ${point.fixedNames.join(", ")}`);
    if (point.ignoredNames.length) parts.push(`newly ignored: ${point.ignoredNames.join(", ")}`);
    return parts.join(". ");
  };

  return (
    <div ref={containerRef} data-agent-readiness-chart style={{ position: "relative", width: "100%", height: H }}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} role="img" aria-label="Agent readiness percentage over time" style={{ display: "block", overflow: "visible" }}>
        {ticks.map((tick) => (
          <g key={tick}>
            <line x1={padL} x2={W - padR} y1={y(tick)} y2={y(tick)} stroke="#24242A" strokeWidth={1} />
            <text x={padL - 8} y={y(tick) + 3.5} textAnchor="end" fontSize={10} fill={C.faint}>
              {tick}%
            </text>
          </g>
        ))}
        {xLabels.map((index) => (
          <text key={index} x={x(index)} y={H - 10} textAnchor={n === 1 ? "end" : "middle"} fontSize={10} fill={C.faint}>
            {points[index].night.date}
          </text>
        ))}
        <line
          x1={padL}
          x2={W - padR}
          y1={y(clampedThreshold)}
          y2={y(clampedThreshold)}
          stroke="#5A5A62"
          strokeWidth={1.2}
          strokeDasharray="5 4"
        />
        <text x={W - padR} y={y(clampedThreshold) - 6} textAnchor="end" fontSize={10} fill={C.muted}>
          threshold {clampedThreshold}%
        </text>
        {n > 1 && (
          <polyline points={linePoints} fill="none" stroke={C.violetSoft} strokeWidth={2.4} strokeLinejoin="round" strokeLinecap="round" />
        )}
        {points.map((point, index) => {
          const eventColor = point.fixedNames.length
            ? C.green
            : point.ignoredNames.length
              ? C.accentSoft
              : C.violetSoft;
          return (
            <circle
              key={point.night.runId ?? point.night.i}
              cx={x(index)}
              cy={y(point.snapshot.percent)}
              r={activeIndex === index ? 4.5 : 3.5}
              fill={eventColor}
              stroke={C.panel}
              strokeWidth={2}
            />
          );
        })}
      </svg>
      {points.map((point, index) => (
        <button
          key={`target-${point.night.runId ?? point.night.i}`}
          type="button"
          aria-label={`Inspect ${pointLabel(point)}`}
          onClick={() => setActiveIndex(index)}
          onFocus={() => setActiveIndex(index)}
          onBlur={() => setActiveIndex(null)}
          onMouseEnter={() => setActiveIndex(index)}
          onMouseLeave={() => setActiveIndex(null)}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              setActiveIndex(null);
              event.currentTarget.blur();
            }
          }}
          style={{
            position: "absolute",
            left: `${(x(index) / W) * 100}%`,
            top: `${(y(point.snapshot.percent) / H) * 100}%`,
            width: 22,
            height: 22,
            padding: 0,
            border: 0,
            borderRadius: "50%",
            background: "transparent",
            transform: "translate(-50%, -50%)",
            cursor: "default",
            outline: "none",
            boxShadow: activeIndex === index ? "0 0 0 3px rgba(59,137,255,0.25)" : "none",
          }}
        />
      ))}
      {active && (
        <div
          role="tooltip"
          style={{
            position: "absolute",
            left: `${(activeX / W) * 100}%`,
            top: `${(activeY / H) * 100}%`,
            transform: tooltipTransform,
            zIndex: 2,
            width: 218,
            padding: "9px 10px",
            borderRadius: 8,
            border: `1px solid ${C.border2}`,
            background: "#19191F",
            boxShadow: "0 12px 28px rgba(0,0,0,0.42)",
            color: C.dim,
            fontSize: 11.5,
            lineHeight: 1.45,
            pointerEvents: "none",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, color: C.text, fontWeight: 600 }}>
            <span>{active.night.date}</span>
            <span>{active.snapshot.percent}%</span>
          </div>
          <div style={{ marginTop: 3 }}>{active.snapshot.pass}/{active.snapshot.total} passing{active.snapshot.ignored ? ` · ${active.snapshot.ignored} ignored` : ""}</div>
          {active.fixedNames.length > 0 && <div style={{ color: C.green, marginTop: 3 }}>Fixed: {active.fixedNames.join(", ")}</div>}
          {active.ignoredNames.length > 0 && <div style={{ color: C.accentSoft, marginTop: 3 }}>Ignored: {active.ignoredNames.join(", ")}</div>}
        </div>
      )}
    </div>
  );
}

function FixedChartDot({
  kind,
  x,
  y,
  viewWidth,
  viewHeight,
  radius,
  color,
  borderColor,
  borderWidth = 0,
}: {
  kind: "sparkline" | "history-line" | "history-marker";
  x: number;
  y: number;
  viewWidth: number;
  viewHeight: number;
  radius: number;
  color: string;
  borderColor?: string;
  borderWidth?: number;
}) {
  return (
    <span
      aria-hidden="true"
      data-chart-dot={kind}
      style={{
        position: "absolute",
        left: `${(x / viewWidth) * 100}%`,
        top: `${(y / viewHeight) * 100}%`,
        width: radius * 2,
        height: radius * 2,
        boxSizing: "content-box",
        display: "block",
        borderRadius: "50%",
        background: color,
        border: borderWidth && borderColor ? `${borderWidth}px solid ${borderColor}` : "none",
        transform: "translate(-50%, -50%)",
        pointerEvents: "none",
      }}
    />
  );
}
