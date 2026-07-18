"use client";

import { useStore } from "./store";
import { C } from "@/lib/ui";
import { scoreMeta } from "@/lib/scoring";
import { CheckIcon, CloseIcon } from "./icons";

function Toast() {
  const { toast } = useStore();
  if (!toast) return null;
  return (
    <div
      style={{
        position: "fixed",
        bottom: 26,
        left: "50%",
        transform: "translateX(-50%)",
        background: C.border,
        border: "1px solid #313136",
        color: C.text,
        fontSize: 13,
        padding: "12px 20px",
        borderRadius: 9,
        boxShadow: "0 12px 40px rgba(0,0,0,0.5)",
        zIndex: 60,
        display: "flex",
        alignItems: "center",
        gap: 10,
      }}
    >
      <CheckIcon size={16} style={{ color: C.green }} />
      {toast}
    </div>
  );
}

function ModalShell({ width = 460, onClose, children }: { width?: number; onClose: () => void; children: React.ReactNode }) {
  return (
    <div
      onClick={onClose}
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 70, padding: 24 }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ background: "#141416", border: `1px solid ${C.border2}`, borderRadius: 15, width, maxWidth: "100%", maxHeight: "82vh", overflow: "auto", boxShadow: "0 24px 70px rgba(0,0,0,0.6)" }}
      >
        {children}
      </div>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  fontSize: 13.5,
  padding: "10px 12px",
  background: C.bgElev,
  color: C.text,
  border: `1px solid ${C.border2}`,
  borderRadius: 7,
};
const labelStyle: React.CSSProperties = { display: "block", fontSize: 12, fontWeight: 550, color: C.muted, marginBottom: 6 };
const cancelBtn: React.CSSProperties = { border: `1px solid ${C.border2}`, background: "rgba(255,255,255,0.03)", color: C.text, fontSize: 13, fontWeight: 500, padding: "9px 16px", borderRadius: 7, cursor: "pointer" };
const primaryBtn: React.CSSProperties = { border: "none", background: C.accent, color: "#fff", fontSize: 13, fontWeight: 550, padding: "9px 18px", borderRadius: 7, cursor: "pointer" };

function segBtn(active: boolean): React.CSSProperties {
  return {
    border: "none",
    fontSize: 12.5,
    fontWeight: 550,
    padding: "7px 14px",
    borderRadius: 6,
    cursor: "pointer",
    color: active ? "#FFFFFF" : C.faint2,
    background: active ? "rgba(255,255,255,0.09)" : "transparent",
  };
}

function AddModal() {
  const { form, setForm, submitAdd, closeModal } = useStore();
  return (
    <ModalShell onClose={closeModal}>
      <div style={{ padding: "22px 24px 0" }}>
        <h3 style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>Add a page to the watchlist</h3>
        <p style={{ margin: "7px 0 0", fontSize: 13, color: C.muted }}>It joins the next nightly run. Capture a baseline once it has data.</p>
      </div>
      <div style={{ padding: "20px 24px" }}>
        <label style={labelStyle}>Page title</label>
        <input value={form.title} onChange={(e) => setForm({ title: e.target.value })} placeholder="e.g. Localization" style={{ ...inputStyle, marginBottom: 16 }} />
        <label style={labelStyle}>URL</label>
        <input value={form.url} onChange={(e) => setForm({ url: e.target.value })} placeholder="webflow.com/localization" style={{ ...inputStyle, marginBottom: 16 }} />
        <label style={{ ...labelStyle, marginBottom: 8 }}>Flag</label>
        <div style={{ display: "inline-flex", padding: 3, background: "rgba(255,255,255,0.05)", border: `1px solid ${C.border2}`, borderRadius: 8 }}>
          <button onClick={() => setForm({ flag: "priority" })} style={segBtn(form.flag === "priority")}>Priority</button>
          <button onClick={() => setForm({ flag: "watching" })} style={segBtn(form.flag === "watching")}>Watching</button>
        </div>
      </div>
      <div style={{ padding: "0 24px 22px", display: "flex", justifyContent: "flex-end", gap: 10 }}>
        <button onClick={closeModal} style={cancelBtn}>Cancel</button>
        <button onClick={submitAdd} style={primaryBtn}>Add page</button>
      </div>
    </ModalShell>
  );
}

