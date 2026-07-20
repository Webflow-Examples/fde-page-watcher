import type { PageStatus } from "@/lib/types";
import { statusMeta } from "@/lib/scoring";
import { C } from "@/lib/ui";

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

export function StatusShape({ shape, color }: { shape: "circle" | "triangle" | "square"; color: string }) {
  if (shape === "triangle") {
    return <span style={{ width: 0, height: 0, borderLeft: "4px solid transparent", borderRight: "4px solid transparent", borderBottom: `7px solid ${color}` }} />;
  }
  if (shape === "square") {
    return <span style={{ width: 7, height: 7, background: color }} />;
  }
  return <span style={{ width: 7, height: 7, borderRadius: "50%", background: color }} />;
}

export interface SegOption<T extends string> {
  value: T;
  label: string;
  icon?: React.ReactNode;
}

/** Segmented pill toggle (strategy, group-by, view switches). */
export function SegToggle<T extends string>({ options, value, onChange }: { options: SegOption<T>[]; value: T; onChange: (v: T) => void }) {
  return (
    <div role="group" style={{ display: "inline-flex", padding: 3, background: "rgba(255,255,255,0.05)", border: `1px solid ${C.border2}`, borderRadius: 8 }}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(o.value)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              border: "none",
              fontSize: 11.5,
              fontWeight: 550,
              padding: o.icon ? "6px 11px" : "5px 12px",
              borderRadius: 6,
              cursor: "pointer",
              color: active ? "#FFFFFF" : C.faint2,
              background: active ? "rgba(255,255,255,0.10)" : "transparent",
            }}
          >
            {o.icon}
            {o.label}
          </button>
        );
      })}
    </div>
  );
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
