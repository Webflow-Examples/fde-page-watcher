/**
 * The canonical issue case.
 *
 * Page Watch grew four independent lifecycles over the same problem —
 * `Rec.status`, `Rec.taskStatus`, the per-strategy field lifecycle, and the
 * agent verification status. Nothing stopped them contradicting each other, so
 * a record could be untriaged and finished at the same time and every screen
 * picked a different field to trust. That is the mechanism behind the audit's
 * "same finding explained four different ways".
 *
 * This module replaces all four with one object holding one lifecycle field.
 * The old lifecycles survive only as inputs to the adapters at the bottom of
 * this file and as the derived getters `recStatusOf` / `taskStatusOf`, which
 * exist so screens can be moved over one at a time and deleted when the last
 * reader is gone.
 *
 * Three rules this module keeps:
 *
 *   1. Nothing user-facing is authored here. Status words come from
 *      `vocabulary.ts`; titles, remediation, and diagnoses come from the data.
 *      A logic module that writes copy is how two vocabularies start.
 *   2. Two sources are never averaged, summed, or composited into one number.
 *      The ledger keeps each reading in its own source's words, and confidence
 *      is a count of agreement, not a score.
 *   3. Every state change goes through the registry's transition table. An
 *      illegal move throws rather than being quietly allowed.
 */

import type {
  CustomerActionability,
  FieldOnlyRecommendationSignal,
  Rec,
  RecStatus,
  Strategy,
  TaskStatus,
} from "./types";
import {
  APPLICABILITY_TRANSITIONS,
  COUNTED_QUEUES,
  DISMISS_REASONS,
  EXCLUSION_REASONS,
  ISSUE_TRANSITIONS,
  QUEUE_HOLDS,
  WORK_STATES,
  type Actionability,
  type Applicability,
  type CheckpointResult,
  type Confidence,
  type DismissReason,
  type EvidenceSource,
  type ExclusionReason,
  type IssueAction,
  type Queue,
  type WorkState,
} from "./vocabulary";
import { historyExcluded, historyIncluded } from "./case-copy";
import { isFieldRecommendationActionable, fieldRecommendationLifecycleStatus } from "./fieldOnlyRecommendations";
import { parseMarkerDate } from "./ui";
import type { AgentEvidenceSystem, AgentIssueCase, AgentIssueStatus } from "./agentIssueCases";

/**
 * The one lifecycle union, imported rather than redeclared.
 *
 * `vocabulary.ts` calls it `WorkState` because the registry concept is
 * `work_state`; the field on a case is `issue.state`, so this file uses the
 * name the field has. It is an alias for the imported union, not a second
 * declaration — if the registry gains or loses a state, this changes with it.
 */
export type IssueState = WorkState;

export type { WorkState };

/* ── The object ─────────────────────────────────────────────────────────── */

/** One reading from one evidence system, in that system's own words. */
export interface EvidenceEntry {
  source: EvidenceSource;
  /** human-readable, source's own words */
  reading: string;
  /** ISO — each source keeps its own */
  observedAt: string;
  /** does this reading support the diagnosis */
  supports: boolean;
}

export type { EvidenceSource };

/** How much of a fix this is, as a band rather than an estimate. */
export type Effort = "minutes" | "hours" | "days" | "unknown";

/** Whether the person reading this can act on it, and who owns it if not. */
export type { Actionability };

export type CheckpointInterval = "2d" | "7d" | "30d";
export type { CheckpointResult };

export interface Checkpoint {
  interval: CheckpointInterval;
  due?: string;
  result?: CheckpointResult;
  /**
   * How many times the collector has tried to take this reading.
   *
   * Absent until something tries. Evaluation rule 2 allows exactly one retry
   * after a failure to read, and this is what distinguishes the first
   * unavailable reading — which buys the retry and moves `due` — from the
   * second, which records Unavailable and lets the run carry on.
   */
  attempts?: number;
}

export interface HistoryEntry {
  at: string;
  from?: IssueState;
  to: IssueState;
  actor: string;
  reason?: string;
}

/**
 * Whether an entry records a move between states or a note against one.
 *
 * History is a log of events, not only of transitions: a checkpoint that could
 * not be read is something that happened, and rule 16 owes the reader the
 * sentence for it. Those entries carry the same state on both sides, which is
 * the honest encoding of "the case did not move" — but it means a renderer that
 * assumes every entry is a move will draw "Fixed → Fixed", which is worse than
 * drawing nothing.
 *
 * So the distinction is a function rather than a convention. Ask this instead of
 * comparing `from` and `to`, and the arrow cannot appear on a note. An entry
 * with no `from` is a transition whose origin was not recorded — migrated
 * history — not a note.
 */
export function isTransition(entry: HistoryEntry): boolean {
  return entry.from === undefined || entry.from !== entry.to;
}

