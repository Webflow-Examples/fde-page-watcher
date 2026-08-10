/**
 * Small, bounded visual mocks of real Page Watch UI conventions, built from
 * the literal token values in src/app/globals.css and the shapes described
 * in docs/visual-inventory.md. These are illustrative recreations rendered
 * with plain inline-styled markup inside the preview canvas — not the real
 * app components, and not fetched from anywhere at runtime.
 *
 * Where the source pattern is itself interactive (segmented control, select
 * menu, sortable header, status toggle), the mock responds to clicks with
 * local state so the preview behaves like the real thing rather than a
 * frozen screenshot.
 */
import { useState, type CSSProperties, type ReactNode } from "react";

const T = {
  bg: "#0b0b0c",
  bgElev: "#0e0e10",
  panel: "#131315",
  panel2: "#161619",
  border: "#1e1e22",
  border2: "#26262a",
  text: "#f4f4f5",
  textDim: "#c4c4c8",
  textMuted: "#8a8a90",
  textFaint: "#6c6c72",
  accent: "#146ef5",
  accentBright: "#3b89ff",
  green: "#35d07f",
  amber: "#ff9a3d",
  red: "#ff5c6c",
  violet: "#8a5cf6",
};

const canvasStyle: CSSProperties = {
  background: T.bg,
  border: "1px solid " + T.border,
  borderRadius: 10,
  padding: 20,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  minHeight: 96,
  fontFamily: "-apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Helvetica, Arial, sans-serif",
};

function Canvas({ children }: { children: ReactNode }) {
  return <div style={canvasStyle}>{children}</div>;
}

/** Best-effort clipboard copy; silently no-ops if the browser denies it. */
export function copyToClipboard(value: string) {
  if (typeof navigator !== "undefined" && navigator.clipboard) {
    navigator.clipboard.writeText(value).catch(() => {});
  }
}

function CopiedFlash({ copied }: { copied: boolean }) {
  if (!copied) return null;
  return (
    <span
      style={{
        marginLeft: 6,
        color: T.green,
        fontSize: 10,
        fontWeight: 600,
      }}
    >
      Copied
    </span>
  );
}

function useCopiedFlash(): [boolean, (value: string) => void] {
  const [copied, setCopied] = useState(false);
  function trigger(value: string) {
    copyToClipboard(value);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  }
  return [copied, trigger];
}

/** Interactive: click a device to select it, like the real segmented control. */
function SegmentedControlMock() {
  const [selected, setSelected] = useState(0);
  const options = ["Desktop", "Mobile"];
  return (
    <Canvas>
      <div style={{ display: "inline-flex", gap: 2, padding: 3, borderRadius: 9, background: "#101014" }}>
        {options.map((label, index) => (
          <button
            key={label}
            type="button"
            onClick={() => setSelected(index)}
            style={{
              padding: "6px 12px",
              border: 0,
              borderRadius: 7,
              fontSize: 13,
              fontWeight: 500,
              cursor: "pointer",
              color: index === selected ? T.text : "#6b6b76",
              background: index === selected ? "#20202a" : "transparent",
            }}
          >
            {label}
          </button>
        ))}
      </div>
    </Canvas>
  );
}

