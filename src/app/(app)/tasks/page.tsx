"use client";

import { useEffect, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useStore } from "@/components/store";
import type { Rec, TaskStatus } from "@/lib/types";
import { C, costValue, savingsValue, taskAccent, taskLabel } from "@/lib/ui";
import { FieldEvidenceChip, FieldRecommendationStatusBadge, SegToggle, SortHeader, WebflowClassificationChips } from "@/components/bits";
import { CheckIcon } from "@/components/icons";
import { culpritGroupLabel, effortLabel, webflowClassificationFor } from "@/lib/webflowPerformance";
import { recommendationEvidenceSignal } from "@/lib/fieldPrioritization";

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
  const searchParams = useSearchParams();
  const { pages, recs, visitorExperience, productEscalations = [], taskGroup, setTaskGroup, taskDescriptions, setTaskDescriptions, taskView, setTaskView, taskSort, sortTask, advanceTask, pathFor } = useStore();
  const dragKey = useRef<string | null>(null);

  const tasks = recs.filter((r) => r.status === "task");
  const linkedTaskKey = searchParams.get("task");
  useEffect(() => {
    if (!linkedTaskKey) return;
    document.getElementById(`task-${linkedTaskKey}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [linkedTaskKey, taskView]);

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

  const openPage = (pageId: string) => router.push(pathFor(`/pages/${pageId}`));
  const escalationByRec = new Map(productEscalations.map((item) => [item.recKey, item]));
  const escalationChip = (task: Rec) => {
    const escalation = escalationByRec.get(task.key);
    return escalation ? (
      <button type="button" onClick={(event) => { event.stopPropagation(); router.push(pathFor("/escalations")); }} style={{ border: "1px solid rgba(255,154,61,0.24)", background: "rgba(255,154,61,0.10)", color: C.amber, fontSize: 10.5, fontWeight: 600, padding: "2px 7px", borderRadius: 5, cursor: "pointer" }}>
        Escalation · {escalation.status}
      </button>
    ) : null;
  };
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
  const fieldEvidenceChip = (task: Rec) => task.source === "crux-field-only" ? (
    <FieldEvidenceChip signal={recommendationEvidenceSignal(task, pages.find((page) => page.id === task.pageId), visitorExperience)} />
  ) : null;

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
  } else if (taskGroup === "culprit") {
    const m = new Map<string, { label: string; items: Rec[] }>();
    sorted.forEach((task) => {
      const classification = webflowClassificationFor(task);
      const key = classification.culprit;
      if (!m.has(key)) m.set(key, { label: culpritGroupLabel(task), items: [] });
      m.get(key)!.items.push(task);
    });
    listGroups = [...m.values()];
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
      <header className="page-header tasks-page-header" style={{ padding: "30px 40px 24px" }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 27, fontWeight: 600, letterSpacing: "-0.01em" }}>Tasks</h1>
          <p style={{ margin: "8px 0 0", fontSize: 13.5, color: C.muted }}>Recommendations you&apos;ve committed to. Completing a task logs a change marker on its page and schedules the follow-up reports.</p>
        </div>
        <div className="page-controls tasks-page-controls" style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 12, color: C.faint }}>Descriptions</span>
            <SegToggle
              label="Task descriptions"
              value={taskDescriptions}
              onChange={setTaskDescriptions}
              options={[
                { value: "show", label: "Show" },
                { value: "hide", label: "Hide" },
              ]}
            />
          </div>
          <SegToggle label="Task view" value={taskView} onChange={setTaskView} options={[{ value: "kanban", label: "Columns" }, { value: "list", label: "List" }]} />
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 12, color: C.faint, whiteSpace: "nowrap" }}>Group by</span>
            <SegToggle label="Group tasks by" value={taskGroup} onChange={setTaskGroup} options={[{ value: "none", label: "None" }, { value: "page", label: "Page" }, { value: "rec", label: "Fix" }, { value: "culprit", label: "Issue" }]} />
          </div>
        </div>
      </header>

      <div className="page-content table-scroll" style={{ padding: "0 40px 48px" }}>
        {taskView === "list" ? (
          <div className="narrow-table" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div style={{ display: "grid", gridTemplateColumns: LIST_GRID, gap: 16, alignItems: "center", padding: "4px 22px 0", fontSize: 11, fontWeight: 550, letterSpacing: "0.04em", textTransform: "uppercase" }}>
              <div />
              <SortHeader label="Recommendation" align="left" active={taskSort.col === "rec"} dir={taskSort.dir} onSort={() => sortTask("rec")} />
              <SortHeader label="Impact" align="right" active={taskSort.col === "savings"} dir={taskSort.dir} onSort={() => sortTask("savings")} />
              <SortHeader label="Effort" align="right" active={taskSort.col === "cost"} dir={taskSort.dir} onSort={() => sortTask("cost")} />
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
                  <div id={`task-${t.key}`} key={t.key} style={{ display: "grid", gridTemplateColumns: LIST_GRID, gap: 16, alignItems: "center", padding: "15px 22px", borderBottom: `1px solid ${C.rowBorder}`, background: linkedTaskKey === t.key ? "rgba(59,137,255,0.10)" : undefined }}>
                    <span style={{ justifySelf: "center", width: 9, height: 9, borderRadius: "50%", background: taskAccent(t.taskStatus) }} />
                    <div style={{ minWidth: 0 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                        <span style={{ fontSize: 14, fontWeight: 600 }}>{taskGroup === "rec" ? t.pageTitle : t.title}</span>
                        {t.strategies?.map((device) => (
                          <span key={device} style={{ fontSize: 9.5, color: C.accentSoft, textTransform: "capitalize" }}>{device}</span>
                        ))}
                      </div>
                      {taskDescriptions === "show" && t.aiSummary && <div style={{ fontSize: 12, color: C.muted, marginTop: 4, lineHeight: 1.45 }}>{t.aiSummary}</div>}
                      <div style={{ marginTop: 7 }}>
                        <WebflowClassificationChips classification={webflowClassificationFor(t)} />
                      </div>
                      {t.source === "crux-field-only" && <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 6 }}>{fieldEvidenceChip(t)}<FieldRecommendationStatusBadge rec={t} /></div>}
                      <div style={{ marginTop: 6 }}>{escalationChip(t)}</div>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 6 }}>
                        {pageChip(t)}
                        <span style={{ fontSize: 11.5, fontWeight: 550, color: taskAccent(t.taskStatus) }}>{taskLabel(t.taskStatus)}</span>
                      </div>
                    </div>
                    <div style={{ textAlign: "right", fontSize: 13, fontWeight: 600, color: C.amber }}>{t.savings}</div>
                    <div style={{ textAlign: "right", fontSize: 13, fontWeight: 600, color: C.dim }}>{effortLabel(t)}</div>
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
                              <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                                <span style={{ fontSize: 13.5, fontWeight: 600, lineHeight: 1.35 }}>{taskGroup === "rec" ? t.pageTitle : t.title}</span>
                                {t.strategies?.map((device) => (
                                  <span key={device} style={{ fontSize: 9.5, color: C.accentSoft, textTransform: "capitalize" }}>{device}</span>
                                ))}
                              </div>
                              {taskDescriptions === "show" && t.aiSummary && <div style={{ fontSize: 12, color: C.muted, marginTop: 6, lineHeight: 1.45 }}>{t.aiSummary}</div>}
                              <div style={{ marginTop: 8 }}>
                                <WebflowClassificationChips classification={webflowClassificationFor(t)} />
                              </div>
                              {t.source === "crux-field-only" && <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 6 }}>{fieldEvidenceChip(t)}<FieldRecommendationStatusBadge rec={t} /></div>}
                              <div style={{ marginTop: 6 }}>{escalationChip(t)}</div>
                              <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 11 }}>
                                <span style={{ fontSize: 11, fontWeight: 600, color: C.amber, background: "rgba(255,154,61,0.13)", padding: "2px 8px", borderRadius: 5 }}>{t.source === "crux-field-only" ? "Visitor investigation" : `${t.savings} saved`}</span>
                                <span style={{ fontSize: 11, fontWeight: 600, color: C.dim, background: "rgba(255,255,255,0.06)", padding: "2px 8px", borderRadius: 5 }}>{effortLabel(t)}</span>
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