export interface Remediation {
  steps: string[];
  actionability: Actionability;
}

export interface IssueCase {
  id: string;                    // "PW-2291", stable and user-visible
  cause: string;                 // grouping key: culprit + audit id
  state: IssueState;             // the ONLY lifecycle field
  // 1 diagnosis — one plain sentence, present tense, names the symptom
  //   a person notices. Never an audit title.
  title: string;
  diagnosis: string;
  // 2 why now — what changed and when it was corroborated
  detectedAt: string;            // ISO
  confirmedRuns: number;
  trigger?: { kind: "publish" | "provider" | "threshold"; at: string };
  // 3 scope
  scope: "page" | "pages" | "origin";
  pageIds: string[];
  /**
   * Pages this case covers but does not count, by page id.
   *
   * Absent or empty means every page is included, which is the default a case
   * arrives with. This is the registry's `applicability` concept applied to a
   * new object, not a second lifecycle: the case's state says how far along the
   * work is, and this says which of its pages the work is about. A page can be
   * excluded and the case still be `todo`; the two never contradict because
   * they answer different questions.
   *
   * Excluding is not deleting. The page keeps its row and its reading, and the
   * reason is shown — hiding evidence without saying why is what the audit says
   * cost the agent tab its trust.
   */
  excludedPages?: Record<string, ExclusionReason>;
  strategies: Strategy[];        // mobile and/or desktop
  // 4 impact — ONE unit each. No display strings.
  impactMs: number;
  effort: Effort;
  // 5 confidence — derived from source agreement, never a composite score.
  //   The union is imported, not restated: the registry owns the three values
  //   and a fourth added there must not be silently unrepresentable here.
  confidence: Confidence;
  // 6 remediation — a case with no steps cannot be accepted
  remediation: Remediation;
  // 7 success criteria — what would prove this fixed
  successCriteria: string;
  checkpoints: Checkpoint[];
  // 8 evidence ledger — one entry per source, NEVER averaged
  evidence: EvidenceEntry[];
  // 9 history — every transition, append-only
  history: HistoryEntry[];
  // work view (D4) — added in place, never a copy
  owner?: string;
  checklist?: { text: string; done: boolean }[];
  notes?: string;
}

/** Thrown for an illegal transition, a missing reason, or a duplicated source. */
export class IssueCaseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IssueCaseError";
  }
}

/* ── Queue membership — derived, never stored ───────────────────────────── */

/**
 * The queue a state appears in.
 *
 * Derived from the registry's `queue.holds`, over the counted queues only:
 * `show_all` holds `"*"` because it is the unfiltered view rather than a queue
 * (registry rule 1), so including it would put every state in two queues. A
 * state no counted queue claims is reachable only through Show all.
 */
export function queueOf(state: IssueState): Queue {
  const holder = COUNTED_QUEUES.find((queue) => QUEUE_HOLDS[queue].includes(state));
  return holder ?? "show_all";
}

/** The cases in one queue. Show all is unfiltered, exactly as the registry says. */
export function casesInQueue(cases: readonly IssueCase[], queue: Queue): IssueCase[] {
  if (queue === "show_all") return [...cases];
  return cases.filter((item) => queueOf(item.state) === queue);
}

/* ── Impact and effort parsers — one place, both tested ─────────────────── */

/**
 * Milliseconds parsed from a stored `savings` label.
 *
 * The formats in the data are all produced by `formatDiagnosticImpact` or
 * hand-written in fixtures: `"1.8 s"`, `"620 ms"`, `"Field p75 4.8 s"`, and
 * non-measurements like `"Observed"`, `"Detected"`, `"Field signal"`,
 * `"Essential"`, or a byte figure such as `"180 KB"`. Anything that is not a
 * time returns 0 — a case with no measured time has no impact in milliseconds,
 * which is different from having a small one.
 */
export function parseImpactMs(savings: string | null | undefined): number {
  const match = /(\d+(?:\.\d+)?)\s*(ms|s)\b/i.exec(savings ?? "");
  if (!match) return 0;
  const value = Number.parseFloat(match[1]);
  if (!Number.isFinite(value)) return 0;
  return match[2].toLowerCase() === "ms" ? Math.round(value) : Math.round(value * 1000);
}

/**
 * Whether a case carries a time measurement at all.
 *
 * Registry rule 18: an absent measurement is not a small measurement. The 0 the
 * parser above returns means *no reading*, not *a tiny one*, and a case holding
 * it must never be folded, filtered or ranked as though its value were zero.
 * Every caller that would otherwise compare `impactMs` to a number asks this
 * first, so the distinction lives in one place rather than in each screen's
 * idea of what 0 meant.
 */
export function hasMeasuredImpact(impactMs: number): boolean {
  return impactMs > 0;
}

