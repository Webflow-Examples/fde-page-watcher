"use client";

import { latestCruxSnapshot, type CruxPageEvidence } from "@/lib/crux";
import type { Night, Strategy } from "@/lib/types";
import {
  formatCollectionWindow,
  visitorExperienceTrend,
  visitorSnapshotValues,
} from "@/lib/visitorExperience";
import type { VisitorMetricKey } from "@/lib/visitorExperience";
import { compareLabAndField, type LabFieldMetricComparison } from "@/lib/labFieldComparison";
import { C } from "@/lib/ui";
import { Sparkline } from "./charts";

function ratingColor(rating: "Good" | "Needs improvement" | "Poor"): string {
  return rating === "Good" ? C.green : rating === "Needs improvement" ? C.amber : C.redSoft;
}

function comparisonTone(status: ReturnType<typeof compareLabAndField>["status"]): string {
  return status === "aligned" ? C.green
    : status === "corroborated" || status === "divergent" ? C.amber
      : status === "partial" ? C.accentSoft
        : C.muted;
}

function verdictTone(verdict: LabFieldMetricComparison["verdict"]): { color: string; background: string } {
  if (verdict === "aligned-good") return { color: C.green, background: "rgba(53,208,127,0.13)" };
  if (verdict === "corroborated-issue") return { color: C.redSoft, background: "rgba(255,92,108,0.13)" };
  if (verdict === "field-only-risk" || verdict === "lab-only-risk") return { color: C.amber, background: "rgba(255,154,61,0.13)" };
  return { color: C.muted, background: "rgba(255,255,255,0.06)" };
}

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
  const tone = comparisonTone(comparison.status);

  return (
    <section aria-labelledby={compact ? "visitor-history-heading" : "visitor-experience-heading"} style={{ marginTop: compact ? 20 : 0, paddingTop: compact ? 20 : 0, borderTop: compact ? `1px solid ${C.border}` : undefined }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 20 }}>
        <div>
          <div id={compact ? "visitor-history-heading" : "visitor-experience-heading"} style={{ fontSize: compact ? 12 : 15, fontWeight: 600, color: compact ? C.accentSoft : C.text }}>
            Visitor experience
          </div>
          <div style={{ fontSize: 11.5, color: C.faint, marginTop: 4, lineHeight: 1.45 }}>
            Chrome UX Report · previous 28 days · updated weekly
          </div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ color: tone, fontSize: 12, fontWeight: 650 }}>{comparison.headline}</div>
          {latest && (
            <div style={{ color: C.faint, fontSize: 10.5, marginTop: 4 }}>
              {scopeLabel(evidence!, latest.scope)} · {formatCollectionWindow(latest)}
            </div>
          )}
        </div>
      </div>

      {!latest ? (
        <div style={{ padding: compact ? "30px 16px 12px" : "34px 16px", textAlign: "center", color: C.muted, fontSize: 12.5 }}>
          Not enough Chrome visitor data is available for this page and device yet.
        </div>
      ) : (
        <>
          <div style={{ marginTop: 14, padding: "11px 13px", borderRadius: 8, border: `1px solid ${tone}44`, background: `${tone}12` }}>
            <div style={{ color: tone, fontSize: 12, fontWeight: 650 }}>{comparison.headline}</div>
            <div style={{ color: C.muted, fontSize: 11, lineHeight: 1.45, marginTop: 3 }}>{comparison.detail}</div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: compact ? "repeat(auto-fit, minmax(230px, 1fr))" : "repeat(auto-fit, minmax(250px, 1fr))", gap: 12, marginTop: 12 }}>
          {comparison.metrics.map((metric) => {
            const verdict = verdictTone(metric.verdict);
            const series = visitorSnapshotValues(evidence!.snapshots, FIELD_KEY_BY_COMPARISON[metric.key]);
            return (
              <div key={metric.key} style={{ minWidth: 0, background: compact ? C.bgElev : C.panel2, border: `1px solid ${C.border2}`, borderRadius: 10, padding: compact ? "12px" : "14px" }}>
                <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8 }}>
                  <div>
                    <div style={{ fontSize: 12.5, color: C.text, fontWeight: 600 }}>{metric.label}</div>
                    <div style={{ fontSize: 10.5, color: C.faint, marginTop: 3 }}>{metric.relationship === "direct" ? "Direct metric comparison" : "Diagnostic proxy · TBT and INP differ"}</div>
                  </div>
                  <span title={metric.guidance} style={{ flex: "none", fontSize: 9.5, fontWeight: 650, color: verdict.color, background: verdict.background, padding: "3px 6px", borderRadius: 5 }}>{metric.verdictLabel}</span>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 12 }}>
                  {[metric.lab, metric.field].map((signal, index) => (
                    <div key={index} style={{ minWidth: 0, paddingLeft: index ? 10 : 0, borderLeft: index ? `1px solid ${C.border}` : undefined }}>
                      <div style={{ color: C.faint, fontSize: 9.5, textTransform: "uppercase", letterSpacing: "0.04em" }}>{signal?.label ?? (index ? "Visitor metric" : "Lab metric")}</div>
                      <div style={{ color: signal ? ratingColor(signal.rating) : C.muted, fontSize: compact ? 17 : 20, fontWeight: 650, marginTop: 5 }}>{signal?.formatted ?? "—"}</div>
                      <div style={{ color: signal ? ratingColor(signal.rating) : C.faint, fontSize: 9.5, marginTop: 3 }}>{signal?.rating ?? "Unavailable"}</div>
                    </div>
                  ))}
                </div>
                {compact && series.length > 1 && metric.field && (
                  <div style={{ height: 28, marginTop: 9 }}>
                    <Sparkline series={series} color={ratingColor(metric.field.rating)} w={150} h={28} />
                  </div>
                )}
              </div>
            );
          })}
          </div>
        </>
      )}

      <div style={{ marginTop: 12, fontSize: 10.5, color: C.faint, lineHeight: 1.45 }}>
        Lighthouse values are controlled lab medians from the latest retained run in this range. Visitor values are CrUX p75 measurements over a rolling 28-day window; they are not Lighthouse scores.
        {latest?.scope === "origin" ? " Exact URL data was unavailable, so these measurements cover the entire origin." : ""}
        {trend !== "insufficient" ? ` Visitor evidence is ${trend} versus its prior weekly snapshot.` : ""}
      </div>
    </section>
  );
}
