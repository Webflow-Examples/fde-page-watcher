"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import type { AppState, CategoryKey, Flag, Night, NightScores, ScoreByCategory, Strategy, StrategyScores } from "@/lib/types";
import { shortDate } from "@/lib/ui";

type SortDir = "asc" | "desc";
interface SortState {
  col: string | null;
  dir: SortDir;
}

interface AddForm {
  title: string;
  url: string;
  flag: Flag;
}

export interface ReportData {
  date: string;
  url: string;
  raw: string;
  cats: { label: string; median: number; range: string; key: CategoryKey }[];
}

interface StoreValue extends AppState {
  // global strategy toggle
  strategy: Strategy;
  setStrategy: (s: Strategy) => void;
  // dashboard sort
  dashSort: SortState;
  sortDash: (col: string) => void;
  // inbox
  inboxGroup: "none" | "page" | "rec";
  setInboxGroup: (g: "none" | "page" | "rec") => void;
  inboxSort: SortState;
  sortInbox: (col: string) => void;
  // tasks
  taskGroup: "none" | "page" | "rec";
  setTaskGroup: (g: "none" | "page" | "rec") => void;
  taskView: "list" | "kanban";
  setTaskView: (v: "list" | "kanban") => void;
  taskSort: SortState;
  sortTask: (col: string) => void;
  // page detail
  tab: "overview" | "history" | "audits" | "agent";
  setTab: (t: "overview" | "history" | "audits" | "agent") => void;
  chartCat: CategoryKey;
  setChartCat: (c: CategoryKey) => void;
  // modals / toast / report
  modal: "add" | "marker" | "report" | null;
  markerPageId: string | null;
  openAdd: () => void;
  openMarker: (pageId: string) => void;
  closeModal: () => void;
  report: ReportData | null;
  openReport: (r: ReportData) => void;
  toast: string | null;
  flash: (msg: string) => void;
  // add form
  form: AddForm;
  setForm: (f: Partial<AddForm>) => void;
  // marker form
  markerText: string;
  markerDate: string;
  setMarkerText: (t: string) => void;
  setMarkerDate: (d: string) => void;
  // actions
  setFlag: (id: string, flag: Flag) => void;
  removePage: (id: string) => void;
  saveTask: (key: string) => void;
  ignoreRec: (key: string) => void;
  advanceTask: (key: string, to: "todo" | "in-progress" | "done") => void;
  submitAdd: () => void;
  submitMarker: () => void;
  runPage: (id: string) => void;
  captureBaseline: (id: string) => void;
}

const Ctx = createContext<StoreValue | null>(null);

export function useStore(): StoreValue {
  const v = useContext(Ctx);
  if (!v) throw new Error("useStore must be used within <StoreProvider>");
  return v;
}

const CAT_KEYS: CategoryKey[] = ["perf", "a11y", "bp", "seo"];

/** Flat NightScores at a fixed set of medians (used when a new page has no runs yet). */
function flatScores(base: ScoreByCategory): StrategyScores {
  const cs = (v: number, spread: number) => ({ m: v, lo: Math.max(0, v - spread), hi: Math.min(100, v + spread) });
  const mobile: NightScores = { perf: cs(base.perf, 3), a11y: cs(base.a11y, 1), bp: cs(base.bp, 1), seo: cs(base.seo, 1) };
  const desktop: NightScores = {
    perf: cs(Math.min(100, base.perf + 18), 3),
    a11y: cs(base.a11y, 1),
    bp: cs(base.bp, 1),
    seo: cs(base.seo, 1),
  };
  return { mobile, desktop };
}

