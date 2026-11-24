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

import type { CustomerActionability, Strategy } from "../types";
import {
  COUNTED_QUEUES,
  DISMISS_REASONS,
  ISSUE_TRANSITIONS,
  QUEUE_HOLDS,
  WORK_STATES,
  type Actionability,
  type CheckpointResult,
  type Confidence,
  type DismissReason,
  type EvidenceSource,
  type ExclusionReason,
  type IssueAction,
  type Queue,
  type WorkState,
} from "../vocabulary";
import { attributionOf, type Caller } from "../caller";

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

/**
 * Whether the impact came from real visitors or from a simulated test.
 *
 * A CrUX reading is what real people experienced; a Lighthouse run is a simulated
 * test on a throttled machine. The two are both real measurements — the
 * distinction is who took them — and the list has to keep it, because a 579 KiB
 * image finding and a field-confirmed LCP reading were both being rendered as
 * "Not measured" beside a simulated 12 s estimate that outranked them.
 *
 * `observed` is reserved for readings taken from the published site as visitors
 * met it: CrUX field data, native-element scans and rendered-page evidence.
 * Everything Lighthouse-only is `simulated`, including the legacy records that
 * predate `Rec.source`, which all came from Lighthouse.
 */
export type ImpactOrigin = "observed" | "simulated";

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
  /**
   * Who did it, whole.
   *
   * The identity and its class arrive together in one value, so nothing here
   * stores a bare class: a row saying only "a person" is a row that threw away
   * the answer to the question history is asked. `Caller` is the shape, and
   * `callerFromLegacyActor` is how a row written before the split becomes one.
   */
  by: Caller;
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
  /**
   * How many runs have seen this finding, where the source counts them.
   *
   * 0 means the source does not count runs, not "never seen": a CrUX record and
   * a native-element scan have no run count. The detail reads "Seen in N runs"
   * only when there is one (rule 18).
   */
  confirmedRuns: number;
  trigger?: { kind: "publish" | "provider" | "threshold"; at: string };
  /**
   * When the pages this case covers were last read by a successful run.
   *
   * Part of the case projection rather than of `AppState`: it is derived on read
   * from the pages' `lastRunAt`, exactly like `pageIds`, and storing it would be
   * a second copy of a date the page already holds. Absent when no page the case
   * covers has ever completed a run — which is not the same as "a long time ago"
   * (rule 18). See `case-recency.ts` for the rule that marks one stale.
   */
  lastCheckedAt?: string;
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
  /**
   * The worst measured time on a page this case counts, 0 when no time was
   * measured. 0 means "no reading", never "a tiny one" (rule 18).
   */
  impactMs: number;
  /**
   * The worst measured byte saving on a page this case counts. Absent when
   * nothing was measured in bytes.
   *
   * A separate field rather than a conversion into `impactMs`, because the two
   * are different statistics: adding an image's weight to a load-time estimate
   * would invent a figure no run produced. A byte-only case reads in bytes; a
   * case measured in both reads in milliseconds and keeps the bytes in evidence.
   */
  impactBytes?: number;
  /**
   * Who took the reading that a surface will show — see `ImpactOrigin`.
   *
   * Absent when nothing was measured, and also on a group whose displayed
   * reading has no origin recorded. It is read off the highest-precedence
   * reading in the case (milliseconds first, then bytes), never set for the
   * case as a whole, so a group cannot inherit "observed" from a byte reading
   * while it displays a simulated time.
   */
  impactOrigin?: ImpactOrigin;
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
  /**
   * A decision was taken about this remediation and does not apply to it any
   * more, because the remediation's key changed under it.
   *
   * Derived on read from the decisions log, never stored: it is a statement
   * about the relationship between two things that are already persisted, and
   * writing it down would make it a third thing that can disagree with them.
   *
   * The case reads as undecided while this is true, which is the honest state —
   * nobody has decided about THIS fix. What it must not do is read as though
   * nobody ever decided anything, so the case says the fix changed.
   */
  strandedDecision?: boolean;
  /* ── The work view — two fields, and no hand on either ──────────────────── */
  /**
   * Who picked this up — the identity `attributionOf` gives their caller.
   * Written by `start` and by nothing else.
   *
   * There is no setter for this and no input bound to it, which is the whole
   * design rather than an omission. An owner a person can retype is an owner
   * that disagrees with the history entry beside it the first time somebody
   * corrects a spelling, and then the case has two answers to "who has this"
   * — the same defect, one field smaller, that the four merged lifecycles
   * were. Whoever fired `start` is the owner; if that is wrong, the remedy is
   * a transition, not a text field.
   *
   * An identity rather than a `Caller`, because F4 split the two on purpose:
   * the class is a permission and this is the record of who. `start` is
   * person-only, so the class here is already known and constant, and a field
   * typed to admit `{ kind: "system" }` is a field that eventually holds one.
   *
   * Absent is common and is a real answer. A legacy record that arrives
   * already `in_progress` through `stateFromTaskStatus` never passed through
   * `start`; a migrated person caller carries `UNKNOWN_USER`, which recorded
   * the class and threw the identity away. Rule 18 applies to a name as much
   * as to a reading — the queue says there is no owner rather than inventing
   * one or printing a sentinel.
   */
  owner?: string;
  /**
   * When they picked it up. Written by `start`, alongside `owner`.
   *
   * The pair is written together and read together. This is the only date the
   * fix queue nudges with — past thirty days it renders amber, which is a
   * statement of fact and not an alert. There is no due date and no second
   * threshold behind it.
   */
  startedAt?: string;
  /**
   * Free text for whoever picks this up.
   *
   * No schema, no required fields, nothing derived from it. A note is the one
   * place on a case where the app does not have an opinion about the shape of
   * what you write, which is what makes it usable for the thing that did not
   * fit any of the other eight sections.
   */
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
  return holder ?? "settled";
}

