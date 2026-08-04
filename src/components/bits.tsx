import type { PageStatus, Rec, WebflowPerformanceClassification } from "@/lib/types";
import { statusMeta } from "@/lib/scoring";
import { C } from "@/lib/ui";
import { SegmentedControl } from "@/components/segmented-control";
import type { VisitorExperienceTrend } from "@/lib/visitorExperience";
import { remediationTone } from "@/lib/webflowPerformance";
import type { PerformanceIssueStatus } from "@/lib/performanceIssues";
import type { LabFieldComparisonStatus } from "@/lib/labFieldComparison";
import type { RecommendationEvidenceSignal } from "@/lib/fieldPrioritization";
import { fieldRecommendationLifecycleStatus } from "@/lib/fieldOnlyRecommendations";

export function FieldRecommendationStatusBadge({ rec }: { rec: Pick<Rec, "source" | "fieldLifecycle"> }) {
  const status = fieldRecommendationLifecycleStatus(rec);
  if (!status) return null;
  const meta = status === "regressed"
    ? { label: "Field issue returned", color: C.redSoft, background: "rgba(255,92,108,0.13)", title: "The visitor-only issue returned after it had cleared or become corroborated." }
    : status === "active"
      ? { label: "Active field issue", color: C.amber, background: "rgba(255,154,61,0.13)", title: "Exact-URL visitor evidence is outside the good range and Lighthouse does not reproduce it." }
      : status === "verifying"
        ? { label: "Verifying recovery", color: C.accentSoft, background: "rgba(59,137,255,0.13)", title: "One distinct CrUX window is good; a second is required to confirm resolution." }
        : status === "corroborated"
          ? { label: "Now reproduced in lab", color: C.violetSoft, background: "rgba(138,92,246,0.13)", title: "The visitor issue is now reproduced or explained by the latest Lighthouse evidence." }
          : { label: "Field issue resolved", color: C.green, background: "rgba(53,208,127,0.13)", title: "Two distinct CrUX windows are within the good range." };
  return (
    <span title={meta.title} style={{ fontSize: 10.5, fontWeight: 650, color: meta.color, background: meta.background, padding: "2px 7px", borderRadius: 5, whiteSpace: "nowrap" }}>
      {meta.label}
    </span>
  );
}

export function FieldEvidenceChip({ signal }: { signal: RecommendationEvidenceSignal }) {
  const tone = signal.priority === "corroborated"
    ? { color: C.redSoft, background: "rgba(255,92,108,0.13)" }
    : signal.priority === "field-only"
      ? { color: C.amber, background: "rgba(255,154,61,0.13)" }
      : signal.priority === "aligned-good"
        ? { color: C.green, background: "rgba(53,208,127,0.13)" }
        : signal.priority === "origin-context"
          ? { color: C.accentSoft, background: "rgba(59,137,255,0.13)" }
          : { color: C.muted, background: "rgba(255,255,255,0.06)" };
  return (
    <span title={signal.detail} style={{ display: "inline-flex", alignItems: "center", fontSize: 10.5, fontWeight: 650, color: tone.color, background: tone.background, padding: "2px 7px", borderRadius: 5, whiteSpace: "nowrap" }}>
      {signal.label}{signal.strategy ? ` · ${signal.strategy}` : ""}
    </span>
  );
}

export function PerformanceIssueStatusBadge({ status }: { status: PerformanceIssueStatus }) {
  const meta = status === "regressed"
    ? { label: "Returned", color: C.redSoft, background: "rgba(255,92,108,0.13)", title: "Returned after a confirmed resolution" }
    : status === "resolved"
      ? { label: "Resolved", color: C.green, background: "rgba(53,208,127,0.13)", title: "Absent from two consecutive diagnostic captures" }
      : status === "verifying"
        ? { label: "Verifying fix", color: C.accentSoft, background: "rgba(59,137,255,0.13)", title: "Absent once; one more clean capture is required" }
        : { label: "Active", color: C.amber, background: "rgba(255,154,61,0.13)", title: "Present in the latest diagnostic capture" };
  return (
    <span title={meta.title} style={{ fontSize: 10.5, fontWeight: 650, color: meta.color, background: meta.background, padding: "2px 7px", borderRadius: 5, whiteSpace: "nowrap" }}>
      {meta.label}
    </span>
  );
}

