"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { DotsSixVerticalIcon, Info } from "@phosphor-icons/react";
import { useStore } from "@/components/store";
import { AGENT_CHECK_GROUPS, ALL_AGENT_CHECKS } from "@/lib/agentChecks";
import { agentCheckKey, isAgentCheckIgnored, isAgentGroupIgnored, normalizeAgentIgnoreSettings } from "@/lib/agentScoring";
import { DEFAULT_PERFORMANCE_THRESHOLDS, normalizePerformanceThresholds, PERFORMANCE_THRESHOLD_LIMITS } from "@/lib/performanceThresholds";
import type { DevicePolicy, PerformanceThresholds } from "@/lib/types";
import { normalizeCollectionSchedule } from "@/lib/collectionSchedule";
import { C, flagChip, naturalDate } from "@/lib/ui";
import { SegToggle } from "@/components/bits";
import { ChevronDownIcon, PlusIcon, TrashIcon } from "@/components/icons";
import { flagCapacityError, MAX_ACTIVE_PAGES, MAX_PRIORITY_PAGES, watchCapacity } from "@/lib/watchCapacity";
import { movePageWithinFlag, reorderPageWithinFlag, sortWatchlistPages } from "@/lib/watchlistOrder";
import { failedRunLabel } from "@/lib/collectionStatus";

const GRID = "32px minmax(228px,2.4fr) 230px 1fr 120px";
const PRIORITY_CHIP = flagChip("priority");
const PAUSED_CHIP = flagChip("paused");
type NumericToleranceKey = keyof typeof PERFORMANCE_THRESHOLD_LIMITS;
type WatchlistDropTarget = { pageId: string; position: "before" | "after" };
const NUMERIC_TOLERANCE_KEYS = Object.keys(PERFORMANCE_THRESHOLD_LIMITS) as NumericToleranceKey[];

function EditablePageTitle({
  pageId,
  title,
  onSave,
}: {
  pageId: string;
  title: string;
  onSave: (id: string, title: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(title);
  const cancelPending = useRef(false);

  const beginEdit = () => {
    cancelPending.current = false;
    setDraft(title);
    setEditing(true);
  };

  const finishEdit = () => {
    if (cancelPending.current) {
      cancelPending.current = false;
      return;
    }
    const next = draft.trim();
    setEditing(false);
    if (next && next !== title) onSave(pageId, next);
    else setDraft(title);
  };

  if (editing) {
    return (
      <input
        aria-label={`Page name for ${title}`}
        value={draft}
        maxLength={120}
        autoFocus
        onFocus={(event) => event.currentTarget.select()}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={finishEdit}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            event.currentTarget.blur();
          } else if (event.key === "Escape") {
            event.preventDefault();
            cancelPending.current = true;
            setDraft(title);
            setEditing(false);
          }
        }}
        style={{
          width: "100%",
          margin: "-5px -8px",
          padding: "4px 7px",
          border: `1px solid ${C.accent}`,
          borderRadius: 5,
          outline: "none",
          background: C.bgElev,
          boxShadow: "0 0 0 2px rgba(20,110,245,0.18)",
          color: C.text,
          font: "inherit",
          fontSize: 14,
          fontWeight: 600,
        }}
      />
    );
  }

  return (
    <button
      type="button"
      aria-label={`Edit page name: ${title}`}
      title="Click to edit page name"
      onClick={beginEdit}
      style={{
        display: "block",
        width: "100%",
        overflow: "hidden",
        padding: 0,
        border: "none",
        background: "transparent",
        color: C.text,
        fontSize: 14,
        fontWeight: 600,
        lineHeight: "normal",
        textAlign: "left",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
        cursor: "text",
      }}
    >
      {title}
    </button>
  );
}

function SettingTooltip({ id, label, help }: { id: string; label: string; help: string }) {
  return (
    <span className="setting-tooltip">
      <button
        type="button"
        className="setting-tooltip-trigger"
        aria-label={`About ${label}`}
        aria-describedby={id}
      >
        <Info size={13} weight="bold" />
      </button>
      <span className="setting-tooltip-content" id={id} role="tooltip">
        {help}
      </span>
    </span>
  );
}

function SettingHeader({
  id,
  label,
  help,
  resetDisabled,
  onReset,
}: {
  id: string;
  label: string;
  help: string;
  resetDisabled: boolean;
  onReset: () => void;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", minWidth: 0, gap: 6 }}>
      <span id={`${id}-label`} style={{ minWidth: 0, color: C.text, fontSize: 13, fontWeight: 600 }}>
        {label}
      </span>
      <SettingTooltip id={`${id}-help`} label={label} help={help} />
      <button
        type="button"
        className="setting-reset-button"
        aria-label={`Reset ${label} to its team default`}
        disabled={resetDisabled}
        onClick={onReset}
      >
        Reset
      </button>
    </div>
  );
}

