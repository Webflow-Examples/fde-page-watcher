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
import { C } from "@/lib/ui";

function verdictTone(verdict: AgentAccessVerdict): { color: string; background: string } {
  if (verdict === "ready") return { color: C.green, background: "rgba(53,208,127,0.13)" };
  if (verdict === "blocked") return { color: C.redSoft, background: "rgba(255,92,108,0.13)" };
  if (verdict === "needs-attention") return { color: C.amber, background: "rgba(255,154,61,0.13)" };
  return { color: C.muted, background: "rgba(255,255,255,0.06)" };
}

function statusTone(status: AgentIssueStatus): { color: string; background: string } {
  if (status === "pass") return { color: C.green, background: "rgba(53,208,127,0.13)" };
  if (status === "failed") return { color: C.redSoft, background: "rgba(255,92,108,0.13)" };
  if (status === "partial") return { color: C.amber, background: "rgba(255,154,61,0.13)" };
  if (status === "ignored") return { color: C.violetSoft, background: "rgba(167,139,250,0.13)" };
  return { color: C.muted, background: "rgba(255,255,255,0.06)" };
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

function confidenceLabel(issue: AgentIssueCase): string {
  return issue.confidence === "corroborated"
    ? `Corroborated by ${new Set(issue.sources.map((source) => source.system)).size} independent sources`
    : issue.confidence === "conflicting"
      ? "Sources disagree"
      : issue.confidence === "insufficient"
        ? "Not enough evidence to be confident"
        : "Reported by one source";
}

function StatusBadge({ status }: { status: AgentIssueStatus }) {
  const tone = statusTone(status);
  return (
    <span style={{ flex: "none", fontSize: 11, fontWeight: 600, color: tone.color, background: tone.background, borderRadius: 5, padding: "2px 7px" }}>
      {agentStatusLabel(status)}
    </span>
  );
}

function SourceRow({ source }: { source: AgentIssueSource }) {
  return (
    <li style={{ listStyle: "none", display: "flex", alignItems: "baseline", gap: 8, fontSize: 11.5, color: C.muted, padding: "3px 0" }}>
      <span style={{ color: C.faint, minWidth: 108 }}>{systemLabel(source.system)}</span>
      <span style={{ flex: 1, minWidth: 0 }}>
        {source.label} · {agentStatusLabel(source.result)}
        <span style={{ color: C.faint }}> · {source.scope === "origin" ? "origin-wide" : "this page"}</span>
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
  const tone = verdictTone(summary.verdict);
  return (
    <section
      aria-labelledby="agent-access-verdict-heading"
      style={{ background: C.panel, border: `1px solid ${C.border}`, borderRadius: 13, padding: "17px 20px", marginBottom: 16 }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: tone.color, background: tone.background, borderRadius: 6, padding: "3px 9px" }}>
          {agentVerdictLabel(summary.verdict)}
        </span>
        <h2 id="agent-access-verdict-heading" style={{ margin: 0, fontSize: 14.5, fontWeight: 600 }}>
          {summary.headline}
        </h2>
      </div>

      {summary.primary && (
        <div style={{ marginTop: 12 }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: C.faint }}>Primary issue</div>
          <div style={{ fontSize: 13, marginTop: 2 }}>{summary.primary.title}</div>
          <div style={{ fontSize: 11.5, color: C.muted, marginTop: 3, lineHeight: 1.5 }}>
            {summary.primary.consequence}
          </div>
        </div>
      )}

      {summary.nextAction && (
        <div style={{ marginTop: 12 }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: C.faint }}>Next action</div>
          <div style={{ fontSize: 12.5, marginTop: 2, lineHeight: 1.5 }}>{summary.nextAction}</div>
        </div>
      )}

      <div style={{ display: "flex", flexWrap: "wrap", gap: 14, marginTop: 12, fontSize: 11.5 }}>
        {summary.blockers > 0 && (
          <span style={{ color: C.redSoft }}>{summary.blockers} essential blocker{summary.blockers === 1 ? "" : "s"}</span>
        )}
        {summary.improvements > 0 && (
          <span style={{ color: C.amber }}>{summary.improvements} recommended improvement{summary.improvements === 1 ? "" : "s"}</span>
        )}
        {summary.undetermined > 0 && (
          <span style={{ color: C.muted }}>{summary.undetermined} not determined</span>
        )}
        {freshness && <span style={{ color: C.faint }}>{freshness}</span>}
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
  return (
    <li style={{ listStyle: "none", borderTop: `1px solid ${C.border}`, padding: "11px 0" }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12 }}>
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
          style={{ flex: 1, minWidth: 0, textAlign: "left", border: "none", background: "none", color: C.text, fontSize: 13, fontWeight: 600, padding: 0, cursor: "pointer" }}
        >
          {issue.title}
        </button>
        <StatusBadge status={issue.status} />
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginTop: 4, fontSize: 11, color: C.faint }}>
        <span>{issue.scope === "origin" ? "Origin-wide" : "This page"}</span>
        <span>{confidenceLabel(issue)}</span>
        {issue.tier === "essential" && <span style={{ color: C.redSoft }}>Essential</span>}
      </div>

      {open && (
        <div style={{ marginTop: 10 }}>
          <div style={{ fontSize: 11.5, color: C.muted, lineHeight: 1.55 }}>{issue.consequence}</div>

          {issue.conflict && (
            <div style={{ fontSize: 11.5, color: C.amber, marginTop: 8, lineHeight: 1.5 }}>{issue.conflict}</div>
          )}

          <div style={{ fontSize: 11, fontWeight: 600, color: C.faint, marginTop: 10 }}>What to do</div>
          <ol style={{ margin: "4px 0 0", paddingLeft: 18, fontSize: 11.5, color: C.muted, lineHeight: 1.6 }}>
            {issue.remediation.map((step) => <li key={step}>{step}</li>)}
          </ol>

          <div style={{ fontSize: 11, fontWeight: 600, color: C.faint, marginTop: 10 }}>How we know</div>
          <ul style={{ margin: "4px 0 0", padding: 0 }}>
            {issue.sources.map((source, index) => (
              <SourceRow key={`${source.system}:${source.label}:${index}`} source={source} />
            ))}
          </ul>

          <details style={{ marginTop: 10 }}>
            <summary style={{ fontSize: 11.5, color: C.muted, cursor: "pointer" }}>Advanced evidence</summary>
            <div style={{ fontSize: 11.5, color: C.faint, marginTop: 6, lineHeight: 1.6 }}>
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
                border: `1px solid ${C.border}`,
                background: "transparent",
                color: taskState === "tracked" ? C.faint : C.muted,
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
      style={{ background: C.panel, border: `1px solid ${C.border}`, borderRadius: 13, padding: "6px 20px 16px", marginBottom: 16 }}
    >
      <h3 id="agent-issue-cases-heading" style={{ fontSize: 13.5, fontWeight: 600, margin: "14px 0 2px" }}>
        Issues
      </h3>
      <div style={{ fontSize: 11.5, color: C.faint, marginBottom: 6, lineHeight: 1.5 }}>
        One entry per problem, merged across Page Watch checks, the rendered-page probe, and the
        external audit. Source readings are kept underneath rather than averaged.
      </div>

      {open.length === 0 && (
        <div style={{ fontSize: 12, color: C.muted, padding: "10px 0" }}>
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
            style={{ border: "none", background: "none", color: C.accentSoft, fontSize: 12, fontWeight: 600, padding: 0, marginTop: 12, cursor: "pointer" }}
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
  const tone = verdictTone(verdict);
  return (
    <span
      title={`Agent access: ${agentVerdictLabel(verdict)}`}
      style={{ fontSize: 10.5, fontWeight: 600, color: tone.color, background: tone.background, borderRadius: 5, padding: "2px 7px", whiteSpace: "nowrap" }}
    >
      Agents: {agentVerdictLabel(verdict)}
    </span>
  );
}
