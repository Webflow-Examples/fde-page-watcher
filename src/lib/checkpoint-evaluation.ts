import {
  applyAction,
  checkpointsAgree,
  includedPages,
  reopenForPages,
  type Checkpoint,
  type CheckpointInterval,
  type IssueCase,
  IssueCaseError,
} from "./issue-case";
import type { Caller } from "./caller";
import { CHECKPOINT_EVALUATION, type CheckpointResult } from "./vocabulary";
import { HISTORY_RESOLVED, historyReopened, historyUnavailable } from "./watch-copy";

/**
 * The only thing in the app that reads a checkpoint result.
 *
 * `mark_fixed` has scheduled three checkpoints since v5 and nothing read them,
 * so a fixed case sat in Watch forever. This applies the five rules the
 * registry decided — `concepts.checkpoint.evaluation`, mirrored as
 * `CHECKPOINT_EVALUATION` — to one incoming reading at a time.
 *
 * The rules are not restated here. Each branch cites the rule it implements by
 * index, and `CHECKPOINT_EVALUATION` is the text; a comment paraphrasing the
 * registry would be a second copy of the decision that could drift from the
 * first (rule 20). Read them side by side.
 *
 * What this deliberately does NOT do:
 *
 *   - decide whether the problem is still there. That is the collector's
 *     reading, which arrives as a `CheckpointReading`.
 *   - re-derive when the case may resolve. `checkpointsAgree` is that
 *     predicate, and it already reads the resolving interval off the schedule.
 *     A second copy here is what rule 20 forbids.
 */

/** The interval whose reading advanced, and what the re-measurement found. */
export interface CheckpointReading {
  interval: CheckpointInterval;
  /**
   * A reading is never `scheduled`: that is the absence of one. Excluding it
   * here means "the collector reported nothing" cannot be spelled as a reading
   * that says nothing.
   */
  outcome: Exclude<CheckpointResult, "scheduled">;
  /** When the reading was taken. */
  at: string;
  /**
   * For a disagreement, the pages the problem came back on. Defaults to the
   * pages the case COUNTS — `reopenForPages` narrows the case to these.
   *
   * Counted, not covered: a page excluded on the case is one the reader said
   * does not apply, and a checkpoint that reopened the case on it would
   * override that decision silently. An exclusion the evaluator ignores is not
   * an exclusion.
   */
  pageIds?: readonly string[];
}

/** What the evaluator did, so a caller can notify, digest, or stay quiet. */
export type CheckpointEffect = "reopened" | "resolved" | "retry_scheduled" | "recorded";

export interface CheckpointEvaluation {
  issue: IssueCase;
  effect: CheckpointEffect;
  /** The reading's interval, for the digest line and the history line. */
  interval: CheckpointInterval;
}

/** Milliseconds in the one retry rule 2 allows. */
const RETRY_AFTER_MS = 24 * 60 * 60 * 1000;

/**
 * This evaluator, as the caller it is.
 *
 * `system` is the class the registry permits to fire `resolve`, and it is the
 * tag rather than a claim beside the identity — `applyAction` reads it off this
 * value and checks it against `action.resolve.actor`. Before v9 the same word
 * was passed as a bare string and nothing looked at it, so "resolve is
 * system-only" was true only because this file was its one caller.
 *
 * `checkpoint` is the agent, not `system` again: the row a reader sees says a
 * scheduled re-measurement moved the case, and there is no other agent it
 * could be confused with. Nothing renders it — see `attributionOf`.
 */
const CHECKPOINT_CALLER: Caller = { kind: "system", agent: "checkpoint" };

/**
 * How many times a checkpoint has been read.
 *
 * A checkpoint carries no attempt count until it needs one. Rule 2 allows
 * exactly one retry, so distinguishing the first unavailable reading from the
 * second is the whole of the state this needs — a boolean would do, but a
 * count says what it is and reads correctly if the rule ever allows two.
 */
function attemptsOf(checkpoint: Checkpoint): number {
  return checkpoint.attempts ?? 0;
}

function withCheckpoint(
  issue: IssueCase,
  interval: CheckpointInterval,
  update: (checkpoint: Checkpoint) => Checkpoint,
): IssueCase {
  return {
    ...issue,
    checkpoints: issue.checkpoints.map((checkpoint) =>
      checkpoint.interval === interval ? update(checkpoint) : checkpoint,
    ),
  };
}

/**
 * Record a note against a case without moving it.
 *
 * An unavailable reading is not a transition — rule 2 says it neither advances
 * nor reopens — but rule 16 still owes the reader the sentence, so the entry
 * carries the same state on both sides. `from === to` is the honest encoding of
 * "something happened and the case did not move"; inventing a state for it
 * would put a word in the lifecycle that the registry does not have.
 */
function note(issue: IssueCase, at: string, reason: string): IssueCase {
  return {
    ...issue,
    history: [...issue.history, { at, from: issue.state, to: issue.state, by: CHECKPOINT_CALLER, reason }],
  };
}

