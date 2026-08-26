"use client";

import { latestCruxSnapshot, type CruxPageEvidence } from "@/lib/crux";
import type { Night, Strategy } from "@/lib/types";
import {
  formatCollectionWindow,
  visitorExperienceTrend,
  visitorSnapshotValues,
  type VisitorExperienceTrend,
  type VisitorMetricKey,
} from "@/lib/visitorExperience";
import {
  compareLabAndField,
  type LabFieldComparisonStatus,
  type LabFieldMetricComparison,
  type SignalRating,
} from "@/lib/labFieldComparison";
import type { Trend } from "@/lib/vocabulary";
import { Sparkline } from "./charts";
import { TrendArrow } from "./trend-arrow";

/**
 * Health (R1) is the only axis in this panel allowed a hue, and it always
 * arrives as a complete triple. Nothing here concatenates alpha digits onto a
 * colour: `${tone}44` was valid against a hex and silently invalid against a
 * token, which is exactly the failure this shape removes.
 */
type HealthBand = "good" | "warn" | "poor" | "none";

interface HealthTone {
  text: string;
  bg: string;
  border: string;
}

function healthTone(band: HealthBand): HealthTone {
  return {
    text: `var(--health-${band}-text)`,
    bg: `var(--health-${band}-bg)`,
    border: `var(--health-${band}-border)`,
  };
}

function ratingBand(rating: SignalRating): HealthBand {
  return rating === "Good" ? "good" : rating === "Needs improvement" ? "warn" : "poor";
}

/**
 * `corroborated` is the worst case on this panel, not a middling one: the
 * problem reproduces in the controlled run *and* at the visitor p75. It used
 * to share amber with `divergent`, while the per-metric chip directly below
 * called the same fact poor — one fact, two verdicts, on one screen.
 *
 * `partial` and `unavailable` are absent evidence rather than a warning, so
 * they take the no-verdict band. The headline text carries which of the two
 * it is; the hue does not have to.
 */
function comparisonBand(status: LabFieldComparisonStatus): HealthBand {
  switch (status) {
    case "aligned":
      return "good";
    case "corroborated":
      return "poor";
    case "divergent":
      return "warn";
    default:
      return "none";
  }
}

function verdictBand(verdict: LabFieldMetricComparison["verdict"]): HealthBand {
  switch (verdict) {
    case "aligned-good":
      return "good";
    case "corroborated-issue":
      return "poor";
    case "field-only-risk":
    case "lab-only-risk":
      return "warn";
    default:
      return "none";
  }
}

/**
 * R4 — a chart mark carries device identity, never a judgment. The sparkline
 * used to take the metric's own rating colour, so the line changed hue as the
 * data moved; it now states which device the series belongs to and nothing
 * else. The rating is already stated in words directly above it.
 */
/** R2 — direction is a shape. This panel's own trend words map onto the F1 set. */
const VISITOR_TREND_AS_TREND: Record<Exclude<VisitorExperienceTrend, "insufficient">, Trend> = {
  improving: "improving",
  stable: "no_change",
  worsening: "regressing",
};

const FIELD_KEY_BY_COMPARISON: Record<LabFieldMetricComparison["key"], VisitorMetricKey> = {
  lcp: "lcpP75Ms",
  responsiveness: "inpP75Ms",
  cls: "clsP75",
  ttfb: "ttfbP75Ms",
};
function scopeLabel(item: CruxPageEvidence, scope: "url" | "origin"): string {
  return scope === "url" ? "Exact URL" : "Origin-wide";
}