/** Compact culprit, weighted metric, and remediation labels for a Lighthouse finding. */
export function WebflowClassificationChips({
  classification,
  showMetric = true,
  showCulprit = true,
}: {
  classification: WebflowPerformanceClassification;
  showMetric?: boolean;
  showCulprit?: boolean;
}) {
  const tone = remediationTone(classification.remediation);
  return (
    <span style={{ display: "inline-flex", alignItems: "center", flexWrap: "wrap", gap: 6 }}>
      {showMetric && classification.metric !== "other" && (
        <span style={{ fontSize: 10.5, fontWeight: 650, color: C.accentSoft, background: "rgba(59,137,255,0.12)", padding: "2px 7px", borderRadius: 5, whiteSpace: "nowrap" }}>
          {classification.metric} · {classification.metricWeight}%
        </span>
      )}
      {showCulprit && (
        <span style={{ fontSize: 10.5, fontWeight: 550, color: C.violetSoft, background: "rgba(138,92,246,0.12)", padding: "2px 7px", borderRadius: 5, whiteSpace: "nowrap" }}>
          {classification.culpritLabel}
        </span>
      )}
      <span
        title={classification.guidance}
        style={{ fontSize: 10.5, fontWeight: 650, color: tone.color, background: tone.background, padding: "2px 7px", borderRadius: 5, whiteSpace: "nowrap" }}
      >
        {classification.remediationLabel}
      </span>
    </span>
  );
}

/** Status pill with its accessibility shape (circle / triangle / square) — REQ-009. */
export function StatusBadge({ status, size = 12.5 }: { status: PageStatus; size?: number }) {
  const sm = statusMeta(status);
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        whiteSpace: "nowrap",
        fontSize: size,
        fontWeight: 550,
        padding: "4px 12px",
        borderRadius: 20,
        color: sm.fg,
        background: sm.bg,
      }}
    >
      <StatusShape shape={sm.shape} color={sm.fg} />
      {sm.label}
    </span>
  );
}

/** Compact always-visible mobile + desktop Performance trends. */
export function DeviceChangeLabels({
  mobile,
  desktop,
  visitorExperience,
  labFieldComparison,
  size = 11.5,
  direction = "column",
}: {
  mobile: PageStatus;
  desktop: PageStatus;
  visitorExperience?: VisitorExperienceTrend;
  labFieldComparison?: LabFieldComparisonStatus;
  size?: number;
  direction?: "row" | "column";
}) {
  return (
    <div style={{ display: "flex", flexDirection: direction, alignItems: "flex-start", gap: direction === "row" ? 14 : 5 }}>
      <DeviceChangeLine device="M" name="Mobile" status={mobile} size={size} />
      <DeviceChangeLine device="D" name="Desktop" status={desktop} size={size} />
      {visitorExperience && <VisitorExperienceLine status={visitorExperience} size={size} />}
      {labFieldComparison && <LabFieldComparisonLine status={labFieldComparison} size={size} />}
    </div>
  );
}

function LabFieldComparisonLine({ status, size }: { status: LabFieldComparisonStatus; size: number }) {
  const meta = status === "aligned"
    ? { label: "Aligned", color: C.green }
    : status === "corroborated"
      ? { label: "Corroborated", color: C.redSoft }
      : status === "divergent"
        ? { label: "Divergent", color: C.amber }
        : status === "partial"
          ? { label: "Partial", color: C.accentSoft }
          : { label: "Unavailable", color: C.muted };
  return (
    <span aria-label={`Lab and field evidence: ${meta.label}`} title={`Lab and field evidence: ${meta.label}`} style={{ display: "inline-flex", alignItems: "center", gap: 5, color: meta.color, fontSize: size, fontWeight: 550, whiteSpace: "nowrap" }}>
      <span style={{ width: 20, color: C.faint2, fontSize: size - 1, fontWeight: 650 }}>L/F</span>
      <span aria-hidden="true" style={{ width: 7, height: 7, borderRadius: "50%", background: meta.color }} />
      <span>{meta.label}</span>
    </span>
  );
}
function VisitorExperienceLine({ status, size }: { status: VisitorExperienceTrend; size: number }) {
  const label = status === "insufficient" ? "Unavailable" : status;
  const color = status === "worsening" ? C.redSoft : status === "improving" ? C.green : status === "stable" ? C.accentSoft : C.muted;
  return (
    <span aria-label={`Visitor experience: ${label}`} title={`Visitor experience: ${label}`} style={{ display: "inline-flex", alignItems: "center", gap: 5, color, fontSize: size, fontWeight: 550, whiteSpace: "nowrap" }}>
      <span style={{ width: 20, color: C.faint2, fontSize: size - 1, fontWeight: 650 }}>XP</span>
      <span aria-hidden="true" style={{ width: 7, height: 7, borderRadius: "50%", background: color }} />
      <span style={{ textTransform: "capitalize" }}>{label}</span>
    </span>
  );
}

