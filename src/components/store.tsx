"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { DEFAULT_RANGE_DAYS } from "@/lib/types";
import type { AgentIgnoreOverrideMode, AgentIgnoreScope, AppState, CategoryKey, CollectionSchedule, Flag, PagePerformanceThresholdOverrides, PerformanceThresholds, RangeDays, ScoreByCategory, Strategy } from "@/lib/types";

import type { CruxPageEvidence } from "@/lib/crux";
import type { ExternalAgentOriginAudit } from "@/lib/agentAudit";
import { updateAgentIgnoreOverride, updateAgentIgnoreSettings } from "@/lib/agentScoring";
import { collectionRequestMessage, collectionSettlementMessage, hasActiveCollections, startCollectionPolling, type CollectionRequestResult } from "@/lib/collectionPolling";
import { effectivePerformanceThresholds, normalizePerformanceThresholdOverrides, normalizePerformanceThresholds } from "@/lib/performanceThresholds";
import {
  byWorstMeasured,
  casesInQueue,
  groupByRemediation,
  type Effort,
  type IssueCase,
  type RemediationGroup,
} from "@/lib/issue-case";
import { issueCasesFrom, lastRunAtOf } from "@/lib/issue-cases";
import type { CaseDecision, CaseDecisionRequest } from "@/lib/case-decisions";
import { partitionByImpact } from "@/lib/impact-format";
import { APPLICABILITY_LABEL, COUNTED_QUEUES, ISSUE_ACTION_LABEL, type ExclusionReason, type Queue } from "@/lib/vocabulary";
import { normalizeNativeElementControls } from "@/lib/nativeElements";
import { localISODate } from "@/lib/ui";
import { withBasePath } from "@/lib/paths";
import { defaultNewPageFlag, flagCapacityError } from "@/lib/watchCapacity";
import { applyWatchlistPageOrder, changePageFlagOrder } from "@/lib/watchlistOrder";
import { isTaskMarker, removeTaskMarker, taskMarkerText } from "@/lib/taskMarkers";
import { pageTrend } from "@/lib/scoring";
import { normalizeState } from "@/lib/store/normalize";
import type { Project } from "@/lib/projects";
import { LAST_PROJECT_KEY } from "@/lib/projectSelection";
import { APPEARANCE_STORAGE_KEY, isAppearance, resolveSurface, type Appearance } from "./appearance";

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
  user: { email: string; isAppAdmin: boolean; development: boolean };
  canManageProject: boolean;
  visitorExperience: CruxPageEvidence[];
  /** Origin-scoped external agent audits. Read-only; never part of AppState. */
  externalAgentAudits: ExternalAgentOriginAudit[];
  basePath: string;
  pathFor: (path: string) => string;
  projects: Project[];
  adminProjects: Project[];
  project: Project;
  projectSwitching: boolean;
  switchProject: (id: string) => Promise<boolean>;
  projectCreating: boolean;
  createProject: (name: string, customer?: string) => Promise<Project | null>;
  projectUpdating: boolean;
  renameProject: (id: string, name: string, customer?: string) => Promise<boolean>;
  archiveProject: (id: string) => Promise<boolean>;
  restoreProject: (id: string) => Promise<boolean>;
  // global strategy toggle
  strategy: Strategy;
  setStrategy: (s: Strategy) => void;
  preferredStrategy: Strategy;
  setPreferredStrategy: (s: Strategy) => void;
  // Auto / Light / Dark. Persisted beside the device preference above.
  appearance: Appearance;
  setAppearance: (a: Appearance) => void;
  rangeDays: RangeDays;
  setRangeDays: (days: RangeDays) => void;
  // dashboard sort
  dashSort: SortState;
  sortDash: (col: string) => void;
  // inbox
  inboxGroup: "none" | "page" | "rec" | "culprit";
  setInboxGroup: (g: "none" | "page" | "rec" | "culprit") => void;
  inboxDescriptions: "show" | "hide";
  setInboxDescriptions: (value: "show" | "hide") => void;
  inboxSort: SortState;
  sortInbox: (col: string) => void;
  // tasks
  taskGroup: "none" | "page" | "rec" | "culprit";
  setTaskGroup: (g: "none" | "page" | "rec" | "culprit") => void;
  taskDescriptions: "show" | "hide";
  setTaskDescriptions: (value: "show" | "hide") => void;
  taskView: "list" | "kanban";
  setTaskView: (v: "list" | "kanban") => void;
  taskSort: SortState;
  sortTask: (col: string) => void;
  // page detail. The four tabs' state used to live here; the page is one
  // scroll now, so the only view preference it still has is the chart's
  // category.
  chartCat: CategoryKey;
  setChartCat: (c: CategoryKey) => void;
  // modals / toast / report
  modal: "add" | "marker" | "report" | null;
  markerPageId: string | null;
  markerEditingId: string | null;
  openAdd: () => void;
  openMarker: (pageId: string) => void;
  editMarker: (pageId: string, markerId: string) => void;
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
  reorderPages: (pageIds: string[]) => void;
  renamePage: (id: string, title: string) => void;
  setAgentIgnore: (id: string, scope: AgentIgnoreScope, value: string, mode: AgentIgnoreOverrideMode) => void;
  setDefaultAgentIgnore: (scope: AgentIgnoreScope, value: string, ignored: boolean) => void;
  /** Applicability on one native-element finding. `null` includes it again. */
  setNativeElementApplicability: (id: string, findingId: string, reason: ExclusionReason | null) => void;
  /**
   * Append one decision about a remediation. Never edits an earlier one —
   * reversing a decision is another entry saying so.
   */
  recordCaseDecision: (decision: CaseDecisionRequest) => void;
  updatePerformanceThresholds: (thresholds: PerformanceThresholds) => void;
  updatePagePerformanceThresholds: (id: string, overrides: PagePerformanceThresholdOverrides) => void;
  updateCollectionSchedule: (schedule: CollectionSchedule) => void;
  updateAlertWebhookUrl: (url: string) => void;
  setVisitorExperienceVisible: (visible: boolean) => void;
  setExternalAgentAuditEnabled: (enabled: boolean) => void;
  refreshExternalAgentAudit: (pageId: string) => void;
  addAgentIssueTask: (pageId: string, caseKey: string) => void;
  verifyAgentIssueTask: (recKey: string) => void;
  externalAgentAuditRefreshing: boolean;
  removePage: (id: string) => void;
  saveTask: (key: string) => void;
  triageRec: (key: string) => void;
  ignoreRec: (key: string) => void;
  advanceTask: (key: string, to: "todo" | "in-progress" | "done") => void;
  submitAdd: () => void;
  submitMarker: () => void;
  deleteMarker: () => void;
  runPage: (id: string) => void;
  captureBaseline: (id: string) => void;
}

