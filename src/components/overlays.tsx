"use client";

import { useEffect, useRef, useState } from "react";
import { useStore } from "./store";
import { C } from "@/lib/ui";
import { scoreMeta } from "@/lib/scoring";
import { CheckIcon, CloseIcon } from "./icons";
import { defaultNewPageFlag, MAX_ACTIVE_PAGES, watchCapacity } from "@/lib/watchCapacity";

function Toast() {
  const { toast } = useStore();
  if (!toast) return null;
  return (
    <div
      role="status"
      aria-live="polite"
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

function ModalShell({ width = 460, onClose, label, children }: { width?: number; onClose: () => void; label: string; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  // Keep the latest onClose in a ref so the focus-management effect can run
  // once on open without re-running (and stealing focus back to the first
  // control) each time the parent hands us a new onClose identity.
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);
  // Focus management (audit: modals lacked it) — trap Tab within the dialog,
  // close on Escape, focus the first control on open, and restore focus to the
  // trigger on close.
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const node = ref.current;
    const focusables = () =>
      node
        ? [...node.querySelectorAll<HTMLElement>('a[href],button,input,select,textarea,[tabindex]:not([tabindex="-1"])')].filter((el) => !el.hasAttribute("disabled"))
        : [];
    (focusables()[0] ?? node)?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onCloseRef.current();
        return;
      }
      if (e.key === "Tab") {
        const f = focusables();
        if (f.length === 0) return;
        const first = f[0];
        const last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      prev?.focus?.();
    };
    // Run once per mount; onClose is read via onCloseRef to avoid re-running.
  }, []);

  return (
    <div
      onClick={onClose}
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 70, padding: 24 }}
    >
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        style={{ background: "#141416", border: `1px solid ${C.border2}`, borderRadius: 15, width, maxWidth: "100%", maxHeight: "82vh", overflow: "auto", boxShadow: "0 24px 70px rgba(0,0,0,0.6)", outline: "none" }}
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

function AddModal() {
  const { pages, form, setForm, submitAdd, closeModal, pathFor } = useStore();
  const capacity = watchCapacity(pages);
  const willPause = defaultNewPageFlag(pages) === "paused";
  const titleTouched = useRef(false);
  const lookupSequence = useRef(0);
  const [titleLookup, setTitleLookup] = useState<"idle" | "loading" | "found" | "unavailable">("idle");

  useEffect(() => {
    const sequence = ++lookupSequence.current;
    const value = form.url.trim();
    if (!value || titleTouched.current) {
      setTitleLookup("idle");
      return;
    }

    // Wait until typing has paused; each URL change aborts the previous lookup
    // and prevents a slower, stale response from replacing a newer title.
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      if (titleTouched.current || sequence !== lookupSequence.current) return;
      setTitleLookup("loading");
      try {
        const response = await fetch(pathFor("/api/page-title"), {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ url: value }),
          signal: controller.signal,
        });
        const result = (await response.json().catch(() => null)) as { title?: string } | null;
        if (!response.ok || !result?.title?.trim()) throw new Error("Title unavailable");
        if (sequence !== lookupSequence.current || titleTouched.current) return;
        setForm({ title: result.title.trim() });
        setTitleLookup("found");
      } catch {
        if (controller.signal.aborted || sequence !== lookupSequence.current) return;
        setTitleLookup("unavailable");
      }
    }, 600);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [form.url, pathFor, setForm]);

  const lookupMessage =
    titleLookup === "loading"
      ? "Looking up the page title…"
      : titleLookup === "found"
        ? "Page title found."
        : titleLookup === "unavailable"
          ? "We couldn’t find a page title. Enter one below."
          : null;

  return (
    <ModalShell onClose={closeModal} label="Add a page to the watchlist">
      <div style={{ padding: "22px 24px 0" }}>
        <h3 style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>Add a page to the watchlist</h3>
        <p style={{ margin: "7px 0 0", fontSize: 13, color: C.muted }}>Enter a URL and we’ll fill in its page title when available.</p>
      </div>
      <div style={{ padding: "20px 24px" }}>
        <label htmlFor="add-page-url" style={labelStyle}>URL</label>
        <input
          id="add-page-url"
          type="url"
          value={form.url}
          onChange={(event) => {
            const url = event.target.value;
            if (!url.trim()) {
              titleTouched.current = false;
              setTitleLookup("idle");
              setForm({ url, title: "" });
              return;
            }
            setForm({ url });
          }}
          placeholder="https://webflow.com/localization"
          autoComplete="url"
          style={{ ...inputStyle, marginBottom: lookupMessage ? 6 : 16 }}
        />
        {lookupMessage && (
          <div aria-live="polite" style={{ minHeight: 16, marginBottom: 10, fontSize: 11.5, color: titleLookup === "unavailable" ? C.amber : C.faint }}>
            {lookupMessage}
          </div>
        )}
        <label htmlFor="add-page-title" style={labelStyle}>Page title</label>
        <input
          id="add-page-title"
          value={form.title}
          onChange={(event) => {
            titleTouched.current = true;
            setTitleLookup("idle");
            setForm({ title: event.target.value });
          }}
          placeholder="e.g. Localization"
          autoComplete="off"
          style={{ ...inputStyle, marginBottom: 16 }}
        />
        {willPause && (
          <div
            role="alert"
            style={{
              border: "1px solid rgba(255,154,61,0.28)",
              background: "rgba(255,154,61,0.08)",
              borderRadius: 8,
              padding: "10px 12px",
              color: C.amber,
              fontSize: 11.5,
              lineHeight: 1.45,
            }}
          >
            {capacity.active} of {MAX_ACTIVE_PAGES} active slots are in use. This page will be added as Paused and won’t join nightly runs until another page is paused.
          </div>
        )}
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
    <ModalShell onClose={closeModal} label="Log a change marker">
      <div style={{ padding: "22px 24px 0" }}>
        <h3 style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>Log a change marker</h3>
        <p style={{ margin: "7px 0 0", fontSize: 13, color: C.muted }}>Marks the timeline and schedules 2, 7 &amp; 30-day follow-up reports to Slack.</p>
      </div>
      <div style={{ padding: "20px 24px" }}>
        <label htmlFor="marker-description" style={labelStyle}>Description</label>
        <input id="marker-description" value={markerText} onChange={(e) => setMarkerText(e.target.value)} placeholder="e.g. Deployed new hero video" style={{ ...inputStyle, marginBottom: 16 }} />
        <label htmlFor="marker-date" style={labelStyle}>Date</label>
        <input id="marker-date" type="date" value={markerDate} onChange={(e) => setMarkerDate(e.target.value)} style={inputStyle} />
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
    <ModalShell width={600} onClose={closeModal} label={`Full report · ${report.date}`}>
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
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(110px, 1fr))", gap: 12, marginBottom: 22 }}>
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