/**
 * Worst measured first, unmeasured last — rule 18's ordering, for any list of
 * things carrying an `impactMs`.
 *
 * The unmeasured ones are moved as a block rather than sorted by their zero,
 * which is what stops a finding with no reading outranking a 1,900 ms one on an
 * empty cell.
 */
export function byWorstMeasured<T extends { impactMs: number }>(left: T, right: T): number {
  const leftMeasured = hasMeasuredImpact(left.impactMs);
  const rightMeasured = hasMeasuredImpact(right.impactMs);
  if (leftMeasured !== rightMeasured) return leftMeasured ? -1 : 1;
  return right.impactMs - left.impactMs;
}

/**
 * Effort band parsed from a stored `estTime` label.
 *
 * A band, not a duration: `"1 day"` and `"5 days"` are both `days`. The count
 * is deliberately dropped, because the stored figure is a coarse guess
 * (`costBand`) and rendering it as a number implies a precision it never had.
 * `"Needs review"` and `"No direct action"` carry no band and return `unknown`.
 */
export function parseEffort(estTime: string | null | undefined): Effort {
  const text = (estTime ?? "").toLowerCase();
  if (/\bday(s)?\b/.test(text)) return "days";
  if (/\bhour(s)?\b|\bhr(s)?\b/.test(text)) return "hours";
  if (/\bminute(s)?\b|\bmin(s)?\b/.test(text)) return "minutes";
  return "unknown";
}

/**
 * How a band ranks when two are merged into one. `unknown` ranks below every
 * known band, so it loses to any of them — a band nobody estimated must not stand in for one
 * somebody did.
 *
 * Not to be unified with the `EFFORT_ORDER` in `components/store.tsx`, which
 * ranks the same four values for a different job: that one sorts least work
 * first and puts `unknown` last, where this one makes `unknown` lose. Same
 * values, two orders, because the two questions are not the same question.
 */
const EFFORT_MERGE_RANK: Record<Effort, number> = { unknown: -1, minutes: 0, hours: 1, days: 2 };

/** The larger of two bands. `unknown` loses to any known band. */
function widerEffort(left: Effort, right: Effort): Effort {
  return EFFORT_MERGE_RANK[left] >= EFFORT_MERGE_RANK[right] ? left : right;
}

/**
 * The case's actionability from the stored Webflow classification.
 *
 * The two vocabularies do not line up one to one. `"none"` is written by
 * `classificationForPage` only when an audit is platform-owned on a Webflow
 * page, so it becomes `platform`; `"review"` means no documented customer
 * remediation exists at all, so it becomes `none` — and a case with no steps
 * cannot be accepted, which is the correct outcome for an audit nobody has
 * written guidance for yet.
 */
export function actionabilityFrom(actionability: CustomerActionability | undefined): Actionability {
  if (actionability === "direct") return "direct";
  if (actionability === "workaround") return "workaround";
  if (actionability === "none") return "platform";
  return "none";
}

/* ── Confidence — counted from the ledger, never scored ─────────────────── */

/**
 * Confidence from source agreement.
 *
 * Two or more sources supporting the diagnosis is `confirmed`; exactly one is
 * `probable`. Any disagreement between sources is `unclear`, and so is a ledger
 * with nothing supporting it — which covers the case where the only reading is
 * an unavailable one.
 *
 * Disagreement wins over volume on purpose. Letting a majority carry the
 * conclusion would be a composite of readings from different sources, which is
 * the thing this module exists to stop; when sources differ, the honest answer
 * is that it is unclear, and the ledger below says who said what.
 */
export function confidenceFrom(evidence: readonly EvidenceEntry[]): IssueCase["confidence"] {
  const supporting = evidence.filter((entry) => entry.supports).length;
  const dissenting = evidence.length - supporting;
  if (supporting === 0) return "unclear";
  if (dissenting > 0) return "unclear";
  return supporting >= 2 ? "confirmed" : "probable";
}

/**
 * Add a reading to the ledger.
 *
 * Append-only: the returned case has a new array with the entry on the end and
 * every existing entry untouched. One entry per source: a second reading from a
 * source already in the ledger throws, because the two are not merged and the
 * later one does not overwrite the earlier. A source that has re-read is
 * handled by rebuilding the case from its adapter, the way the agent-access
 * assembler already rebuilds from scratch each run.
 *
 * Confidence is recomputed from the whole ledger rather than adjusted, so it
 * can never drift from what the entries actually say.
 */
export function appendEvidence(issue: IssueCase, entry: EvidenceEntry): IssueCase {
  if (issue.evidence.some((existing) => existing.source === entry.source)) {
    throw new IssueCaseError(
      `appendEvidence: ${issue.id} already holds a ${entry.source} reading. The ledger keeps one entry per source; rebuild the case instead of merging readings.`,
    );
  }
  const evidence = [...issue.evidence, entry];
  return { ...issue, evidence, confidence: confidenceFrom(evidence) };
}

