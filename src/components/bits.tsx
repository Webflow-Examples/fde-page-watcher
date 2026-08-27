import type { CSSProperties } from "react";
import type { PageStatus, Rec, WebflowPerformanceClassification } from "@/lib/types";
import { statusMeta } from "@/lib/scoring";
import type { StatusShapeName } from "@/lib/scoring";
import { SegmentedControl } from "@/components/segmented-control";
import { StatusChip } from "@/components/status-chip";
import { TrendArrow } from "@/components/trend-arrow";
import { Magnitude } from "@/components/magnitude";
import { TREND_LABEL } from "@/lib/vocabulary";
import type { Tone, Trend, WorkState } from "@/lib/vocabulary";
import type { VisitorExperienceTrend } from "@/lib/visitorExperience";
import { metricDisplay, remediationTone } from "@/lib/webflowPerformance";
import type { PerformanceIssueStatus } from "@/lib/performanceIssues";
import type { LabFieldComparisonStatus } from "@/lib/labFieldComparison";
import type { RecommendationEvidenceSignal } from "@/lib/fieldPrioritization";
import { fieldRecommendationLifecycleStatus } from "@/lib/fieldOnlyRecommendations";

/**
 * Small shared display pieces.
 *
 * Nothing in this file names a colour value. Three vocabularies used to arrive
 * here as one undifferentiated hue and are now kept apart:
 *
 *   work state  -> <StatusChip>   (the seven F1 states, `--status-*`)
 *   trend       -> <TrendArrow>   (direction is shape, `--trend-glyph`)
 *   magnitude   -> <Magnitude>    (size is weight, `--magnitude-*`)
 *
 * Evidence strength is its own axis again — `--confidence-strong` / `-weak`.
 * It used to borrow red for "well corroborated", which read as "bad" when it
 * meant the opposite.
 */

/** Nothing carrying meaning renders below 12px (F3 rule 10). */
const MIN_FONT_SIZE = 12;

/** The shared chip shell. Ground and ink are always supplied by the caller. */
const CHIP: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  fontSize: MIN_FONT_SIZE,
  fontWeight: 600,
  padding: "2px 7px",
  borderRadius: 5,
  whiteSpace: "nowrap",
};

/**
 * The lifecycle of a visitor-only (CrUX) recommendation.
 *
 * Four of its five values are F1 work states and render through the one chip.
 * `corroborated` is not a work state — "now reproduced in lab" says how well
 * evidenced the finding is, not where it sits in someone's queue — so it is a
 * confidence statement instead of a forced sixth chip tone.
 */
export function FieldRecommendationStatusBadge({ rec }: { rec: Pick<Rec, "source" | "fieldLifecycle"> }) {
  const status = fieldRecommendationLifecycleStatus(rec);
  if (!status) return null;

  if (status === "corroborated") {
    return (
      <span
        title="The nightly test now reproduces, or explains, what real visitors were meeting."
        style={{ ...CHIP, color: "var(--confidence-strong)" }}
      >
        Now reproduced by the nightly test
      </span>
    );
  }

  const meta = status === "regressed"
    ? { state: "reopened" as const, title: "The problem real visitors were meeting came back after it had cleared or been confirmed." }
    : status === "active"
      ? { state: "new" as const, title: "Real visitors to this exact page are outside the good range, and the nightly test cannot reproduce it." }
      : status === "verifying"
        ? { state: "fixed" as const, title: "Verifying recovery: one 28-day window of visitor figures is good; a second is needed to confirm it." }
        : { state: "resolved" as const, title: "Settled: two separate 28-day windows of visitor figures are inside the good range." };

  return (
    <span title={meta.title} style={{ display: "inline-flex" }}>
      <StatusChip state={meta.state} />
    </span>
  );
}

/**
 * How well the field evidence supports a recommendation — a confidence
 * statement, so it takes the confidence tokens rather than a health hue. The
 * one exception is `aligned-good`, which really is a verdict about the page
 * ("the visitor p75 is inside the good range") and keeps the good-health pair.
 */