function MarkerModal() {
  const { markerText, markerDate, setMarkerText, setMarkerDate, submitMarker, closeModal } = useStore();
  return (
    <ModalShell onClose={closeModal}>
      <div style={{ padding: "22px 24px 0" }}>
        <h3 style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>Log a change marker</h3>
        <p style={{ margin: "7px 0 0", fontSize: 13, color: C.muted }}>Marks the timeline and schedules 2, 7 &amp; 30-day follow-up reports to Slack.</p>
      </div>
      <div style={{ padding: "20px 24px" }}>
        <label style={labelStyle}>Description</label>
        <input value={markerText} onChange={(e) => setMarkerText(e.target.value)} placeholder="e.g. Deployed new hero video" style={{ ...inputStyle, marginBottom: 16 }} />
        <label style={labelStyle}>Date</label>
        <input value={markerDate} onChange={(e) => setMarkerDate(e.target.value)} placeholder="Jul 16" style={inputStyle} />
      </div>
      <div style={{ padding: "0 24px 22px", display: "flex", justifyContent: "flex-end", gap: 10 }}>
        <button onClick={closeModal} style={cancelBtn}>Cancel</button>
        <button onClick={submitMarker} style={primaryBtn}>Log marker</button>
      </div>
    </ModalShell>
  );
}

function ReportModal() {
  const { report, closeModal } = useStore();
  if (!report) return null;
  return (
    <ModalShell width={600} onClose={closeModal}>
      <div
        style={{ padding: "22px 24px", borderBottom: `1px solid ${C.border}`, display: "flex", alignItems: "center", justifyContent: "space-between", position: "sticky", top: 0, background: "#141416" }}
      >
        <div>
          <h3 style={{ margin: 0, fontSize: 17, fontWeight: 600 }}>Full report · {report.date}</h3>
          <div style={{ fontSize: 12.5, color: C.muted, marginTop: 3 }}>{report.url}</div>
        </div>
        <button onClick={closeModal} style={{ border: `1px solid ${C.border2}`, background: "rgba(255,255,255,0.03)", padding: "7px 9px", borderRadius: 7, cursor: "pointer", display: "flex" }}>
          <CloseIcon size={15} style={{ color: C.text }} />
        </button>
      </div>
      <div style={{ padding: "22px 24px" }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 12, marginBottom: 22 }}>
          {report.cats.map((rc) => (
            <div key={rc.key} style={{ border: `1px solid ${C.border2}`, background: C.bgElev, borderRadius: 10, padding: 13 }}>
              <div style={{ fontSize: 11, color: C.muted }}>{rc.label}</div>
              <div style={{ fontSize: 22, fontWeight: 600, color: scoreMeta(rc.median).fg, marginTop: 3 }}>{rc.median}</div>
              <div style={{ fontSize: 11, color: C.faint }}>range {rc.range}</div>
            </div>
          ))}
        </div>
        <div style={{ fontSize: 11, fontWeight: 550, letterSpacing: "0.05em", textTransform: "uppercase", color: C.faint, marginBottom: 8 }}>Raw PSI payload (object storage)</div>
        <pre
          style={{ margin: 0, fontFamily: "ui-monospace, SFMono-Regular, monospace", fontSize: 11.5, lineHeight: 1.6, background: "#08080A", color: C.faint2, border: `1px solid ${C.border}`, padding: 16, borderRadius: 9, overflow: "auto" }}
        >
          {report.raw}
        </pre>
      </div>
    </ModalShell>
  );
}

export function ChromeOverlays() {
  const { modal } = useStore();
  return (
    <>
      <Toast />
      {modal === "add" && <AddModal />}
      {modal === "marker" && <MarkerModal />}
      {modal === "report" && <ReportModal />}
    </>
  );
}