/** Prominent mobile + desktop Performance status tiles for page headers. */
export function DeviceStatusCards({ mobile, desktop }: { mobile: PageStatus; desktop: PageStatus }) {
  return (
    <div
      className="page-status-cards"
      style={{
        display: "inline-grid",
        gridTemplateColumns: "max-content",
        alignItems: "stretch",
        justifyItems: "stretch",
        gap: 4,
      }}
    >
      <DeviceStatusCard name="Desktop" status={desktop} />
      <DeviceStatusCard name="Mobile" status={mobile} />
    </div>
  );
}

function DeviceStatusCard({ name, status }: { name: "Mobile" | "Desktop"; status: PageStatus }) {
  const sm = statusMeta(status);
  const pulseClass = status === "improving" ? " status-tile-indicator--slow" : status === "regressing" ? " status-tile-indicator--fast" : "";
  return (
    <div
      aria-label={`${name} Performance change: ${sm.label}`}
      title={`${name} Performance change: ${sm.label}`}
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 14,
        padding: 11,
        border: `1px solid ${sm.fg}`,
        borderRadius: 10,
        color: sm.fg,
        background: sm.bg,
      }}
    >
      <span style={{ fontSize: 12, lineHeight: 1, fontWeight: 700 }}>{name}</span>
      <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 10.5, fontWeight: 650, whiteSpace: "nowrap" }}>
        <span aria-hidden="true" className={`status-tile-indicator${pulseClass}`}>
          <StatusShape shape={sm.shape} color={sm.fg} />
        </span>
        {sm.label}
      </span>
    </div>
  );
}

function DeviceChangeLine({ device, name, status, size }: { device: "M" | "D"; name: string; status: PageStatus; size: number }) {
  const sm = statusMeta(status);
  return (
    <span aria-label={`${name} Performance change: ${sm.label}`} title={`${name} Performance change: ${sm.label}`} style={{ display: "inline-flex", alignItems: "center", gap: 5, color: sm.fg, fontSize: size, fontWeight: 550, whiteSpace: "nowrap" }}>
      <span style={{ width: 14, color: C.faint2, fontSize: size - 1, fontWeight: 650 }}>{device}</span>
      <StatusShape shape={sm.shape} color={sm.fg} />
      {sm.label}
    </span>
  );
}

export function StatusShape({ shape, color }: { shape: "circle" | "triangle" | "square"; color: string }) {
  if (shape === "triangle") {
    return <span style={{ width: 0, height: 0, borderLeft: "4px solid transparent", borderRight: "4px solid transparent", borderBottom: `7px solid ${color}` }} />;
  }
  if (shape === "square") {
    return <span style={{ width: 7, height: 7, background: color }} />;
  }
  return <span style={{ width: 7, height: 7, borderRadius: "50%", background: color }} />;
}

export interface SegOption<T extends string | number> {
  value: T;
  label: string;
  icon?: React.ReactNode;
  disabled?: boolean;
  title?: string;
  tone?: string;
  selectedBackground?: string;
}

/** Segmented pill toggle (strategy, group-by, view switches). */
export function SegToggle<T extends string | number>({ options, value, onChange, label }: { options: SegOption<T>[]; value: T; onChange: (v: T) => void; label?: string }) {
  return <SegmentedControl ariaLabel={label ?? "Options"} value={value} onChange={onChange} options={options} />;
}

/** A sortable column header button with an ↑/↓ indicator. */
export function SortHeader({
  label,
  active,
  dir,
  onSort,
  align = "center",
}: {
  label: string;
  active: boolean;
  dir: "asc" | "desc";
  onSort: () => void;
  align?: "left" | "center" | "right";
}) {
  return (
    <div style={{ textAlign: align }}>
      <button
        onClick={onSort}
        style={{
          border: "none",
          background: "none",
          font: "inherit",
          letterSpacing: "inherit",
          textTransform: "inherit",
          cursor: "pointer",
          padding: 0,
          color: active ? C.text : C.faint,
        }}
      >
        {label}
        {active ? (dir === "asc" ? " ↑" : " ↓") : ""}
      </button>
    </div>
  );
}
