"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import type { AgentIgnoreOverrideMode, AgentIgnoreScope, AppState, CategoryKey, Flag, RangeDays, ScoreByCategory, Strategy } from "@/lib/types";
import { updateAgentIgnoreOverride, updateAgentIgnoreSettings } from "@/lib/agentScoring";
import { collectionSettlementMessage, hasActiveCollections, startCollectionPolling } from "@/lib/collectionPolling";
import { isoDate } from "@/lib/ui";
import { withBasePath } from "@/lib/paths";
import { defaultNewPageFlag, flagCapacityError } from "@/lib/watchCapacity";

type SortDir = "asc" | "desc";
interface SortState {
  col: string | null;
  dir: SortDir;
}

interface AddForm {
  title: string;
  url: string;
}

export interface ReportData {
  date: string;
  url: string;
  raw: string;
  cats: { label: string; median: number; range: string; key: CategoryKey }[];
}

interface StoreValue extends AppState {
  basePath: string;
  pathFor: (path: string) => string;
  // global strategy toggle
  strategy: Strategy;
  setStrategy: (s: Strategy) => void;
  preferredStrategy: Strategy;
  setPreferredStrategy: (s: Strategy) => void;
  rangeDays: RangeDays;
  setRangeDays: (days: RangeDays) => void;
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
  renamePage: (id: string, title: string) => void;
  setAgentIgnore: (id: string, scope: AgentIgnoreScope, value: string, mode: AgentIgnoreOverrideMode) => void;
  setDefaultAgentIgnore: (scope: AgentIgnoreScope, value: string, ignored: boolean) => void;
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
const STRATEGY_PREFERENCE_KEY = "page-watcher:preferred-strategy";
const RANGE_PREFERENCE_KEY = "page-watcher:range-days";
const RANGE_DAYS = new Set<RangeDays>([3, 7, 30, 90]);

export function useStore(): StoreValue {
  const v = useContext(Ctx);
  if (!v) throw new Error("useStore must be used within <StoreProvider>");
  return v;
}

const CAT_KEYS: CategoryKey[] = ["perf", "a11y", "bp", "seo"];

const toggleSort = (prev: SortState, col: string): SortState => ({
  col,
  dir: prev.col === col && prev.dir === "desc" ? "asc" : "desc",
});

/** A brand-new page starts pending (no baseline / history) — no fabricated provenance. */
function pendingOptimisticPage(id: string, title: string, url: string, flag: Flag): AppState["pages"][number] {
  const zeroScores: ScoreByCategory = { perf: 0, a11y: 0, bp: 0, seo: 0 };
  return {
    id,
    title,
    url,
    flag,
    status: "pending",
    current: { mobile: zeroScores, desktop: zeroScores },
    history: [],
    markers: [],
    agent: [],
    agentIgnores: { checks: [], groups: [] },
    agentIgnoreRestores: { checks: [], groups: [] },
    acted: {},
  };
}

export function StoreProvider({ initial, basePath = "", children }: { initial: AppState; basePath?: string; children: React.ReactNode }) {
  const [data, setData] = useState<AppState>(initial);
  const dataRef = useRef<AppState>(initial);
  const mutationQueueRef = useRef<Promise<void>>(Promise.resolve());
  const mutationSequenceRef = useRef(0);
  const apply = useCallback((next: AppState) => {
    dataRef.current = next;
    setData(next);
  }, []);

  const [strategy, setStrategy] = useState<Strategy>("desktop");
  const [preferredStrategy, setPreferredStrategyState] = useState<Strategy>("desktop");
  const [rangeDays, setRangeDaysState] = useState<RangeDays>(30);
  const [dashSort, setDashSort] = useState<SortState>({ col: null, dir: "desc" });
  const [inboxGroup, setInboxGroup] = useState<"none" | "page" | "rec">("page");
  const [inboxSort, setInboxSort] = useState<SortState>({ col: null, dir: "desc" });
  const [taskGroup, setTaskGroup] = useState<"none" | "page" | "rec">("page");
  const [taskView, setTaskView] = useState<"list" | "kanban">("list");
  const [taskSort, setTaskSort] = useState<SortState>({ col: null, dir: "desc" });
  const [tab, setTab] = useState<"overview" | "history" | "audits" | "agent">("overview");
  const [chartCat, setChartCat] = useState<CategoryKey>("perf");
  const [modal, setModal] = useState<"add" | "marker" | "report" | null>(null);
  const [markerPageId, setMarkerPageId] = useState<string | null>(null);
  const [report, setReport] = useState<ReportData | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [form, setFormState] = useState<AddForm>({ title: "", url: "" });
  const [markerText, setMarkerText] = useState("");
  const [markerDate, setMarkerDate] = useState("");
  const pathFor = useCallback((path: string) => withBasePath(basePath, path), [basePath]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        const savedStrategy = window.localStorage.getItem(STRATEGY_PREFERENCE_KEY);
        if (savedStrategy === "mobile" || savedStrategy === "desktop") {
          setPreferredStrategyState(savedStrategy);
          setStrategy(savedStrategy);
        }
        const savedRange = Number(window.localStorage.getItem(RANGE_PREFERENCE_KEY)) as RangeDays;
        if (RANGE_DAYS.has(savedRange)) setRangeDaysState(savedRange);
      } catch {
        // Browser storage can be disabled; desktop + 30 days remain safe defaults.
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  const setPreferredStrategy = useCallback((next: Strategy) => {
    setPreferredStrategyState(next);
    setStrategy(next);
    try {
      window.localStorage.setItem(STRATEGY_PREFERENCE_KEY, next);
    } catch {
      // The preference still applies for the current session.
    }
  }, []);

  const setRangeDays = useCallback((next: RangeDays) => {
    setRangeDaysState(next);
    try {
      window.localStorage.setItem(RANGE_PREFERENCE_KEY, String(next));
    } catch {
      // The filter still applies for the current session.
    }
  }, []);

  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flash = useCallback((msg: string) => {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2800);
  }, []);
  useEffect(() => () => { if (toastTimer.current) clearTimeout(toastTimer.current); }, []);

  const hasActiveCollection = hasActiveCollections(data);
  useEffect(() => {
    if (!hasActiveCollection) return;
    // Reconcile immediately after a refresh/redeploy instead of waiting for a
    // button-local timer that no longer exists.
    return startCollectionPolling({
      url: pathFor("/api/state"),
      getState: () => dataRef.current,
      onState: (next) => {
        const previous = dataRef.current;
        apply(next);
        const message = collectionSettlementMessage(previous, next);
        if (message) flash(message);
      },
    });
  }, [apply, flash, hasActiveCollection, pathFor]);

  // ── persistence ──────────────────────────────────────────────────────
  // Optimistic mutate: apply the local prediction immediately, call the
  // server-side domain endpoint, then reconcile with the authoritative state
  // it returns. On any non-2xx / network failure, revert to the pre-action
  // snapshot and surface the error — no action ever reports success on failure
  // (audit: optimistic-success + whole-state overwrite).
  const mutate = useCallback(
    (
      optimistic: AppState,
      req: { url: string; method?: string; body?: unknown },
      msg: { success?: string; failure: string },
    ) => {
      const prev = dataRef.current;
      const sequence = ++mutationSequenceRef.current;
      apply(optimistic);

      // Preserve the user's action order. Without this queue, a slower earlier
      // toggle can reach the API after a later restore and become the persisted
      // final state. Only the newest response reconciles the optimistic client
      // state; it contains every earlier mutation because requests are serial.
      mutationQueueRef.current = mutationQueueRef.current
        .catch(() => undefined)
        .then(async () => {
          const r = await fetch(pathFor(req.url), {
            method: req.method ?? "POST",
            headers: req.body !== undefined ? { "content-type": "application/json" } : undefined,
            body: req.body !== undefined ? JSON.stringify(req.body) : undefined,
          });
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          const res = (await r.json().catch(() => null)) as { state?: AppState } | null;
          if (res?.state && sequence === mutationSequenceRef.current) apply(res.state);
          if (msg.success) flash(msg.success);
        })
        .catch(() => {
          if (sequence === mutationSequenceRef.current) apply(prev);
          flash(msg.failure);
        });
    },
    [apply, flash, pathFor],
  );

  // ── mutations ────────────────────────────────────────────────────────
  const setFlag = useCallback(
    (id: string, flag: Flag) => {
      const cur = dataRef.current;
      const page = cur.pages.find((item) => item.id === id);
      if (flag === "paused" && page?.runState && page.runState !== "failed") {
        flash("Wait for the current collection to finish before pausing this page");
        return;
      }
      const capacityError = flagCapacityError(cur.pages, id, flag);
      if (capacityError) {
        flash(capacityError);
        return;
      }
      mutate(
        { ...cur, watcherNote: undefined, pages: cur.pages.map((p) => (p.id === id ? { ...p, flag } : p)) },
        { url: `/api/pages/${id}/flag`, body: { flag } },
        { failure: "Couldn't update the monitoring status — check the limits and try again" },
      );
    },
    [flash, mutate],
  );

  const renamePage = useCallback(
    (id: string, value: string) => {
      const title = value.trim();
      const cur = dataRef.current;
      const page = cur.pages.find((item) => item.id === id);
      if (!page || !title || title === page.title) return;
      mutate(
        {
          ...cur,
          watcherNote: undefined,
          pages: cur.pages.map((item) => (item.id === id ? { ...item, title } : item)),
          recs: cur.recs.map((rec) => (rec.pageId === id ? { ...rec, pageTitle: title } : rec)),
        },
        { url: `/api/pages/${id}`, method: "PATCH", body: { title } },
        {
          success: `Renamed page to ${title}`,
          failure: "Couldn't rename the page — try again",
        },
      );
    },
    [mutate],
  );

  const setAgentIgnore = useCallback(
    (id: string, scope: AgentIgnoreScope, value: string, mode: AgentIgnoreOverrideMode) => {
      const cur = dataRef.current;
      mutate(
        {
          ...cur,
          pages: cur.pages.map((page) => {
            if (page.id !== id) return page;
            const next = updateAgentIgnoreOverride(page.agentIgnores, page.agentIgnoreRestores, scope, value, mode);
            return { ...page, agentIgnores: next.ignores, agentIgnoreRestores: next.restores };
          }),
        },
        { url: `/api/pages/${id}/agent-ignores`, body: { scope, value, mode } },
        {
          success: mode === "inherit"
            ? `${scope === "group" ? "Category" : "Check"} now uses the Watch List default`
            : `${scope === "group" ? "Category" : "Check"} ${mode === "ignore" ? "ignored" : "restored"} for this page`,
          failure: `Couldn't update the ${scope} override — try again`,
        },
      );
    },
    [mutate],
  );

  const setDefaultAgentIgnore = useCallback(
    (scope: AgentIgnoreScope, value: string, ignored: boolean) => {
      const cur = dataRef.current;
      mutate(
        {
          ...cur,
          agentIgnoreDefaults: updateAgentIgnoreSettings(cur.agentIgnoreDefaults, scope, value, ignored),
        },
        { url: "/api/settings/agent-ignores", body: { scope, value, ignored } },
        {
          success: `${scope === "group" ? "Category" : "Check"} ${ignored ? "ignored" : "restored"} by default`,
          failure: `Couldn't update the default ${scope} — try again`,
        },
      );
    },
    [mutate],
  );

  const removePage = useCallback(
    (id: string) => {
      const cur = dataRef.current;
      const p = cur.pages.find((x) => x.id === id);
      mutate(
        {
          ...cur,
          pages: cur.pages.filter((x) => x.id !== id),
          recs: cur.recs.filter((r) => r.pageId !== id),
          followUps: (cur.followUps ?? []).filter((f) => f.pageId !== id),
          watcherNote: undefined,
        },
        { url: `/api/pages/${id}`, method: "DELETE" },
        { success: `Removed ${p ? p.title : "page"} — excluded from future runs`, failure: "Couldn't remove the page — try again" },
      );
    },
    [mutate],
  );

  const saveTask = useCallback(
    (key: string) => {
      const cur = dataRef.current;
      mutate(
        { ...cur, recs: cur.recs.map((r) => (r.key === key ? { ...r, status: "task", taskStatus: "todo" } : r)) },
        { url: `/api/recs`, body: { key, action: "save" } },
        { success: "Saved to Tasks — track it on the Tasks board", failure: "Couldn't save to Tasks — try again" },
      );
    },
    [mutate],
  );

  const ignoreRec = useCallback(
    (key: string) => {
      const cur = dataRef.current;
      mutate(
        { ...cur, recs: cur.recs.map((r) => (r.key === key ? { ...r, status: "ignored" } : r)) },
        { url: `/api/recs`, body: { key, action: "ignore" } },
        { success: "Ignored — cleared from Inbox, still listed on the page", failure: "Couldn't ignore — try again" },
      );
    },
    [mutate],
  );

  const advanceTask = useCallback(
    (key: string, to: "todo" | "in-progress" | "done") => {
      const cur = dataRef.current;
      const rec = cur.recs.find((r) => r.key === key);
      if (!rec) return;
      // Idempotent: re-dropping an already-done card onto Done must not log a
      // second change marker or a duplicate set of follow-ups (audit).
      if (to === rec.taskStatus) return;
      const date = isoDate();
      if (to === "done") {
        // Completing a task logs a change marker + schedules follow-ups, so it
        // goes through the marker route (sequential storage, REQ-043/044).
        mutate(
          {
            ...cur,
            recs: cur.recs.map((r) => (r.key === key ? { ...r, taskStatus: "done", doneDate: date } : r)),
            pages: cur.pages.map((p) =>
              p.id === rec.pageId ? { ...p, markers: [...(p.markers || []), { id: crypto.randomUUID(), i: p.history.length - 1, date, text: `Acted: ${rec.title}` }] } : p,
            ),
          },
          { url: `/api/pages/${rec.pageId}/markers`, body: { text: `Acted: ${rec.title}`, date, recKey: key, taskStatus: "done" } },
          { success: `Task completed — change marker logged on ${rec.pageTitle}`, failure: "Couldn't complete the task — try again" },
        );
      } else {
        mutate(
          { ...cur, recs: cur.recs.map((r) => (r.key === key ? { ...r, taskStatus: to } : r)) },
          { url: `/api/recs`, body: { key, action: "advance", to } },
          { success: to === "in-progress" ? "Task moved to In progress" : "Task moved back to To do", failure: "Couldn't move the task — try again" },
        );
      }
    },
    [mutate],
  );

  const setForm = useCallback((f: Partial<AddForm>) => setFormState((prev) => ({ ...prev, ...f })), []);

  const submitAdd = useCallback(() => {
    const f = form;
    if (!f.title.trim() || !f.url.trim()) {
      flash("Add a title and URL");
      return;
    }
    const cur = dataRef.current;
    const flag = defaultNewPageFlag(cur.pages);
    // Optimistic pending page (temp id) — the server generates the real id and
    // returns the authoritative state, which replaces this on success.
    const optimistic: AppState = {
      ...cur,
      watcherNote: undefined,
      pages: [...cur.pages, pendingOptimisticPage(`tmp${Date.now()}`, f.title.trim(), f.url.trim(), flag)],
    };
    setModal(null);
    mutate(
      optimistic,
      // Let the server derive the status inside its atomic update so a racing
      // add becomes Paused instead of failing or exceeding the active limit.
      { url: `/api/pages`, body: { title: f.title.trim(), url: f.url.trim() } },
      {
        success: flag === "paused"
          ? `Added ${f.title.trim()} — paused with no collections scheduled`
          : `Added ${f.title.trim()} — pending its first run`,
        failure: "Couldn't add the page — try again",
      },
    );
  }, [form, mutate, flash]);

  const submitMarker = useCallback(() => {
    if (!markerText.trim()) {
      flash("Describe the change");
      return;
    }
    const id = markerPageId;
    if (!id) return;
    const date = markerDate.trim() || isoDate();
    const cur = dataRef.current;
    setModal(null);
    mutate(
      {
        ...cur,
        pages: cur.pages.map((p) => (p.id === id ? { ...p, markers: [...(p.markers || []), { id: crypto.randomUUID(), i: p.history.length - 1, date, text: markerText.trim() }] } : p)),
      },
      { url: `/api/pages/${id}/markers`, body: { text: markerText.trim(), date } },
      { success: "Marker logged — 2, 7 & 30-day Slack reports scheduled", failure: "Couldn't log the marker — try again" },
    );
  }, [markerText, markerDate, markerPageId, mutate, flash]);

  const runPage = useCallback(
    (id: string) => {
      const cur = dataRef.current;
      const p = cur.pages.find((x) => x.id === id);
      flash(`Run started for ${p ? p.title : "this page"} — collecting in the background…`);
      fetch(pathFor(`/api/pages/${id}/run`), { method: "POST" })
        .then(async (r) => {
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          const res = (await r.json().catch(() => null)) as { state?: AppState } | null;
          if (res?.state) apply(res.state);
        })
        .catch(() => flash("Couldn't start the run — try again"));
    },
    [flash, apply, pathFor],
  );

  const captureBaseline = useCallback(
    (id: string) => {
      const page = dataRef.current.pages.find((item) => item.id === id);
      flash(`Baseline queued for ${page?.title ?? "this page"} — collecting in the background…`);
      fetch(pathFor(`/api/pages/${id}/baseline`), { method: "POST" })
        .then(async (r) => {
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          const res = (await r.json().catch(() => null)) as { state?: AppState } | null;
          if (res?.state) apply(res.state);
        })
        .catch(() => flash("Baseline capture failed"));
    },
    [flash, apply, pathFor],
  );

  const sortDash = useCallback((col: string) => setDashSort((p) => toggleSort(p, col)), []);
  const sortInbox = useCallback((col: string) => setInboxSort((p) => toggleSort(p, col)), []);
  const sortTask = useCallback((col: string) => setTaskSort((p) => toggleSort(p, col)), []);
  const openAdd = useCallback(() => {
    setFormState({ title: "", url: "" });
    setModal("add");
  }, []);
  const openMarker = useCallback((pageId: string) => {
    setMarkerPageId(pageId);
    setMarkerText("");
    setMarkerDate(isoDate());
    setModal("marker");
  }, []);
  const closeModal = useCallback(() => setModal(null), []);
  const openReport = useCallback((r: ReportData) => {
    setReport(r);
    setModal("report");
  }, []);

  const value: StoreValue = {
    ...data,
    basePath,
    pathFor,
    strategy,
    setStrategy,
    preferredStrategy,
    setPreferredStrategy,
    rangeDays,
    setRangeDays,
    dashSort,
    sortDash,
    inboxGroup,
    setInboxGroup,
    inboxSort,
    sortInbox,
    taskGroup,
    setTaskGroup,
    taskView,
    setTaskView,
    taskSort,
    sortTask,
    tab,
    setTab,
    chartCat,
    setChartCat,
    modal,
    markerPageId,
    openAdd,
    openMarker,
    closeModal,
    report,
    openReport,
    toast,
    flash,
    form,
    setForm,
    markerText,
    markerDate,
    setMarkerText,
    setMarkerDate,
    setFlag,
    renamePage,
    setAgentIgnore,
    setDefaultAgentIgnore,
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
