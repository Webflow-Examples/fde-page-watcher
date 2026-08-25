"use client";

import { useState } from "react";
import type {
  AgentAccessSummary,
  AgentAccessVerdict,
  AgentIssueCase,
  AgentIssueSource,
  AgentIssueStatus,
} from "@/lib/agentIssueCases";
import { agentVerdictLabel, systemLabel } from "@/lib/agentIssueCases";
import { Magnitude } from "@/components/magnitude";
import { StatusChip } from "@/components/status-chip";

/**
 * The four health bands, as names. Nothing in this file names a colour value:
 * a band resolves to `var(--health-<band>-text|-bg|-border)` at the one place
 * that paints it, `<HealthChip>` below.
 */
type HealthBand = "good" | "warn" | "poor" | "none";

/**
 * Can agents use this site right now? That is a health question, so the verdict
 * gets a health band. `unknown` is not a warning — it is the absence of a
 * verdict, which is what `none` means.
 */
function verdictTone(verdict: AgentAccessVerdict): HealthBand {
  if (verdict === "ready") return "good";
  if (verdict === "blocked") return "poor";
  if (verdict === "needs-attention") return "warn";
  return "none";
}

/**
 * Same question, one issue at a time.
 *
 * `ignored` is deliberately not accepted here. A dismissed check is a work
 * state — somebody chose to exclude it — and R11 keeps work states out of the
 * health tokens entirely. `<StatusBadge>` branches on it before it ever
 * reaches this helper, and the `Exclude<>` makes forgetting that a type error.
 */
function statusTone(status: Exclude<AgentIssueStatus, "ignored">): HealthBand {
  if (status === "pass") return "good";
  if (status === "failed") return "poor";
  if (status === "partial") return "warn";
  return "none";
}

/**
 * The one health chip in this file.
 *
 * Three hand-rolled treatments used to render the same idea at three sizes,
 * three weights, and three corner radii — the issue badge, the verdict badge,
 * and the dashboard chip. They are one component now, so a band can only ever
 * look like itself.
 */
const HEALTH_CHIP_MIN_FONT_SIZE = 12;

function HealthChip({
  band,
  label,
  fontSize = HEALTH_CHIP_MIN_FONT_SIZE,
  fontWeight = 600,
  title,
}: {
  band: HealthBand;
  label: string;
  fontSize?: number;
  fontWeight?: number;
  title?: string;
}) {
  return (
    <span
      title={title}
      data-health-band={band}
      style={{
        flex: "none",
        display: "inline-flex",
        alignItems: "center",
        fontSize: Math.max(HEALTH_CHIP_MIN_FONT_SIZE, fontSize),
        fontWeight,
        lineHeight: 1.35,
        color: `var(--health-${band}-text)`,
        background: `var(--health-${band}-bg)`,
        border: `1px solid var(--health-${band}-border)`,
        borderRadius: 6,
        padding: "1px 7px",
        whiteSpace: "nowrap",
      }}
    >
      {label}
    </span>
  );
}

/** Every state reads differently, so partial can never look like pass or fail. */
export function agentStatusLabel(status: AgentIssueStatus): string {
  return status === "pass" ? "Passing"
    : status === "failed" ? "Failing"
      : status === "partial" ? "Partial"
        : status === "not-applicable" ? "Not applicable"
          : status === "ignored" ? "Ignored"
            : "Not determined";
}

type ConfidenceStrength = "strong" | "weak";

/**
 * Four distinct readings that all rendered in the same grey, so the page said
 * "corroborated by three independent sources" and "not enough evidence to be
 * confident" in exactly the same voice.
 *
 * Strength now comes through `--confidence-strong` / `--confidence-weak`. Only
 * a conclusion two independent systems agree on is strong; thin, disputed, and
 * absent evidence are all weak. This is deliberately not a health hue — how
 * well a thing is evidenced is a different question from whether it is good.
 */
function confidenceReading(issue: AgentIssueCase): { label: string; strength: ConfidenceStrength } {
  if (issue.confidence === "corroborated") {
    const systems = new Set(issue.sources.map((source) => source.system)).size;
    return { label: `Corroborated by ${systems} independent sources`, strength: "strong" };
  }
  if (issue.confidence === "conflicting") return { label: "Sources disagree", strength: "weak" };
  if (issue.confidence === "insufficient") {
    return { label: "Not enough evidence to be confident", strength: "weak" };
  }
  return { label: "Reported by one source", strength: "weak" };
}

function StatusBadge({ status }: { status: AgentIssueStatus }) {
  // Dismissed is a work state, not a verdict: it says a person excluded this
  // check, not that the check is healthy. It renders through the one status
  // chip so it reads the same here as everywhere else in the app.
  if (status === "ignored") return <StatusChip state="dismissed" />;
  return <HealthChip band={statusTone(status)} label={agentStatusLabel(status)} />;
}