/** Interactive: click to open/close the listbox and choose a range. */
function SelectMenuMock() {
  const [open, setOpen] = useState(false);
  const options = ["Last 7 days", "Last 14 days", "Last 30 days"];
  const [selected, setSelected] = useState(options[0]);
  return (
    <Canvas>
      <div style={{ position: "relative" }}>
        <button
          type="button"
          onClick={() => setOpen((current) => !current)}
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            height: 34,
            padding: "0 11px 0 12px",
            border: "1px solid #2a2a33",
            borderRadius: 8,
            background: "#131318",
            color: "#e9e9ee",
            fontSize: 14,
            minWidth: 150,
            cursor: "pointer",
          }}
        >
          <span>{selected}</span>
          <span style={{ color: "#8a8a96", fontSize: 10 }}>{open ? "▴" : "▾"}</span>
        </button>
        {open ? (
          <div
            style={{
              position: "absolute",
              top: "calc(100% + 4px)",
              left: 0,
              right: 0,
              zIndex: 5,
              border: "1px solid #2c2c36",
              borderRadius: 8,
              background: "#16161c",
              boxShadow: "0 12px 28px rgba(0,0,0,0.45)",
              padding: 4,
            }}
          >
            {options.map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => {
                  setSelected(option);
                  setOpen(false);
                }}
                style={{
                  display: "block",
                  width: "100%",
                  textAlign: "left",
                  padding: "7px 8px",
                  border: 0,
                  borderRadius: 6,
                  background: option === selected ? "rgba(20,110,245,0.16)" : "transparent",
                  color: option === selected ? "#fff" : "#c6c6d0",
                  fontSize: 13,
                  cursor: "pointer",
                }}
              >
                {option}
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </Canvas>
  );
}

function ClassificationChipsMock() {
  const chip = (label: string, color: string): CSSProperties => ({
    padding: "3px 9px",
    borderRadius: 999,
    fontSize: 11.5,
    fontWeight: 500,
    color,
    background: color + "22",
    border: "1px solid " + color + "44",
  });
  return (
    <Canvas>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        <span style={chip("LCP · 25%", T.accentBright)}>LCP · 25%</span>
        <span style={chip("Image format", T.violet)}>Image format</span>
        <span style={chip("Fixable in Webflow", T.green)}>Fixable in Webflow</span>
      </div>
    </Canvas>
  );
}

function FieldEvidenceChipMock() {
  return (
    <Canvas>
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          padding: "3px 10px",
          borderRadius: 999,
          fontSize: 11.5,
          fontWeight: 500,
          color: T.amber,
          background: T.amber + "1f",
          border: "1px solid " + T.amber + "44",
        }}
      >
        Corroborated by field data
      </span>
    </Canvas>
  );
}

/** Interactive: click a row to see it become the active status. */
function StatusShapeMock() {
  const rows: { shape: (active: boolean) => ReactNode; label: string; color: string }[] = [
    {
      shape: (active) => (
        <span
          style={{
            width: 8,
            height: 8,
            borderRadius: "50%",
            background: T.green,
            display: "inline-block",
            outline: active ? "2px solid " + T.green : "none",
            outlineOffset: 2,
          }}
        />
      ),
      label: "healthy",
      color: T.green,
    },
    {
      shape: (active) => (
        <span
          style={{
            width: 0,
            height: 0,
            borderLeft: "4px solid transparent",
            borderRight: "4px solid transparent",
            borderBottom: "7px solid " + T.amber,
            display: "inline-block",
            filter: active ? "drop-shadow(0 0 0 " + T.amber + ")" : "none",
          }}
        />
      ),
      label: "slow",
      color: T.amber,
    },
    {
      shape: (active) => (
        <span
          style={{
            width: 8,
            height: 8,
            background: T.red,
            display: "inline-block",
            outline: active ? "2px solid " + T.red : "none",
            outlineOffset: 2,
          }}
        />
      ),
      label: "regressed",
      color: T.red,
    },
  ];
  const [active, setActive] = useState(0);
  return (
    <Canvas>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {rows.map((row, index) => (
          <button
            key={row.label}
            type="button"
            onClick={() => setActive(index)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              background: "transparent",
              border: 0,
              padding: 0,
              cursor: "pointer",
            }}
          >
            {row.shape(index === active)}
            <span
              style={{
                color: row.color,
                fontSize: 12.5,
                fontWeight: index === active ? 700 : 500,
                textTransform: "lowercase",
              }}
            >
              {row.label}
            </span>
          </button>
        ))}
      </div>
    </Canvas>
  );
}