function NumberStepper({
  id,
  ariaLabel,
  value,
  min,
  max,
  suffix,
  onChange,
}: {
  id: string;
  ariaLabel: string;
  value: string;
  min: number;
  max: number;
  suffix: string;
  onChange: (value: string) => void;
}) {
  const stepValue = (amount: number) => {
    const parsed = Number(value);
    const current = Number.isFinite(parsed) ? parsed : min;
    onChange(String(Math.max(min, Math.min(max, current + amount))));
  };

  return (
    <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <span className="tolerance-stepper" style={{ position: "relative", display: "inline-flex", width: 92, height: 36 }}>
        <input
          className="tolerance-number-input"
          id={id}
          type="number"
          inputMode="numeric"
          value={value}
          min={min}
          max={max}
          step={1}
          aria-label={ariaLabel}
          onChange={(event) => onChange(event.target.value)}
          style={{
            width: "100%",
            height: "100%",
            padding: "0 38px 0 10px",
            border: `1px solid ${C.border2}`,
            borderRadius: 7,
            background: C.bgElev,
            color: C.text,
            font: "inherit",
            fontSize: 14,
            fontWeight: 600,
            textAlign: "right",
          }}
        />
        <span
          style={{
            position: "absolute",
            top: 1,
            right: 1,
            bottom: 1,
            display: "grid",
            width: 28,
            gridTemplateRows: "1fr 1fr",
            borderLeft: `1px solid ${C.border2}`,
            borderRadius: "0 6px 6px 0",
            overflow: "hidden",
          }}
        >
          <button
            className="tolerance-stepper-button"
            type="button"
            aria-label={`Increase ${ariaLabel}`}
            aria-controls={id}
            disabled={Number(value) >= max}
            onClick={() => stepValue(1)}
          >
            <ChevronDownIcon size={10} style={{ transform: "rotate(180deg)" }} />
          </button>
          <button
            className="tolerance-stepper-button"
            type="button"
            aria-label={`Decrease ${ariaLabel}`}
            aria-controls={id}
            disabled={Number(value) <= min}
            onClick={() => stepValue(-1)}
          >
            <ChevronDownIcon size={10} />
          </button>
        </span>
      </span>
      <span style={{ minWidth: 40, color: C.faint2, fontSize: 11.5 }}>{suffix}</span>
    </span>
  );
}

function ToleranceField({
  id,
  label,
  help,
  value,
  defaultValue,
  min,
  max,
  suffix,
  onChange,
  onReset,
  wide = false,
}: {
  id: string;
  label: string;
  help: string;
  value: string;
  defaultValue: number;
  min: number;
  max: number;
  suffix: string;
  onChange: (value: string) => void;
  onReset: () => void;
  wide?: boolean;
}) {
  return (
    <div className={`watchlist-setting-card${wide ? " watchlist-setting-card--wide" : ""}`}>
      <SettingHeader
        id={id}
        label={label}
        help={help}
        resetDisabled={value === String(defaultValue)}
        onReset={onReset}
      />
      <NumberStepper
        id={id}
        ariaLabel={label}
        value={value}
        min={min}
        max={max}
        suffix={suffix}
        onChange={onChange}
      />
    </div>
  );
}