function SourceRow({ source }: { source: AgentIssueSource }) {
  return (
    <li style={{ listStyle: "none", display: "flex", alignItems: "baseline", gap: 8, fontSize: 12, color: "var(--text-muted)", padding: "3px 0" }}>
      <span style={{ color: "var(--text-muted)", minWidth: 108 }}>{systemLabel(source.system)}</span>
      <span style={{ flex: 1, minWidth: 0 }}>
        {source.label} · {agentStatusLabel(source.result)}
        <span style={{ color: "var(--text-muted)" }}> · {source.scope === "origin" ? "origin-wide" : "this page"}</span>
      </span>
    </li>
  );
}

/**
 * Verdict-first summary. Deliberately leads with a conclusion rather than a
 * score: the reading order is verdict, then the single highest-priority issue,
 * then the next action, with per-source numbers kept underneath.
 */
export function AgentAccessVerdictCard({
  summary,
  freshness,
}: {
  summary: AgentAccessSummary;
  freshness?: string;
}) {
  return (
    <section
      aria-labelledby="agent-access-verdict-heading"
      style={{ background: "var(--surface-card)", border: "1px solid var(--border-hairline)", borderRadius: 13, padding: "17px 20px", marginBottom: 16 }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <HealthChip band={verdictTone(summary.verdict)} label={agentVerdictLabel(summary.verdict)} fontWeight={700} />
        <h2 id="agent-access-verdict-heading" style={{ margin: 0, fontSize: 14.5, fontWeight: 600 }}>
          {summary.headline}
        </h2>
      </div>

      {summary.primary && (
        <div style={{ marginTop: 12 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-muted)" }}>Primary issue</div>
          <div style={{ fontSize: 13, marginTop: 2 }}>{summary.primary.title}</div>
          <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 3, lineHeight: 1.5 }}>
            {summary.primary.consequence}
          </div>
        </div>
      )}

      {summary.nextAction && (
        <div style={{ marginTop: 12 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-muted)" }}>Next action</div>
          <div style={{ fontSize: 12.5, marginTop: 2, lineHeight: 1.5 }}>{summary.nextAction}</div>
        </div>
      )}

      {/*
        These three counts used to repeat the verdict badge ten lines above in
        red, amber, and grey — a second, quieter opinion about the same facts.
        They are quantities, so they answer "how much" with weight (R3) and the
        verdict keeps the only hue on the card.
      */}
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "baseline", gap: 14, marginTop: 12, fontSize: 12 }}>
        {summary.blockers > 0 && (
          <Magnitude
            value={summary.blockers}
            unit={`essential blocker${summary.blockers === 1 ? "" : "s"}`}
            fontSize={12}
          />
        )}
        {summary.improvements > 0 && (
          <Magnitude
            value={summary.improvements}
            unit={`recommended improvement${summary.improvements === 1 ? "" : "s"}`}
            fontSize={12}
          />
        )}
        {summary.undetermined > 0 && (
          <Magnitude value={summary.undetermined} unit="not determined" fontSize={12} />
        )}
        {freshness && <span style={{ color: "var(--text-muted)" }}>{freshness}</span>}
      </div>
    </section>
  );
}

function IssueRow({
  issue,
  canManage,
  onAddToTasks,
  taskState,
}: {
  issue: AgentIssueCase;
  canManage: boolean;
  onAddToTasks?: (issue: AgentIssueCase) => void;
  taskState?: "none" | "tracked";
}) {
  const [open, setOpen] = useState(false);
  const confidence = confidenceReading(issue);
  return (
    <li style={{ listStyle: "none", borderTop: "1px solid var(--border-hairline)", padding: "11px 0" }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12 }}>
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
          style={{ flex: 1, minWidth: 0, textAlign: "left", border: "none", background: "none", color: "var(--text-body)", fontSize: 13, fontWeight: 600, padding: 0, cursor: "pointer" }}
        >
          {issue.title}
        </button>
        <StatusBadge status={issue.status} />
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginTop: 4, fontSize: 12, color: "var(--text-muted)" }}>
        <span>{issue.scope === "origin" ? "Origin-wide" : "This page"}</span>
        <span style={{ color: `var(--confidence-${confidence.strength})` }}>{confidence.label}</span>
        {/*
          A tier is a classification of the check, not a verdict on the page:
          "Essential" renders on passing issues too, so red here said "bad"
          about something that is fine. Weight carries the emphasis instead.
        */}
        {issue.tier === "essential" && <span style={{ color: "var(--text-muted)", fontWeight: 600 }}>Essential</span>}
      </div>

      {open && (
        <div style={{ marginTop: 10 }}>
          <div style={{ fontSize: 12, color: "var(--text-muted)", lineHeight: 1.55 }}>{issue.consequence}</div>

          {/* A disagreement between sources is a statement about evidence quality, not page health. */}
          {issue.conflict && (
            <div style={{ fontSize: 12, color: "var(--confidence-weak)", marginTop: 8, lineHeight: 1.5 }}>{issue.conflict}</div>
          )}

          <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-muted)", marginTop: 10 }}>What to do</div>
          <ol style={{ margin: "4px 0 0", paddingLeft: 18, fontSize: 12, color: "var(--text-muted)", lineHeight: 1.6 }}>
            {issue.remediation.map((step) => <li key={step}>{step}</li>)}
          </ol>

          <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-muted)", marginTop: 10 }}>How we know</div>
          <ul style={{ margin: "4px 0 0", padding: 0 }}>
            {issue.sources.map((source, index) => (
              <SourceRow key={`${source.system}:${source.label}:${index}`} source={source} />
            ))}
          </ul>

          <details style={{ marginTop: 10 }}>
            <summary style={{ fontSize: 12, color: "var(--text-muted)", cursor: "pointer" }}>Advanced evidence</summary>
            <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 6, lineHeight: 1.6 }}>
              <div>Issue key: {issue.key}</div>
              <div>Success criteria: {issue.successCriteria}</div>
              <div>
                {issue.verificationCheckIds.length
                  ? `Provider checks re-run to verify: ${issue.verificationCheckIds.join(", ")}`
                  : "No provider check covers this issue, so a fix cannot be confirmed externally."}
              </div>
              {issue.sources.filter((source) => source.detail).map((source, index) => (
                <div key={`detail-${index}`}>
                  {systemLabel(source.system)} observed: {source.detail}
                </div>
              ))}
            </div>
          </details>

          {onAddToTasks && canManage && (
            <button
              type="button"
              onClick={() => onAddToTasks(issue)}
              disabled={taskState === "tracked"}
              style={{
                marginTop: 12,
                border: "1px solid var(--border-strong)",
                background: "transparent",
                // The label already swaps to "Already in Tasks"; the ink only
                // has to stop looking clickable, which is what the disabled
                // token is for.
                color: taskState === "tracked" ? "var(--text-disabled-app)" : "var(--text-muted)",
                fontSize: 12,
                fontWeight: 600,
                padding: "7px 11px",
                borderRadius: 7,
                cursor: taskState === "tracked" ? "default" : "pointer",
              }}
            >
              {taskState === "tracked" ? "Already in Tasks" : "Add remediation to Tasks"}
            </button>
          )}
        </div>
      )}
    </li>
  );
}