/** Interactive: click to toggle sort direction, like the real column header. */
function SortHeaderMock() {
  const [direction, setDirection] = useState<"desc" | "asc">("desc");
  return (
    <Canvas>
      <button
        type="button"
        onClick={() => setDirection((current) => (current === "desc" ? "asc" : "desc"))}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          background: "transparent",
          border: 0,
          cursor: "pointer",
          color: T.text,
          fontSize: 12.5,
          fontWeight: 600,
        }}
      >
        Performance
        <span style={{ color: T.accentBright, fontSize: 10 }}>{direction === "desc" ? "↓" : "↑"}</span>
      </button>
    </Canvas>
  );
}

function ModalShellMock() {
  return (
    <Canvas>
      <div style={{ position: "relative", width: "100%", maxWidth: 220 }}>
        <div style={{ position: "absolute", inset: -20, background: "rgba(0,0,0,0.55)", borderRadius: 10 }} />
        <div
          style={{
            position: "relative",
            background: T.panel,
            border: "1px solid " + T.border2,
            borderRadius: 12,
            padding: 14,
            boxShadow: "0 24px 56px rgba(0,0,0,0.5)",
          }}
        >
          <div style={{ color: T.text, fontSize: 13, fontWeight: 600, marginBottom: 6 }}>Log a change marker</div>
          <div style={{ color: T.textMuted, fontSize: 11 }}>Schedules 2-, 7-, and 30-day follow-ups.</div>
        </div>
      </div>
    </Canvas>
  );
}

function ToastMock() {
  return (
    <Canvas>
      <div
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 8,
          padding: "9px 14px",
          borderRadius: 10,
          background: "#1a1a1e",
          border: "1px solid " + T.border2,
          color: T.text,
          fontSize: 12.5,
          boxShadow: "0 10px 30px rgba(0,0,0,0.4)",
        }}
      >
        <span style={{ color: T.green }}>✓</span>
        Page removed from watchlist
      </div>
    </Canvas>
  );
}

function EmptyStateMock() {
  return (
    <Canvas>
      <div style={{ textAlign: "center", color: T.textMuted }}>
        <div style={{ fontSize: 22, marginBottom: 4 }}>—</div>
        <div style={{ fontSize: 12.5 }}>No successful run yet</div>
      </div>
    </Canvas>
  );
}

/** Interactive: click a nav item to select it, like the real sidebar. */
function SidebarMock() {
  const items = ["Dashboard", "Inbox", "Tasks", "Escalations", "Watchlist"];
  const [selected, setSelected] = useState(0);
  return (
    <Canvas>
      <div style={{ width: 150, background: T.panel, border: "1px solid " + T.border, borderRadius: 10, padding: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 10 }}>
          <span style={{ width: 16, height: 16, borderRadius: 4, background: T.accent, display: "inline-block" }} />
          <span style={{ color: T.text, fontSize: 11.5, fontWeight: 600 }}>Page Watch</span>
        </div>
        {items.map((item, index) => (
          <button
            key={item}
            type="button"
            onClick={() => setSelected(index)}
            style={{
              display: "block",
              width: "100%",
              textAlign: "left",
              border: 0,
              padding: "5px 7px",
              borderRadius: 6,
              fontSize: 11,
              cursor: "pointer",
              color: index === selected ? T.text : T.textMuted,
              background: index === selected ? "rgba(20,110,245,0.14)" : "transparent",
              marginBottom: 2,
            }}
          >
            {item}
          </button>
        ))}
      </div>
    </Canvas>
  );
}

function SparklineMock() {
  const points = "0,20 10,16 20,18 30,10 40,12 50,6 60,9 70,4";
  return (
    <Canvas>
      <svg width={90} height={26} viewBox="0 0 76 26">
        <polyline points={points} fill="none" stroke={T.green} strokeWidth={1.6} />
      </svg>
    </Canvas>
  );
}