const Ctx = createContext<StoreValue | null>(null);
const STRATEGY_PREFERENCE_KEY = "page-watcher:preferred-strategy";
const INBOX_DESCRIPTIONS_PREFERENCE_KEY = "page-watcher:inbox-descriptions";
const TASK_DESCRIPTIONS_PREFERENCE_KEY = "page-watcher:task-descriptions";
// The appearance key lives in appearance.tsx because the pre-paint script in
// (app)/layout.tsx reads the same one before any bundle has loaded.

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

export function StoreProvider({
  initial,
  initialVisitorExperience = [],
  initialExternalAgentAudits = [],
  basePath = "",
  projects: initialProjects,
  adminProjects: initialAdminProjects,
  initialProjectId,
  user,
  children,
}: {
  initial: AppState;
  initialVisitorExperience?: CruxPageEvidence[];
  initialExternalAgentAudits?: ExternalAgentOriginAudit[];
  basePath?: string;
  projects: Project[];
  adminProjects: Project[];
  initialProjectId: string;
  user: { email: string; isAppAdmin: boolean; development: boolean };
  children: React.ReactNode;
}) {
  const [data, setData] = useState<AppState>(initial);
  const [visitorExperience, setVisitorExperience] = useState<CruxPageEvidence[]>(initialVisitorExperience);
  const [externalAgentAudits, setExternalAgentAudits] = useState<ExternalAgentOriginAudit[]>(initialExternalAgentAudits);
  const dataRef = useRef<AppState>(initial);
  const mutationQueueRef = useRef<Promise<void>>(Promise.resolve());
  const mutationSequenceRef = useRef(0);
  const apply = useCallback((next: AppState) => {
    dataRef.current = next;
    setData(next);
  }, []);

  const [strategy, setStrategy] = useState<Strategy>("desktop");
  // "auto" until the stored preference is read below, matching the pre-paint
  // script's own default so the two never briefly disagree.
  const [appearance, setAppearanceState] = useState<Appearance>("auto");
  const [preferredStrategy, setPreferredStrategyState] = useState<Strategy>("desktop");
  // Range is shared by every route under this provider, but intentionally
  // starts fresh at seven days after a full app reload.
  const [rangeDays, setRangeDaysState] = useState<RangeDays>(DEFAULT_RANGE_DAYS);
  const [dashSort, setDashSort] = useState<SortState>({ col: null, dir: "desc" });
  const [inboxGroup, setInboxGroup] = useState<"none" | "page" | "rec" | "culprit">("page");
  const [inboxDescriptions, setInboxDescriptionsState] = useState<"show" | "hide">("show");
  const [inboxSort, setInboxSort] = useState<SortState>({ col: null, dir: "desc" });
  const [taskGroup, setTaskGroup] = useState<"none" | "page" | "rec" | "culprit">("page");
  const [taskDescriptions, setTaskDescriptionsState] = useState<"show" | "hide">("show");
  const [taskView, setTaskView] = useState<"list" | "kanban">("list");
  const [taskSort, setTaskSort] = useState<SortState>({ col: null, dir: "desc" });
  const [chartCat, setChartCat] = useState<CategoryKey>("perf");
  const [modal, setModal] = useState<"add" | "marker" | "report" | null>(null);
  const [markerPageId, setMarkerPageId] = useState<string | null>(null);
  const [markerEditingId, setMarkerEditingId] = useState<string | null>(null);
  const [report, setReport] = useState<ReportData | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [form, setFormState] = useState<AddForm>({ title: "", url: "" });
  const [markerText, setMarkerText] = useState("");
  const [markerDate, setMarkerDate] = useState("");
  const [projectId, setProjectId] = useState(initialProjectId);
  const [projectSwitching, setProjectSwitching] = useState(false);
  const [projectCreating, setProjectCreating] = useState(false);
  const [projectUpdating, setProjectUpdating] = useState(false);
  const [projects, setProjects] = useState(initialProjects);
  const [adminProjects, setAdminProjects] = useState(initialAdminProjects);
  const project = projects.find(({ id }) => id === projectId) ?? projects[0];
  if (!project) throw new Error("StoreProvider requires at least one project");
  const canManageProject = user.isAppAdmin || project.accessRole === "project_admin";

  const projectPathFor = useCallback((id: string, path: string) => {
    const resolved = withBasePath(basePath, path);
    if (!path.startsWith("/api/")) return resolved;
    const hashIndex = resolved.indexOf("#");
    const beforeHash = hashIndex === -1 ? resolved : resolved.slice(0, hashIndex);
    const hash = hashIndex === -1 ? "" : resolved.slice(hashIndex);
    return `${beforeHash}${beforeHash.includes("?") ? "&" : "?"}project=${encodeURIComponent(id)}${hash}`;
  }, [basePath]);
  const pathFor = useCallback((path: string) => projectPathFor(projectId, path), [projectId, projectPathFor]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        const savedStrategy = window.localStorage.getItem(STRATEGY_PREFERENCE_KEY);
        if (savedStrategy === "mobile" || savedStrategy === "desktop") {
          setPreferredStrategyState(savedStrategy);
          setStrategy(savedStrategy);
        }
        const savedInboxDescriptions = window.localStorage.getItem(INBOX_DESCRIPTIONS_PREFERENCE_KEY);
        if (savedInboxDescriptions === "show" || savedInboxDescriptions === "hide") {
          setInboxDescriptionsState(savedInboxDescriptions);
        }
        const savedTaskDescriptions = window.localStorage.getItem(TASK_DESCRIPTIONS_PREFERENCE_KEY);
        if (savedTaskDescriptions === "show" || savedTaskDescriptions === "hide") {
          setTaskDescriptionsState(savedTaskDescriptions);
        }
        const savedAppearance = window.localStorage.getItem(APPEARANCE_STORAGE_KEY);
        if (isAppearance(savedAppearance)) setAppearanceState(savedAppearance);
      } catch {
        // Browser storage can be disabled; desktop remains a safe default.
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

  const setAppearance = useCallback((next: Appearance) => {
    setAppearanceState(next);
    try {
      window.localStorage.setItem(APPEARANCE_STORAGE_KEY, next);
    } catch {
      // The preference still applies for the current session.
    }
  }, []);

  /**
   * Keep `data-surface` in step with the preference.
   *
   * The pre-paint script in (app)/layout.tsx sets this attribute before first
   * paint; this effect owns it from then on. Under "auto" it also subscribes to
   * the device setting, so a system theme change is followed live rather than
   * only on the next reload.
   */
  useEffect(() => {
    const query = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      document.documentElement.setAttribute("data-surface", resolveSurface(appearance, query.matches));
    };
    apply();
    if (appearance !== "auto") return;
    query.addEventListener("change", apply);
    return () => query.removeEventListener("change", apply);
  }, [appearance]);

  const setRangeDays = useCallback((next: RangeDays) => setRangeDaysState(next), []);

  const setInboxDescriptions = useCallback((next: "show" | "hide") => {
    setInboxDescriptionsState(next);
    try {
      window.localStorage.setItem(INBOX_DESCRIPTIONS_PREFERENCE_KEY, next);
    } catch {
      // The preference still applies for the current session.
    }
  }, []);

  const setTaskDescriptions = useCallback((next: "show" | "hide") => {
    setTaskDescriptionsState(next);
    try {
      window.localStorage.setItem(TASK_DESCRIPTIONS_PREFERENCE_KEY, next);
    } catch {
      // The preference still applies for the current session.
    }
  }, []);

  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flash = useCallback((msg: string) => {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2800);
  }, []);
  useEffect(() => () => { if (toastTimer.current) clearTimeout(toastTimer.current); }, []);

  const switchProject = useCallback(async (nextId: string): Promise<boolean> => {
    if (nextId === projectId || projectSwitching || !projects.some(({ id }) => id === nextId)) return false;
    setProjectSwitching(true);
    setModal(null);
    setReport(null);
    setToast(null);
    // Prevent an older mutation response from reconciling over the next project.
    mutationSequenceRef.current += 1;
    try {
      const response = await fetch(projectPathFor(nextId, "/api/state"), { cache: "no-store" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const body = (await response.json().catch(() => null)) as {
        state?: AppState;
        visitorExperience?: CruxPageEvidence[];
        externalAgentAudits?: ExternalAgentOriginAudit[];
      } | null;
      if (!body?.state) throw new Error("Project state unavailable");
      apply(body.state);
      setVisitorExperience(body.visitorExperience ?? []);
      setExternalAgentAudits(body.externalAgentAudits ?? []);
      setProjectId(nextId);
      try {
        window.localStorage.setItem(LAST_PROJECT_KEY, nextId);
      } catch {
        // The selected project still applies for this session.
      }
      return true;
    } catch {
      flash("Couldn't switch projects — try again");
      return false;
    } finally {
      setProjectSwitching(false);
    }
  }, [apply, flash, projectId, projectPathFor, projectSwitching, projects]);

  const createProject = useCallback(async (name: string, customer?: string): Promise<Project | null> => {
    if (!user.isAppAdmin) {
      flash("App administrator access is required");
      return null;
    }
    if (projectCreating) return null;
    setProjectCreating(true);
    try {
      const response = await fetch(pathFor("/api/admin/projects"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, customer }),
      });
      const body = (await response.json().catch(() => null)) as {
        project?: Project;
        projects?: Project[];
        adminProjects?: Project[];
        error?: string;
      } | null;
      if (!response.ok || !body?.project || !body.projects || !body.adminProjects) {
        throw new Error(body?.error || `HTTP ${response.status}`);
      }
      setProjects(body.projects);
      setAdminProjects(body.adminProjects);
      flash(`${body.project.name} created`);
      return body.project;
    } catch (error) {
      flash(error instanceof Error ? error.message : "Couldn't create the project");
      return null;
    } finally {
      setProjectCreating(false);
    }
  }, [flash, pathFor, projectCreating, user.isAppAdmin]);

  const updateProject = useCallback(async (
    id: string,
    action: "rename" | "archive" | "restore",
    name?: string,
    customer?: string,
  ): Promise<boolean> => {
    if (!user.isAppAdmin) {
      flash("App administrator access is required");
      return false;
    }
    if (projectUpdating) return false;
    setProjectUpdating(true);
    try {
      const response = await fetch(pathFor("/api/admin/projects"), {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id, action, ...(name !== undefined ? { name } : {}), ...(customer !== undefined ? { customer } : {}) }),
      });
      const body = (await response.json().catch(() => null)) as {
        project?: Project;
        projects?: Project[];
        adminProjects?: Project[];
        error?: string;
      } | null;
      if (!response.ok || !body?.project || !body.projects || !body.adminProjects) {
        throw new Error(body?.error || `HTTP ${response.status}`);
      }
      if (action === "archive" && id === projectId) {
        window.location.reload();
        return true;
      }
      setProjects(body.projects);
      setAdminProjects(body.adminProjects);
      const verb = action === "rename" ? "renamed" : action === "archive" ? "archived" : "restored";
      flash(`${body.project.name} ${verb}`);
      return true;
    } catch (error) {
      flash(error instanceof Error ? error.message : `Couldn't ${action} the project`);
      return false;
    } finally {
      setProjectUpdating(false);
    }
  }, [flash, pathFor, projectId, projectUpdating, user.isAppAdmin]);

  const renameProject = useCallback((id: string, name: string, customer?: string) => updateProject(id, "rename", name, customer), [updateProject]);
  const archiveProject = useCallback((id: string) => updateProject(id, "archive"), [updateProject]);
  const restoreProject = useCallback((id: string) => updateProject(id, "restore"), [updateProject]);

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
      onVisitorExperience: setVisitorExperience,
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
      if (!canManageProject) {
        flash("Viewer access is read-only");
        return;
      }
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
    [apply, canManageProject, flash, pathFor],
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
        { ...cur, watcherNote: undefined, pages: changePageFlagOrder(cur.pages, id, flag) },
        { url: `/api/pages/${id}/flag`, body: { flag } },
        { failure: "Couldn't update the monitoring status — check the limits and try again" },
      );
    },
    [flash, mutate],
  );

  const reorderPages = useCallback(
    (pageIds: string[]) => {
      const cur = dataRef.current;
      let pages: AppState["pages"];
      try {
        pages = applyWatchlistPageOrder(cur.pages, pageIds);
      } catch {
        flash("Couldn't reorder the pages — refresh and try again");
        return;
      }
      if (pages.every((page, index) => page.id === cur.pages[index]?.id)) return;
      mutate(
        { ...cur, watcherNote: undefined, pages },
        { url: "/api/pages/order", body: { pageIds: pages.map((page) => page.id) } },
        {
          success: "Page order updated",
          failure: "Couldn't save the page order — refresh and try again",
        },
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

  const setNativeElementApplicability = useCallback(
    (id: string, findingId: string, reason: ExclusionReason | null) => {
      const cur = dataRef.current;
      const updatedAt = new Date().toISOString();
      mutate(
        {
          ...cur,
          watcherNote: undefined,
          pages: cur.pages.map((page) => {
            if (page.id !== id) return page;
            // Same rule as the server mutation: applicability only. The
            // record's status is the lifecycle's business, and this is not it.
            const controls = normalizeNativeElementControls(page.nativeElementControls);
            const dismissed = controls[findingId]?.dismissed ? { dismissed: true } : {};
            if (reason === null) {
              if (controls[findingId]?.dismissed) controls[findingId] = { dismissed: true, updatedAt };
              else delete controls[findingId];
            } else {
              controls[findingId] = { ...dismissed, excluded: { reason }, updatedAt };
            }
            return { ...page, nativeElementControls: controls };
          }),
        },
        { url: `/api/pages/${id}/native-elements`, body: { findingId, reason } },
        {
          success: reason
            ? `${APPLICABILITY_LABEL.excluded} — ${reason}`
            : `${APPLICABILITY_LABEL.included} again`,
          failure: "Couldn't update the native-element finding — try again",
        },
      );
    },
    [mutate],
  );

  /**
   * Keep one decision about a remediation.
   *
   * Optimistically appended in the same shape the server will store, so the
   * case re-derives with the decision applied on the next render rather than
   * waiting for the round trip — and reverts with everything else if the write
   * fails, because a decision that reports success it did not have is the exact
   * failure the control was withheld to avoid.
   *
   * The local stamp is a prediction. The authoritative state that comes back
   * carries the server's, which is the one that persists.
   */
  const recordCaseDecision = useCallback(
    (decision: CaseDecisionRequest) => {
      const cur = dataRef.current;
      const optimistic: CaseDecision = { ...decision, at: new Date().toISOString(), actor: "person" };
      mutate(
        { ...cur, caseDecisions: [...(cur.caseDecisions ?? []), optimistic] },
        { url: "/api/decisions", body: decision },
        {
          success: decision.decision === "exclude"
            ? `${APPLICABILITY_LABEL.excluded} — ${decision.reason}`
            : decision.decision === "include"
              ? `${APPLICABILITY_LABEL.included} again`
              : ISSUE_ACTION_LABEL[decision.decision],
          failure: "Couldn't keep that decision — try again",
        },
      );
    },
    [mutate],
  );

  const updatePerformanceThresholds = useCallback(
    (thresholds: PerformanceThresholds) => {
      const cur = dataRef.current;
      const next = normalizePerformanceThresholds(thresholds);
      mutate(
        {
          ...cur,
          performanceThresholds: next,
          watcherNote: undefined,
        },
        { url: "/api/settings/performance-thresholds", body: next },
        {
          success: "Performance tolerances updated",
          failure: "Couldn't update the performance tolerances — try again",
        },
      );
    },
    [mutate],
  );

  const updatePagePerformanceThresholds = useCallback(
    (id: string, overrides: PagePerformanceThresholdOverrides) => {
      const cur = dataRef.current;
      const normalized = normalizePerformanceThresholdOverrides(overrides);
      mutate(
        {
          ...cur,
          watcherNote: undefined,
          pages: cur.pages.map((page) => page.id === id ? {
            ...page,
            performanceThresholdOverrides: normalized,
            status: pageTrend(page, "mobile", effectivePerformanceThresholds(cur.performanceThresholds, normalized)),
          } : page),
        },
        { url: `/api/pages/${id}/performance-thresholds`, body: normalized },
        {
          success: Object.keys(normalized).length ? "Page calibration saved" : "Page calibration reset to team defaults",
          failure: "Couldn't update the page calibration — try again",
        },
      );
    },
    [mutate],
  );

  const updateCollectionSchedule = useCallback(
    (schedule: CollectionSchedule) => {
      const cur = dataRef.current;
      mutate(
        {
          ...cur,
          collectionSchedule: schedule,
          pages: cur.pages.map((page) => ({ ...page, lastScheduledAt: new Date().toISOString() })),
        },
        { url: "/api/settings/collection-schedule", body: schedule },
        {
          success: "Default collection time updated",
          failure: "Couldn't update the collection schedule — try again",
        },
      );
    },
    [mutate],
  );

  const updateAlertWebhookUrl = useCallback(
    (url: string) => {
      const cur = dataRef.current;
      const normalized = url.trim();
      mutate(
        { ...cur, alertWebhookUrl: normalized || null },
        { url: "/api/settings/alert-webhook", body: { url: normalized } },
        {
          success: normalized ? "Alert webhook updated" : "Alert webhook disabled",
          failure: "Couldn't update the alert webhook — check the URL and try again",
        },
      );
    },
    [mutate],
  );

  const [externalAgentAuditRefreshing, setExternalAgentAuditRefreshing] = useState(false);

  /**
   * Ask the collector for a fresh external audit, then re-read the audits.
   * This is not an AppState mutation: provider evidence lives beside the state,
   * so nothing is applied optimistically and no local reading is invented.
   */
  const refreshExternalAgentAudit = useCallback(
    (pageId: string) => {
      setExternalAgentAuditRefreshing(true);
      void (async () => {
        try {
          const response = await fetch(pathFor("/api/agent-audits/refresh"), {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ pageId }),
            cache: "no-store",
          });
          const body = (await response.json().catch(() => null)) as {
            refusedReason?: string;
            results?: Array<{ status?: string; errorCode?: string }>;
            code?: string;
          } | null;
          if (!response.ok) {
            flash(
              body?.refusedReason === "not-consented"
                ? "Enable external agent audits in Watch List settings first"
                : body?.code === "ORA_SCAN_DISABLED"
                  ? "External agent scanning is turned off for this deployment"
                  : "Couldn't refresh the external audit — try again",
            );
            return;
          }
          const outcome = body?.results?.[0]?.status;
          flash(
            outcome === "available" ? "External audit updated"
              : outcome === "pending" ? "The provider is still finishing this audit"
                : outcome === "rate-limited" ? "Provider limit reached — the last audit is unchanged"
                  : outcome === "skipped" ? "An audit for this origin is already in progress"
                    : "The provider could not complete the audit — the last audit is unchanged",
          );
          const state = await fetch(pathFor("/api/state"), { cache: "no-store" });
          const payload = (await state.json().catch(() => null)) as {
            externalAgentAudits?: ExternalAgentOriginAudit[];
          } | null;
          if (payload?.externalAgentAudits) setExternalAgentAudits(payload.externalAgentAudits);
        } catch {
          flash("Couldn't refresh the external audit — try again");
        } finally {
          setExternalAgentAuditRefreshing(false);
        }
      })();
    },
    [flash, pathFor],
  );

  const verifyAgentIssueTask = useCallback(
    (recKey: string) => {
      void (async () => {
        try {
          const response = await fetch(pathFor("/api/agent-audits/verify"), {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ recKey }),
            cache: "no-store",
          });
          const body = (await response.json().catch(() => null)) as {
            status?: string;
            refusedReason?: string;
            code?: string;
          } | null;
          if (!response.ok && !body?.status) {
            // A provider that cannot answer leaves the task verifying. Say so
            // plainly rather than implying the fix failed.
            flash(
              body?.refusedReason === "not-consented"
                ? "Enable external agent audits to verify this fix automatically"
                : body?.code === "ORA_SCAN_DISABLED"
                  ? "External verification is turned off for this deployment"
                  : "Couldn't reach the provider — this fix stays unverified",
            );
            return;
          }
          flash(
            body?.status === "resolved" ? "Provider re-check passed — issue resolved"
              : body?.status === "returned" ? "Provider re-check still failing — issue returned to open work"
                : "Provider could not confirm yet — still verifying",
          );
          const state = await fetch(pathFor("/api/state"), { cache: "no-store" });
          const payload = (await state.json().catch(() => null)) as { state?: AppState } | null;
          if (payload?.state) apply(normalizeState(payload.state));
        } catch {
          flash("Couldn't reach the provider — this fix stays unverified");
        }
      })();
    },
    [apply, flash, pathFor],
  );

  const addAgentIssueTask = useCallback(
    (pageId: string, caseKey: string) => {
      // No optimistic apply: the server re-assembles the case from stored
      // evidence, so the authoritative task is whatever it returns.
      void (async () => {
        try {
          const response = await fetch(pathFor(`/api/pages/${encodeURIComponent(pageId)}/agent-issues`), {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ caseKey }),
            cache: "no-store",
          });
          const body = (await response.json().catch(() => null)) as { state?: AppState } | null;
          if (!response.ok || !body?.state) {
            flash("Couldn't add this to Tasks — try again");
            return;
          }
          apply(normalizeState(body.state));
          flash("Added to Tasks with its verification target");
        } catch {
          flash("Couldn't add this to Tasks — try again");
        }
      })();
    },
    [apply, flash, pathFor],
  );

  const setExternalAgentAuditEnabled = useCallback(
    (enabled: boolean) => {
      const cur = dataRef.current;
      mutate(
        { ...cur, externalAgentAuditEnabled: enabled },
        { url: "/api/settings/agent-audits", body: { enabled } },
        {
          success: enabled
            ? "External agent audits enabled for this project"
            : "External agent audits turned off",
          failure: "Couldn't update external agent audits — try again",
        },
      );
    },
    [mutate],
  );

  const setVisitorExperienceVisible = useCallback(
    (visible: boolean) => {
      const cur = dataRef.current;
      mutate(
        { ...cur, visitorExperienceVisible: visible },
        { url: "/api/settings/visitor-experience", body: { visible } },
        {
          success: `Visitor experience data ${visible ? "shown" : "hidden"}`,
          failure: "Couldn't update visitor experience visibility — try again",
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

  const triageRec = useCallback(
    (key: string) => {
      saveTask(key);
    },
    [saveTask],
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
      const date = localISODate();
      if (to === "done") {
        const text = taskMarkerText(rec.title);
        // Completing a task logs a change marker + schedules follow-ups, so it
        // goes through the marker route (sequential storage, REQ-043/044).
        mutate(
          {
            ...cur,
            recs: cur.recs.map((r) => (r.key === key ? { ...r, taskStatus: "done", doneDate: date } : r)),
            pages: cur.pages.map((p) =>
              p.id === rec.pageId ? { ...p, markers: [...(p.markers || []), { id: crypto.randomUUID(), i: p.history.length - 1, date, text, source: "task", recKey: key }] } : p,
            ),
          },
          { url: `/api/pages/${rec.pageId}/markers`, body: { text, date, recKey: key, taskStatus: "done" } },
          { success: `Task completed — change marker logged on ${rec.pageTitle}`, failure: "Couldn't complete the task — try again" },
        );
        // Marker-triggered verification. The existing change marker and the
        // 2/7/30-day follow-ups above are untouched; this only adds the
        // provider re-check of the ids this task recorded.
        if (rec.source === "agent-readiness" && (rec.agentIssue?.verificationCheckIds.length ?? 0) > 0) {
          verifyAgentIssueTask(key);
        }
      } else {
        const optimistic = structuredClone(cur);
        const optimisticRec = optimistic.recs.find((item) => item.key === key);
        if (!optimisticRec) return;
        optimisticRec.taskStatus = to;
        optimisticRec.doneDate = null;
        removeTaskMarker(optimistic, optimisticRec);
        mutate(
          optimistic,
          { url: `/api/recs`, body: { key, action: "advance", to } },
          { success: to === "in-progress" ? "Task moved to In progress" : "Task moved back to To do", failure: "Couldn't move the task — try again" },
        );
      }
    },
    [mutate, verifyAgentIssueTask],
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
    let timeZone = "UTC";
    try {
      timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    } catch {
      // UTC remains a valid fallback if the browser cannot resolve its zone.
    }
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
      {
        url: `/api/pages`,
        body: { title: f.title.trim(), url: f.url.trim(), timeZone },
      },
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
    const date = markerDate.trim() || localISODate();
    const cur = dataRef.current;
    setModal(null);
    if (markerEditingId) {
      mutate(
        {
          ...cur,
          pages: cur.pages.map((p) => p.id === id
            ? { ...p, markers: p.markers.map((marker) => marker.id === markerEditingId ? { ...marker, text: markerText.trim(), date } : marker) }
            : p),
        },
        { url: `/api/pages/${id}/markers`, method: "PATCH", body: { markerId: markerEditingId, text: markerText.trim(), date } },
        { success: "Marker updated", failure: "Couldn't update the marker — try again" },
      );
      return;
    }
    mutate(
      {
        ...cur,
        pages: cur.pages.map((p) => (p.id === id ? { ...p, markers: [...(p.markers || []), { id: crypto.randomUUID(), i: p.history.length - 1, date, text: markerText.trim(), source: "custom" }] } : p)),
      },
      { url: `/api/pages/${id}/markers`, body: { text: markerText.trim(), date } },
      { success: "Marker logged — 2, 7 & 30-day Slack reports scheduled", failure: "Couldn't log the marker — try again" },
    );
  }, [markerText, markerDate, markerPageId, markerEditingId, mutate, flash]);

  const deleteMarker = useCallback(() => {
    const pageId = markerPageId;
    const markerId = markerEditingId;
    if (!pageId || !markerId) return;
    const cur = dataRef.current;
    setModal(null);
    mutate(
      {
        ...cur,
        pages: cur.pages.map((page) => page.id === pageId
          ? { ...page, markers: page.markers.filter((marker) => marker.id !== markerId) }
          : page),
        followUps: (cur.followUps ?? []).filter((followUp) => followUp.markerId !== markerId),
      },
      { url: `/api/pages/${pageId}/markers`, method: "DELETE", body: { markerId } },
      { success: "Marker deleted", failure: "Couldn't delete the marker — try again" },
    );
  }, [markerPageId, markerEditingId, mutate]);

  const runPage = useCallback(
    (id: string) => {
      if (!canManageProject) {
        flash("Viewer access is read-only");
        return;
      }
      const cur = dataRef.current;
      const p = cur.pages.find((x) => x.id === id);
      const title = p?.title ?? "this page";
      flash(`Starting run for ${title}…`);
      fetch(pathFor(`/api/pages/${id}/run`), { method: "POST" })
        .then(async (r) => {
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          const res = (await r.json().catch(() => null)) as CollectionRequestResult | null;
          if (res?.state) apply(res.state);
          if (res) flash(collectionRequestMessage(title, "run", res));
        })
        .catch(() => flash("Couldn't start the run — try again"));
    },
    [flash, apply, pathFor, canManageProject],
  );

  const captureBaseline = useCallback(
    (id: string) => {
      if (!canManageProject) {
        flash("Viewer access is read-only");
        return;
      }
      const page = dataRef.current.pages.find((item) => item.id === id);
      const title = page?.title ?? "this page";
      flash(`Starting baseline for ${title}…`);
      fetch(pathFor(`/api/pages/${id}/baseline`), { method: "POST" })
        .then(async (r) => {
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          const res = (await r.json().catch(() => null)) as CollectionRequestResult | null;
          if (res?.state) apply(res.state);
          if (res) flash(collectionRequestMessage(title, "baseline", res));
        })
        .catch(() => flash("Baseline capture failed"));
    },
    [flash, apply, pathFor, canManageProject],
  );

  const sortDash = useCallback((col: string) => setDashSort((p) => toggleSort(p, col)), []);
  const sortInbox = useCallback((col: string) => setInboxSort((p) => toggleSort(p, col)), []);
  const sortTask = useCallback((col: string) => setTaskSort((p) => toggleSort(p, col)), []);
  const openAdd = useCallback(() => {
    if (!canManageProject) {
      flash("Viewer access is read-only");
      return;
    }
    setFormState({ title: "", url: "" });
    setModal("add");
  }, [canManageProject, flash]);
  const openMarker = useCallback((pageId: string) => {
    if (!canManageProject) {
      flash("Viewer access is read-only");
      return;
    }
    setMarkerPageId(pageId);
    setMarkerEditingId(null);
    setMarkerText("");
    setMarkerDate(localISODate());
    setModal("marker");
  }, [canManageProject, flash]);
  const editMarker = useCallback((pageId: string, markerId: string) => {
    const marker = dataRef.current.pages.find((page) => page.id === pageId)?.markers.find((item) => item.id === markerId);
    if (!marker || isTaskMarker(marker)) return;
    setMarkerPageId(pageId);
    setMarkerEditingId(markerId);
    setMarkerText(marker.text);
    setMarkerDate(marker.date);
    setModal("marker");
  }, []);
  const closeModal = useCallback(() => setModal(null), []);
  const openReport = useCallback((r: ReportData) => {
    setReport(r);
    setModal("report");
  }, []);

  const value: StoreValue = {
    ...data,
    user,
    canManageProject,
    visitorExperience,
    externalAgentAudits,
    basePath,
    pathFor,
    projects,
    adminProjects,
    project,
    projectSwitching,
    switchProject,
    projectCreating,
    createProject,
    projectUpdating,
    renameProject,
    archiveProject,
    restoreProject,
    strategy,
    setStrategy,
    appearance,
    setAppearance,
    preferredStrategy,
    setPreferredStrategy,
    rangeDays,
    setRangeDays,
    dashSort,
    sortDash,
    inboxGroup,
    setInboxGroup,
    inboxDescriptions,
    setInboxDescriptions,
    inboxSort,
    sortInbox,
    taskGroup,
    setTaskGroup,
    taskDescriptions,
    setTaskDescriptions,
    taskView,
    setTaskView,
    taskSort,
    sortTask,
    chartCat,
    setChartCat,
    modal,
    markerPageId,
    markerEditingId,
    openAdd,
    openMarker,
    editMarker,
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
    reorderPages,
    renamePage,
    setAgentIgnore,
    setDefaultAgentIgnore,
    setNativeElementApplicability,
    recordCaseDecision,
    updatePerformanceThresholds,
    updatePagePerformanceThresholds,
    updateCollectionSchedule,
    setExternalAgentAuditEnabled,
    refreshExternalAgentAudit,
    addAgentIssueTask,
    verifyAgentIssueTask,
    externalAgentAuditRefreshing,
    updateAlertWebhookUrl,
    setVisitorExperienceVisible,
    removePage,
    saveTask,
    triageRec,
    ignoreRec,
    advanceTask,
    submitAdd,
    submitMarker,
    deleteMarker,
    runPage,
    captureBaseline,
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export { CAT_KEYS };

/* ── Issue-list selectors ───────────────────────────────────────────────── */

/**
 * Everything the issues list reads, derived in one place.
 *
 * The rule these exist to keep is that queue membership is never stored and
 * never worked out locally. `queueOf` in `issue-case.ts` owns it, so the header
 * sentence, the tab badges and the rows below them are three readings of one
 * number rather than three numbers that happen to agree today.
 *
 * They are exported as plain functions and consumed by the one hook at the
 * bottom. Nothing here touches React, so the list's behaviour is unit-testable
 * without rendering it.
 */

/**
 * The case derivation moved to `lib/issue-cases.ts` in S7, when the collector
 * started building the digest from it — a Worker cannot reasonably import a
 * `"use client"` module to find out what is open. Re-exported so the list's
 * existing importers keep one name for each.
 */
export { issueCasesFrom, lastRunAtOf };

/**
 * How many cases each counted queue holds.
 *
 * Deliberately partial. `show_all` is the unfiltered view rather than a queue,
 * so the registry marks it uncounted and this never produces a number for it —
 * a badge cannot appear on it by accident, because there is nothing to read.
 */
export type QueueCounts = Partial<Record<Queue, number>>;

export function queueCountsOf(cases: readonly IssueCase[]): QueueCounts {
  const counts: QueueCounts = {};
  for (const queue of COUNTED_QUEUES) counts[queue] = casesInQueue(cases, queue).length;
  return counts;
}

/* ── The low-impact tail ────────────────────────────────────────────────── */

/**
 * The fold moved to `lib/impact-format.ts` in S7, when the digest became a
 * second reader of the project's savings gate. Re-exported so the list's
 * existing importers keep one name for it.
 */
export { partitionByImpact };

/* ── Sorting ────────────────────────────────────────────────────────────── */

export const ISSUE_SORTS = ["impact", "newest", "changed", "effort"] as const;
export type IssueSort = (typeof ISSUE_SORTS)[number];

/** Impact is the default, because it is the only one that ranks by consequence. */
export const DEFAULT_ISSUE_SORT: IssueSort = "impact";

export const ISSUE_SORT_LABEL: Record<IssueSort, string> = {
  impact: "Impact",
  newest: "Newest",
  changed: "What changed",
  effort: "Effort",
};

export function parseIssueSort(value: string | null | undefined): IssueSort {
  return (ISSUE_SORTS as readonly string[]).includes(value ?? "") ? (value as IssueSort) : DEFAULT_ISSUE_SORT;
}

/** Least work first, so a sort by effort surfaces what can be cleared today. */
const EFFORT_ORDER: Record<Effort, number> = { minutes: 0, hours: 1, days: 2, unknown: 3 };

/** The calendar day of an ISO stamp, for comparing a detection to a run. */
const dayOf = (iso: string): string => iso.slice(0, 10);

/**
 * Order the groups, without changing which of them there are.
 *
 * Every comparator is a total order over the same array — sorting is never a
 * filter here, so switching one cannot make a case disappear. "What changed"
 * is the one worth spelling out: it puts the cases the last run detected first
 * and everything else after, still in date order. That is a sort, so the older
 * cases are further down rather than gone.
 */
export function sortRemediationGroups(
  groups: readonly RemediationGroup[],
  sort: IssueSort,
  lastRunAt?: string,
): RemediationGroup[] {
  const lastRunDay = lastRunAt ? dayOf(lastRunAt) : undefined;
  const inLastRun = (group: RemediationGroup): number =>
    lastRunDay && group.detectedAt && dayOf(group.detectedAt) >= lastRunDay ? 0 : 1;

  const byNewest = (a: RemediationGroup, b: RemediationGroup) => b.detectedAt.localeCompare(a.detectedAt);
  // The id tie-break keeps the order stable when the sort key matches, so a
  // re-render never reshuffles equal rows.
  const byId = (a: RemediationGroup, b: RemediationGroup) => a.primary.id.localeCompare(b.primary.id);

  // Wherever impact is the ranking key, `byWorstMeasured` applies rule 18: the
  // unmeasured groups move to the end of the band as a block instead of being
  // ordered by a zero they never measured. Newest and What changed rank on a
  // date every case carries, so no measurement stands in for a missing one.
  const compare: Record<IssueSort, (a: RemediationGroup, b: RemediationGroup) => number> = {
    impact: (a, b) => byWorstMeasured(a, b) || byNewest(a, b) || byId(a, b),
    newest: (a, b) => byNewest(a, b) || byId(a, b),
    changed: (a, b) => inLastRun(a) - inLastRun(b) || byNewest(a, b) || byId(a, b),
    effort: (a, b) => EFFORT_ORDER[a.effort] - EFFORT_ORDER[b.effort] || byWorstMeasured(a, b) || byId(a, b),
  };

  return [...groups].sort(compare[sort]);
}

/* ── The hook the list uses ─────────────────────────────────────────────── */

export interface IssuesView {
  /** Every case in the project, one per problem. */
  cases: IssueCase[];
  /** Counted queues only. `show_all` is absent by design. */
  counts: QueueCounts;
  /** The cases in the requested queue. */
  inQueue: IssueCase[];
  /** Those of them the list shows as rows, grouped by remediation and sorted. */
  groups: RemediationGroup[];
  /** Those of them the fold holds, grouped the same way and sorted the same way. */
  tail: RemediationGroup[];
  /** The cases behind the fold, for the count it states. */
  tailCases: IssueCase[];
  /** The project's threshold, so the fold can name it. */
  minimumSavingsMs: number;
  /** Page titles by id, for the scope line on a row. */
  pageTitles: Record<string, string>;
  lastRunAt?: string;
}

/**
 * One derivation of the issues list, memoised on the store's state.
 *
 * The queue and the sort come from the URL rather than from here: both are
 * things a person should be able to link someone to, and neither is a
 * preference worth persisting.
 */
export function useIssuesView(queue: Queue, sort: IssueSort): IssuesView {
  const { recs, pages, performanceThresholds, caseDecisions } = useStore();
  return useMemo(() => {
    // The decisions log is part of the derivation's input, not a filter applied
    // after it: what someone decided about a remediation changes which queue
    // its cases are in, so the counts and the rows have to be read from the
    // same pass or the badge and the list disagree.
    const cases = issueCasesFrom({ recs, pages, caseDecisions });
    const lastRunAt = lastRunAtOf(pages);
    const at = lastRunAt ? { at: lastRunAt } : {};
    const { minimumSavingsMs } = normalizePerformanceThresholds(performanceThresholds);
    const inQueue = casesInQueue(cases, queue);
    const { inline, tail } = partitionByImpact(inQueue, minimumSavingsMs);
    return {
      cases,
      counts: queueCountsOf(cases),
      inQueue,
      groups: sortRemediationGroups(groupByRemediation(inline, at), sort, lastRunAt),
      tail: sortRemediationGroups(groupByRemediation(tail, at), sort, lastRunAt),
      tailCases: tail,
      minimumSavingsMs,
      pageTitles: Object.fromEntries(pages.map((page) => [page.id, page.title])),
      lastRunAt,
    };
  }, [recs, pages, caseDecisions, performanceThresholds, queue, sort]);
}