/**
 * Apply one checkpoint reading.
 *
 * Returns the case as it stands afterwards and what happened to it. Throws when
 * the reading is for an interval this case has no checkpoint for, rather than
 * silently doing nothing: a reading nobody scheduled is a broken caller, and
 * rule 18's malformed-structure half says name it.
 */
export function recordCheckpointReading(
  issue: IssueCase,
  reading: CheckpointReading,
): CheckpointEvaluation {
  const { interval, outcome, at } = reading;
  const checkpoint = issue.checkpoints.find((item) => item.interval === interval);
  if (!checkpoint) {
    throw new IssueCaseError(
      `recordCheckpointReading: ${issue.id} has no ${interval} checkpoint to record a reading against.`,
    );
  }

  // Rule 1. Fired before anything else is considered, and the remaining
  // checkpoints go with it — waiting out a run whose conclusion is already
  // overturned would keep the case out of Decide for another three weeks.
  if (outcome === "disagreed") {
    // Only a counted page can bring the case back. A reading that names none of
    // them measured something the case does not claim, so there is nothing to
    // reopen: it is recorded and the run carries on.
    const cameBack = (reading.pageIds ?? includedPages(issue)).filter((pageId) =>
      includedPages(issue).includes(pageId),
    );
    if (cameBack.length === 0) {
      const noted = withCheckpoint(issue, interval, (item) => ({
        ...item,
        attempts: attemptsOf(item) + 1,
        result: "disagreed",
      }));
      return { issue: noted, effect: "recorded", interval };
    }
    const marked = withCheckpoint(issue, interval, (item) => ({ ...item, result: "disagreed" }));
    const cancelled = {
      ...marked,
      // Cancelled, not "cancelled"-flagged: the registry's four results have no
      // fifth value, and the next `mark_fixed` schedules a fresh set of three.
      // A checkpoint that never produced a reading and never will is not a
      // reading with an outcome, so it stops existing.
      checkpoints: marked.checkpoints.filter(
        (item) => item.interval === interval || item.result !== "scheduled",
      ),
    };
    return {
      issue: reopenForPages(cancelled, cameBack, {
        by: CHECKPOINT_CALLER,
        at,
        reason: historyReopened(interval),
      }),
      effect: "reopened",
      interval,
    };
  }

  // Rule 2. The first failure to read buys one retry a day later; the second
  // records Unavailable and the run carries on. Neither counts against the fix,
  // so neither writes an outcome the resolving rule would have to discount.
  if (outcome === "unavailable") {
    if (attemptsOf(checkpoint) === 0) {
      return {
        issue: withCheckpoint(issue, interval, (item) => ({
          ...item,
          attempts: 1,
          due: new Date(new Date(at).getTime() + RETRY_AFTER_MS).toISOString(),
        })),
        effect: "retry_scheduled",
        interval,
      };
    }
    const recorded = withCheckpoint(issue, interval, (item) => ({
      ...item,
      attempts: attemptsOf(item) + 1,
      result: "unavailable",
    }));
    // Rule 4 needs no branch: three unavailable readings leave every result
    // `unavailable`, `checkpointsAgree` finds no agreed resolving checkpoint,
    // and the case stays where it is. The row is what says so.
    return { issue: note(recorded, at, historyUnavailable(interval)), effect: "recorded", interval };
  }

  const agreed = withCheckpoint(issue, interval, (item) => ({
    ...item,
    attempts: attemptsOf(item) + 1,
    result: "agreed",
  }));

  // Rules 3 and 5, both of them inside `checkpointsAgree`: it requires the
  // resolving checkpoint to have agreed, which is why a 2 or 7-day agreement
  // falls through to `recorded` and only the last one can resolve.
  if (checkpointsAgree(agreed.checkpoints)) {
    return {
      issue: applyAction(agreed, "resolve", { by: CHECKPOINT_CALLER, at, reason: HISTORY_RESOLVED }),
      effect: "resolved",
      interval,
    };
  }
  return { issue: agreed, effect: "recorded", interval };
}

/* ── The run, as the row and the track draw it ──────────────────────────── */

/**
 * The four silhouettes a mark can have.
 *
 * Named for the shape rather than the outcome because that is what makes the
 * single-reader rule real: a component that received the raw result would have
 * to compare it against the four values to pick a glyph, and then there would
 * be two places that know what `disagreed` means. It receives a shape instead
 * and looks up a drawing. Four distinct silhouettes, so the marks survive
 * having their colour removed — `check` and `cross` are the pair that would
 * otherwise be tempted to differ by hue alone.
 */
export type MarkShape = "ring" | "dash" | "check" | "cross";

const MARK_SHAPE: Record<CheckpointResult, MarkShape> = {
  scheduled: "ring",
  unavailable: "dash",
  agreed: "check",
  disagreed: "cross",
};

/**
 * The outcome-to-silhouette map, for the test that checks all four differ.
 *
 * Exposed rather than duplicated in the test: asserting a copy of this map
 * against this map would prove the two agree and never that four shapes are
 * actually four (rule 21).
 */