/* ── Transitions — the registry's table, enforced ───────────────────────── */

export interface TransitionOptions {
  /** Who moved it. Recorded in history verbatim. */
  actor: string;
  /** Required by `dismiss`; must be one of the registry's reasons. */
  reason?: string;
  /** ISO timestamp for the history entry. Defaults to now. */
  at?: string;
}

/** The actions legal from a state, straight from the registry. */
export function actionsFor(state: IssueState): IssueAction[] {
  return (Object.keys(ISSUE_TRANSITIONS) as IssueAction[])
    .filter((action) => ISSUE_TRANSITIONS[action].from.includes(state));
}

export function canApply(issue: IssueCase, action: IssueAction): boolean {
  return ISSUE_TRANSITIONS[action].from.includes(issue.state);
}

function isDismissReason(value: string | undefined): value is DismissReason {
  return typeof value === "string" && (DISMISS_REASONS as readonly string[]).includes(value);
}

/** The three checkpoints a `mark_fixed` schedules, and their offsets. */
const CHECKPOINT_DAYS: Record<CheckpointInterval, number> = { "2d": 2, "7d": 7, "30d": 30 };
const DAY_MS = 86_400_000;

/**
 * The interval whose checkpoint can fire `resolve`.
 *
 * Read off `CHECKPOINT_DAYS` rather than written as "30d", so the schedule and
 * the rule that reads it cannot name different checkpoints. Registry evaluation
 * rule 5: the 2 and 7-day checkpoints never resolve on their own, because
 * Resolved means the evidence agreed *and held*, and holding takes the full
 * span.
 */
export const RESOLVING_INTERVAL: CheckpointInterval = (Object.keys(CHECKPOINT_DAYS) as CheckpointInterval[])
  .reduce((longest, interval) => (CHECKPOINT_DAYS[interval] > CHECKPOINT_DAYS[longest] ? interval : longest));

/**
 * Whether the checkpoints agree, which is what `resolve` requires.
 *
 * The registry states this requirement twice — `action.resolve.requires` is
 * `checkpoint_agreement`, and `checkpoint.evaluation` says what agreement is —
 * and until now nothing read either. `ISSUE_TRANSITIONS.resolve.requires`
 * carried the word while `applyAction` only ever enforced the reason guard, so
 * a case could reach Resolved with three checkpoints still scheduled.
 *
 * The predicate is the registry's three sentences, in order:
 *
 *   - the last checkpoint agreed (evaluation rules 3 and 5), which also means
 *     three unavailable readings do not resolve (rule 4);
 *   - nothing disagreed (rule 1 — a disagreement fires reopen, not resolve);
 *   - anything still scheduled or unavailable is skipped, not counted against
 *     (rules 2 and 3).
 *
 * Scheduling and firing the checkpoints is not implemented here. This is the
 * guard that stops the transition being taken without them.
 */
export function checkpointsAgree(checkpoints: readonly Checkpoint[]): boolean {
  if (checkpoints.some((checkpoint) => checkpoint.result === "disagreed")) return false;
  return checkpoints.some(
    (checkpoint) => checkpoint.interval === RESOLVING_INTERVAL && checkpoint.result === "agreed",
  );
}

/**
 * Move a case through one registry transition.
 *
 * Everything the table forbids throws. Two extra guards sit on top of it,
 * because they are conditions on the case rather than on the state:
 *
 *   - `accept` refuses a case with no remediation steps. Saying yes to work
 *     nobody has written down is how the fix queue fills with items that
 *     cannot be started. `todo` is only reachable through `accept`, so this
 *     guard closes every path to it.
 *   - `dismiss` refuses a reason that is not one the registry blesses.
 *
 * Beyond those, every requirement the registry states on a transition is
 * enforced from the table itself rather than from a per-action branch, so a
 * requirement added to `vocabulary.json` cannot be carried in the type and
 * ignored in the guard the way `checkpoint_agreement` was.
 */
export function applyAction(issue: IssueCase, action: IssueAction, options: TransitionOptions): IssueCase {
  const transition = ISSUE_TRANSITIONS[action];
  if (!transition.from.includes(issue.state)) {
    throw new IssueCaseError(
      `applyAction: ${action} is not legal from ${issue.state} (legal from ${transition.from.join(", ")}).`,
    );
  }
  if (action === "accept" && issue.remediation.steps.length === 0) {
    throw new IssueCaseError(
      `applyAction: ${issue.id} has no remediation steps, so it cannot be accepted. Give it steps first.`,
    );
  }
  if (transition.requiresReason && !isDismissReason(options.reason)) {
    throw new IssueCaseError(
      `applyAction: ${action} requires one of these reasons — ${DISMISS_REASONS.join(", ")}.`,
    );
  }
  if (transition.requires === "checkpoint_agreement" && !checkpointsAgree(issue.checkpoints)) {
    throw new IssueCaseError(
      `applyAction: ${action} requires checkpoint agreement — the ${RESOLVING_INTERVAL} checkpoint must have agreed and none may have disagreed.`,
    );
  }
  const at = options.at ?? new Date().toISOString();
  const entry: HistoryEntry = {
    at,
    from: issue.state,
    to: transition.to,
    actor: options.actor,
    ...(options.reason ? { reason: options.reason } : {}),
  };
  const moved: IssueCase = {
    ...issue,
    state: transition.to,
    history: [...issue.history, entry],
  };
  return action === "mark_fixed" ? { ...moved, checkpoints: scheduleCheckpoints(at) } : moved;
}

