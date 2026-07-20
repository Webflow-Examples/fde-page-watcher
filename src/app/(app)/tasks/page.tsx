"use client";

import { useRef } from "react";
import { useRouter } from "next/navigation";
import { useStore } from "@/components/store";
import type { Rec, TaskStatus } from "@/lib/types";
import { C, costValue, savingsValue, taskAccent, taskLabel } from "@/lib/ui";
import { SegToggle, SortHeader } from "@/components/bits";
import { CheckIcon } from "@/components/icons";

const LIST_GRID = "24px minmax(220px,1fr) 92px 92px 240px";

function ActionButtons({ t, advance }: { t: Rec; advance: (key: string, to: TaskStatus) => void }) {
  if (t.taskStatus === "todo") {
    return (
      <button onClick={() => advance(t.key, "in-progress")} style={{ border: `1px solid ${C.border2}`, background: "rgba(255,255,255,0.04)", color: C.text, fontSize: 11.5, fontWeight: 550, padding: "6px 12px", borderRadius: 7, cursor: "pointer" }}>
        Start
      </button>
    );
  }
  if (t.taskStatus === "in-progress") {
    return (
      <>
        <button onClick={() => advance(t.key, "done")} style={{ border: "none", background: C.accent, color: "#fff", fontSize: 11.5, fontWeight: 550, padding: "6px 12px", borderRadius: 7, cursor: "pointer" }}>Mark done</button>
        <button onClick={() => advance(t.key, "todo")} style={{ border: `1px solid ${C.border2}`, background: "rgba(255,255,255,0.03)", color: C.faint2, fontSize: 11.5, fontWeight: 500, padding: "6px 10px", borderRadius: 7, cursor: "pointer" }}>Back</button>
      </>
    );
  }
  return (
    <>
      <span style={{ fontSize: 11.5, color: C.muted }}>Done {t.doneDate}</span>
      <button onClick={() => advance(t.key, "in-progress")} style={{ border: `1px solid ${C.border2}`, background: "rgba(255,255,255,0.03)", color: C.faint2, fontSize: 11.5, fontWeight: 500, padding: "6px 10px", borderRadius: 7, cursor: "pointer" }}>Reopen</button>
    </>
  );
}