/** Interactive: click Desktop/Mobile to swap which sparkline is highlighted. */
function HistoryChartMock() {
  const [device, setDevice] = useState<"desktop" | "mobile">("desktop");
  return (
    <Canvas>
      <div style={{ display: "flex", flexDirection: "column", gap: 6, width: "100%", maxWidth: 220 }}>
        <button
          type="button"
          onClick={() => setDevice("desktop")}
          style={{
            background: "transparent",
            border: 0,
            padding: 0,
            textAlign: "left",
            cursor: "pointer",
            color: device === "desktop" ? T.accentBright : T.textMuted,
            fontSize: 10.5,
            textTransform: "uppercase",
            letterSpacing: "0.05em",
            fontWeight: device === "desktop" ? 700 : 400,
          }}
        >
          Desktop
        </button>
        <svg width="100%" height={30} viewBox="0 0 100 30" preserveAspectRatio="none">
          <polyline
            points="0,24 15,20 30,22 45,10 60,14 75,8 90,12 100,6"
            fill="none"
            stroke={T.accentBright}
            strokeWidth={device === "desktop" ? 2.5 : 1}
            opacity={device === "desktop" ? 1 : 0.4}
          />
        </svg>
        <button
          type="button"
          onClick={() => setDevice("mobile")}
          style={{
            background: "transparent",
            border: 0,
            padding: 0,
            textAlign: "left",
            cursor: "pointer",
            color: device === "mobile" ? T.violet : T.textMuted,
            fontSize: 10.5,
            textTransform: "uppercase",
            letterSpacing: "0.05em",
            fontWeight: device === "mobile" ? 700 : 400,
          }}
        >
          Mobile
        </button>
        <svg width="100%" height={30} viewBox="0 0 100 30" preserveAspectRatio="none">
          <polyline
            points="0,10 15,14 30,12 45,20 60,16 75,22 90,18 100,20"
            fill="none"
            stroke={T.violet}
            strokeWidth={device === "mobile" ? 2.5 : 1}
            opacity={device === "mobile" ? 1 : 0.4}
          />
        </svg>
      </div>
    </Canvas>
  );
}

function AgentReadinessRingMock() {
  const pct = 82;
  const radius = 26;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - pct / 100);
  return (
    <Canvas>
      <svg width={70} height={70} viewBox="0 0 70 70">
        <circle cx={35} cy={35} r={radius} fill="none" stroke={T.border2} strokeWidth={6} />
        <circle
          cx={35}
          cy={35}
          r={radius}
          fill="none"
          stroke={T.green}
          strokeWidth={6}
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
          transform="rotate(-90 35 35)"
        />
        <text x={35} y={39} textAnchor="middle" fontSize={15} fontWeight={700} fill={T.text}>
          {pct}%
        </text>
      </svg>
    </Canvas>
  );
}

function WebflowConnectionMock() {
  return (
    <Canvas>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span
          style={{
            padding: "3px 9px",
            borderRadius: 999,
            fontSize: 11,
            fontWeight: 600,
            color: T.green,
            background: T.green + "1f",
            border: "1px solid " + T.green + "44",
          }}
        >
          Connected
        </span>
        <span style={{ color: T.textMuted, fontSize: 11.5 }}>Brand Studio · synced 12m ago</span>
      </div>
    </Canvas>
  );
}

function VisitorExperienceMock() {
  return (
    <Canvas>
      <div style={{ display: "flex", gap: 16 }}>
        <div style={{ textAlign: "center" }}>
          <div style={{ color: T.textMuted, fontSize: 10, textTransform: "uppercase" }}>Lab</div>
          <div style={{ color: T.text, fontSize: 18, fontWeight: 700 }}>2.1s</div>
        </div>
        <div style={{ textAlign: "center" }}>
          <div style={{ color: T.textMuted, fontSize: 10, textTransform: "uppercase" }}>Field p75</div>
          <div style={{ color: T.amber, fontSize: 18, fontWeight: 700 }}>2.6s</div>
        </div>
      </div>
    </Canvas>
  );
}

