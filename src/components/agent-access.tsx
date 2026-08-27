"use client";

import { useState } from "react";
import Link from "next/link";
import type { AgentIssueCase, AgentIssueSource, AgentIssueStatus } from "@/lib/agentIssueCases";
import { systemLabel } from "@/lib/agentIssueCases";
import { readingPredatesWithdrawal } from "@/lib/agentConsent";
import { SETTINGS_CONSENT_STALE_READING } from "@/lib/settings-copy";
import type { ExternalAgentConsentEntry } from "@/lib/types";
import {
  agentAgreement,
  AGENT_ACCESS_SOURCES,
  AGENT_RESULT_FOR_STATUS,
  type AgentAccess,
  type AgentReading,
} from "@/lib/agent-access";
import {
  agentExcluded,
  agentReadingsAgree,
  agentReadingsConflict,
  agentReadingsCount,
  AGENT_CAUSE,
  AGENT_LAST_CHECKED,
  AGENT_NEXT_ACTION,
  AGENT_READINGS_LABEL,
  AGENT_TITLE,
  AGENT_UNKNOWN,
} from "@/lib/agent-copy";
import {
  AGENT_RESULT_LABEL,
  AGENT_VERDICT_LABEL,
  EVIDENCE_SOURCE_LABEL,
  QUEUE_LABEL,
  type AgentVerdict,
} from "@/lib/vocabulary";
import { formatDate } from "@/lib/watch-copy";
import { StatusChip } from "@/components/status-chip";

/**
 * The four health bands, as names. Nothing in this file names a colour value:
 * a band resolves to `var(--health-<band>-text|-bg|-border)` at the one place
 * that paints it, `<HealthChip>` below.
 */
type HealthBand = "good" | "warn" | "poor" | "none";

/**
 * Can agents use this origin right now? That is a health question, so the
 * verdict gets a health band. `unknown` is not a warning — it is the absence of
 * a verdict, which is what `none` means.
 *
 * A `Record` over the registry's union rather than a ternary chain, so a
 * verdict added to `agent_verdict` arrives here as a missing key.
 */
const VERDICT_BAND: Record<AgentVerdict, HealthBand> = {
  ready: "good",
  needs_work: "warn",
  blocked: "poor",
  unknown: "none",
};

/**
 * Same question, one check at a time.
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

/**
 * The verdict word and the date it was last checked, in one component.
 *
 * They are one component precisely so they cannot be separated. A verdict with
 * no date is a claim with no evidence behind it, and the way to stop that
 * happening is to make the date an argument of the thing that paints the word
 * rather than a line somebody remembers to add underneath. `formatDate` says
 * "date unknown" when there is nothing to show, so the slot is never empty and
 * never filled with a plausible substitute.
 */
function VerdictLine({
  verdict,
  lastChecked,
  locale,
  fontSize = 12,
}: {
  verdict: AgentVerdict;
  lastChecked: string | undefined;
  locale?: string;
  fontSize?: number;
}) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
      <HealthChip band={VERDICT_BAND[verdict]} label={AGENT_VERDICT_LABEL[verdict]} fontSize={fontSize} fontWeight={700} />
      <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
        {AGENT_LAST_CHECKED} {formatDate(lastChecked, locale)}
      </span>
    </span>
  );
}

/* ── The readings table ─────────────────────────────────────────────────── */

/**
 * One row per source. Five rows, and no sixth.
 *
 * There is deliberately no total row and no average: two sources reading the
 * same origin differently is the thing this table exists to make visible, and a
 * summary line at the bottom would resolve that disagreement before the reader
 * saw it. The agreement sentence underneath counts rows instead, which is a
 * figure the table itself can be checked against.
 */
function ReadingRow({
  reading,
  locale,
  highlight,
  consent,
}: {
  reading: AgentReading;
  locale?: string;
  highlight?: boolean;
  consent?: AgentAccessConsent;
}) {
  const excluded = reading.applicability === "excluded";
  // Only Ora's row. Kitesurf is not gated by this consent, and a clause about a
  // permission that never governed a reading would be a claim about it that is
  // simply untrue.
  const stale = reading.source === "ora"
    && readingPredatesWithdrawal(consent?.history, consent?.on === true, reading.observedAt);
  return (
    <div
      role="row"
      data-source={reading.source}
      data-applicability={reading.applicability}
      style={{
        display: "grid",
        gridTemplateColumns: "minmax(120px, 1fr) minmax(0, 2.2fr) auto",
        gap: 12,
        alignItems: "baseline",
        padding: "9px 0",
        borderTop: "1px solid var(--border-hairline)",
        // Excluded is greyed, never hidden. The reading it last took stays
        // legible; only its weight in the conclusion is gone.
        color: excluded ? "var(--text-disabled-app)" : "var(--text-muted)",
        ...(highlight ? { background: "var(--surface-raised)" } : {}),
      }}
    >
      <div role="cell" style={{ fontWeight: 600, color: excluded ? "inherit" : "var(--text-body)" }}>
        {EVIDENCE_SOURCE_LABEL[reading.source]}
      </div>
      <div role="cell" style={{ minWidth: 0, lineHeight: 1.5, fontSize: 12 }}>
        {/* The source's own words, or an explicit nothing. Rule 18: an absent
            reading says so rather than borrowing a sentence. */}
        {reading.words ?? "—"}
        {excluded && (
          <div style={{ marginTop: 2 }}>{agentExcluded(reading.reason)}</div>
        )}
        {/* A reading taken while Ora was connected, on a project that has since
            disconnected. It is a real reading and it stays exactly as legible as
            the others — not greyed, not removed, not reordered. All the clause
            does is say the permission behind it is gone, so a reader is not left
            wondering why a source that is off has a row at all. The string is
            imported rather than written here: Settings says it too, and two
            renderers of one sentence is what rule 20 forbids. */}
        {stale && (
          <div style={{ marginTop: 2 }}>{SETTINGS_CONSENT_STALE_READING}</div>
        )}
      </div>
      <div role="cell" style={{ display: "flex", alignItems: "baseline", gap: 10, whiteSpace: "nowrap", fontSize: 12 }}>
        <span style={{ fontWeight: 600 }}>{AGENT_RESULT_LABEL[reading.result]}</span>
        {/* Each source keeps its own date. Never the run's, never the newest. */}
        <span>{formatDate(reading.observedAt, locale)}</span>
      </div>
    </div>
  );
}