export default function TasksPage() {
  const router = useRouter();
  const { recs, taskGroup, setTaskGroup, taskView, setTaskView, taskSort, sortTask, advanceTask } = useStore();
  const dragKey = useRef<string | null>(null);

  const tasks = recs.filter((r) => r.status === "task");

  let sorted = tasks;
  if (taskSort.col) {
    const dir = taskSort.dir === "asc" ? 1 : -1;
    const key = (r: Rec) => (taskSort.col === "rec" ? r.title.toLowerCase() : taskSort.col === "savings" ? savingsValue(r) : costValue(r));
    sorted = [...tasks].sort((a, b) => {
      const av = key(a);
      const bv = key(b);
      if (av < bv) return -1 * dir;
      if (av > bv) return 1 * dir;
      return 0;
    });
  }

  const openPage = (pageId: string) => router.push(`/pages/${pageId}`);
  const pageChip = (t: Rec) => (
    <button
      type="button"
      aria-label={`Open ${t.pageTitle} details`}
      onClick={(e) => {
        e.stopPropagation();
        openPage(t.pageId);
      }}
      style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11, fontWeight: 550, color: C.dim, background: "rgba(255,255,255,0.06)", border: `1px solid #2E2E34`, padding: "2px 8px", borderRadius: 5, cursor: "pointer" }}
    >
      {t.pageTitle} ↗
    </button>
  );

  // List groups
  let listGroups: { label: string | null; items: Rec[] }[];
  if (taskGroup === "page") {
    const m = new Map<string, Rec[]>();
    sorted.forEach((t) => m.set(t.pageTitle, [...(m.get(t.pageTitle) ?? []), t]));
    listGroups = [...m.entries()].map(([label, items]) => ({ label, items }));
  } else if (taskGroup === "rec") {
    const m = new Map<string, Rec[]>();
    sorted.forEach((t) => m.set(t.title, [...(m.get(t.title) ?? []), t]));
    listGroups = [...m.entries()].map(([label, items]) => ({ label, items }));
  } else {
    listGroups = [{ label: null, items: sorted }];
  }

  const columns: { label: string; accent: string; status: TaskStatus }[] = [
    { label: "To do", accent: C.muted, status: "todo" },
    { label: "In progress", accent: C.accentSoft, status: "in-progress" },
    { label: "Done", accent: C.green, status: "done" },
  ];

  return (
    <div>
      <header className="page-header" style={{ padding: "30px 40px 24px", display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 24 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 27, fontWeight: 600, letterSpacing: "-0.01em" }}>Tasks</h1>
          <p style={{ margin: "8px 0 0", fontSize: 13.5, color: C.muted }}>Recommendations you&apos;ve committed to. Completing a task logs a change marker on its page and schedules the follow-up reports.</p>
        </div>
        <div className="page-controls" style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <SegToggle label="Task view" value={taskView} onChange={setTaskView} options={[{ value: "kanban", label: "Columns" }, { value: "list", label: "List" }]} />
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 12, color: C.faint, whiteSpace: "nowrap" }}>Group by</span>
            <SegToggle label="Group tasks by" value={taskGroup} onChange={setTaskGroup} options={[{ value: "none", label: "None" }, { value: "page", label: "Page" }, { value: "rec", label: "Recommendation" }]} />
          </div>
        </div>
      </header>

      <div className="page-content table-scroll" style={{ padding: "0 40px 48px" }}>
        {taskView === "list" ? (
          <div className="narrow-table" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div style={{ display: "grid", gridTemplateColumns: LIST_GRID, gap: 16, alignItems: "center", padding: "4px 22px 0", fontSize: 11, fontWeight: 550, letterSpacing: "0.04em", textTransform: "uppercase" }}>
              <div />
              <SortHeader label="Recommendation" align="left" active={taskSort.col === "rec"} dir={taskSort.dir} onSort={() => sortTask("rec")} />
              <SortHeader label="Savings" align="right" active={taskSort.col === "savings"} dir={taskSort.dir} onSort={() => sortTask("savings")} />
              <SortHeader label="Cost" align="right" active={taskSort.col === "cost"} dir={taskSort.dir} onSort={() => sortTask("cost")} />
              <div style={{ color: C.faint, textAlign: "right" }}>Actions</div>
            </div>
            {listGroups.map((g, gi) => (
              <div key={gi} style={{ background: C.panel, border: `1px solid ${C.border}`, borderRadius: 14, overflow: "hidden" }}>
                {g.label && (
                  <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "13px 22px", borderBottom: `1px solid ${C.border}`, background: C.panel2 }}>
                    <span style={{ fontSize: 13, fontWeight: 600 }}>{g.label}</span>
                    <span style={{ marginLeft: "auto", fontSize: 11, fontWeight: 600, color: C.accentSoft, background: "rgba(59,137,255,0.14)", padding: "1px 8px", borderRadius: 20 }}>{g.items.length}</span>
                  </div>
                )}
                {g.items.map((t) => (
                  <div key={t.key} style={{ display: "grid", gridTemplateColumns: LIST_GRID, gap: 16, alignItems: "center", padding: "15px 22px", borderBottom: `1px solid ${C.rowBorder}` }}>
                    <span style={{ justifySelf: "center", width: 9, height: 9, borderRadius: "50%", background: taskAccent(t.taskStatus) }} />
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 14, fontWeight: 600 }}>{t.title}</div>
                      {t.aiSummary && <div style={{ fontSize: 12, color: C.muted, marginTop: 4, lineHeight: 1.45 }}>{t.aiSummary}</div>}
                      <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 6 }}>
                        {pageChip(t)}
                        <span style={{ fontSize: 11.5, fontWeight: 550, color: taskAccent(t.taskStatus) }}>{taskLabel(t.taskStatus)}</span>
                      </div>
                    </div>
                    <div style={{ textAlign: "right", fontSize: 13, fontWeight: 600, color: C.amber }}>{t.savings}</div>
                    <div style={{ textAlign: "right", fontSize: 13, fontWeight: 600, color: C.dim }}>{t.estTime}</div>
                    <div style={{ justifySelf: "end", display: "flex", alignItems: "center", gap: 8 }}>
                      <ActionButtons t={t} advance={advanceTask} />
                    </div>
                  </div>
                ))}
              </div>
            ))}
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
            {listGroups.map((grp, gi) => (
              <div key={gi}>
                {grp.label && (
                  <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
                    <span style={{ fontSize: 13, fontWeight: 600 }}>{grp.label}</span>
                    <span style={{ fontSize: 11, fontWeight: 600, color: C.accentSoft, background: "rgba(59,137,255,0.14)", padding: "1px 8px", borderRadius: 20 }}>{grp.items.length}</span>
                  </div>
                )}
                <div className="kanban-grid" style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 16, alignItems: "start" }}>
                  {columns.map((col) => {
                    const items = grp.items.filter((t) => t.taskStatus === col.status);
                    return (
                      <div
                        key={col.status}
                        onDragOver={(e) => e.preventDefault()}
                        onDrop={(e) => {
                          e.preventDefault();
                          if (dragKey.current) advanceTask(dragKey.current, col.status);
                          dragKey.current = null;
                        }}
                        style={{ background: "#0F0F11", border: `1px solid ${C.border}`, borderRadius: 14, padding: 14 }}
                      >
                        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 6px 14px" }}>
                          <span style={{ width: 8, height: 8, borderRadius: "50%", background: col.accent }} />
                          <span style={{ fontSize: 12.5, fontWeight: 600 }}>{col.label}</span>
                          <span style={{ fontSize: 11.5, color: C.faint }}>{items.length}</span>
                        </div>
                        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                          {items.map((t) => (
                            <div
                              key={t.key}
                              draggable
                              onDragStart={(e) => {
                                dragKey.current = t.key;
                                e.dataTransfer.effectAllowed = "move";
                              }}
                              style={{ background: C.panel2, border: `1px solid ${C.border2}`, borderRadius: 11, padding: 14, cursor: "grab" }}
                            >
                              <div style={{ marginBottom: 9 }}>{pageChip(t)}</div>
                              <div style={{ fontSize: 13.5, fontWeight: 600, lineHeight: 1.35 }}>{t.title}</div>
                              {t.aiSummary && <div style={{ fontSize: 12, color: C.muted, marginTop: 6, lineHeight: 1.45 }}>{t.aiSummary}</div>}
                              <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 11 }}>
                                <span style={{ fontSize: 11, fontWeight: 600, color: C.amber, background: "rgba(255,154,61,0.13)", padding: "2px 8px", borderRadius: 5 }}>{t.savings} saved</span>
                                <span style={{ fontSize: 11, fontWeight: 600, color: C.dim, background: "rgba(255,255,255,0.06)", padding: "2px 8px", borderRadius: 5 }}>{t.estTime}</span>
                              </div>
                              <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 13 }}>
                                {t.taskStatus === "done" ? (
                                  <>
                                    <span style={{ fontSize: 11.5, color: C.green, display: "flex", alignItems: "center", gap: 5 }}>
                                      <CheckIcon size={13} style={{ color: C.green }} />
                                      Done {t.doneDate}
                                    </span>
                                    <button onClick={() => advanceTask(t.key, "in-progress")} style={{ marginLeft: "auto", border: `1px solid ${C.border2}`, background: "rgba(255,255,255,0.03)", color: C.faint2, fontSize: 11.5, fontWeight: 500, padding: "6px 10px", borderRadius: 7, cursor: "pointer" }}>Reopen</button>
                                  </>
                                ) : (
                                  <ActionButtons t={t} advance={advanceTask} />
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