export function VisitorExperiencePanel({
  evidence,
  labHistory,
  strategy,
  compact = false,
}: {
  evidence: CruxPageEvidence | null;
  labHistory: Night[];
  strategy: Strategy;
  compact?: boolean;
}) {
  const latest = latestCruxSnapshot(evidence?.snapshots ?? []);
  const trend = visitorExperienceTrend(evidence);
  const comparison = compareLabAndField(labHistory, strategy, evidence);
  const tone = healthTone(comparisonBand(comparison.status));
  const trendState = trend === "insufficient" ? null : VISITOR_TREND_AS_TREND[trend];

  return (
    <section aria-labelledby={compact ? "visitor-history-heading" : "visitor-experience-heading"} style={{ marginTop: compact ? 20 : 0, paddingTop: compact ? 20 : 0, borderTop: compact ? "1px solid var(--border-hairline)" : undefined }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 20 }}>
        <div>
          <div id={compact ? "visitor-history-heading" : "visitor-experience-heading"} style={{ fontSize: compact ? 12 : 15, fontWeight: 600, color: "var(--text-body)" }}>
            Visitor experience
          </div>
          <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 4, lineHeight: 1.45 }}>
            What real visitors met · previous 28 days · updated weekly (the Chrome UX Report)
          </div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 8, flexWrap: "wrap" }}>
            <div style={{ color: tone.text, fontSize: 12, fontWeight: 650 }}>{comparison.headline}</div>
            {trendState ? <TrendArrow trend={trendState} /> : null}
          </div>
          {latest && (
            <div style={{ color: "var(--text-muted)", fontSize: 12, marginTop: 4 }}>
              {scopeLabel(evidence!, latest.scope)} · {formatCollectionWindow(latest)}
            </div>
          )}
        </div>
      </div>

      {!latest ? (
        <div style={{ padding: compact ? "30px 16px 12px" : "34px 16px", textAlign: "center", color: "var(--text-muted)", fontSize: 12.5 }}>
          Not enough Chrome visitor data is available for this page and device yet.
        </div>
      ) : (
        <>
          <div style={{ marginTop: 14, padding: "11px 13px", borderRadius: 8, border: `1px solid ${tone.border}`, background: tone.bg }}>
            <div style={{ color: tone.text, fontSize: 12, fontWeight: 650 }}>{comparison.headline}</div>
            <div style={{ color: "var(--text-muted)", fontSize: 12, lineHeight: 1.45, marginTop: 3 }}>{comparison.detail}</div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: compact ? "repeat(auto-fit, minmax(230px, 1fr))" : "repeat(auto-fit, minmax(250px, 1fr))", gap: 12, marginTop: 12 }}>
          {comparison.metrics.map((metric) => {
            const verdict = healthTone(verdictBand(metric.verdict));
            const series = visitorSnapshotValues(evidence!.snapshots, FIELD_KEY_BY_COMPARISON[metric.key]);
            return (
              <div key={metric.key} style={{ minWidth: 0, background: "var(--surface-card)", border: "1px solid var(--border-strong)", borderRadius: 10, padding: compact ? "12px" : "14px" }}>
                <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8 }}>
                  <div>
                    <div style={{ fontSize: 12.5, color: "var(--text-body)", fontWeight: 600 }}>{metric.label}</div>
                    <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 3 }}>{metric.relationship === "direct" ? "The same measurement on both sides" : "Two different measurements, compared as the nearest match"}</div>
                  </div>
                  <span title={metric.guidance} style={{ flex: "none", fontSize: 12, fontWeight: 650, color: verdict.text, background: verdict.bg, padding: "3px 6px", borderRadius: 5 }}>{metric.verdictLabel}</span>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 12 }}>
                  {[metric.lab, metric.field].map((signal, index) => (
                    <div key={index} style={{ minWidth: 0, paddingLeft: index ? 10 : 0, borderLeft: index ? "1px solid var(--border-hairline)" : undefined }}>
                      <div style={{ color: "var(--text-muted)", fontSize: 12, textTransform: "uppercase", letterSpacing: "0.04em" }}>{signal?.label ?? (index ? "Visitor metric" : "Lab metric")}</div>
                      <div style={{ color: signal ? healthTone(ratingBand(signal.rating)).text : "var(--health-none-text)", fontSize: compact ? 17 : 20, fontWeight: 650, marginTop: 5 }}>{signal?.formatted ?? "—"}</div>
                      <div style={{ color: signal ? healthTone(ratingBand(signal.rating)).text : "var(--health-none-text)", fontSize: 12, marginTop: 3 }}>{signal?.rating ?? "Unavailable"}</div>
                    </div>
                  ))}
                </div>
                {compact && series.length > 1 && metric.field && (
                  <div style={{ height: 28, marginTop: 9 }}>
                    <Sparkline series={series} device={strategy} w={150} h={28} />
                  </div>
                )}
              </div>
            );
          })}
          </div>
        </>
      )}

      <div style={{ marginTop: 12, fontSize: 12, color: "var(--text-muted)", lineHeight: 1.45 }}>
        The nightly figures are the middle result of a test run on a deliberately slow connection, from the latest
        kept run in this range (Lighthouse). The visitor figures are the level three quarters of real visitors did
        better than, over a rolling 28 days (the Chrome UX Report). They are not scores, and they are not comparable
        to one.
        {latest?.scope === "origin" ? " Too few people visited this exact page for it to be reported on its own, so these figures cover the whole site." : ""}
        {trendState ? " The trend arrow compares the latest weekly snapshot with the one before it and describes the visitor experience itself, so an up arrow means visitors are better off." : ""}
      </div>
    </section>
  );
}