/**
 * Agent access, top to bottom: the verdict word, one paragraph naming which
 * half is at fault, the next action with a link to the case, then every
 * reading.
 *
 * The order is the point. A reader who stops after the first line has the
 * conclusion; one who stops after the second knows whether the problem is
 * getting in or being understood; one who reads on gets the single next step
 * and then, underneath, every reading it was drawn from — unmerged.
 */
/**
 * What the ledger needs to know about consent, and nothing more.
 *
 * The live boolean and the record behind it. Both, because "is this reading
 * stale" cannot be answered from the boolean alone: a project that connected,
 * disconnected and connected again has readings from two permitted stretches,
 * and only the history says which side of the current withdrawal each one
 * falls on.
 */
export interface AgentAccessConsent {
  on: boolean;
  history: readonly ExternalAgentConsentEntry[];
}

export function AgentAccessPanel({
  access,
  caseHref,
  locale,
  consent,
}: {
  access: AgentAccess;
  /** Resolves a family key to `/issues/{id}`. Absent while no case exists yet. */
  caseHref?: (key: string) => string | undefined;
  locale?: string;
  consent?: AgentAccessConsent;
}) {
  const agreement = agentAgreement(access);
  const href = access.primary ? caseHref?.(access.primary.key) : undefined;
  const disagreement = access.verdict === "unknown" && access.cause === "disagree"
    ? access.disagreement
    : null;
  const conflicting = new Set(disagreement?.map((reading) => reading.source));

  return (
    <section
      aria-labelledby="agent-access-heading"
      style={{ background: "var(--surface-card)", border: "1px solid var(--border-hairline)", borderRadius: 13, padding: "17px 20px", marginBottom: 16 }}
    >
      <h2 id="agent-access-heading" style={{ margin: "0 0 10px", fontSize: 14.5, fontWeight: 600 }}>
        {AGENT_TITLE}
      </h2>

      {/* 1. The verdict word, and the date it rests on. Inseparable by design. */}
      <VerdictLine verdict={access.verdict} lastChecked={access.lastChecked} locale={locale} fontSize={13} />

      {/* 2. One paragraph. For a failing verdict it names the half at fault; for
             Unknown it names which of the two causes applies. Never both, and
             the type makes never-neither a compile-time fact.

             Ready has no paragraph rather than an empty one: there is nothing
             at fault and nothing withheld, and the agreement line under the
             table already says what the verdict rests on. */}
      {access.verdict !== "ready" && (
        <p style={{ margin: "10px 0 0", fontSize: 12.5, lineHeight: 1.55, color: "var(--text-muted)", maxWidth: "72ch" }}>
          {access.verdict === "unknown" ? AGENT_UNKNOWN[access.cause] : AGENT_CAUSE[access.fault]}
          {access.primary && ` ${access.primary.title}.`}
        </p>
      )}

      {/* 2a. The two readings that contradict each other, adjacent, so the
              reader can see the disagreement rather than take it on trust. */}
      {disagreement && (
        <div role="table" aria-label="Conflicting readings" style={{ marginTop: 10, border: "1px solid var(--border-hairline)", borderRadius: 9, padding: "0 12px" }}>
          {disagreement.map((reading) => (
            <ReadingRow key={`conflict-${reading.source}`} reading={reading} locale={locale} consent={consent} />
          ))}
        </div>
      )}

      {/* 3. The next action, and the case it belongs to. One case, named — not
             a list of every cause that contributed. */}
      {access.primary && (
        <div style={{ marginTop: 12 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-muted)" }}>{AGENT_NEXT_ACTION}</div>
          <div style={{ fontSize: 12.5, marginTop: 2, lineHeight: 1.5 }}>
            {access.primary.nextAction}
            {href && (
              <>
                {" "}
                <Link href={href} style={{ color: "var(--action-primary-ink)", fontWeight: 600 }}>
                  Open the case
                </Link>
              </>
            )}
          </div>
        </div>
      )}

      {/* 4. Every reading. */}
      <div role="table" aria-labelledby="agent-readings-heading" style={{ marginTop: 16 }}>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12 }}>
          <h3 id="agent-readings-heading" style={{ margin: 0, fontSize: 13, fontWeight: 600 }}>
            {AGENT_READINGS_LABEL}
          </h3>
          <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
            {agentReadingsCount(AGENT_ACCESS_SOURCES.length)}
          </span>
        </div>
        {access.readings.map((reading) => (
          <ReadingRow
            key={reading.source}
            reading={reading}
            locale={locale}
            highlight={conflicting.has(reading.source)}
            consent={consent}
          />
        ))}
        <p style={{ margin: "10px 0 0", fontSize: 12, color: "var(--text-muted)", lineHeight: 1.5 }}>
          {disagreement
            ? agentReadingsConflict(
              EVIDENCE_SOURCE_LABEL[disagreement[0].source],
              EVIDENCE_SOURCE_LABEL[disagreement[1].source],
            )
            : agentReadingsAgree(agreement.count, agreement.result, access.verdict)}
        </p>
      </div>
    </section>
  );
}