export function FieldEvidenceChip({ signal }: { signal: RecommendationEvidenceSignal }) {
  const tone = signal.priority === "corroborated"
    ? { color: "var(--confidence-strong)", background: "transparent" }
    : signal.priority === "field-only"
      ? { color: "var(--confidence-weak)", background: "transparent" }
      : signal.priority === "aligned-good"
        ? { color: "var(--health-good-text)", background: "var(--health-good-bg)" }
        : signal.priority === "origin-context"
          ? { color: "var(--confidence-weak)", background: "transparent" }
          : { color: "var(--text-muted)", background: "transparent" };
  return (
    <span title={signal.detail} style={{ ...CHIP, color: tone.color, background: tone.background }}>
      {signal.label}{signal.strategy ? ` · ${signal.strategy}` : ""}
    </span>
  );
}

/**
 * A diagnostic issue's lifecycle. A 1:1 match with the F1 work states, so it
 * is the one chip and nothing else.
 */
const PERFORMANCE_ISSUE_CHIP: Record<PerformanceIssueStatus, { state: WorkState; title: string }> = {
  regressed: { state: "reopened", title: "Returned after a confirmed resolution" },
  resolved: { state: "resolved", title: "Gone from the last two nightly tests" },
  verifying: { state: "fixed", title: "Gone once; one more clean night confirms it" },
  active: { state: "new", title: "Found in the latest nightly test" },
};

export function PerformanceIssueStatusBadge({ status }: { status: PerformanceIssueStatus }) {
  const meta = PERFORMANCE_ISSUE_CHIP[status];
  return (
    <span title={meta.title} style={{ display: "inline-flex" }}>
      <StatusChip state={meta.state} />
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
  // A NAME, not a colour: "what can the customer do about this?" is a system
  // state, so it resolves through the status tokens. It must never reach for
  // `--health-*` — a page with an available remediation is still broken.
  const tone: Tone = remediationTone(classification.remediation);
  const actionability = classification.actionability
    ?? (classification.remediation === "available" ? "direct"
      : classification.remediation === "partial" ? "workaround"
        : classification.remediation === "unknown" ? "review"
          : "none");
  const actionLabel = actionability === "direct" ? "Action available"
    : actionability === "workaround" ? "Workaround available"
      : actionability === "review" ? "Needs review"
        : "No direct action";
  return (
    <span style={{ display: "inline-flex", alignItems: "center", flexWrap: "wrap", gap: 6 }}>
      {showMetric && classification.metric !== "other" && (
        // The weight is a quantity, so it carries its own emphasis rather than
        // a hue; the metric name beside it is a label, not a verdict.
        <span style={{ ...CHIP, gap: 4, color: "var(--text-muted)", background: "var(--surface-input)" }}>
          {metricDisplay(classification.metric)}
          <span aria-hidden="true">·</span>
          <Magnitude value={classification.metricWeight} unit="%" fontSize={MIN_FONT_SIZE} style={{ gap: 0 }} />
        </span>
      )}
      {showCulprit && (
        // A taxonomy name. A classification is not a verdict, so it has no hue.
        <span style={{ ...CHIP, color: "var(--text-muted)", background: "var(--surface-input)" }}>
          {classification.culpritLabel}
        </span>
      )}
      <span
        title={actionLabel}
        style={{ ...CHIP, color: `var(--status-${tone}-text)`, background: `var(--status-${tone}-bg)` }}
      >
        {actionLabel}
      </span>
    </span>
  );
}

/**
 * Status pill with its accessibility shape (circle / triangle / square) —
 * REQ-009. `pending` is not a fourth direction, it is "no verdict yet", so it
 * takes the health-none pair rather than an arrow.
 */
export function StatusBadge({ status, size = 12.5 }: { status: PageStatus; size?: number }) {
  const sm = statusMeta(status);
  const shell: CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    whiteSpace: "nowrap",
    fontSize: Math.max(MIN_FONT_SIZE, size),
    fontWeight: 550,
    padding: "4px 12px",
    borderRadius: 20,
  };
  if (sm.kind === "pending") {
    return (
      <span style={{ ...shell, color: "var(--health-none-text)", background: "var(--health-none-bg)" }}>
        <StatusShape shape={sm.shape} />
        {sm.label}
      </span>
    );
  }
  return (
    <span style={{ ...shell, color: "var(--trend-glyph)", background: "var(--surface-input)" }}>
      <StatusShape shape={sm.shape} />
      <TrendArrow trend={sm.trend} fontSize={Math.max(MIN_FONT_SIZE, size)} />
    </span>
  );
}