function IconSetMock() {
  const glyphs = ["▤", "◔", "▣", "☰", "⏱", "⤢"];
  return (
    <Canvas>
      <div style={{ display: "flex", gap: 10 }}>
        {glyphs.map((glyph, index) => (
          <span
            key={index}
            style={{
              width: 26,
              height: 26,
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              borderRadius: 6,
              background: T.panel2,
              color: T.textDim,
              fontSize: 13,
            }}
          >
            {glyph}
          </span>
        ))}
      </div>
    </Canvas>
  );
}

function StoreMock() {
  return (
    <Canvas>
      <div style={{ display: "flex", flexDirection: "column", gap: 6, alignItems: "center" }}>
        <div style={{ display: "flex", gap: 6 }}>
          <span style={{ width: 8, height: 8, borderRadius: "50%", background: T.accentBright, display: "inline-block" }} />
          <span style={{ color: T.textDim, fontSize: 11.5 }}>optimistic update → server reconcile</span>
        </div>
        <div style={{ color: T.textFaint, fontSize: 10.5 }}>shared across every route via StoreProvider</div>
      </div>
    </Canvas>
  );
}

const MOCKS: Record<string, () => ReactNode> = {
  "segmented-control": SegmentedControlMock,
  "select-menu": SelectMenuMock,
  "classification-chips": ClassificationChipsMock,
  "field-evidence-chip": FieldEvidenceChipMock,
  "status-shape": StatusShapeMock,
  "sort-header": SortHeaderMock,
  "modal-shell": ModalShellMock,
  toast: ToastMock,
  "empty-state": EmptyStateMock,
  sidebar: SidebarMock,
  sparkline: SparklineMock,
  "history-chart": HistoryChartMock,
  "agent-readiness-ring": AgentReadinessRingMock,
  "webflow-connection": WebflowConnectionMock,
  "visitor-experience": VisitorExperienceMock,
  "icon-set": IconSetMock,
  store: StoreMock,
};

export function MockPreview({ mockId }: { mockId: string }) {
  const Mock = MOCKS[mockId];
  if (!Mock) {
    return (
      <Canvas>
        <span style={{ color: T.textFaint, fontSize: 12 }}>No preview available for &quot;{mockId}&quot;.</span>
      </Canvas>
    );
  }
  return <>{Mock()}</>;
}

/**
 * Color token swatch. Clicking the hex value copies the value; clicking the
 * label copies the token name. A brief "Copied" flash confirms the action.
 */
export function SwatchPreview({ colors }: { colors: { hex: string; label: string }[] }) {
  return (
    <Canvas>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", justifyContent: "center" }}>
        {colors.map((color) => (
          <SwatchChip key={color.hex + color.label} hex={color.hex} label={color.label} />
        ))}
      </div>
    </Canvas>
  );
}