function WatchlistContent({ mode }: { mode: "watchlist" | "settings" }) {
  const router = useRouter();
  const {
    pages,
    agentIgnoreDefaults,
    setFlag,
    reorderPages,
    renamePage,
    setDefaultAgentIgnore,
    removePage,
    openAdd,
    pathFor,
    preferredStrategy,
    setPreferredStrategy,
    performanceThresholds,
    updatePerformanceThresholds,
    collectionSchedule,
    updateCollectionSchedule,
    visitorExperienceVisible,
    setVisitorExperienceVisible,
  } = useStore();
  const orderedPages = useMemo(() => sortWatchlistPages(pages), [pages]);
  const defaultIgnores = normalizeAgentIgnoreSettings(agentIgnoreDefaults);
  const thresholds = normalizePerformanceThresholds(performanceThresholds);
  const normalizedSchedule = normalizeCollectionSchedule(collectionSchedule);
  const [collectionTimeDraft, setCollectionTimeDraft] = useState(normalizedSchedule.localTime);
  const [collectionTimeZoneDraft, setCollectionTimeZoneDraft] = useState(normalizedSchedule.timeZone);
  const [timeZones, setTimeZones] = useState<string[]>([]);
  const [thresholdDrafts, setThresholdDrafts] = useState<Record<NumericToleranceKey, string>>(() =>
    Object.fromEntries(NUMERIC_TOLERANCE_KEYS.map((key) => [key, String(thresholds[key])])) as Record<NumericToleranceKey, string>
  );
  const [devicePolicyDraft, setDevicePolicyDraft] = useState<DevicePolicy>(thresholds.devicePolicy);
  const [draggedPageId, setDraggedPageId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<WatchlistDropTarget | null>(null);
  const [keyboardDragPageId, setKeyboardDragPageId] = useState<string | null>(null);
  const [reorderAnnouncement, setReorderAnnouncement] = useState("");
  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (!collectionSchedule) {
        const browserTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
        if (browserTimeZone) setCollectionTimeZoneDraft(browserTimeZone);
      }
      const supportedValuesOf = (
        Intl as typeof Intl & { supportedValuesOf?: (key: "timeZone") => string[] }
      ).supportedValuesOf;
      if (supportedValuesOf) setTimeZones(supportedValuesOf("timeZone"));
    }, 0);
    return () => window.clearTimeout(timer);
  }, [collectionSchedule]);
  const ignoredByDefault = ALL_AGENT_CHECKS.filter((check) => isAgentCheckIgnored(check, undefined, defaultIgnores)).length;
  const capacity = watchCapacity(pages);
  const thresholdValues = Object.fromEntries(
    NUMERIC_TOLERANCE_KEYS.map((key) => [key, Number(thresholdDrafts[key])]),
  ) as Record<NumericToleranceKey, number>;
  const thresholdsValid = NUMERIC_TOLERANCE_KEYS.every((key) => {
    const value = thresholdValues[key];
    const limits = PERFORMANCE_THRESHOLD_LIMITS[key];
    return Number.isInteger(value) && value >= limits.min && value <= limits.max;
  });
  const nextThresholds = {
    ...thresholdValues,
    devicePolicy: devicePolicyDraft,
  } as PerformanceThresholds;
  const thresholdsDirty = thresholdsValid && (
    NUMERIC_TOLERANCE_KEYS.some((key) => thresholdValues[key] !== thresholds[key])
    || devicePolicyDraft !== thresholds.devicePolicy
  );
  const thresholdDraftsAtDefaults = NUMERIC_TOLERANCE_KEYS.every(
    (key) => thresholdDrafts[key] === String(DEFAULT_PERFORMANCE_THRESHOLDS[key]),
  ) && devicePolicyDraft === DEFAULT_PERFORMANCE_THRESHOLDS.devicePolicy;

  const setThresholdDraft = (key: NumericToleranceKey, value: string) => {
    setThresholdDrafts((current) => ({ ...current, [key]: value }));
  };

  const saveThresholds = () => {
    if (!thresholdsValid) return;
    updatePerformanceThresholds(nextThresholds);
  };
  const collectionScheduleDirty =
    collectionTimeDraft !== normalizedSchedule.localTime
    || collectionTimeZoneDraft !== normalizedSchedule.timeZone
    || !normalizedSchedule.overridden;
  const saveCollectionSchedule = () => {
    updateCollectionSchedule({
      localTime: collectionTimeDraft,
      timeZone: collectionTimeZoneDraft,
      overridden: true,
    });
  };

  const resetThresholds = (keys: NumericToleranceKey[]) => {
    setThresholdDrafts((current) => ({
      ...current,
      ...Object.fromEntries(keys.map((key) => [key, String(DEFAULT_PERFORMANCE_THRESHOLDS[key])])),
    }));
  };

  const resetAllThresholds = () => {
    setThresholdDrafts(
      Object.fromEntries(NUMERIC_TOLERANCE_KEYS.map((key) => [key, String(DEFAULT_PERFORMANCE_THRESHOLDS[key])])) as Record<NumericToleranceKey, string>,
    );
    setDevicePolicyDraft(DEFAULT_PERFORMANCE_THRESHOLDS.devicePolicy);
  };

  const persistReorder = (
    pageId: string,
    targetId: string,
    position: WatchlistDropTarget["position"],
  ) => {
    const next = reorderPageWithinFlag(orderedPages, pageId, targetId, position);
    if (next.every((page, index) => page.id === orderedPages[index]?.id)) return false;
    reorderPages(next.map((page) => page.id));
    const movedPage = next.find((page) => page.id === pageId);
    const tier = next.filter((page) => page.flag === movedPage?.flag);
    const tierIndex = tier.findIndex((page) => page.id === pageId);
    setReorderAnnouncement(
      `${movedPage?.title ?? "Page"} moved to position ${tierIndex + 1} of ${tier.length} in ${movedPage?.flag ?? "its group"}.`,
    );
    return true;
  };

  const moveKeyboardPage = (pageId: string, direction: -1 | 1) => {
    const next = movePageWithinFlag(orderedPages, pageId, direction);
    const movedPage = next.find((page) => page.id === pageId);
    const changed = next.some((page, index) => page.id !== orderedPages[index]?.id);
    if (!changed || !movedPage) {
      setReorderAnnouncement(`This page is already at the ${direction < 0 ? "start" : "end"} of its ${movedPage?.flag ?? "current"} group.`);
      return;
    }
    reorderPages(next.map((page) => page.id));
    const tier = next.filter((page) => page.flag === movedPage.flag);
    const tierIndex = tier.findIndex((page) => page.id === pageId);
    setReorderAnnouncement(`${movedPage.title} moved to position ${tierIndex + 1} of ${tier.length} in ${movedPage.flag}.`);
  };

  const dropTargetAtPoint = (pageId: string, x: number, y: number): WatchlistDropTarget | null => {
    const targetRow = document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-watchlist-page]");
    const targetId = targetRow?.dataset.watchlistPage;
    if (!targetRow || !targetId || targetId === pageId) return null;
    const page = orderedPages.find((item) => item.id === pageId);
    const target = orderedPages.find((item) => item.id === targetId);
    if (!page || !target || page.flag !== target.flag) return null;
    const bounds = targetRow.getBoundingClientRect();
    return {
      pageId: targetId,
      position: y < bounds.top + (bounds.height / 2) ? "before" : "after",
    };
  };

  return (
    <div>
      <header style={{ padding: "30px 40px 24px", display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 24 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 27, fontWeight: 600, letterSpacing: "-0.01em" }}>{mode === "watchlist" ? "Watchlist" : "Settings"}</h1>
          <p style={{ margin: "8px 0 0", fontSize: 13.5, color: C.muted }}>
            {mode === "watchlist"
              ? "Priority and Watching pages are monitored nightly. Paused pages keep their history without collecting new data."
              : "Configure how Page Watch displays performance, evaluates changes, schedules collections, and calculates agent-readiness."}
          </p>
        </div>
        {mode === "watchlist" && (
          <button
            onClick={openAdd}
            style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 16px", border: "none", borderRadius: 8, background: C.accent, color: "#fff", fontSize: 13, fontWeight: 550, cursor: "pointer" }}
          >
            <PlusIcon size={15} style={{ color: "#fff" }} />
            Add page
          </button>
        )}
      </header>

      <div style={{ padding: "0 40px 48px" }}>
        {mode === "watchlist" ? (
          <>
        <div style={{ background: C.panel, border: `1px solid ${C.border}`, borderRadius: 14, overflow: "hidden" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 18, padding: "12px 24px", borderBottom: `1px solid ${C.border}`, fontSize: 11.5, color: C.muted }}>
            <span><strong style={{ color: C.text, fontWeight: 600 }}>{capacity.active}/{MAX_ACTIVE_PAGES}</strong> active</span>
            <span><strong style={{ color: C.accentSoft, fontWeight: 600 }}>{capacity.priority}/{MAX_PRIORITY_PAGES}</strong> Priority</span>
            <span><strong style={{ color: C.faint2, fontWeight: 600 }}>{capacity.paused}</strong> Paused</span>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: GRID, alignItems: "center", padding: "14px 24px", borderBottom: `1px solid ${C.border}`, fontSize: 11, fontWeight: 550, letterSpacing: "0.05em", textTransform: "uppercase", color: C.faint }}>
            <div aria-hidden="true" />
            <div>Page</div>
            <div>Flag</div>
            <div>Baseline</div>
            <div style={{ textAlign: "right" }}>Actions</div>
          </div>
          <p id="watchlist-reorder-instructions" className="visually-hidden">
            Drag a page handle to reorder it within its current monitoring group. With the handle focused, press Space or Enter to pick up the page, use the Up and Down arrow keys to move it, then press Space or Enter again to drop it. Press Escape to cancel.
          </p>
          <div className="visually-hidden" aria-live="polite" aria-atomic="true">
            {reorderAnnouncement}
          </div>
          {orderedPages.map((p) => {
            const priorityError = flagCapacityError(pages, p.id, "priority");
            const watchingError = flagCapacityError(pages, p.id, "watching");
            const pauseBlocked = !!p.runState && p.runState !== "failed";
            const keyboardDragging = keyboardDragPageId === p.id;
            const isDropTarget = dropTarget?.pageId === p.id;
            return (
            <div
              key={p.id}
              data-watchlist-page={p.id}
              className={`watchlist-page-row${draggedPageId === p.id ? " is-dragging" : ""}${keyboardDragging ? " is-keyboard-dragging" : ""}${isDropTarget ? ` is-drop-${dropTarget.position}` : ""}`}
              style={{ display: "grid", gridTemplateColumns: GRID, alignItems: "center", padding: "15px 24px", borderBottom: `1px solid ${C.rowBorder}` }}
            >
              <button
                type="button"
                className={`watchlist-drag-handle${keyboardDragging ? " is-grabbed" : ""}`}
                aria-label={`Drag ${p.title} to reorder within ${p.flag}`}
                aria-describedby="watchlist-reorder-instructions"
                aria-pressed={keyboardDragging}
                title={`Drag to reorder within ${p.flag}`}
                onMouseDown={(event) => {
                  if (event.button !== 0) return;
                  event.preventDefault();
                  event.currentTarget.focus();
                  setKeyboardDragPageId(null);
                  setDraggedPageId(p.id);
                  setDropTarget(null);
                  setReorderAnnouncement(`Dragging ${p.title}. Drop it on another ${p.flag} page.`);
                  const handleMouseMove = (moveEvent: MouseEvent) => {
                    const nextTarget = dropTargetAtPoint(p.id, moveEvent.clientX, moveEvent.clientY);
                    setDropTarget((current) => (
                      current?.pageId === nextTarget?.pageId && current?.position === nextTarget?.position
                        ? current
                        : nextTarget
                    ));
                  };
                  const handleMouseUp = (upEvent: MouseEvent) => {
                    window.removeEventListener("mousemove", handleMouseMove);
                    window.removeEventListener("mouseup", handleMouseUp);
                    const nextTarget = dropTargetAtPoint(p.id, upEvent.clientX, upEvent.clientY);
                    if (nextTarget) persistReorder(p.id, nextTarget.pageId, nextTarget.position);
                    setDraggedPageId(null);
                    setDropTarget(null);
                  };
                  window.addEventListener("mousemove", handleMouseMove);
                  window.addEventListener("mouseup", handleMouseUp);
                }}
                onKeyDown={(event) => {
                  if (event.key === " " || event.key === "Enter") {
                    event.preventDefault();
                    if (keyboardDragging) {
                      setKeyboardDragPageId(null);
                      setReorderAnnouncement(`${p.title} dropped.`);
                    } else {
                      setKeyboardDragPageId(p.id);
                      setReorderAnnouncement(`${p.title} picked up. Use the Up and Down arrow keys to move it within ${p.flag}.`);
                    }
                    return;
                  }
                  if (!keyboardDragging) return;
                  if (event.key === "ArrowUp" || event.key === "ArrowDown") {
                    event.preventDefault();
                    moveKeyboardPage(p.id, event.key === "ArrowUp" ? -1 : 1);
                  } else if (event.key === "Escape") {
                    event.preventDefault();
                    setKeyboardDragPageId(null);
                    setReorderAnnouncement(`Reordering ${p.title} cancelled.`);
                  }
                }}
              >
                <DotsSixVerticalIcon size={17} weight="bold" aria-hidden="true" />
              </button>
              <div style={{ minWidth: 0, paddingRight: 16 }}>
                <EditablePageTitle pageId={p.id} title={p.title} onSave={renamePage} />
                <div
                  aria-label={`Locked URL for ${p.title}: ${p.url}`}
                  title="The watched URL is locked"
                  style={{ fontSize: 12, color: C.faint, marginTop: 3, userSelect: "text" }}
                >
                  {p.url}
                </div>
              </div>
              <div>
                <SegToggle
                  label={`Flag for ${p.title}`}
                  value={p.flag}
                  onChange={(f) => setFlag(p.id, f)}
                  options={[
                    { value: "priority", label: "Priority", tone: PRIORITY_CHIP.fg, selectedBackground: PRIORITY_CHIP.bg, disabled: p.flag !== "priority" && !!priorityError, title: p.flag !== "priority" ? priorityError ?? undefined : undefined },
                    { value: "watching", label: "Watching", disabled: p.flag !== "watching" && !!watchingError, title: p.flag !== "watching" ? watchingError ?? undefined : undefined },
                    { value: "paused", label: "Paused", tone: PAUSED_CHIP.fg, selectedBackground: PAUSED_CHIP.bg, disabled: p.flag !== "paused" && pauseBlocked, title: pauseBlocked ? "Wait for the current collection to finish before pausing" : undefined },
                  ]}
                />
              </div>
              <div style={{ fontSize: 12.5, color: p.runState === "failed" ? C.redSoft : C.muted }}>
                {p.flag === "paused"
                  ? "History retained"
                  : p.runState === "queued"
                  ? "Collection queued"
                  : p.runState === "dispatching"
                    ? "Collector starting"
                    : p.runState === "running"
                      ? "Collection running"
                      : p.runState === "waiting_for_evidence"
                        ? "Waiting for independent PSI evidence"
                      : p.runState === "failed"
                        ? failedRunLabel(p)
                        : p.lastCollectionStatus === "inconclusive"
                          ? "Measurement inconclusive · previous trusted score retained"
                        : p.baselineCapturedAt
                          ? `Captured ${naturalDate(p.baselineCapturedAt)}`
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
          );})}
        </div>
          </>
        ) : (
          <>

        <section aria-labelledby="default-chart-device-heading" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 24, background: C.panel, border: `1px solid ${C.border}`, borderRadius: 13, padding: "17px 20px", marginBottom: 16 }}>
          <div>
            <div id="default-chart-device-heading" style={{ fontSize: 13.5, fontWeight: 600 }}>Default chart device</div>
            <div style={{ fontSize: 12, color: C.muted, marginTop: 4 }}>Choose which device is primary when the app opens. Both device Change labels remain visible.</div>
          </div>
          <div style={{ flex: "none" }}>
            <SegToggle
              label="Default chart device"
              value={preferredStrategy}
              onChange={setPreferredStrategy}
              options={[
                { value: "desktop", label: "Desktop first" },
                { value: "mobile", label: "Mobile first" },
              ]}
            />
          </div>
        </section>

        <section aria-labelledby="visitor-experience-heading" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 24, background: C.panel, border: `1px solid ${C.border}`, borderRadius: 13, padding: "17px 20px", marginBottom: 16 }}>
          <div>
            <div id="visitor-experience-heading" style={{ fontSize: 13.5, fontWeight: 600 }}>Visitor experience data</div>
            <div style={{ maxWidth: 720, fontSize: 12, color: C.muted, marginTop: 4, lineHeight: 1.5 }}>
              Show or hide Chrome visitor measurements throughout the app. Collection continues weekly while this is hidden.
            </div>
          </div>
          <div style={{ flex: "none" }}>
            <SegToggle
              label="Visitor experience data visibility"
              value={visitorExperienceVisible ? "visible" : "hidden"}
              onChange={(value) => setVisitorExperienceVisible(value === "visible")}
              options={[
                { value: "visible", label: "Visible" },
                { value: "hidden", label: "Hidden" },
              ]}
            />
          </div>
        </section>

        <section aria-labelledby="collection-schedule-heading" style={{ background: C.panel, border: `1px solid ${C.border}`, borderRadius: 14, padding: "20px", marginBottom: 16 }}>
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 24 }}>
            <div>
              <div id="collection-schedule-heading" style={{ fontSize: 13.5, fontWeight: 600 }}>Default collection time</div>
              <div style={{ maxWidth: 720, marginTop: 4, color: C.muted, fontSize: 12, lineHeight: 1.5 }}>
                This starts the workspace&apos;s daily collection window. Active pages are spread out after this time, and each page&apos;s PSI samples are staggered.
              </div>
              <div style={{ marginTop: 7, color: C.faint, fontSize: 11.5 }}>
                {normalizedSchedule.overridden
                  ? "Using your saved override."
                  : "Defaults to midnight in the timezone captured when the first page is added."}
              </div>
            </div>
            <button
              type="button"
              disabled={!collectionScheduleDirty}
              onClick={saveCollectionSchedule}
              style={{ border: "none", background: C.accent, color: "#fff", fontSize: 12, fontWeight: 600, padding: "9px 13px", borderRadius: 7, cursor: "pointer" }}
            >
              Save schedule
            </button>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "minmax(150px,220px) minmax(260px,1fr)", gap: 12, marginTop: 16 }}>
            <label style={{ display: "grid", gap: 7, color: C.muted, fontSize: 11.5 }}>
              Local time
              <input
                type="time"
                value={collectionTimeDraft}
                onChange={(event) => setCollectionTimeDraft(event.target.value)}
                style={{ background: C.bgElev, color: C.text, border: `1px solid ${C.border2}`, borderRadius: 7, padding: "9px 10px", fontSize: 13 }}
              />
            </label>
            <label style={{ display: "grid", gap: 7, color: C.muted, fontSize: 11.5 }}>
              Timezone
              <input
                list="collection-timezones"
                value={collectionTimeZoneDraft}
                onChange={(event) => setCollectionTimeZoneDraft(event.target.value)}
                placeholder="America/Chicago"
                style={{ background: C.bgElev, color: C.text, border: `1px solid ${C.border2}`, borderRadius: 7, padding: "9px 10px", fontSize: 13 }}
              />
              <datalist id="collection-timezones">
                {timeZones.map((timeZone) => <option key={timeZone} value={timeZone} />)}
              </datalist>
            </label>
          </div>
        </section>

        <section aria-labelledby="performance-tolerances-heading" style={{ background: C.panel, border: `1px solid ${C.border}`, borderRadius: 14, padding: "20px", marginBottom: 16 }}>
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 24, marginBottom: 16 }}>
            <div>
              <div id="performance-tolerances-heading" style={{ fontSize: 13.5, fontWeight: 600 }}>Monitoring tolerances</div>
              <div style={{ maxWidth: 720, marginTop: 4, color: C.muted, fontSize: 12, lineHeight: 1.5 }}>
                Team defaults for when pages enter dashboard cards, Watcher summaries, page statuses, and alerts. Hover or focus an info icon for details.
              </div>
            </div>
            <button
              type="button"
              className="setting-reset-all-button"
              disabled={thresholdDraftsAtDefaults}
              onClick={resetAllThresholds}
            >
              Reset all
            </button>
          </div>

          <div className="watchlist-tolerance-grid" style={{ display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: 12 }}>
            <ToleranceField
              id="improvement-threshold"
              label="Improvement threshold"
              help="A page is improving when its Performance gain meets this minimum and also clears its normal measurement noise."
              value={thresholdDrafts.improvement}
              defaultValue={DEFAULT_PERFORMANCE_THRESHOLDS.improvement}
              min={PERFORMANCE_THRESHOLD_LIMITS.improvement.min}
              max={PERFORMANCE_THRESHOLD_LIMITS.improvement.max}
              suffix="points"
              onChange={(value) => setThresholdDraft("improvement", value)}
              onReset={() => resetThresholds(["improvement"])}
            />
            <ToleranceField
              id="regression-threshold"
              label="Regression tolerance"
              help="A Performance decline must meet or exceed this many points before it can be classified as a regression."
              value={thresholdDrafts.regression}
              defaultValue={DEFAULT_PERFORMANCE_THRESHOLDS.regression}
              min={PERFORMANCE_THRESHOLD_LIMITS.regression.min}
              max={PERFORMANCE_THRESHOLD_LIMITS.regression.max}
              suffix="points"
              onChange={(value) => setThresholdDraft("regression", value)}
              onReset={() => resetThresholds(["regression"])}
            />
            <ToleranceField
              id="confirmation-runs"
              label="Confirmation runs"
              help="Require this many consecutive qualifying scans before a regression is surfaced."
              value={thresholdDrafts.confirmationRuns}
              defaultValue={DEFAULT_PERFORMANCE_THRESHOLDS.confirmationRuns}
              min={PERFORMANCE_THRESHOLD_LIMITS.confirmationRuns.min}
              max={PERFORMANCE_THRESHOLD_LIMITS.confirmationRuns.max}
              suffix="scans"
              onChange={(value) => setThresholdDraft("confirmationRuns", value)}
              onReset={() => resetThresholds(["confirmationRuns"])}
            />
            <ToleranceField
              id="regression-floor"
              label="Regression floor"
              help="Ignore a decline when the latest Performance score remains at or above this value."
              value={thresholdDrafts.regressionFloor}
              defaultValue={DEFAULT_PERFORMANCE_THRESHOLDS.regressionFloor}
              min={PERFORMANCE_THRESHOLD_LIMITS.regressionFloor.min}
              max={PERFORMANCE_THRESHOLD_LIMITS.regressionFloor.max}
              suffix="/ 100"
              onChange={(value) => setThresholdDraft("regressionFloor", value)}
              onReset={() => resetThresholds(["regressionFloor"])}
            />

            <div className="watchlist-setting-card">
              <SettingHeader
                id="device-policy"
                label="Device policy"
                help="Choose whether either device, both devices, or only the default chart device can place a page in a summary status."
                resetDisabled={devicePolicyDraft === DEFAULT_PERFORMANCE_THRESHOLDS.devicePolicy}
                onReset={() => setDevicePolicyDraft(DEFAULT_PERFORMANCE_THRESHOLDS.devicePolicy)}
              />
              <SegToggle
                label="Device policy"
                value={devicePolicyDraft}
                onChange={setDevicePolicyDraft}
                options={[
                  { value: "either", label: "Either" },
                  { value: "both", label: "Both" },
                  { value: "preferred", label: "Default" },
                ]}
              />
            </div>

            <ToleranceField
              id="agent-readiness-cutoff"
              label="Agent-readiness cutoff"
              help="Pages with an agent-readiness score below this percentage appear in Agent gaps."
              value={thresholdDrafts.agentReadiness}
              defaultValue={DEFAULT_PERFORMANCE_THRESHOLDS.agentReadiness}
              min={PERFORMANCE_THRESHOLD_LIMITS.agentReadiness.min}
              max={PERFORMANCE_THRESHOLD_LIMITS.agentReadiness.max}
              suffix="%"
              onChange={(value) => setThresholdDraft("agentReadiness", value)}
              onReset={() => resetThresholds(["agentReadiness"])}
            />

            <div className="watchlist-setting-card watchlist-setting-card--wide">
              <SettingHeader
                id="metric-cutoffs"
                label="Metric-specific cutoffs"
                help="A metric is considered low when its latest score falls below the corresponding cutoff."
                resetDisabled={(["lowPerformance", "accessibility", "bestPractices", "seo"] as NumericToleranceKey[]).every(
                  (key) => thresholdDrafts[key] === String(DEFAULT_PERFORMANCE_THRESHOLDS[key]),
                )}
                onReset={() => resetThresholds(["lowPerformance", "accessibility", "bestPractices", "seo"])}
              />
              <div className="metric-cutoff-grid">
                {([
                  ["lowPerformance", "Performance"],
                  ["accessibility", "Accessibility"],
                  ["bestPractices", "Best practices"],
                  ["seo", "SEO"],
                ] as [NumericToleranceKey, string][]).map(([key, label]) => (
                  <div key={key} className="metric-cutoff-control">
                    <span>{label}</span>
                    <NumberStepper
                      id={`metric-cutoff-${key}`}
                      ariaLabel={`${label} cutoff`}
                      value={thresholdDrafts[key]}
                      min={PERFORMANCE_THRESHOLD_LIMITS[key].min}
                      max={PERFORMANCE_THRESHOLD_LIMITS[key].max}
                      suffix="/ 100"
                      onChange={(value) => setThresholdDraft(key, value)}
                    />
                  </div>
                ))}
              </div>
            </div>

            <ToleranceField
              id="new-page-grace-runs"
              label="New-page grace period"
              help="Wait for this many completed post-baseline scans before showing trend statuses or sending regression alerts."
              value={thresholdDrafts.newPageGraceRuns}
              defaultValue={DEFAULT_PERFORMANCE_THRESHOLDS.newPageGraceRuns}
              min={PERFORMANCE_THRESHOLD_LIMITS.newPageGraceRuns.min}
              max={PERFORMANCE_THRESHOLD_LIMITS.newPageGraceRuns.max}
              suffix="scans"
              onChange={(value) => setThresholdDraft("newPageGraceRuns", value)}
              onReset={() => resetThresholds(["newPageGraceRuns"])}
              wide
            />

            <ToleranceField
              id="minimum-finding-runs"
              label="Finding evidence"
              help="Require this many repeatable Lighthouse captures before a quantified finding can enter Inbox."
              value={thresholdDrafts.minimumFindingRuns}
              defaultValue={DEFAULT_PERFORMANCE_THRESHOLDS.minimumFindingRuns}
              min={PERFORMANCE_THRESHOLD_LIMITS.minimumFindingRuns.min}
              max={PERFORMANCE_THRESHOLD_LIMITS.minimumFindingRuns.max}
              suffix="runs"
              onChange={(value) => setThresholdDraft("minimumFindingRuns", value)}
              onReset={() => resetThresholds(["minimumFindingRuns"])}
            />
            <ToleranceField
              id="minimum-time-saving"
              label="Minimum time saving"
              help="Suppress new quantified Inbox findings whose estimated time saving is below this value, unless their transfer saving clears its own threshold."
              value={thresholdDrafts.minimumSavingsMs}
              defaultValue={DEFAULT_PERFORMANCE_THRESHOLDS.minimumSavingsMs}
              min={PERFORMANCE_THRESHOLD_LIMITS.minimumSavingsMs.min}
              max={PERFORMANCE_THRESHOLD_LIMITS.minimumSavingsMs.max}
              suffix="ms"
              onChange={(value) => setThresholdDraft("minimumSavingsMs", value)}
              onReset={() => resetThresholds(["minimumSavingsMs"])}
            />
            <ToleranceField
              id="minimum-transfer-saving"
              label="Minimum transfer saving"
              help="Suppress new quantified Inbox findings below this transfer saving, unless their estimated time saving clears its own threshold. Structural findings with no estimate remain visible."
              value={thresholdDrafts.minimumSavingsKilobytes}
              defaultValue={DEFAULT_PERFORMANCE_THRESHOLDS.minimumSavingsKilobytes}
              min={PERFORMANCE_THRESHOLD_LIMITS.minimumSavingsKilobytes.min}
              max={PERFORMANCE_THRESHOLD_LIMITS.minimumSavingsKilobytes.max}
              suffix="KB"
              onChange={(value) => setThresholdDraft("minimumSavingsKilobytes", value)}
              onReset={() => resetThresholds(["minimumSavingsKilobytes"])}
            />
          </div>

          <div className="watchlist-tolerance-actions" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, marginTop: 16 }}>
            <div aria-live="polite" style={{ color: thresholdsValid ? C.faint : C.redSoft, fontSize: 11.5 }}>
              {thresholdsValid
                ? thresholdsDirty ? "Unsaved tolerance changes." : "All monitoring tolerances are saved."
                : "One or more values are outside the supported range."}
            </div>
            <div style={{ display: "flex", flex: "none", alignItems: "center", gap: 8 }}>
              <button
                type="button"
                onClick={saveThresholds}
                disabled={!thresholdsDirty}
                style={{ border: "none", background: C.accent, color: "#fff", fontSize: 12, fontWeight: 600, padding: "9px 13px", borderRadius: 7, cursor: "pointer" }}
              >
                Save changes
              </button>
            </div>
          </div>
        </section>

        <section aria-labelledby="default-agent-checks-heading" style={{ background: C.panel, border: `1px solid ${C.border}`, borderRadius: 14, padding: "20px" }}>
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 24, marginBottom: 18 }}>
            <div>
              <div id="default-agent-checks-heading" style={{ fontSize: 13.5, fontWeight: 600 }}>Default agent checks to ignore</div>
              <div style={{ fontSize: 12, color: C.muted, marginTop: 4, maxWidth: 680, lineHeight: 1.5 }}>
                Ignored checks are excluded from agent-readiness scores on every page. Individual pages can override these defaults.
              </div>
            </div>
            <div style={{ flex: "none", padding: "5px 9px", borderRadius: 6, background: ignoredByDefault ? "rgba(138,92,246,0.14)" : "rgba(255,255,255,0.05)", color: ignoredByDefault ? C.violetSoft : C.muted, fontSize: 11.5, fontWeight: 600 }}>
              {ignoredByDefault} of {ALL_AGENT_CHECKS.length} ignored
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 16, alignItems: "start" }}>
            {AGENT_CHECK_GROUPS.map((group) => {
              const groupIgnored = isAgentGroupIgnored(group.name, undefined, defaultIgnores);
              return (
                <div
                  key={group.name}
                  style={{
                    background: groupIgnored ? "rgba(138,92,246,0.07)" : "rgba(255,255,255,0.018)",
                    border: `1px solid ${groupIgnored ? "rgba(138,92,246,0.28)" : C.border}`,
                    borderRadius: 12,
                    padding: "16px 18px",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
                    <div style={{ minWidth: 0, fontSize: 11, fontWeight: 550, letterSpacing: "0.05em", textTransform: "uppercase", color: groupIgnored ? C.violetSoft : C.faint }}>
                      {group.name}
                    </div>
                    <button
                      type="button"
                      aria-label={`${groupIgnored ? "Restore" : "Ignore"} ${group.name} category by default`}
                      onClick={() => setDefaultAgentIgnore("group", group.name, !groupIgnored)}
                      style={{ marginLeft: "auto", flex: "none", border: `1px solid ${groupIgnored ? "rgba(183,156,255,0.30)" : C.border2}`, background: groupIgnored ? "rgba(138,92,246,0.14)" : "rgba(255,255,255,0.03)", color: groupIgnored ? C.violetSoft : C.faint2, fontSize: 10.5, fontWeight: 550, padding: "4px 8px", borderRadius: 6, cursor: "pointer" }}
                    >
                      {groupIgnored ? "Restore category" : "Ignore category"}
                    </button>
                  </div>

                  <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                    {group.items.map((name) => {
                      const check = { group: group.name, name };
                      const checkKey = agentCheckKey(check);
                      const individuallyIgnored = defaultIgnores.checks.includes(checkKey);
                      const checkIgnored = groupIgnored || individuallyIgnored;
                      return (
                        <div key={name} style={{ display: "flex", alignItems: "center", gap: 9, minWidth: 0 }}>
                          <span style={{ flex: "none", width: 18, height: 18, borderRadius: 5, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 700, color: checkIgnored ? C.violetSoft : C.muted, background: checkIgnored ? "rgba(138,92,246,0.18)" : C.border2 }}>
                            {checkIgnored ? "–" : "✓"}
                          </span>
                          <span style={{ minWidth: 0, flex: 1, fontSize: 13, color: checkIgnored ? C.faint : C.dim }}>{name}</span>
                          {groupIgnored ? (
                            <span style={{ flex: "none", fontSize: 10, fontWeight: 600, color: C.violetSoft }}>ignored by category</span>
                          ) : (
                            <button
                              type="button"
                              aria-label={`${individuallyIgnored ? "Restore" : "Ignore"} ${name} check by default`}
                              onClick={() => setDefaultAgentIgnore("check", checkKey, !individuallyIgnored)}
                              style={{ flex: "none", border: "none", background: "transparent", color: individuallyIgnored ? C.violetSoft : C.faint, fontSize: 10.5, fontWeight: 550, padding: "2px 0", cursor: "pointer" }}
                            >
                              {individuallyIgnored ? "Restore" : "Ignore"}
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
          </>
        )}
      </div>
    </div>
  );
}

export default function WatchlistPage() {
  return <WatchlistContent mode="watchlist" />;
}

export function SettingsPageContent() {
  return <WatchlistContent mode="settings" />;
}
