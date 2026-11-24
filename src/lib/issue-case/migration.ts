import type {
  FieldOnlyRecommendationSignal,
  Rec,
  RecStatus,
  Strategy,
  TaskStatus,
} from "../types";
import type { Caller } from "../caller";
import { isFieldRecommendationActionable, fieldRecommendationLifecycleStatus } from "../fieldOnlyRecommendations";
import { parseMarkerDate } from "../ui";
import type { AgentEvidenceSystem, AgentIssueCase, AgentIssueStatus } from "../agentIssueCases";
import { remediationFor } from "../remediation";
import { caseTitleFor, lcpElementEvidenceLine, lcpElementStatement } from "../case-titles";
import { formatBytes, formatImpact } from "../impact-units";
import type { Effort, EvidenceEntry, EvidenceSource, HistoryEntry, ImpactOrigin, IssueCase, IssueState, ProgressState } from "./core";
import {
  PROGRESS_RANK,
  actionabilityFrom,
  confidenceFrom,
  hasMeasuredBytes,
  hasMeasuredImpact,
  parseEffort,
  parseImpactBytes,
  parseImpactMs,
} from "./core";

/* ── Migration: derived views of the retired lifecycles ─────────────────── */

/**
 * `Rec.status` as a read-only view of the case state.
 *
 * Here so screens can be moved across one at a time. Nothing should write
 * `Rec.status`; when the last reader is gone, this and `taskStatusOf` go with
 * it.
 */
export function recStatusOf(state: IssueState): RecStatus {
  if (state === "dismissed") return "ignored";
  if (state === "new" || state === "reopened") return "inbox";
  return "task";
}

/** `Rec.taskStatus` as a read-only view of the case state. See `recStatusOf`. */
export function taskStatusOf(state: IssueState): TaskStatus {
  if (state === "in_progress") return "in-progress";
  if (state === "fixed" || state === "resolved") return "done";
  return "todo";
}

/* ── Migration adapters ─────────────────────────────────────────── */

/** `Rec.status` on its own says how far triage got, and nothing about work. */
function stateFromRecStatus(status: RecStatus): ProgressState {
  return status === "task" ? "todo" : "new";
}

/**
 * `Rec.taskStatus` on its own says how far work got, and nothing about triage.
 *
 * "done" lands on `resolved`, not `fixed`. `fixed` means "the change shipped,
 * evidence has not agreed yet", which puts the case in Watch with a checkpoint
 * due — and every one of these records is months old with no checkpoint behind
 * it, so `fixed` would flood Watch with work nobody is going to re-verify. A
 * person ticking a task off is the closest thing the legacy data has to an
 * agreed outcome. `fromRec` writes the missing-evidence caveat into history so
 * the gap is recorded rather than implied.
 *
 * The `done` arm must stay in step with `taskStatusWorkState` in
 * `src/lib/workState.ts`, which is the same decision for display. The other two
 * arms differ on purpose: there, `todo` means the work state `todo`; here it
 * means `new`, because `taskStatus` alone carries no triage information.
 */
function stateFromTaskStatus(taskStatus: TaskStatus): ProgressState {
  if (taskStatus === "in-progress") return "in_progress";
  if (taskStatus === "done") return "resolved";
  return "new";
}

/**
 * The plan this case arrives with, and where it came from.
 *
 * Three sources, in the order the brief fixes: steps the caller passed
 * explicitly, then the steps the record itself carries, then the remediation
 * library for the audit. Empty steps count as absent at every step of the way —
 * an agent issue with `remediation: []` documented nothing, so the library's
 * steps are the next real answer rather than a reason to stop.
 *
 * A plan a person writes for one case does not come through here at all:
 * `applyCasePlans` runs after grouping and overrides whatever this produced, so
 * a user-authored plan still wins over the library.
 */
function planFor(
  rec: Rec,
  options: FromRecOptions,
): { steps: string[]; successCriteria: string; fromLibrary: boolean } {
  const explicit = options.remediationSteps?.filter((step) => step.trim() !== "");
  if (explicit && explicit.length > 0) {
    return { steps: explicit, successCriteria: options.successCriteria ?? "", fromLibrary: false };
  }
  const recorded = rec.agentIssue?.remediation?.filter((step) => step.trim() !== "");
  if (recorded && recorded.length > 0) {
    return {
      steps: recorded,
      successCriteria: options.successCriteria ?? rec.agentIssue?.successCriteria ?? "",
      fromLibrary: false,
    };
  }
  const library = remediationFor(rec.id, rec.title);
  if (library) {
    return {
      steps: [...library.steps],
      successCriteria: options.successCriteria ?? library.successCriteria,
      fromLibrary: true,
    };
  }
  return {
    steps: [],
    successCriteria: options.successCriteria ?? rec.agentIssue?.successCriteria ?? "",
    fromLibrary: false,
  };
}

