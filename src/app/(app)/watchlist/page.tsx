"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { Info } from "@phosphor-icons/react";
import { useStore } from "@/components/store";
import { AGENT_CHECK_GROUPS, ALL_AGENT_CHECKS } from "@/lib/agentChecks";
import { agentCheckKey, isAgentCheckIgnored, isAgentGroupIgnored, normalizeAgentIgnoreSettings } from "@/lib/agentScoring";
import { DEFAULT_PERFORMANCE_THRESHOLDS, normalizePerformanceThresholds, PERFORMANCE_THRESHOLD_LIMITS } from "@/lib/performanceThresholds";
import type { DevicePolicy, PerformanceThresholds } from "@/lib/types";
import { C } from "@/lib/ui";
import { SegToggle } from "@/components/bits";
import { ChevronDownIcon, PlusIcon, TrashIcon } from "@/components/icons";
import { flagCapacityError, MAX_ACTIVE_PAGES, MAX_PRIORITY_PAGES, watchCapacity } from "@/lib/watchCapacity";

const GRID = "minmax(260px,2.4fr) 230px 1fr 120px";
type NumericToleranceKey = keyof typeof PERFORMANCE_THRESHOLD_LIMITS;
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

export default function WatchlistPage() {
  const router = useRouter();
  const {
    pages,
    agentIgnoreDefaults,
    setFlag,
    renamePage,
    setDefaultAgentIgnore,
    removePage,
    openAdd,
    pathFor,
    preferredStrategy,
    setPreferredStrategy,
    performanceThresholds,
    updatePerformanceThresholds,
  } = useStore();
  const defaultIgnores = normalizeAgentIgnoreSettings(agentIgnoreDefaults);
  const thresholds = normalizePerformanceThresholds(performanceThresholds);
  const [thresholdDrafts, setThresholdDrafts] = useState<Record<NumericToleranceKey, string>>(() =>
    Object.fromEntries(NUMERIC_TOLERANCE_KEYS.map((key) => [key, String(thresholds[key])])) as Record<NumericToleranceKey, string>
  );
  const [devicePolicyDraft, setDevicePolicyDraft] = useState<DevicePolicy>(thresholds.devicePolicy);
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

  return (
    <div>
      <header style={{ padding: "30px 40px 24px", display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 24 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 27, fontWeight: 600, letterSpacing: "-0.01em" }}>Watchlist</h1>
          <p style={{ margin: "8px 0 0", fontSize: 13.5, color: C.muted }}>Priority and Watching pages are monitored nightly. Paused pages keep their history without collecting new data.</p>
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
        <div style={{ background: C.panel, border: `1px solid ${C.border}`, borderRadius: 14, overflow: "hidden", marginBottom: 16 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 18, padding: "12px 24px", borderBottom: `1px solid ${C.border}`, fontSize: 11.5, color: C.muted }}>
            <span><strong style={{ color: C.text, fontWeight: 600 }}>{capacity.active}/{MAX_ACTIVE_PAGES}</strong> active</span>
            <span><strong style={{ color: C.accentSoft, fontWeight: 600 }}>{capacity.priority}/{MAX_PRIORITY_PAGES}</strong> Priority</span>
            <span><strong style={{ color: C.faint2, fontWeight: 600 }}>{capacity.paused}</strong> Paused</span>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: GRID, alignItems: "center", padding: "14px 24px", borderBottom: `1px solid ${C.border}`, fontSize: 11, fontWeight: 550, letterSpacing: "0.05em", textTransform: "uppercase", color: C.faint }}>
            <div>Page</div>
            <div>Flag</div>
            <div>Baseline</div>
            <div style={{ textAlign: "right" }}>Actions</div>
          </div>
          {pages.map((p) => {
            const priorityError = flagCapacityError(pages, p.id, "priority");
            const watchingError = flagCapacityError(pages, p.id, "watching");
            const pauseBlocked = !!p.runState && p.runState !== "failed";
            return (
            <div key={p.id} style={{ display: "grid", gridTemplateColumns: GRID, alignItems: "center", padding: "15px 24px", borderBottom: `1px solid ${C.rowBorder}` }}>
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
                    { value: "priority", label: "Priority", disabled: p.flag !== "priority" && !!priorityError, title: p.flag !== "priority" ? priorityError ?? undefined : undefined },
                    { value: "watching", label: "Watching", disabled: p.flag !== "watching" && !!watchingError, title: p.flag !== "watching" ? watchingError ?? undefined : undefined },
                    { value: "paused", label: "Paused", disabled: p.flag !== "paused" && pauseBlocked, title: pauseBlocked ? "Wait for the current collection to finish before pausing" : undefined },
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
          );})}
        </div>

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
      </div>
    </div>
  );
}