/** Issue cases in priority order. Nothing is hidden — every state is listed. */
export function AgentIssueCaseList({
  cases,
  canManage,
  onAddToTasks,
  trackedKeys,
}: {
  cases: AgentIssueCase[];
  canManage: boolean;
  onAddToTasks?: (issue: AgentIssueCase) => void;
  trackedKeys?: Set<string>;
}) {
  const [showResolved, setShowResolved] = useState(false);
  const open = cases.filter((issue) => issue.status === "failed" || issue.status === "partial");
  const rest = cases.filter((issue) => issue.status !== "failed" && issue.status !== "partial");

  return (
    <section
      aria-labelledby="agent-issue-cases-heading"
      style={{ background: "var(--surface-card)", border: "1px solid var(--border-hairline)", borderRadius: 13, padding: "6px 20px 16px", marginBottom: 16 }}
    >
      <h3 id="agent-issue-cases-heading" style={{ fontSize: 13.5, fontWeight: 600, margin: "14px 0 2px" }}>
        Issues
      </h3>
      <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 6, lineHeight: 1.5 }}>
        One entry per problem, merged across Page Watch checks, the rendered-page probe, and the
        external audit. Source readings are kept underneath rather than averaged.
      </div>

      {open.length === 0 && (
        <div style={{ fontSize: 12, color: "var(--text-muted)", padding: "10px 0" }}>
          No open agent-access issues in the current evidence.
        </div>
      )}
      <ul style={{ margin: 0, padding: 0 }}>
        {open.map((issue) => (
          <IssueRow
            key={issue.key}
            issue={issue}
            canManage={canManage}
            onAddToTasks={onAddToTasks}
            taskState={trackedKeys?.has(issue.key) ? "tracked" : "none"}
          />
        ))}
      </ul>

      {rest.length > 0 && (
        <>
          <button
            type="button"
            onClick={() => setShowResolved((value) => !value)}
            aria-expanded={showResolved}
            style={{ border: "none", background: "none", color: "var(--action-primary-ink)", fontSize: 12, fontWeight: 600, padding: 0, marginTop: 12, cursor: "pointer" }}
          >
            {showResolved
              ? "Hide passing, ignored, and not-applicable issues"
              : `Show ${rest.length} passing, ignored, and not-applicable issue${rest.length === 1 ? "" : "s"}`}
          </button>
          {showResolved && (
            <ul style={{ margin: "6px 0 0", padding: 0 }}>
              {rest.map((issue) => (
                <IssueRow
                  key={issue.key}
                  issue={issue}
                  canManage={canManage}
                  onAddToTasks={onAddToTasks}
                  taskState={trackedKeys?.has(issue.key) ? "tracked" : "none"}
                />
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}

/** Compact verdict chip for the dashboard. Never shows a provider score. */
export function AgentAccessChip({ verdict }: { verdict: AgentAccessVerdict }) {
  return (
    <HealthChip
      band={verdictTone(verdict)}
      label={`Agents: ${agentVerdictLabel(verdict)}`}
      title={`Agent access: ${agentVerdictLabel(verdict)}`}
    />
  );
}