export function StoreProvider({ initial, children }: { initial: AppState; children: React.ReactNode }) {
  const [data, setData] = useState<AppState>(initial);
  const dataRef = useRef<AppState>(initial);
  const apply = useCallback((next: AppState) => {
    dataRef.current = next;
    setData(next);
  }, []);

  const [strategy, setStrategy] = useState<Strategy>("mobile");
  const [dashSort, setDashSort] = useState<SortState>({ col: null, dir: "desc" });
  const [inboxGroup, setInboxGroup] = useState<"none" | "page" | "rec">("none");
  const [inboxSort, setInboxSort] = useState<SortState>({ col: null, dir: "desc" });
  const [taskGroup, setTaskGroup] = useState<"none" | "page" | "rec">("none");
  const [taskView, setTaskView] = useState<"list" | "kanban">("list");
  const [taskSort, setTaskSort] = useState<SortState>({ col: null, dir: "desc" });
  const [tab, setTab] = useState<"overview" | "history" | "audits" | "agent">("overview");
  const [chartCat, setChartCat] = useState<CategoryKey>("perf");
  const [modal, setModal] = useState<"add" | "marker" | "report" | null>(null);
  const [markerPageId, setMarkerPageId] = useState<string | null>(null);
  const [report, setReport] = useState<ReportData | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [form, setFormState] = useState<AddForm>({ title: "", url: "", flag: "priority" });
  const [markerText, setMarkerText] = useState("");
  const [markerDate, setMarkerDate] = useState("");

  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flash = useCallback((msg: string) => {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2800);
  }, []);
  useEffect(() => () => { if (toastTimer.current) clearTimeout(toastTimer.current); }, []);

  // ── persistence ──────────────────────────────────────────────────────
  const persist = useCallback(
    (next: AppState) => {
      apply(next);
      fetch("/api/state", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(next),
      }).catch(() => flash("Couldn't save — changes may not persist"));
    },
    [apply, flash],
  );

  const toggleSort = (prev: SortState, col: string): SortState => ({
    col,
    dir: prev.col === col && prev.dir === "desc" ? "asc" : "desc",
  });

  // ── mutations ────────────────────────────────────────────────────────
  const setFlag = useCallback(
    (id: string, flag: Flag) => {
      const cur = dataRef.current;
      persist({ ...cur, pages: cur.pages.map((p) => (p.id === id ? { ...p, flag } : p)) });
    },
    [persist],
  );

  const removePage = useCallback(
    (id: string) => {
      const cur = dataRef.current;
      const p = cur.pages.find((x) => x.id === id);
      persist({
        ...cur,
        pages: cur.pages.filter((x) => x.id !== id),
        recs: cur.recs.filter((r) => r.pageId !== id),
      });
      flash(`Removed ${p ? p.title : "page"} — excluded from future runs`);
    },
    [persist, flash],
  );

  const saveTask = useCallback(
    (key: string) => {
      const cur = dataRef.current;
      persist({ ...cur, recs: cur.recs.map((r) => (r.key === key ? { ...r, status: "task", taskStatus: "todo" } : r)) });
      flash("Saved to Tasks — track it on the Tasks board");
    },
    [persist, flash],
  );

  const ignoreRec = useCallback(
    (key: string) => {
      const cur = dataRef.current;
      persist({ ...cur, recs: cur.recs.map((r) => (r.key === key ? { ...r, status: "ignored" } : r)) });
      flash("Ignored — cleared from Inbox, still listed on the page");
    },
    [persist, flash],
  );

  const advanceTask = useCallback(
    (key: string, to: "todo" | "in-progress" | "done") => {
      const cur = dataRef.current;
      const rec = cur.recs.find((r) => r.key === key);
      if (!rec) return;
      const date = shortDate();
      if (to === "done") {
        // Optimistic: mark done + add marker locally, then persist via the
        // marker route (sequential storage + follow-up scheduling, REQ-043/044).
        const optimistic: AppState = {
          ...cur,
          recs: cur.recs.map((r) => (r.key === key ? { ...r, taskStatus: "done", doneDate: date } : r)),
          pages: cur.pages.map((p) =>
            p.id === rec.pageId ? { ...p, markers: [...(p.markers || []), { i: p.history.length - 1, date, text: `Acted: ${rec.title}` }] } : p,
          ),
        };
        apply(optimistic);
        flash(`Task completed — change marker logged on ${rec.pageTitle}`);
        fetch(`/api/pages/${rec.pageId}/markers`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ text: `Acted: ${rec.title}`, date, recKey: key, taskStatus: "done" }),
        })
          .then((r) => (r.ok ? r.json() : null))
          .then((res) => { if (res?.state) apply(res.state as AppState); })
          .catch(() => {});
      } else {
        persist({ ...cur, recs: cur.recs.map((r) => (r.key === key ? { ...r, taskStatus: to } : r)) });
        flash(to === "in-progress" ? "Task moved to In progress" : "Task moved back to To do");
      }
    },
    [persist, apply, flash],
  );

  const setForm = useCallback((f: Partial<AddForm>) => setFormState((prev) => ({ ...prev, ...f })), []);

  const submitAdd = useCallback(() => {
    const f = form;
    if (!f.title.trim() || !f.url.trim()) {
      flash("Add a title and URL");
      return;
    }
    const cur = dataRef.current;
    const id = `p${Date.now()}`;
    const base: ScoreByCategory = { perf: 70, a11y: 92, bp: 96, seo: 96 };
    const template = cur.pages[0]?.history ?? [];
    const scores = flatScores(base);
    const history: Night[] =
      template.length > 0
        ? template.map((d) => ({ i: d.i, date: d.date, scores }))
        : Array.from({ length: 30 }, (_, i) => ({ i, date: "", scores }));
    persist({
      ...cur,
      pages: [
        ...cur.pages,
        {
          id,
          title: f.title.trim(),
          url: f.url.trim(),
          flag: f.flag,
          status: "healthy",
          baseline: scores,
          current: { mobile: base, desktop: { ...base, perf: Math.min(100, base.perf + 18) } },
          history,
          markers: [],
          agent: [],
          acted: {},
        },
      ],
    });
    setModal(null);
    flash(`Added ${f.title.trim()} — included in the next nightly run`);
  }, [form, persist, flash]);

  const submitMarker = useCallback(() => {
    if (!markerText.trim()) {
      flash("Describe the change");
      return;
    }
    const id = markerPageId;
    if (!id) return;
    const date = markerDate.trim() || shortDate();
    const cur = dataRef.current;
    const optimistic: AppState = {
      ...cur,
      pages: cur.pages.map((p) => (p.id === id ? { ...p, markers: [...(p.markers || []), { i: p.history.length - 1, date, text: markerText.trim() }] } : p)),
    };
    apply(optimistic);
    setModal(null);
    flash("Marker logged — 2, 7 & 30-day Slack reports scheduled");
    fetch(`/api/pages/${id}/markers`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: markerText.trim(), date }),
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((res) => { if (res?.state) apply(res.state as AppState); })
      .catch(() => {});
  }, [markerText, markerDate, markerPageId, apply, flash]);

  const runPage = useCallback(
    (id: string) => {
      const cur = dataRef.current;
      const p = cur.pages.find((x) => x.id === id);
      flash(`Async run queued for ${p ? p.title : "this page"}`);
      fetch(`/api/pages/${id}/run`, { method: "POST" })
        .then((r) => (r.ok ? r.json() : null))
        .then((res) => { if (res?.state) apply(res.state as AppState); })
        .catch(() => {});
    },
    [flash, apply],
  );

  const captureBaseline = useCallback(
    (id: string) => {
      flash("Capturing baseline — 5 PSI runs per strategy…");
      fetch(`/api/pages/${id}/baseline`, { method: "POST" })
        .then((r) => (r.ok ? r.json() : null))
        .then((res) => {
          if (res?.state) apply(res.state as AppState);
          flash("Baseline captured");
        })
        .catch(() => flash("Baseline capture failed"));
    },
    [flash, apply],
  );

  const value: StoreValue = {
    ...data,
    strategy,
    setStrategy,
    dashSort,
    sortDash: (col) => setDashSort((p) => toggleSort(p, col)),
    inboxGroup,
    setInboxGroup,
    inboxSort,
    sortInbox: (col) => setInboxSort((p) => toggleSort(p, col)),
    taskGroup,
    setTaskGroup,
    taskView,
    setTaskView,
    taskSort,
    sortTask: (col) => setTaskSort((p) => toggleSort(p, col)),
    tab,
    setTab,
    chartCat,
    setChartCat,
    modal,
    markerPageId,
    openAdd: () => {
      setFormState({ title: "", url: "", flag: "priority" });
      setModal("add");
    },
    openMarker: (pageId) => {
      setMarkerPageId(pageId);
      setMarkerText("");
      setMarkerDate("");
      setModal("marker");
    },
    closeModal: () => setModal(null),
    report,
    openReport: (r) => {
      setReport(r);
      setModal("report");
    },
    toast,
    flash,
    form,
    setForm,
    markerText,
    markerDate,
    setMarkerText,
    setMarkerDate,
    setFlag,
    removePage,
    saveTask,
    ignoreRec,
    advanceTask,
    submitAdd,
    submitMarker,
    runPage,
    captureBaseline,
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export { CAT_KEYS };