/**
 * The adapters below are a system caller, and they say which one.
 *
 * `migration` is an agent name rather than a class: the rows it writes are
 * about a record that arrived from the old lifecycles, and "the system did it"
 * would not tell a reader that three weeks later.
 */
const MIGRATION_CALLER: Caller = { kind: "system", agent: "migration" };

export interface FromRecOptions {
  /**
   * Grouping key. Two findings that share it are one case. Defaults to the
   * audit id, which groups the same audit across pages; pass
   * `${culpritHost}:${auditId}` where the culprit is known.
   */
  cause?: string;
  /** One plain sentence naming the symptom. Defaults to the record's summary. */
  diagnosis?: string;
  /** What would prove this fixed. Defaults to the agent issue's criteria. */
  successCriteria?: string;
  /** Ordered steps. Defaults to the agent issue's steps. */
  remediationSteps?: string[];
  /** ISO. Defaults to the best timestamp the record carries. */
  detectedAt?: string;
  /** Corroborating runs behind the finding. The record does not carry a count. */
  confirmedRuns?: number;
  trigger?: IssueCase["trigger"];
  /** Reference year for records whose `added` is a display date such as "Jul 16". */
  referenceYear?: number;
  /** ISO stamp for any migration history entry. Defaults to now. */
  at?: string;
}

function earliestSignalDate(signals: Partial<Record<Strategy, FieldOnlyRecommendationSignal>> | undefined): string | undefined {
  const dates = Object.values(signals ?? {})
    .flatMap((signal) => (signal?.detectedAt ? [signal.detectedAt] : []))
    .sort();
  return dates[0];
}

function detectedAtFor(rec: Rec, options: FromRecOptions): string {
  if (options.detectedAt) return options.detectedAt;
  if (rec.agentIssue?.capturedAt) return rec.agentIssue.capturedAt;
  const signal = earliestSignalDate(rec.fieldSignals);
  if (signal) return signal;
  const parsed = parseMarkerDate(rec.added, options.referenceYear);
  return parsed ? parsed.toISOString() : "";
}

export const EVIDENCE_SOURCE: Record<NonNullable<Rec["source"]>, EvidenceSource> = {
  lighthouse: "lighthouse",
  "crux-field-only": "crux",
  "native-elements": "native-elements",
  // Page Watch's own HTTP checks are the thing that flagged this record, and
  // from v5 the agent-readiness slot carries only that reading.
  "agent-readiness": "agent-readiness",
};

/**
 * Whether this record's reading came from real visitors or from a test.
 *
 * Read off the source that produced it, never off which field happens to hold a
 * number. CrUX is what real visitors experienced; a native-element scan and Page
 * Watch's own checks read the published page as it is served. Lighthouse is a
 * simulated test on a throttled machine, and a record written before `source`
 * existed (all of which came from Lighthouse) is simulated too.
 *
 * Absent when nothing was measured: an origin without a reading would be a claim
 * about a measurement nobody took.
 */
export function impactOriginFromRec(rec: Pick<Rec, "source" | "savings"> & { savingsBytes?: number }): ImpactOrigin | undefined {
  const measured = parseImpactMs(rec.savings) > 0
    || hasMeasuredBytes(rec.savingsBytes)
    || parseImpactBytes(rec.savings) > 0;
  if (!measured) return undefined;
  return rec.source === undefined || rec.source === "lighthouse" ? "simulated" : "observed";
}

/**
 * The record's own source reading.
 *
 * A recommendation exists because a source flagged it, so the reading supports
 * the diagnosis — except for a field-only record whose CrUX windows have since
 * come good, where the source no longer says the problem is there. The wording
 * is the source's, never Page Watch's.
 */