export function markShapesOf(): Record<CheckpointResult, MarkShape> {
  return { ...MARK_SHAPE };
}

/** One checkpoint, resolved into everything a mark or a segment needs. */
export interface CheckpointView {
  interval: CheckpointInterval;
  /** Always concrete: a checkpoint with no result yet is `scheduled`. */
  result: CheckpointResult;
  due?: string;
  shape: MarkShape;
  /**
   * The one scheduled check that renders as a countdown pill instead of a
   * ring. True for at most one view in a run, which is what stops a row
   * growing a second countdown.
   */
  isNext: boolean;
  /**
   * Whether a reading came in at all, whatever it said. The track fills a
   * segment's bar on this and not on agreement: an unavailable check was
   * genuinely reached, and drawing it as untouched would lose that.
   */
  read: boolean;
  /**
   * Whether that reading agreed — the one outcome that has a date of its own
   * to show. Everything else is still described by what it is waiting for.
   */
  agreed: boolean;
}

/**
 * The case's three checkpoints in chronological order, ready to draw.
 *
 * Chronological by due date, so a checkpoint that rule 2 pushed back sits where
 * it will actually be read rather than where its name suggests. Undated ones
 * keep their schedule order behind the dated ones.
 */
export function runOf(issue: IssueCase): CheckpointView[] {
  const next = nextScheduled(issue);
  return issue.checkpoints
    .map((checkpoint) => {
      const result = checkpoint.result ?? "scheduled";
      return {
        interval: checkpoint.interval,
        result,
        ...(checkpoint.due ? { due: checkpoint.due } : {}),
        shape: MARK_SHAPE[result],
        isNext: next ? checkpoint.interval === next.interval : false,
        read: result !== "scheduled",
        agreed: result === "agreed",
      };
    })
    .sort((a, b) => {
      if (a.due && b.due) return a.due.localeCompare(b.due);
      if (a.due) return -1;
      if (b.due) return 1;
      return 0;
    });
}

/* ── Reading the run, for the row and the queue ─────────────────────────── */

/** The checkpoints that have produced a reading, in schedule order. */
export function readings(issue: IssueCase): Checkpoint[] {
  return issue.checkpoints.filter((item) => item.result && item.result !== "scheduled");
}

/**
 * The next checkpoint still waiting for a reading, or null when none is left.
 *
 * Ordered by due date rather than by interval, because rule 2's retry moves a
 * due date: a 2-day checkpoint retried at +24h is due after the 7-day one was
 * scheduled for, and the countdown must name whichever is actually next.
 */
export function nextScheduled(issue: IssueCase): Checkpoint | null {
  const waiting = issue.checkpoints.filter((item) => !item.result || item.result === "scheduled");
  if (waiting.length === 0) return null;
  return [...waiting].sort((a, b) => (a.due ?? "").localeCompare(b.due ?? ""))[0];
}

/**
 * Whether every checkpoint was read and none of them could be.
 *
 * Rule 4's case, and the only row in Watch that offers an action. The case is
 * still Fixed: nothing disagreed, so nothing overturned the fix — there is
 * simply no evidence either way, and only a person can decide what to do about
 * that.
 */
export function noReadingTaken(issue: IssueCase): boolean {
  return (
    issue.checkpoints.length > 0
    && issue.checkpoints.every((item) => item.result === "unavailable")
  );
}

/**
 * When this case's next check is due, for ordering the queue.
 *
 * A case with nothing scheduled sorts last: rule 18 says an absent reading is
 * never ranked as though it were a value, and "no date" is not an early date.
 */
export function nextDueAt(issue: IssueCase): string | null {
  return nextScheduled(issue)?.due ?? null;
}

/**
 * When the fix shipped.
 *
 * Read off history rather than stored: `mark_fixed` writes the entry, so the
 * date the row shows and the date the transition happened are the same fact.
 * The last such entry wins — a case that came back and was fixed again is
 * being watched from the second fix, not the first.
 */
export function fixedAtOf(issue: IssueCase): string | undefined {
  return [...issue.history].reverse().find((entry) => entry.to === "fixed")?.at;
}

/**
 * The first check that could not be taken, for the row's secondary line.
 *
 * Only one is named. A row that listed every failure would be a log; the row's
 * job is to say that the record has a hole in it, and the drawer says where.
 */
export function firstUnavailable(issue: IssueCase): CheckpointInterval | null {
  return runOf(issue).find((view) => view.result === "unavailable")?.interval ?? null;
}

/** Watch, ordered by the next check due, ascending. Undated cases sort last. */
export function byNextDue(left: IssueCase, right: IssueCase): number {
  const a = nextDueAt(left);
  const b = nextDueAt(right);
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return a.localeCompare(b);
}

/** The registry text these branches implement, for the test that reads both. */
export const EVALUATION_RULES = CHECKPOINT_EVALUATION;