export function accept(issue: IssueCase, options: TransitionOptions): IssueCase {
  return applyAction(issue, "accept", options);
}

export function dismiss(issue: IssueCase, options: TransitionOptions & { reason: string }): IssueCase {
  return applyAction(issue, "dismiss", options);
}

export function start(issue: IssueCase, options: TransitionOptions): IssueCase {
  return applyAction(issue, "start", options);
}

export function markFixed(issue: IssueCase, options: TransitionOptions): IssueCase {
  return applyAction(issue, "mark_fixed", options);
}

export function reopen(issue: IssueCase, options: TransitionOptions): IssueCase {
  return applyAction(issue, "reopen", options);
}


/**
 * The checks that decide whether a fixed case becomes resolved.
 *
 * `fixed` means the change shipped and the evidence has not agreed yet, so
 * marking a case fixed schedules the checks that will settle it rather than
 * leaving it waiting on nothing.
 */
export function scheduleCheckpoints(from: string): Checkpoint[] {
  const start = new Date(from).getTime();
  return (Object.keys(CHECKPOINT_DAYS) as CheckpointInterval[]).map((interval) => ({
    interval,
    ...(Number.isFinite(start)
      ? { due: new Date(start + CHECKPOINT_DAYS[interval] * DAY_MS).toISOString() }
      : {}),
    result: "scheduled" as CheckpointResult,
  }));
}

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

/* ── Migration adapters ─────────────────────────────────────────────────── */

/**
 * How far along the lifecycle a state sits, for resolving contradictions.
 *
 * `dismissed` and `reopened` are off the progression — they are decisions
 * rather than progress — so they are handled explicitly rather than ranked.
 */
const PROGRESS_RANK: Record<Exclude<IssueState, "dismissed" | "reopened">, number> = {
  new: 0,
  todo: 1,
  in_progress: 2,
  fixed: 3,
  resolved: 4,
};

type ProgressState = keyof typeof PROGRESS_RANK;

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

const MIGRATION_ACTOR = "migration";

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
  const reading = signal
    ? `${signal.metricLabel} ${signal.fieldFormatted} (${signal.fieldRating})`
    : rec.savings
      ? `${rec.title} — ${rec.savings}`
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
 * written into history under the actor `migration` rather than quietly
 * discarded. A field lifecycle that has resolved or regressed, and an agent
 * verification that came back, are newer information than either, so they
 * override the pair and are recorded the same way.
 */