/** Compact always-visible mobile + desktop Performance trends. */
export function DeviceChangeLabels({
  mobile,
  desktop,
  visitorExperience,
  labFieldComparison,
  size = 13,
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

/** The row-prefix letters ("M", "D", "XP", "L/F") sit one step down, never below 12. */
function prefixSize(size: number) {
  return Math.max(MIN_FONT_SIZE, size - 1);
}

const LINE: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 5,
  fontWeight: 550,
  whiteSpace: "nowrap",
};

/**
 * How far lab and visitor evidence agree. This is an evidence-strength
 * statement, not a health verdict: `corroborated` used to be red, which reads
 * as "bad" when it in fact means "both sources agree" — the strongest evidence
 * the app has. Whether the agreed-on reading is good or bad is the health
 * chip's job, on the same row.
 */
function LabFieldComparisonLine({ status, size }: { status: LabFieldComparisonStatus; size: number }) {
  const meta = status === "aligned"
    ? { label: "Aligned", color: "var(--confidence-strong)" }
    : status === "corroborated"
      ? { label: "Corroborated", color: "var(--confidence-strong)" }
      : status === "divergent"
        ? { label: "Divergent", color: "var(--confidence-weak)" }
        : status === "partial"
          ? { label: "Partial", color: "var(--confidence-weak)" }
          : { label: "Unavailable", color: "var(--health-none-text)" };
  return (
    <span
      aria-label={`Lab and field evidence: ${meta.label}`}
      title={`Lab and field evidence: ${meta.label}`}
      style={{ ...LINE, color: meta.color, fontSize: Math.max(MIN_FONT_SIZE, size) }}
    >
      <span style={{ width: 24, color: "var(--text-muted)", fontSize: prefixSize(size), fontWeight: 650 }}>L/F</span>
      <span aria-hidden="true" style={{ width: 7, height: 7, borderRadius: "50%", background: "currentColor" }} />
      <span>{meta.label}</span>
    </span>
  );
}

const VISITOR_EXPERIENCE_TREND: Record<Exclude<VisitorExperienceTrend, "insufficient">, Trend> = {
  improving: "improving",
  stable: "no_change",
  worsening: "regressing",
};

/**
 * Visitor-experience direction. This was worsening=red / improving=green /
 * stable=blue, repeated as a coloured dot — direction painted as a verdict.
 * It is an arrow now; `insufficient` is not a direction at all, so it reads as
 * "no verdict yet" rather than a fourth colour.
 */
function VisitorExperienceLine({ status, size }: { status: VisitorExperienceTrend; size: number }) {
  const fontSize = Math.max(MIN_FONT_SIZE, size);
  const prefix = (
    <span style={{ width: 24, color: "var(--text-muted)", fontSize: prefixSize(size), fontWeight: 650 }}>XP</span>
  );
  if (status === "insufficient") {
    return (
      <span
        aria-label="Visitor experience: Unavailable"
        title="Visitor experience: Unavailable"
        style={{ ...LINE, color: "var(--health-none-text)", fontSize }}
      >
        {prefix}
        <span>Unavailable</span>
      </span>
    );
  }
  const trend = VISITOR_EXPERIENCE_TREND[status];
  return (
    <span
      aria-label={`Visitor experience: ${TREND_LABEL[trend]}`}
      title={`Visitor experience: ${TREND_LABEL[trend]}`}
      style={{ ...LINE, color: "var(--text-body)", fontSize }}
    >
      {prefix}
      <TrendArrow trend={trend} fontSize={fontSize} />
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
  // Motion and shape, not hue — the pulse rate is the only thing that varies
  // with direction, and that is a channel colour was doing twice over.
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
        border: "1px solid var(--border-hairline)",
        borderRadius: 10,
        color: "var(--text-body)",
        background: "var(--surface-card)",
      }}
    >
      <span style={{ fontSize: MIN_FONT_SIZE, lineHeight: 1, fontWeight: 700 }}>{name}</span>
      <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: MIN_FONT_SIZE, fontWeight: 650, whiteSpace: "nowrap", color: sm.kind === "pending" ? "var(--health-none-text)" : "var(--trend-glyph)" }}>
        <span aria-hidden="true" className={`status-tile-indicator${pulseClass}`}>
          <StatusShape shape={sm.shape} />
        </span>
        {sm.kind === "pending" ? sm.label : <TrendArrow trend={sm.trend} fontSize={MIN_FONT_SIZE} />}
      </span>
    </div>
  );
}