/* ── The case list underneath ───────────────────────────────────────────── */

/** Every state reads differently, in the registry's own words. */
export function agentStatusLabel(status: AgentIssueStatus): string {
  return AGENT_RESULT_LABEL[AGENT_RESULT_FOR_STATUS[status]];
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

function IssueRow({
  issue,
  canManage,
  onTrack,
  tracked,
  href,
}: {
  issue: AgentIssueCase;
  canManage: boolean;
  onTrack?: (issue: AgentIssueCase) => void;
  tracked?: boolean;
  href?: string;
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

          {/*
            Once a finding is tracked it is a case, so the row links to it
            instead of offering to file it twice. Before that it offers the one
            queue the registry has for work somebody has said yes to.
          */}
          {tracked && href && (
            <Link href={href} style={{ display: "inline-block", marginTop: 12, fontSize: 12, fontWeight: 600, color: "var(--action-primary-ink)" }}>
              Open the case
            </Link>
          )}
          {!tracked && onTrack && canManage && (
            <button
              type="button"
              onClick={() => onTrack(issue)}
              style={{
                marginTop: 12,
                border: "1px solid var(--border-strong)",
                background: "transparent",
                color: "var(--text-muted)",
                fontSize: 12,
                fontWeight: 600,
                padding: "7px 11px",
                borderRadius: 7,
                cursor: "pointer",
              }}
            >
              {`Add to the ${QUEUE_LABEL.fix} queue`}
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
  onTrack,
  trackedKeys,
  caseHref,
}: {
  cases: AgentIssueCase[];
  canManage: boolean;
  onTrack?: (issue: AgentIssueCase) => void;
  trackedKeys?: Set<string>;
  caseHref?: (key: string) => string | undefined;
}) {
  const [showResolved, setShowResolved] = useState(false);
  const open = cases.filter((issue) => issue.status === "failed" || issue.status === "partial");
  const rest = cases.filter((issue) => issue.status !== "failed" && issue.status !== "partial");
  const rowFor = (issue: AgentIssueCase) => {
    const tracked = trackedKeys?.has(issue.key) ?? false;
    const href = caseHref?.(issue.key);
    return (
      <IssueRow
        key={issue.key}
        issue={issue}
        canManage={canManage}
        onTrack={onTrack}
        tracked={tracked}
        {...(href ? { href } : {})}
      />
    );
  };

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
      <ul style={{ margin: 0, padding: 0 }}>{open.map(rowFor)}</ul>

      {rest.length > 0 && (
        <>
          <button
            type="button"
            onClick={() => setShowResolved((value) => !value)}
            aria-expanded={showResolved}
            style={{ border: "none", background: "none", color: "var(--action-primary-ink)", fontSize: 12, fontWeight: 600, padding: 0, marginTop: 12, cursor: "pointer" }}
          >
            {showResolved
              ? "Hide the issues that are passing, excluded, or not applicable"
              : `Show ${rest.length} passing, excluded, or not-applicable issue${rest.length === 1 ? "" : "s"}`}
          </button>
          {showResolved && <ul style={{ margin: "6px 0 0", padding: 0 }}>{rest.map(rowFor)}</ul>}
        </>
      )}
    </section>
  );
}

/**
 * Compact verdict for the pages overview.
 *
 * Takes the date for the same reason the panel does: this is the same verdict,
 * and a verdict is never rendered without the date it was last checked. Never a
 * provider score.
 */
export function AgentAccessChip({
  verdict,
  lastChecked,
  locale,
}: {
  verdict: AgentVerdict;
  lastChecked: string | undefined;
  locale?: string;
}) {
  return <VerdictLine verdict={verdict} lastChecked={lastChecked} locale={locale} />;
}
