"use client";

import { useRouter } from "next/navigation";
import { useStore } from "@/components/store";
import type { Rec } from "@/lib/types";
import { C, costValue, savingsValue } from "@/lib/ui";
import { SegToggle, SortHeader } from "@/components/bits";
import { CheckIcon, ExternalIcon } from "@/components/icons";

const GRID = "44px minmax(220px,1fr) 92px 92px 240px";

interface Group {
  label: string | null;
  sub: string | null;
  items: Rec[];
}

export default function InboxPage() {
  const router = useRouter();
  const { recs, inboxGroup, setInboxGroup, inboxSort, sortInbox, saveTask, ignoreRec, pathFor } = useStore();

  let items = recs.filter((r) => r.status === "inbox");
  if (inboxSort.col) {
    const dir = inboxSort.dir === "asc" ? 1 : -1;
    const key = (r: Rec) => (inboxSort.col === "rec" ? r.title.toLowerCase() : inboxSort.col === "savings" ? savingsValue(r) : costValue(r));
    items = [...items].sort((a, b) => {
      const av = key(a);
      const bv = key(b);
      if (av < bv) return -1 * dir;
      if (av > bv) return 1 * dir;
      return 0;
    });
  }

  let groups: Group[];
  if (inboxGroup === "page") {
    const m = new Map<string, Group>();
    items.forEach((it) => {
      if (!m.has(it.pageTitle)) m.set(it.pageTitle, { label: it.pageTitle, sub: it.url, items: [] });
      m.get(it.pageTitle)!.items.push(it);
    });
    groups = [...m.values()];
  } else if (inboxGroup === "rec") {
    const m = new Map<string, Group>();
    items.forEach((it) => {
      if (!m.has(it.title)) m.set(it.title, { label: it.title, sub: it.category, items: [] });
      m.get(it.title)!.items.push(it);
    });
    groups = [...m.values()];
  } else {
    groups = [{ label: null, sub: null, items }];
  }

  return (
    <div>
      <header className="page-header" style={{ padding: "30px 40px 24px", display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 24 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 27, fontWeight: 600, letterSpacing: "-0.01em" }}>Inbox</h1>
          <p style={{ margin: "8px 0 0", fontSize: 13.5, color: C.muted }}>New recommendations from the latest nightly runs. Save the ones you&apos;ll act on as tasks, or ignore the rest.</p>
        </div>
        <div className="page-controls" style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 12, color: C.faint }}>Group by</span>
          <SegToggle
            label="Group inbox by"
            value={inboxGroup}
            onChange={setInboxGroup}
            options={[
              { value: "none", label: "None" },
              { value: "page", label: "Page" },
              { value: "rec", label: "Recommendation" },
            ]}
          />
        </div>
      </header>

      <div className="page-content table-scroll" style={{ padding: "0 40px 48px" }}>
        {items.length === 0 ? (
          <div style={{ padding: "70px 24px", textAlign: "center", background: C.panel, border: `1px solid ${C.border}`, borderRadius: 14 }}>
            <div style={{ width: 52, height: 52, margin: "0 auto 16px", borderRadius: "50%", background: "rgba(53,208,127,0.14)", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <CheckIcon size={26} style={{ color: C.green }} />
            </div>
            <div style={{ fontSize: 16, fontWeight: 600 }}>Inbox zero</div>
            <div style={{ fontSize: 13, color: C.muted, marginTop: 6 }}>Every recommendation has been triaged. New ones arrive after tonight&apos;s run.</div>
          </div>
        ) : (
          <div className="narrow-table" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div style={{ display: "grid", gridTemplateColumns: GRID, gap: 16, alignItems: "center", padding: "4px 22px 0", fontSize: 11, fontWeight: 550, letterSpacing: "0.04em", textTransform: "uppercase" }}>
              <div />
              <SortHeader label="Recommendation" align="left" active={inboxSort.col === "rec"} dir={inboxSort.dir} onSort={() => sortInbox("rec")} />
              <SortHeader label="Savings" align="right" active={inboxSort.col === "savings"} dir={inboxSort.dir} onSort={() => sortInbox("savings")} />
              <SortHeader label="Cost" align="right" active={inboxSort.col === "cost"} dir={inboxSort.dir} onSort={() => sortInbox("cost")} />
              <div style={{ color: C.faint, textAlign: "right" }}>Actions</div>
            </div>
            {groups.map((g, gi) => (
              <div key={gi} style={{ background: C.panel, border: `1px solid ${C.border}`, borderRadius: 14, overflow: "hidden" }}>
                {g.label && (
                  <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "13px 22px", borderBottom: `1px solid ${C.border}`, background: C.panel2 }}>
                    <span style={{ fontSize: 13, fontWeight: 600 }}>{g.label}</span>
                    <span style={{ fontSize: 11.5, color: C.faint }}>{g.sub}</span>
                    <span style={{ marginLeft: "auto", fontSize: 11, fontWeight: 600, color: C.accentSoft, background: "rgba(59,137,255,0.14)", padding: "1px 8px", borderRadius: 20 }}>{g.items.length}</span>
                  </div>
                )}
                {g.items.map((it) => (
                  <div key={it.key} style={{ display: "grid", gridTemplateColumns: GRID, gap: 16, alignItems: "center", padding: "16px 22px", borderBottom: `1px solid ${C.rowBorder}` }}>
                    <span style={{ justifySelf: "start", fontSize: 10, fontWeight: 600, letterSpacing: "0.04em", textTransform: "uppercase", color: C.accentSoft, background: "rgba(59,137,255,0.14)", padding: "3px 8px", borderRadius: 5 }}>New</span>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 14, fontWeight: 600 }}>{it.title}</div>
                      {it.aiSummary && <div style={{ fontSize: 12, color: C.muted, marginTop: 4, lineHeight: 1.45 }}>{it.aiSummary}</div>}
                      <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 6 }}>
                        <span style={{ fontSize: 11, fontWeight: 550, color: C.dim, background: "rgba(255,255,255,0.06)", border: `1px solid #2E2E34`, padding: "2px 8px", borderRadius: 5 }}>{it.pageTitle}</span>
                        <span style={{ fontSize: 11.5, color: C.faint }}>{it.url}</span>
                        <span style={{ fontSize: 11, color: C.faint2, background: "rgba(255,255,255,0.04)", padding: "2px 8px", borderRadius: 5 }}>{it.category}</span>
                      </div>
                    </div>
                    <div style={{ textAlign: "right", fontSize: 14, fontWeight: 600, color: C.amber }}>{it.savings}</div>
                    <div style={{ textAlign: "right", fontSize: 14, fontWeight: 600, color: C.dim }}>{it.estTime}</div>
                    <div style={{ justifySelf: "end", display: "flex", gap: 8 }}>
                      <button onClick={() => saveTask(it.key)} style={{ border: "none", background: C.accent, color: "#fff", fontSize: 12, fontWeight: 550, padding: "7px 13px", borderRadius: 7, cursor: "pointer", whiteSpace: "nowrap" }}>Save as task</button>
                      <button onClick={() => ignoreRec(it.key)} style={{ border: `1px solid ${C.border2}`, background: "rgba(255,255,255,0.03)", color: C.dim, fontSize: 12, fontWeight: 500, padding: "7px 13px", borderRadius: 7, cursor: "pointer", whiteSpace: "nowrap" }}>Ignore</button>
                      <button onClick={() => router.push(pathFor(`/pages/${it.pageId}`))} title="Open page" style={{ border: `1px solid ${C.border2}`, background: "rgba(255,255,255,0.03)", padding: "7px 9px", borderRadius: 7, cursor: "pointer", display: "flex", alignItems: "center" }}>
                        <ExternalIcon size={15} style={{ color: C.dim }} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
