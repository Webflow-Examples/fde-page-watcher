"use client";

import { useRouter } from "next/navigation";
import { useStore } from "@/components/store";
import { C } from "@/lib/ui";
import { SegToggle } from "@/components/bits";
import { PlusIcon, TrashIcon } from "@/components/icons";

const GRID = "minmax(260px,2.4fr) 160px 1fr 120px";

export default function WatchlistPage() {
  const router = useRouter();
  const { pages, setFlag, removePage, openAdd, pathFor } = useStore();

  return (
    <div>
      <header style={{ padding: "30px 40px 24px", display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 24 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 27, fontWeight: 600, letterSpacing: "-0.01em" }}>Watchlist</h1>
          <p style={{ margin: "8px 0 0", fontSize: 13.5, color: C.muted }}>Only watchlisted pages are monitored. Priority pages lead the nightly queue.</p>
        </div>
        <button
          onClick={openAdd}
          style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 16px", border: "none", borderRadius: 8, background: C.accent, color: "#fff", fontSize: 13, fontWeight: 550, cursor: "pointer" }}
        >
          <PlusIcon size={15} style={{ color: "#fff" }} />
          Add page
        </button>
      </header>

      <div style={{ padding: "0 40px 48px" }}>
        <div style={{ background: C.panel, border: `1px solid ${C.border}`, borderRadius: 14, overflow: "hidden" }}>
          <div style={{ display: "grid", gridTemplateColumns: GRID, alignItems: "center", padding: "14px 24px", borderBottom: `1px solid ${C.border}`, fontSize: 11, fontWeight: 550, letterSpacing: "0.05em", textTransform: "uppercase", color: C.faint }}>
            <div>Page</div>
            <div>Flag</div>
            <div>Baseline</div>
            <div style={{ textAlign: "right" }}>Actions</div>
          </div>
          {pages.map((p) => (
            <div key={p.id} style={{ display: "grid", gridTemplateColumns: GRID, alignItems: "center", padding: "15px 24px", borderBottom: `1px solid ${C.rowBorder}` }}>
              <div style={{ minWidth: 0, paddingRight: 16 }}>
                <div style={{ fontSize: 14, fontWeight: 600 }}>{p.title}</div>
                <div style={{ fontSize: 12, color: C.faint, marginTop: 3 }}>{p.url}</div>
              </div>
              <div>
                <SegToggle
                  label={`Flag for ${p.title}`}
                  value={p.flag}
                  onChange={(f) => setFlag(p.id, f)}
                  options={[
                    { value: "priority", label: "Priority" },
                    { value: "watching", label: "Watching" },
                  ]}
                />
              </div>
              <div style={{ fontSize: 12.5, color: p.runState === "failed" ? C.redSoft : C.muted }}>
                {p.runState === "queued"
                  ? "Collection queued"
                  : p.runState === "dispatching"
                    ? "Collector starting"
                    : p.runState === "running"
                      ? "Collection running"
                      : p.runState === "failed"
                        ? `Failed: ${p.lastError ?? "retry from page"}`
                        : p.baselineCapturedAt
                          ? `Captured ${p.baselineCapturedAt}`
                          : "No baseline yet"}
              </div>
              <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
                <button
                  onClick={() => router.push(pathFor(`/pages/${p.id}`))}
                  style={{ border: `1px solid ${C.border2}`, background: "rgba(255,255,255,0.03)", color: C.text, fontSize: 12, fontWeight: 500, padding: "6px 12px", borderRadius: 7, cursor: "pointer" }}
                >
                  View
                </button>
                <button
                  onClick={() => removePage(p.id)}
                  title="Remove from watchlist"
                  style={{ border: `1px solid ${C.border2}`, background: "rgba(255,255,255,0.03)", padding: "6px 9px", borderRadius: 7, cursor: "pointer", display: "flex", alignItems: "center" }}
                >
                  <TrashIcon size={15} style={{ color: C.red }} />
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
