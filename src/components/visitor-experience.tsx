"use client";

import type { CruxPageEvidence } from "@/lib/crux";
import type { PageStatus } from "@/lib/types";
import {
  formatCollectionWindow,
  formatVisitorMetric,
  metricRating,
  VISITOR_METRICS,
  visitorConfidenceLabel,
  visitorExperienceTrend,
  visitorSnapshotValues,
} from "@/lib/visitorExperience";
import { C } from "@/lib/ui";
import { Sparkline } from "./charts";

function ratingColor(rating: ReturnType<typeof metricRating>): string {
  return rating === "Good" ? C.green : rating === "Needs improvement" ? C.amber : C.redSoft;
}

function scopeLabel(item: CruxPageEvidence, scope: "url" | "origin"): string {
  return scope === "url" ? "Exact URL" : "Origin-wide";
}

export function VisitorExperiencePanel({
  evidence,
  labTrend,
  compact = false,
}: {
  evidence: CruxPageEvidence | null;
  labTrend: PageStatus;
  compact?: boolean;
}) {
  const latest = evidence?.snapshots.at(-1) ?? null;
  const trend = visitorExperienceTrend(evidence);
  const confidence = visitorConfidenceLabel(labTrend, trend);
  const tone = trend === "worsening" ? C.redSoft : trend === "improving" ? C.green : trend === "stable" ? C.accentSoft : C.muted;

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
          <div style={{ color: tone, fontSize: 12, fontWeight: 650 }}>{confidence}</div>
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
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 12, marginTop: 16 }}>
          {VISITOR_METRICS.map((metric) => {
            const value = latest[metric.key];
            const rating = value === null ? null : metricRating(metric.key, value);
            const series = visitorSnapshotValues(evidence!.snapshots, metric.key);
            return (
              <div key={metric.key} style={{ minWidth: 0, background: compact ? C.bgElev : C.panel2, border: `1px solid ${C.border2}`, borderRadius: 10, padding: compact ? "12px" : "14px" }}>
                <div style={{ fontSize: 12.5, color: C.text, fontWeight: 600 }}>{metric.label}</div>
                <div style={{ fontSize: 10.5, color: C.faint, marginTop: 3 }}>{metric.technicalName}</div>
                <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8, marginTop: 12 }}>
                  <span style={{ fontSize: compact ? 19 : 23, lineHeight: 1, fontWeight: 600, color: rating ? ratingColor(rating) : C.muted }}>
                    {formatVisitorMetric(metric.key, value)}
                  </span>
                  {rating && <span style={{ fontSize: 9.5, color: ratingColor(rating), whiteSpace: "nowrap" }}>{rating}</span>}
                </div>
                {compact && series.length > 0 && (
                  <div style={{ height: 30, marginTop: 10 }}>
                    <Sparkline series={series} color={rating ? ratingColor(rating) : C.muted} w={150} h={30} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <div style={{ marginTop: 12, fontSize: 10.5, color: C.faint, lineHeight: 1.45 }}>
        Values represent the 75th percentile of Chrome visits. They are not Lighthouse scores.
        {latest?.scope === "origin" ? " Exact URL data was unavailable, so these measurements cover the entire origin." : ""}
      </div>
    </section>
  );
}