function evidenceFromRec(rec: Rec, observedAt: string): EvidenceEntry[] {
  // Records written before `source` existed all came from Lighthouse.
  const source = EVIDENCE_SOURCE[rec.source ?? "lighthouse"];
  const signal = Object.values(rec.fieldSignals ?? {}).find(Boolean);
  // Both units where both were measured. A third-party finding transfers bytes
  // AND blocks the thread, and the case is about both: "1.2 s, 2.4 MB" is the
  // reading, and the one number the row shows is not the whole of it.
  const ms = parseImpactMs(rec.savings);
  const bytes = rec.savingsBytes ?? parseImpactBytes(rec.savings);
  const measured = [
    hasMeasuredImpact(ms) ? formatImpact(ms).text : "",
    hasMeasuredBytes(bytes) ? formatBytes(bytes).text : "",
  ].filter(Boolean);
  // The element the reading is about, when the record knows it: "the image
  // visitors wait for is this <img>, loading late" belongs beside the number it
  // is responsible for.
  const elementNote = rec.lcpElement ? `; ${lcpElementEvidenceLine(rec.lcpElement)}` : "";
  const reading = signal
    ? `${signal.metricLabel} ${signal.fieldFormatted} (${signal.fieldRating})`
    : measured.length > 0
      ? `${rec.title} — ${measured.join(", ")}${elementNote}`
      : rec.savings
        ? `${rec.title} — ${rec.savings}${elementNote}`
        : rec.title;
  return [{
    source,
    reading,
    observedAt: signal?.detectedAt ?? observedAt,
    supports: rec.source === "crux-field-only" ? isFieldRecommendationActionable(rec) : true,
  }];
}

/**
 * One case from one legacy recommendation.
 *
 * The four old lifecycles are read here and nowhere else. `Rec.status` says how
 * far triage got and `Rec.taskStatus` says how far work got, so the pair is
 * resolved to whichever is further along; where they disagree — a record still
 * untriaged but marked done — the later state wins and the disagreement is
 * written into history by the `migration` agent rather than quietly
 * discarded. A field lifecycle that has resolved or regressed, and an agent
 * verification that came back, are newer information than either, so they
 * override the pair and are recorded the same way.
 */
