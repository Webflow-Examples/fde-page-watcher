import type { PageStatus } from "@/lib/types";
import { statusMeta } from "@/lib/scoring";
import { C } from "@/lib/ui";
import { SegmentedControl } from "@/components/segmented-control";

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
export function DeviceChangeLabels({ mobile, desktop, size = 11.5, direction = "column" }: { mobile: PageStatus; desktop: PageStatus; size?: number; direction?: "row" | "column" }) {
  return (
    <div style={{ display: "flex", flexDirection: direction, alignItems: "flex-start", gap: direction === "row" ? 14 : 5 }}>
      <DeviceChangeLine device="M" name="Mobile" status={mobile} size={size} />
      <DeviceChangeLine device="D" name="Desktop" status={desktop} size={size} />
    </div>
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