/** The cases in one queue. Show all is the internal unfiltered view. */
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
 * Bytes parsed from a stored `savings` label such as `"180 KB"` or `"1.2 MB"`.
 *
 * The byte labels are produced by `formatDiagnosticImpact` (`"64 KB"`) and by
 * hand-written data; both are binary units, matching the way a transfer size is
 * counted. Anything that is not a byte figure — `"1.8 s"`, `"Observed"`,
 * `"Field signal"` — returns 0, which means *no reading in bytes* rather than a
 * small one, exactly as `parseImpactMs` does for time.
 *
 * `B` is accepted but only with a digit in front of it, so the `b` in a word is
 * never read as a unit.
 */
export function parseImpactBytes(savings: string | null | undefined): number {
  const match = /(\d+(?:\.\d+)?)\s*(gib|mib|kib|gb|mb|kb|b)\b/i.exec(savings ?? "");
  if (!match) return 0;
  const value = Number.parseFloat(match[1]);
  if (!Number.isFinite(value)) return 0;
  const factors: Record<string, number> = {
    b: 1,
    kb: 1024,
    kib: 1024,
    mb: 1024 ** 2,
    mib: 1024 ** 2,
    gb: 1024 ** 3,
    gib: 1024 ** 3,
  };
  return Math.round(value * factors[match[2].toLowerCase()]);
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

/** The byte half of the same question. Absent and 0 both mean no reading. */
export function hasMeasuredBytes(impactBytes: number | undefined): boolean {
  return (impactBytes ?? 0) > 0;
}

/**
 * Whether anything was measured, in either unit.
 *
 * The list asks this rather than `hasMeasuredImpact` wherever the answer decides
 * whether a row says "Not measured": a case measured only in bytes HAS a
 * reading, and rule 18's "absent is not small" does not mean "time is the only
 * measurement".
 */
export function hasAnyImpact(impact: { impactMs: number; impactBytes?: number }): boolean {
  return hasMeasuredImpact(impact.impactMs) || hasMeasuredBytes(impact.impactBytes);
}

/**
 * Worst measured first, unmeasured last — rule 18's ordering, for any list of
 * things carrying an impact.
 *
 * Milliseconds rank ahead of bytes only when both are present, which is the
 * display order too: a case that measured both reads its time. Bytes break the
 * tie among byte-only findings. An unmeasured one sorts below every measured
 * one, as a block, rather than by the zero it never measured.
 */
export function byWorstMeasured<T extends { impactMs: number; impactBytes?: number }>(left: T, right: T): number {
  const leftMeasured = hasAnyImpact(left);
  const rightMeasured = hasAnyImpact(right);
  if (leftMeasured !== rightMeasured) return leftMeasured ? -1 : 1;
  if (left.impactMs !== right.impactMs) return right.impactMs - left.impactMs;
  return (right.impactBytes ?? 0) - (left.impactBytes ?? 0);
}

/** The origin of the side holding the worst reading in one unit. */
function worstOrigin(
  left: { impactOrigin?: ImpactOrigin },
  right: { impactOrigin?: ImpactOrigin },
  leftValue: number,
  rightValue: number,
): ImpactOrigin | undefined {
  if (leftValue > rightValue) return left.impactOrigin;
  if (rightValue > leftValue) return right.impactOrigin;
  // A tie between two readings of one value: the observed one stands, because
  // a group is no less confirmed than its best reading.
  if (left.impactOrigin === right.impactOrigin) return left.impactOrigin;
  return left.impactOrigin === "observed" || right.impactOrigin === "observed" ? "observed" : undefined;
}

/**
 * How two readings of the same problem combine into one case's impact.
 *
 * The worst of each unit, never a sum (rule 19): adding two pages' savings
 * invents a figure no run produced. Milliseconds and bytes are merged
 * separately because they measure different things.
 *
 * The origin belongs to the reading a surface will actually show, which is the
 * time when there is one and the bytes otherwise — so a group holding an
 * observed byte reading and a simulated 12 s estimate reports the 12 s as
 * simulated rather than borrowing "Real users" from the bytes it is not
 * displaying.
 */
export function mergeImpact(
  left: { impactMs: number; impactBytes?: number; impactOrigin?: ImpactOrigin },
  right: { impactMs: number; impactBytes?: number; impactOrigin?: ImpactOrigin },
): { impactMs: number; impactBytes?: number; impactOrigin?: ImpactOrigin } {
  const impactMs = Math.max(left.impactMs, right.impactMs);
  const bytes = Math.max(left.impactBytes ?? 0, right.impactBytes ?? 0);
  const leading = impactMs > 0
    ? worstOrigin(left, right, left.impactMs, right.impactMs)
    : bytes > 0
      ? worstOrigin(left, right, left.impactBytes ?? 0, right.impactBytes ?? 0)
      : undefined;
  return {
    impactMs,
    ...(bytes > 0 ? { impactBytes: bytes } : {}),
    ...(leading ? { impactOrigin: leading } : {}),
  };
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
export function widerEffort(left: Effort, right: Effort): Effort {
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
  if (actionability === "platform") return "platform";
  // `"none"` is the legacy spelling of the same thing: before the platform lane
  // existed it was written only where Webflow owned the audit on a Webflow page.
  if (actionability === "none") return "platform";
  return "none";
}

/**
 * Whether this case is Webflow's own work rather than the reader's.
 *
 * The registry's `actionability.platform`: "Webflow owns this one. Nothing for
 * the customer to do; the case is shown so the reading is not hidden." It is a
 * property of the case, not a fifth queue and not a second lifecycle — the case
 * still has a state, it is simply not a decision the reader can take. Callers
 * that count or rank work ask this; callers that show readings do not.
 */
export function isPlatformOwned(issue: { remediation: Remediation }): boolean {
  return issue.remediation.actionability === "platform";
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
  /**
   * Who is moving it. Validated against the transition's permission set and
   * then recorded in history whole.
   *
   * Not `actor`: that word belongs to the registry, where it names which
   * classes MAY fire a transition. This is the one who did.
   */
  by: Caller;
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

/**
 * Whether the registry lets a caller of this class fire this action.
 *
 * The one place the permission set is read, so the guard in `applyAction` and
 * the affordance in `personActionsFor` cannot come to different conclusions
 * about the same table. It takes a `kind` and never an identity: F4's whole
 * point is that permission is decided on the class, and a function that could
 * be handed a name is one that could be made to answer on the strength of it.
 */
function actorPermits(action: IssueAction, by: Pick<Caller, "kind">): boolean {
  return ISSUE_TRANSITIONS[action].actor.includes(by.kind);
}

/**
 * The actions a person may fire from a state — the ones that can be a button.
 *
 * Filtered on the actor list rather than on a hand-kept exclusion, so `resolve`
 * never grows a button by accident: the registry says it is system-only, and
 * this is what makes that true of the UI rather than merely written down. A
 * transition added with `person` in its actor list appears here without anyone
 * remembering to add it.
 *
 * Asked through `actorPermits` with a class rather than by testing the list
 * against a bare word, so this reads the permission set exactly the way the
 * runtime guard does — which is what `caller`'s "never compare an identity
 * against a permission list" rule is protecting.
 */
export function personActionsFor(state: IssueState): IssueAction[] {
  return actionsFor(state).filter((action) => actorPermits(action, { kind: "person" }));
}

/**
 * How far along the lifecycle a state sits, for resolving contradictions.
 *
 * `dismissed` and `reopened` are off the progression — they are decisions
 * rather than progress — so they are handled explicitly rather than ranked.
 * `primaryActionFor` reads the same distinction to decide which of two legal
 * moves leads, which is why the omission is load-bearing rather than incidental.
 */
export const PROGRESS_RANK: Record<Exclude<IssueState, "dismissed" | "reopened">, number> = {
  new: 0,
  todo: 1,
  in_progress: 2,
  fixed: 3,
  resolved: 4,
};

export type ProgressState = keyof typeof PROGRESS_RANK;

/**
 * The one action a case leads with, and null when a person may not move it.
 *
 * Derived, not tabulated. Where a state offers a person two moves, the one that
 * advances the work leads: from New that is Accept rather than Dismiss, because
 * Accept is the commitment and Dismiss is the other real answer beside it rather
 * than a lesser version of it. Where a state offers one, that is the one — which
 * is how a Fixed case whose checks never read arrives at Reopen without this
 * function knowing anything about checkpoints.
 *
 * `PROGRESS_RANK` is the test for "advances the work": it holds the five states
 * that are progress and deliberately omits `dismissed` and `reopened`, which are
 * decisions. So a transition landing in a ranked state advances, and one landing
 * off the ranking does not. That is why the rule reads correctly in both
 * directions without a second list to keep in step.
 *
 * Null is a real answer and not a gap. No state currently returns it — every one
 * of the seven has at least one person transition out — but rule 12 says a state
 * with no legal exit is a bug in the registry rather than something a caller
 * should paper over, so the type says what would be true if one appeared.
 */
export function primaryActionFor(state: IssueState): IssueAction | null {
  const actions = personActionsFor(state);
  if (actions.length === 0) return null;
  const advancing = actions.filter((action) => ISSUE_TRANSITIONS[action].to in PROGRESS_RANK);
  return (advancing[0] ?? actions[0]) as IssueAction;
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
 * ignored in the guard the way `checkpoint_agreement` was — or the way
 * `actor` was until v9, recorded on every entry and checked on none.
 *
 * The caller's class is one of those requirements now. It is read off
 * `transition.actor`, which is the registry's permission set, so widening
 * `action.resolve.actor` in `vocabulary.json` is the whole of what it takes to
 * let a person resolve a case, and no edit here would do it. That is the
 * difference between a rule and a sentence about a rule.
 *
 * A rejected call is a programming error rather than a user error. No UI path
 * reaches one — the only transition a person cannot fire is `resolve`, and
 * nothing offers a Resolve button. Reaching this throw means a caller was
 * written against a permission it does not have, so it names the transition,
 * the classes the registry permits, and the class it was handed.
 *
 * Two transitions write more than a state and a history line, and both write it
 * here rather than in their named wrapper below. `mark_fixed` schedules the
 * checkpoints that will settle the case; `start` stamps the owner and the start
 * date. Putting both on this function is what makes "no other path writes
 * either" true of the codebase rather than merely intended: `start` is a
 * one-line call to `applyAction`, so there is no second door into `in_progress`
 * that could reach it without the stamp.
 */
export function applyAction(issue: IssueCase, action: IssueAction, options: TransitionOptions): IssueCase {
  const transition = ISSUE_TRANSITIONS[action];
  if (!transition.from.includes(issue.state)) {
    throw new IssueCaseError(
      `applyAction: ${action} is not legal from ${issue.state} (legal from ${transition.from.join(", ")}).`,
    );
  }
  if (!actorPermits(action, options.by)) {
    throw new IssueCaseError(
      `applyAction: ${action} may be fired by ${transition.actor.join(", ")}; the caller offered ${options.by.kind}.`,
    );
  }
  if (action === "accept" && issue.remediation.steps.length === 0) {
    throw new IssueCaseError(
      `applyAction: ${issue.id} has no remediation steps, so it cannot be accepted. Give it steps first.`,
    );
  }
  if (action === "mark_fixed" && issue.remediation.steps.length === 0) {
    throw new IssueCaseError(
      `applyAction: ${issue.id} has no remediation steps, so it cannot be marked fixed. Add a plan first.`,
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
    by: options.by,
    ...(options.reason ? { reason: options.reason } : {}),
  };
  const moved: IssueCase = {
    ...issue,
    state: transition.to,
    history: [...issue.history, entry],
  };
  if (action === "mark_fixed") return { ...moved, checkpoints: scheduleCheckpoints(at) };
  /**
   * Starting is what assigns the case. Whoever fired the transition is the
   * owner, and the instant they fired it is the start date — the same `at` the
   * history entry above carries, so the two can never disagree about when this
   * began.
   *
   * The identity comes through `attributionOf` rather than off `options.by`
   * directly, so the owner field and the attribution column in history are the
   * same answer to the same question and cannot part (rule 20). It also means
   * the two identities F4 declines to render are the two this declines to
   * store: a system caller, and the migrated person nobody can name. Both leave
   * the field absent, and the row then says there is no owner rather than
   * printing a class or a sentinel as though it were a person.
   *
   * `start` is person-only in the registry, so the system arm is unreachable
   * today. It is handled anyway because `attributionOf` is what decides, not a
   * belief here about who is permitted — widening `action.start.actor` must not
   * silently start writing "grouping" into an owner field.
   *
   * A second `start` cannot happen: the registry allows it only from `todo`,
   * and a case that has been started is `in_progress`. So these are written
   * once and are not overwritten by any later move. Reopening a case sends it
   * back to `reopened`, which has to be accepted and started again — and that
   * start, from the new owner, is the one that stamps it.
   */
  if (action === "start") {
    const owner = attributionOf(options.by);
    return { ...moved, ...(owner ? { owner } : {}), startedAt: at };
  }
  return moved;
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
 * When a case last entered a state, read off its history.
 *
 * Read rather than stored, which is what keeps the date a surface shows and the
 * date the transition happened the same fact. The LAST such entry wins: a case
 * that came back and was accepted again was accepted on the second date, and a
 * row saying otherwise would be quoting a decision that has since been retaken.
 *
 * Undefined is a real answer — a state the case never entered, and a migrated
 * case whose history begins mid-lifecycle. Rule 18: callers say so rather than
 * substituting `detectedAt`, which is a different date about a different event.
 */
export function enteredAt(issue: IssueCase, state: IssueState): string | undefined {
  return [...issue.history].reverse().find((entry) => entry.to === state)?.at;
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

/** Every state, for exhaustiveness checks in callers and tests. */
export const ISSUE_STATES: readonly IssueState[] = WORK_STATES;