export function fromRec(rec: Rec, options: FromRecOptions = {}): IssueCase {
  const at = options.at ?? new Date().toISOString();
  const history: HistoryEntry[] = [];
  const note = (to: IssueState, reason: string, from?: IssueState) => {
    history.push({ at, ...(from ? { from } : {}), to, by: MIGRATION_CALLER, reason });
  };

  const fromStatus = stateFromRecStatus(rec.status);
  const fromTask = stateFromTaskStatus(rec.taskStatus);
  const merged: ProgressState = PROGRESS_RANK[fromTask] > PROGRESS_RANK[fromStatus] ? fromTask : fromStatus;

  let state: IssueState = merged;
  if (rec.status === "ignored") {
    state = "dismissed";
    if (rec.taskStatus !== "todo") {
      note("dismissed", `Legacy pair "${rec.status}" + "${rec.taskStatus}" disagreed: the record was set aside while carrying work progress. Set aside wins, because it is a decision rather than progress.`);
    }
  } else if (rec.status === "inbox" && rec.taskStatus !== "todo") {
    // Triage never happened, yet work did. The only genuinely contradictory
    // pairing: every other combination is a coherent point on the old flow.
    note(merged, `Legacy pair "${rec.status}" + "${rec.taskStatus}" disagreed: the record was never triaged yet carried work progress. Resolved to the later state.`);
  }

  if (state === "resolved") {
    // Only reachable from a legacy "done". `resolved` normally means the
    // evidence agreed and held; here nobody measured. Recording the gap is the
    // condition on which mapping "done" to `resolved` was accepted — without
    // it the case would claim a verification that never happened.
    note("resolved", `Legacy "${rec.taskStatus}" migrated to Resolved. No checkpoint evidence was gathered: the old lifecycle recorded that someone marked the work complete, never that a check agreed. Treat the outcome as asserted, not verified.`);
  }

  const fieldLifecycle = fieldRecommendationLifecycleStatus(rec);
  const verification = rec.agentIssue?.verification?.status;
  if (verification === "returned" || fieldLifecycle === "regressed") {
    note("reopened", verification === "returned"
      ? "A verification run found the problem back, which is newer than the stored pair."
      : "A field check found the problem back, which is newer than the stored pair.", state);
    state = "reopened";
  } else if (fieldLifecycle === "resolved") {
    if (state !== "resolved") {
      note("resolved", "The field lifecycle had already settled, which is newer than the stored pair.", state);
      state = "resolved";
    }
  }

  const detectedAt = detectedAtFor(rec, options);
  const evidence = evidenceFromRec(rec, detectedAt);
  const plan = planFor(rec, options);
  const pageIds = [rec.pageId];
  const classification = actionabilityFrom(rec.webflow?.actionability);
  /**
   * A library plan is documented remediation, so the audit is no longer a case
   * with nothing to accept. Without this an accessibility audit, whose
   * classifier answer is "no documented remediation", would carry five concrete
   * steps under a header saying there is no action — the one screen contradicting
   * itself. A plan a person wrote does not change actionability here, because
   * that is their own note rather than documentation.
   */
  const actionability = plan.fromLibrary && classification === "none" ? "direct" : classification;
  // The stored byte figure first; a record written before it existed carries
  // the same number inside its `savings` label ("180 KB"), which is parsed
  // rather than read a second time from a second field.
  const impactBytes = rec.savingsBytes ?? parseImpactBytes(rec.savings);
  const impactOrigin = impactOriginFromRec(rec);
  const impact = {
    impactMs: parseImpactMs(rec.savings),
    ...(hasMeasuredBytes(impactBytes) ? { impactBytes } : {}),
    ...(impactOrigin ? { impactOrigin } : {}),
  };

  return {
    id: rec.key,
    cause: options.cause ?? rec.id,
    state,
    // The audit id stays the cause; the name on screen is a symptom (rule 5's
    // plain language), which is not always what the source called it.
    title: caseTitleFor(rec.id, rec.title),
    // Never the audit title. An LCP record that names its element gets the
    // element's own sentence — the readable name and the attributes it carries,
    // which is the half a reader can act on — ahead of any prose written about
    // the finding. Otherwise the record's own sentence, or nothing: authoring one
    // here would put copy in a logic module.
    // A record's own plain sentence comes first because it is about the page —
    // "the marquee's first image" — and the element facts are in the evidence
    // line either way. With no sentence, the element statement stands.
    diagnosis: options.diagnosis
      ?? rec.aiSummary
      ?? (rec.lcpElement ? lcpElementStatement(rec.lcpElement) : undefined)
      ?? "",
    detectedAt,
    // A run count when the source keeps one, otherwise the adapter's own
    // corroboration count and finally 0, which the detail renders as nothing.
    confirmedRuns: options.confirmedRuns ?? rec.observedRuns ?? 0,
    ...(options.trigger ? { trigger: options.trigger } : {}),
    scope: rec.agentIssue?.scope === "origin" ? "origin" : "page",
    pageIds,
    strategies: rec.strategies ?? [],
    ...impact,
    effort: parseEffort(rec.estTime),
    confidence: confidenceFrom(evidence),
    remediation: { steps: plan.steps, actionability },
    successCriteria: plan.successCriteria,
    checkpoints: [],
    evidence,
    history,
  };
}

/**
 * Which ledger slot each agent evidence system writes to.
 *
 * Exported, with the record above, so registry rule 15 can be checked rather
 * than asserted in prose: between them these two maps are every producer in the
 * app, and their values must be exactly `EVIDENCE_SOURCES`. A slot nothing
 * writes to reads to the user as a reading that found nothing.
 *
 * Ora has its own slot from v5. Sharing one with Page Watch's checks meant
 * `confidenceFrom` counted the two as a single voice, so a disagreement between
 * them could never reach `unclear` — the exact failure the ledger exists to
 * catch. There is deliberately no `is-agentic` slot: rule 15 says a slot with no
 * producer is not a slot, and it returns with its producer in the same change.
 */
export const EVIDENCE_SOURCE_FOR_AGENT_SYSTEM: Record<AgentEvidenceSystem, EvidenceSource> = {
  "page-watch": "agent-readiness",
  ora: "ora",
  kitesurf: "kitesurf",
};

/** Fixed ledger order, so two runs over the same data read identically. */
const AGENT_SYSTEM_ORDER: readonly AgentEvidenceSystem[] = ["page-watch", "ora", "kitesurf"];

export interface FromAgentIssueOptions {
  /** Case id. Defaults to the issue's family key. */
  id?: string;
  cause?: string;
  /** Pages the origin issue was observed on. */
  pageIds?: string[];
  diagnosis?: string;
  detectedAt?: string;
  effort?: Effort;
  impactMs?: number;
  trigger?: IssueCase["trigger"];
  /** Agent verification carried over from the record this issue was promoted to. */
  verification?: "not-started" | "verifying" | "resolved" | "returned" | "unavailable";
  state?: IssueState;
  at?: string;
}