function SwatchChip({ hex, label }: { hex: string; label: string }) {
  const [valueCopied, copyValue] = useCopiedFlash();
  const [labelCopied, copyLabel] = useCopiedFlash();
  return (
    <div style={{ textAlign: "center" }}>
      <button
        type="button"
        onClick={() => copyValue(hex)}
        title={"Click to copy " + hex}
        style={{
          width: 56,
          height: 56,
          borderRadius: 10,
          background: hex,
          border: "1px solid " + T.border2,
          cursor: "pointer",
          padding: 0,
          display: "block",
        }}
      />
      <div style={{ marginTop: 6, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <button
          type="button"
          onClick={() => copyValue(hex)}
          title={"Click to copy " + hex}
          style={{
            background: "transparent",
            border: 0,
            padding: 0,
            cursor: "pointer",
            color: T.textDim,
            fontSize: 10.5,
            fontFamily: "ui-monospace, monospace",
          }}
        >
          {hex}
        </button>
        <CopiedFlash copied={valueCopied} />
      </div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
        <button
          type="button"
          onClick={() => copyLabel(label)}
          title={"Click to copy " + label}
          style={{
            background: "transparent",
            border: 0,
            padding: 0,
            cursor: "pointer",
            color: T.textFaint,
            fontSize: 10,
          }}
        >
          {label}
        </button>
        <CopiedFlash copied={labelCopied} />
      </div>
    </div>
  );
}

/**
 * Non-color scale token (radius, spacing) shown as a size indicator instead
 * of a color fill. Same click-to-copy contract as SwatchPreview: value
 * copies the size, label copies the token's name.
 */
export function ScalePreview({ steps }: { steps: { value: string; label: string }[] }) {
  return (
    <Canvas>
      <div style={{ display: "flex", gap: 14, flexWrap: "wrap", justifyContent: "center", alignItems: "flex-end" }}>
        {steps.map((step) => (
          <ScaleChip key={step.value + step.label} value={step.value} label={step.label} />
        ))}
      </div>
    </Canvas>
  );
}

function ScaleChip({ value, label }: { value: string; label: string }) {
  const [valueCopied, copyValue] = useCopiedFlash();
  const [labelCopied, copyLabel] = useCopiedFlash();
  const size = Math.min(56, Math.max(20, parseFloat(value) * 1.6 || 32));
  const isRadius = label.toLowerCase().includes("radius");
  return (
    <div style={{ textAlign: "center" }}>
      <button
        type="button"
        onClick={() => copyValue(value)}
        title={"Click to copy " + value}
        style={{
          width: isRadius ? size : 44,
          height: isRadius ? size : Math.min(28, size * 0.5),
          borderRadius: isRadius ? value : 4,
          background: T.panel2,
          border: "1px solid " + T.accentBright,
          cursor: "pointer",
          padding: 0,
          display: "block",
          margin: "0 auto",
        }}
      />
      <div style={{ marginTop: 6, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <button
          type="button"
          onClick={() => copyValue(value)}
          title={"Click to copy " + value}
          style={{
            background: "transparent",
            border: 0,
            padding: 0,
            cursor: "pointer",
            color: T.textDim,
            fontSize: 10.5,
            fontFamily: "ui-monospace, monospace",
          }}
        >
          {value}
        </button>
        <CopiedFlash copied={valueCopied} />
      </div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
        <button
          type="button"
          onClick={() => copyLabel(label)}
          title={"Click to copy " + label}
          style={{
            background: "transparent",
            border: 0,
            padding: 0,
            cursor: "pointer",
            color: T.textFaint,
            fontSize: 10,
          }}
        >
          {label}
        </button>
        <CopiedFlash copied={labelCopied} />
      </div>
    </div>
  );
}

/**
 * Font-family token preview. Clicking the sample copies the token value
 * (the font name); clicking the caption below copies the token name.
 */
export function TypePreview({ sample, tokenName, tokenValue }: { sample: string; tokenName?: string; tokenValue?: string }) {
  const [valueCopied, copyValue] = useCopiedFlash();
  const [labelCopied, copyLabel] = useCopiedFlash();
  return (
    <Canvas>
      <div style={{ textAlign: "center" }}>
        <button
          type="button"
          onClick={() => copyValue(tokenValue ?? sample)}
          title={"Click to copy " + (tokenValue ?? sample)}
          style={{
            background: "transparent",
            border: 0,
            padding: 0,
            cursor: "pointer",
            color: T.text,
            fontSize: 26,
            fontWeight: 600,
            letterSpacing: "-0.01em",
            fontFamily: "-apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Helvetica, Arial, sans-serif",
          }}
        >
          {sample}
        </button>
        <CopiedFlash copied={valueCopied} />
        {tokenName ? (
          <div style={{ marginTop: 6 }}>
            <button
              type="button"
              onClick={() => copyLabel(tokenName)}
              title={"Click to copy " + tokenName}
              style={{
                background: "transparent",
                border: 0,
                padding: 0,
                cursor: "pointer",
                color: T.textFaint,
                fontSize: 10,
                fontFamily: "ui-monospace, monospace",
              }}
            >
              {tokenName}
            </button>
            <CopiedFlash copied={labelCopied} />
          </div>
        ) : null}
      </div>
    </Canvas>
  );
}