export function fromRec(rec: Rec, options: FromRecOptions = {}): IssueCase {
  const at = options.at ?? new Date().toISOString();
  const history: HistoryEntry[] = [];
  const note = (to: IssueState, reason: string, from?: IssueState) => {
    history.push({ at, ...(from ? { from } : {}), to, actor: MIGRATION_ACTOR, reason });
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
  const steps = options.remediationSteps ?? rec.agentIssue?.remediation ?? [];
  const pageIds = [rec.pageId];

  return {
    id: rec.key,
    cause: options.cause ?? rec.id,
    state,
    title: rec.title,
    // Never the audit title. Absent when the record carries no plain sentence —
    // authoring one here would put copy in a logic module.
    diagnosis: options.diagnosis ?? rec.aiSummary ?? "",
    detectedAt,
    confirmedRuns: options.confirmedRuns ?? 0,
    ...(options.trigger ? { trigger: options.trigger } : {}),
    scope: rec.agentIssue?.scope === "origin" ? "origin" : "page",
    pageIds,
    strategies: rec.strategies ?? [],
    impactMs: parseImpactMs(rec.savings),
    effort: parseEffort(rec.estTime),
    confidence: confidenceFrom(evidence),
    remediation: { steps, actionability: actionabilityFrom(rec.webflow?.actionability) },
    successCriteria: options.successCriteria ?? rec.agentIssue?.successCriteria ?? "",
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
      actor: MIGRATION_ACTOR,
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

/* ── Grouping by cause ──────────────────────────────────────────────────── */

/**
 * Which state survives when findings that share a cause become one case.
 *
 * Urgency order, not progress order: an active finding must never be hidden
 * behind a sibling that somebody resolved or set aside, because that is how a
 * live problem disappears from the Decide queue.
 */
const MERGE_PRECEDENCE: Record<IssueState, number> = {
  reopened: 0,
  new: 1,
  in_progress: 2,
  todo: 3,
  fixed: 4,
  resolved: 5,
  dismissed: 6,
};

/**
 * A `Record` over the state union rather than an array, so a state added to the
 * registry is a compile error here instead of an `indexOf` of -1 — which, being
 * lower than every real rank, would have made the new state outrank all seven
 * and win every merge silently.
 */
function mostUrgent(left: IssueState, right: IssueState): IssueState {
  return MERGE_PRECEDENCE[left] <= MERGE_PRECEDENCE[right] ? left : right;
}

function scopeFor(scope: IssueCase["scope"], pageIds: readonly string[]): IssueCase["scope"] {
  if (scope === "origin") return "origin";
  return pageIds.length > 1 ? "pages" : "page";
}

/**
 * Merge two ledgers, keeping one entry per source.
 *
 * Where both sides hold a reading from the same source the later `observedAt`
 * wins outright. The two are never combined — a merged reading would be a
 * composite, and the older one was true when it was taken, not half-true now.
 */
function mergeEvidence(left: readonly EvidenceEntry[], right: readonly EvidenceEntry[]): EvidenceEntry[] {
  const bySource = new Map<EvidenceSource, EvidenceEntry>();
  for (const entry of [...left, ...right]) {
    const existing = bySource.get(entry.source);
    if (!existing || entry.observedAt > existing.observedAt) bySource.set(entry.source, entry);
  }
  return [...bySource.values()];
}

/**
 * One case per cause.
 *
 * Two findings with the same cause are the same problem seen on two pages, so
 * they become one case listing every affected page. The first finding in the
 * input supplies the identity and the wording — same cause, same remediation —
 * and the merge keeps the worst observed impact rather than a sum, because
 * adding milliseconds across pages that share an asset would invent a number no
 * run ever measured.
 */
export function groupByCause(cases: readonly IssueCase[], options: { at?: string } = {}): IssueCase[] {
  const at = options.at ?? new Date().toISOString();
  const byCause = new Map<string, IssueCase>();

  for (const item of cases) {
    const existing = byCause.get(item.cause);
    if (!existing) {
      byCause.set(item.cause, { ...item, pageIds: [...item.pageIds] });
      continue;
    }
    const pageIds = [...new Set([...existing.pageIds, ...item.pageIds])];
    const state = mostUrgent(existing.state, item.state);
    const evidence = mergeEvidence(existing.evidence, item.evidence);
    const history = [...existing.history, ...item.history].sort((a, b) => a.at.localeCompare(b.at));
    if (state !== existing.state) {
      history.push({
        at,
        from: existing.state,
        to: state,
        actor: "grouping",
        reason: `Grouped with a finding on ${item.pageIds.join(", ") || "another page"} sharing this cause.`,
      });
    }
    byCause.set(item.cause, {
      ...existing,
      state,
      pageIds,
      scope: scopeFor(existing.scope === "origin" || item.scope === "origin" ? "origin" : "page", pageIds),
      strategies: [...new Set([...existing.strategies, ...item.strategies])],
      detectedAt: [existing.detectedAt, item.detectedAt].filter(Boolean).sort()[0] ?? existing.detectedAt,
      confirmedRuns: Math.max(existing.confirmedRuns, item.confirmedRuns),
      impactMs: Math.max(existing.impactMs, item.impactMs),
      effort: widerEffort(existing.effort, item.effort),
      evidence,
      confidence: confidenceFrom(evidence),
      history,
    });
  }

  return [...byCause.values()];
}

/* ── Grouping by remediation ────────────────────────────────────────────── */

/**
 * The remediation a set of cases shares, as a comparable key.
 *
 * The steps *are* the remediation, so identical ordered steps under the same
 * actionability are the same piece of work — done once, it covers every case
 * keyed to it. Actionability is part of the key because a platform-owned case
 * and a customer-fixable one are not the same job even when the words match.
 *
 * A case with no documented steps shares its remediation with nothing and keys
 * on its own id. Collapsing every step-less case into one bucket would put
 * unrelated problems behind a single row and claim one fix covered them all,
 * which is the failure grouping exists to prevent rather than to cause.
 */
function remediationKey(issue: IssueCase): string {
  const steps = issue.remediation.steps.map((step) => step.trim()).filter(Boolean);
  if (steps.length === 0) return `case:${issue.id}`;
  // JSON-encoded rather than joined on a separator: a step is free text, so any
  // separator a step could itself contain would let two different remediations
  // produce one key.
  return `steps:${issue.remediation.actionability}:${JSON.stringify(steps)}`;
}

/**
 * Weakest wins: a group is no more certain than its least certain member.
 *
 * Keyed over the registry's union for the same reason as `MERGE_PRECEDENCE`: an
 * `indexOf` miss ranks -1, which is weaker than `unclear`, so a confidence
 * value the registry gained would have quietly become the weakest of all.
 */
const CONFIDENCE_PRECEDENCE: Record<Confidence, number> = { unclear: 0, probable: 1, confirmed: 2 };

function weakerConfidence(left: Confidence, right: Confidence): Confidence {
  return CONFIDENCE_PRECEDENCE[left] <= CONFIDENCE_PRECEDENCE[right] ? left : right;
}

/**
 * One remediation and every case it fixes.
 *
 * Deliberately not an `IssueCase`: a merged case would need one diagnosis, one
 * cause and one lifecycle for what may be several distinct problems that happen
 * to share a fix, and inventing those is how a row starts describing something
 * no run ever found. Members keep their own identity and stay individually
 * addressable; the group carries only what is genuinely shared.
 */
export interface RemediationGroup {
  /** Stable across renders for the same input. Not user-visible. */
  key: string;
  /** The remediation every member shares. */
  remediation: Remediation;
  /** Cause-grouped members, largest impact first. Never empty. */
  cases: IssueCase[];
  /** The member whose wording the group shows — the largest impact of them. */
  primary: IssueCase;
  /** Every page any member covers, first seen first. */
  pageIds: string[];
  /** The most urgent member state: a live problem never hides behind a settled one. */
  state: IssueState;
  /**
   * The worst reading any member produced — the same statistic as the number on
   * the row beneath it, never a sum (registry rule 19).
   *
   * A total would be a figure no run ever produced, and one the reader cannot
   * reconcile against the rows it sits above: three members reading 600, 500 and
   * 400 ms under a header reading 1,500 ms leaves them looking for a fourth. The
   * group renders it as "up to", because that is what a worst-of is.
   *
   * 0 when no member was measured at all, which the row renders as words rather
   * than as a number (rule 18).
   */
  impactMs: number;
  /**
   * The one shared effort, never a sum — the remediation is carried out once.
   * Where members disagree on the band, the wider one stands.
   */
  effort: Effort;
  /** The weakest member confidence. */
  confidence: Confidence;
  /** The earliest detection among the members. */
  detectedAt: string;
}

/**
 * One group per remediation.
 *
 * Cause grouping already collapses the same problem seen on several pages. This
 * goes one step further, to the unit a person actually decides on: two cases
 * with different causes that the same steps fix are one piece of work, and a
 * list that shows them apart asks for the same decision twice.
 *
 * `groupByCause` runs first rather than being reimplemented — a second merge
 * rule for pages, evidence and state is exactly the drift this module exists to
 * prevent. Everything below only buckets what that returns.
 *
 * Nothing is added up on the way. `groupByCause` refuses to sum across pages
 * sharing an asset because it would invent a number no run measured, and a
 * group total that cannot be reconciled against its own member rows is the same
 * defect one level up (rule 19).
 */
export function groupByRemediation(
  cases: readonly IssueCase[],
  options: { at?: string } = {},
): RemediationGroup[] {
  const byRemediation = new Map<string, IssueCase[]>();
  for (const item of groupByCause(cases, options)) {
    const key = remediationKey(item);
    const members = byRemediation.get(key);
    if (members) members.push(item);
    else byRemediation.set(key, [item]);
  }

  return [...byRemediation].map(([key, members]) => {
    // Worst measured first, so the wording comes from the largest member and an
    // unmeasured one sorts last within the group rather than ranking as a zero
    // (rule 18). The id breaks the tie, so two runs over the same data read
    // identically.
    const ordered = [...members].sort((a, b) => byWorstMeasured(a, b) || a.id.localeCompare(b.id));
    const primary = ordered[0];
    return {
      key,
      remediation: primary.remediation,
      cases: ordered,
      primary,
      pageIds: [...new Set(ordered.flatMap((item) => item.pageIds))],
      state: ordered.map((item) => item.state).reduce(mostUrgent),
      impactMs: Math.max(...ordered.map((item) => item.impactMs)),
      effort: ordered.map((item) => item.effort).reduce(widerEffort),
      confidence: ordered.map((item) => item.confidence).reduce(weakerConfidence),
      detectedAt: ordered.map((item) => item.detectedAt).filter(Boolean).sort()[0] ?? primary.detectedAt,
    };
  });
}

/**
 * A check found the problem back on some of the pages this case covers.
 *
 * The case reopens scoped to those pages only — the ones that came back are the
 * ones that need a new decision, and carrying the rest along would overstate
 * the problem. The move itself goes through the registry's table, so a case the
 * registry gives no reopen path from throws rather than being forced.
 */
export function reopenForPages(
  issue: IssueCase,
  pageIds: readonly string[],
  options: TransitionOptions,
): IssueCase {
  if (pageIds.length === 0) {
    throw new IssueCaseError(`reopenForPages: ${issue.id} needs at least one page that came back.`);
  }
  const returned = pageIds.filter((pageId) => issue.pageIds.includes(pageId));
  if (returned.length === 0) {
    throw new IssueCaseError(
      `reopenForPages: ${issue.id} does not cover ${pageIds.join(", ")}.`,
    );
  }
  const reopened = applyAction(issue, "reopen", options);
  return { ...reopened, pageIds: returned, scope: scopeFor(issue.scope, returned) };
}

/* ── Per-page applicability ───────────────────────────────────────── */

/**
 * Whether this case counts this page.
 *
 * Included is the default and the absence of an entry, so a case that has never
 * been touched needs no `excludedPages` at all. Reading it through here rather
 * than checking the map directly means "missing means included" is stated once.
 */
export function applicabilityOf(issue: IssueCase, pageId: string): Applicability {
  return issue.excludedPages?.[pageId] ? "excluded" : "included";
}

/** The reason a page is excluded, or undefined when it is not. */
export function exclusionReasonOf(issue: IssueCase, pageId: string): ExclusionReason | undefined {
  return issue.excludedPages?.[pageId];
}

/**
 * The pages this case counts.
 *
 * This is the list every downstream consumer wants: what Accept commits to,
 * what the checkpoints measure, and what a regression has to appear on to
 * reopen the case. `pageIds` remains the full set, because an excluded page is
 * still covered by the case — it is just not counted.
 */
export function includedPages(issue: IssueCase): string[] {
  return issue.pageIds.filter((pageId) => applicabilityOf(issue, pageId) === "included");
}

/** The pages it covers but does not count, in the case's own page order. */
export function excludedPageIds(issue: IssueCase): string[] {
  return issue.pageIds.filter((pageId) => applicabilityOf(issue, pageId) === "excluded");
}

/**
 * Stop counting one page, with a reason.
 *
 * The registry requires the reason, so the type does too — there is no way to
 * call this without one. The move goes through `APPLICABILITY_TRANSITIONS`
 * rather than being written out here, so a case the registry gives no exclude
 * path from throws instead of being forced.
 *
 * Refuses to exclude the last counted page: a case that counts nothing is a
 * case with nothing to accept, and Dismiss is the word for that decision. Two
 * ways to say "not this" is what rule 11 exists to stop.
 */
export function excludePage(
  issue: IssueCase,
  pageId: string,
  reason: ExclusionReason,
  options: TransitionOptions & { page?: string },
): IssueCase {
  if (!issue.pageIds.includes(pageId)) {
    throw new IssueCaseError(`excludePage: ${issue.id} does not cover ${pageId}.`);
  }
  const current = applicabilityOf(issue, pageId);
  if (!APPLICABILITY_TRANSITIONS.exclude.from.includes(current)) {
    throw new IssueCaseError(`excludePage: ${pageId} is already ${current} on ${issue.id}.`);
  }
  if (!(EXCLUSION_REASONS as readonly string[]).includes(reason)) {
    throw new IssueCaseError(
      `excludePage: reason must be one of ${EXCLUSION_REASONS.join(", ")}.`,
    );
  }
  if (includedPages(issue).length <= 1) {
    throw new IssueCaseError(
      `excludePage: ${pageId} is the last counted page on ${issue.id}. Dismiss the case instead.`,
    );
  }
  return {
    ...issue,
    excludedPages: { ...issue.excludedPages, [pageId]: reason },
    history: [
      ...issue.history,
      {
        at: options.at ?? new Date().toISOString(),
        to: issue.state,
        actor: options.actor,
        // The reader's own path where there is one — a page id is an internal
        // handle, and history is read by people.
        reason: historyExcluded(options.page ?? pageId, reason),
      },
    ],
  };
}

/** Count one page again. Needs no reason: the registry asks for none. */
export function includePage(
  issue: IssueCase,
  pageId: string,
  options: TransitionOptions & { page?: string },
): IssueCase {
  const current = applicabilityOf(issue, pageId);
  if (!APPLICABILITY_TRANSITIONS.include.from.includes(current)) {
    throw new IssueCaseError(`includePage: ${pageId} is already ${current} on ${issue.id}.`);
  }
  const next = { ...(issue.excludedPages ?? {}) };
  delete next[pageId];
  return {
    ...issue,
    ...(Object.keys(next).length > 0 ? { excludedPages: next } : { excludedPages: undefined }),
    history: [
      ...issue.history,
      {
        at: options.at ?? new Date().toISOString(),
        to: issue.state,
        actor: options.actor,
        reason: historyIncluded(options.page ?? pageId),
      },
    ],
  };
}

/** Every state, for exhaustiveness checks in callers and tests. */
export const ISSUE_STATES: readonly IssueState[] = WORK_STATES;