/**
 * One case from one assembled agent-access issue.
 *
 * Every evidence system writes its own entry, in its own words, with its own
 * observedAt. Page Watch's HTTP checks, Ora, and Kitesurf are separate systems
 * that read the same origin independently, so the ledger keeps them separate
 * and this adapter neither picks a winner nor merges them.
 *
 * That separation is the point. Page Watch and Ora can disagree about the same
 * origin, and when they do, `confidenceFrom` returns `unclear` rather than
 * letting the more severe or more numerous reading carry the conclusion. A
 * merged entry could not express that — it would have already resolved the
 * disagreement before anyone saw it.
 */
export function fromAgentIssue(issue: AgentIssueCase, options: FromAgentIssueOptions = {}): IssueCase {
  const at = options.at ?? new Date().toISOString();
  const affirms = (result: string) => result === "failed" || result === "partial";

  // `ignored` and `not-applicable` say whether a check counts on this site, or
  // state a policy. Neither is a reading about whether the problem is there, so
  // neither belongs in the ledger — and treating them as absence of the problem
  // would fold a decision about scope into a decision about work.
  //
  // `unavailable` is left out for the same reason from the other direction: the
  // system could not take a reading at all. `supports` is a boolean, so an
  // unavailable source that reached the ledger would land as `supports: false`
  // and count in `confidenceFrom` as a system that disagrees — which is how a
  // provider outage silently turned a corroborated diagnosis into "Unclear".
  // Registry rule 18 and the checkpoint concept both say the same thing: an
  // absent measurement is neither agreement nor disagreement. The assembler
  // already keeps these five outcomes apart in `caseStatus` and
  // `caseConfidence`; this is the adapter agreeing with it.
  const UNREADABLE: readonly AgentIssueStatus[] = ["ignored", "not-applicable", "unavailable"];
  const readable = issue.sources.filter((source) => !UNREADABLE.includes(source.result));

  const describe = (sources: typeof readable) =>
    sources.map((source) => source.detail ? `${source.label}: ${source.detail}` : source.label).join(" · ");
  const observed = (sources: typeof readable) =>
    sources.flatMap((source) => source.observedAt ? [source.observedAt] : []).sort().at(-1)
    ?? options.detectedAt ?? at;

  // One entry per system that actually reported, in a fixed order so the ledger
  // reads the same way on every run. A system with nothing readable to say adds
  // no entry at all — silence is not a reading.
  const evidence: EvidenceEntry[] = AGENT_SYSTEM_ORDER.flatMap((system) => {
    const sources = readable.filter((source) => source.system === system);
    if (!sources.length) return [];
    return [{
      source: EVIDENCE_SOURCE_FOR_AGENT_SYSTEM[system],
      reading: describe(sources),
      observedAt: observed(sources),
      supports: sources.some((source) => affirms(source.result)),
    }];
  });

  const history: HistoryEntry[] = [];
  let state: IssueState = options.state ?? "new";
  if (options.verification === "returned" && state !== "reopened") {
    history.push({
      at,
      from: state,
      to: "reopened",
      by: MIGRATION_CALLER,
      reason: "A verification run found the problem back.",
    });
    state = "reopened";
  }

  const pageIds = options.pageIds ?? [];
  return {
    id: options.id ?? issue.key,
    cause: options.cause ?? issue.key,
    state,
    title: issue.title,
    // The assembler's consequence line is the plain sentence for this family.
    diagnosis: options.diagnosis ?? issue.consequence,
    detectedAt: options.detectedAt ?? observed(readable),
    // Independent systems that reported a determined result, not a run count.
    confirmedRuns: new Set(readable.filter((source) => affirms(source.result)).map((source) => source.system)).size,
    ...(options.trigger ? { trigger: options.trigger } : {}),
    scope: issue.scope === "origin" ? "origin" : pageIds.length > 1 ? "pages" : "page",
    pageIds,
    strategies: [],
    impactMs: options.impactMs ?? 0,
    effort: options.effort ?? "unknown",
    confidence: confidenceFrom(evidence),
    remediation: { steps: issue.remediation, actionability: issue.remediation.length ? "direct" : "none" },
    successCriteria: issue.successCriteria,
    checkpoints: [],
    evidence,
    history,
  };
}
