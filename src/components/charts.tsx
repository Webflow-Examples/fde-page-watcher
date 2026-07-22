import type { CategoryKey, ChangeMarker, Night, Strategy } from "@/lib/types";
import { plottedSparklineSeries } from "@/lib/charting";
import { C } from "@/lib/ui";

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
    <svg viewBox={`0 0 ${w} ${h}`} width="100%" height={h} preserveAspectRatio="none" style={{ display: "block" }}>
      <polygon points={area} fill={color} opacity={0.13} />
      <polyline points={pts} fill="none" stroke={color} strokeWidth={sw} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
      <circle cx={x(n - 1)} cy={y(last)} r={dot} fill={color} />
    </svg>
  );
}

/** Score-over-time chart with the run-to-run range band, baseline, and markers (ported from buildChart). */
export function HistoryChart({
  history,
  strategy,
  catKey,
  baseline,
  markers,
}: {
  history: Night[];
  strategy: Strategy;
  catKey: CategoryKey;
  baseline: number;
  markers: ChangeMarker[];
}) {
  const h = history;
  const n = h.length;
  if (n < 2) return null;
  const W = 900;
  const H = 264;
  const padL = 38;
  const padR = 20;
  const padT = 22;
  const padB = 30;
  const at = (d: Night, which: "m" | "lo" | "hi") => d.scores[strategy][catKey][which];
  const vals: number[] = [baseline];
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

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={264} preserveAspectRatio="none" style={{ display: "block" }}>
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
      <text x={W - padR} y={y(baseline) - 6} textAnchor="end" fontSize={10} fill={C.muted}>
        baseline {baseline}
      </text>
      <polyline points={medPts} fill="none" stroke={line} strokeWidth={2.4} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={x(n - 1)} cy={y(at(ld, "m"))} r={4} fill={line} stroke={C.panel} strokeWidth={2} />
      {(markers || []).map((mk, k) => {
        const markerIndex = h.findIndex((night) => night.i === mk.i);
        if (markerIndex < 0) return null;
        return (
          <g key={`mk${k}`}>
            <line x1={x(markerIndex)} x2={x(markerIndex)} y1={padT - 4} y2={H - padB} stroke="#9564FF" strokeWidth={1.4} strokeDasharray="4 3" />
            <circle cx={x(markerIndex)} cy={padT - 4} r={3.5} fill="#9564FF" />
            <text x={x(markerIndex) + 7} y={padT + 7} fontSize={10.5} fontWeight={600} fill={C.violetSoft}>
              {mk.text}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