function DeviceChangeLine({ device, name, status, size }: { device: "M" | "D"; name: string; status: PageStatus; size: number }) {
  const sm = statusMeta(status);
  const fontSize = Math.max(MIN_FONT_SIZE, size);
  return (
    <span
      aria-label={`${name} Performance change: ${sm.label}`}
      title={`${name} Performance change: ${sm.label}`}
      style={{ ...LINE, color: sm.kind === "pending" ? "var(--health-none-text)" : "var(--trend-glyph)", fontSize }}
    >
      <span style={{ width: 16, color: "var(--text-muted)", fontSize: prefixSize(size), fontWeight: 650 }}>{device}</span>
      <StatusShape shape={sm.shape} />
      {sm.kind === "pending" ? sm.label : <TrendArrow trend={sm.trend} fontSize={fontSize} />}
    </span>
  );
}

/**
 * The accessibility shape that rides along with a direction (REQ-009).
 *
 * It used to take a free-form `color: string`, which is how health hues and
 * trend hues both reached what is meant to be a redundancy marker. It inherits
 * now: inside a trend it is `--trend-glyph`, inside a pending row it is
 * `--health-none-text`, and there is no way to hand it anything else.
 */
export function StatusShape({ shape }: { shape: StatusShapeName }) {
  if (shape === "triangle") {
    return <span style={{ width: 0, height: 0, borderLeft: "4px solid transparent", borderRight: "4px solid transparent", borderBottom: "7px solid currentColor" }} />;
  }
  if (shape === "square") {
    return <span style={{ width: 7, height: 7, background: "currentColor" }} />;
  }
  return <span style={{ width: 7, height: 7, borderRadius: "50%", background: "currentColor" }} />;
}

export interface SegOption<T extends string | number> {
  value: T;
  label: string;
  icon?: React.ReactNode;
  disabled?: boolean;
  title?: string;
  /**
   * A tone NAME from the vocabulary registry, never a colour value. The
   * control resolves it to `--status-<tone>-text` / `-bg`, exactly as
   * `status-chip.tsx` does.
   *
   * This was `tone?: string` alongside `selectedBackground?: string`, which is
   * how a health hue, a trend hue and the desktop series purple all reached an
   * otherwise neutral control. Both are gone: a segment cannot carry its own
   * palette, and a future attempt to give it one is a compile error.
   */
  tone?: Tone;
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
          color: active ? "var(--text-body)" : "var(--text-muted)",
        }}
      >
        {label}
        {active ? (dir === "asc" ? " ↑" : " ↓") : ""}
      </button>
    </div>
  );
}
