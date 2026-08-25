import { CHECKPOINT_RESULT_LABEL, type CheckpointResult } from "./vocabulary";
import type { CheckpointInterval } from "./issue-case";

/**
 * The words Watch says, in one place.
 *
 * Locked copy from the W1 brief. Every string a reader sees about a checkpoint
 * is built here, so the row, the drawer, the case detail and the digest cannot
 * describe the same reading in three different voices.
 *
 * The four outcome labels are NOT restated here. `CHECKPOINT_RESULT_LABEL`
 * already carries them from the registry, and a second copy of a word the
 * registry owns is the defect rule 20 names — a copy that drifts the moment
 * someone relabels one of the four. This module re-exports the registry's map
 * rather than holding its own.
 *
 * Registry rule 16: a transition the system fires still writes history in the
 * words the user reads, so the history lines below are the history lines —
 * there is no internal `auto_resolved` anywhere behind them.
 */

export { CHECKPOINT_RESULT_LABEL as CHECKPOINT_LABEL };

/** The interval as the reader says it: "2d" is "the 2-day check". */
export function daysOf(interval: CheckpointInterval): number {
  return Number.parseInt(interval, 10);
}

/**
 * A date in the reader's own locale.
 *
 * Undated is possible: `scheduleCheckpoints` omits `due` when it is handed a
 * timestamp it cannot parse, and rule 18 says an absent value says so rather
 * than rendering as a plausible one.
 */
export function formatDate(iso: string | undefined, locale?: string): string {
  if (!iso) return "date unknown";
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "date unknown";
  return at.toLocaleDateString(locale, { month: "short", day: "numeric", year: "numeric" });
}

/* ── The countdown pill ─────────────────────────────────────────────────── */

export const WATCH_MARK_PILL_NONE = "none left";

/**
 * The countdown on the next scheduled check.
 *
 * Whole days, floored from midnight to midnight rather than from the instant —
 * "in 21 days" must not become "in 20 days" because the reader loaded the page
 * in the evening, and must not disagree with the due date in the drawer, which
 * is the same instant rendered as a calendar day.
 */
export function watchMarkPill(due: string | undefined, now: Date): string {
  const days = daysUntil(due, now);
  if (days === null) return WATCH_MARK_PILL_NONE;
  if (days <= 0) return "today";
  return `in ${days} ${days === 1 ? "day" : "days"}`;
}

/**
 * Whole calendar days from `now` to `due`, or null when there is no due date.
 *
 * Both instants are collapsed to their local calendar day before subtracting,
 * so the answer changes when the day changes and not when the clock passes an
 * arbitrary hour. That is what keeps the pill and the drawer's date agreeing
 * across a day boundary and across a timezone change.
 */
export function daysUntil(due: string | undefined, now: Date): number | null {
  if (!due) return null;
  const at = new Date(due);
  if (Number.isNaN(at.getTime())) return null;
  const startOfDay = (date: Date) => Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
  return Math.round((startOfDay(at) - startOfDay(now)) / 86_400_000);
}

/* ── The row ────────────────────────────────────────────────────────────── */

export function watchRowFixed(date: string | undefined, locale?: string): string {
  return `Fixed ${formatDate(date, locale)}`;
}

/** The fixed date still leads. The unavailable check is what is added to it. */
export function watchRowFixedUnavailable(
  date: string | undefined,
  interval: CheckpointInterval,
  locale?: string,
): string {
  return `${watchRowFixed(date, locale)} · the ${daysOf(interval)}-day check could not be taken`;
}

export const WATCH_NO_READING =
  "No check could be taken. The fix shipped 30 days ago and this page has not answered since.";

export const WATCH_ACTION_REOPEN = "Reopen";
export const WATCH_ACTION_RECHECK = "Check again";

/* ── The track ──────────────────────────────────────────────────────────── */

export function watchTrackSegment(interval: CheckpointInterval): string {
  return `${daysOf(interval)} days`;
}

export function watchTrackAgreed(date: string | undefined, locale?: string): string {
  return `agreed ${formatDate(date, locale)}`;
}

export function watchTrackDue(due: string | undefined, locale?: string): string {
  return `due ${formatDate(due, locale)}`;
}

/** "Day n of 30" — n counted from the fix, capped at the span it is out of. */
export function watchTrackProgress(fixedAt: string | undefined, now: Date, span: number): string {
  const elapsed = fixedAt ? -(daysUntil(fixedAt, now) ?? 0) : 0;
  const day = Math.min(Math.max(elapsed, 0), span);
  return `Day ${day} of ${span}`;
}

/* ── The queue ──────────────────────────────────────────────────────────── */

export function watchIntro(count: number): string {
  return `${count} ${count === 1 ? "fix is" : "fixes are"} waiting on evidence. Nothing here needs you — a check that disagrees moves the case to Decide on its own.`;
}

export const WATCH_EMPTY = "Nothing is waiting on evidence.";

/* ── History — registry rule 16, the words the user reads ───────────────── */

export const HISTORY_RESOLVED = "Resolved — the 30-day check agreed.";

export function historyReopened(interval: CheckpointInterval): string {
  return `Reopened — the ${daysOf(interval)}-day check still found the problem.`;
}

export function historyUnavailable(interval: CheckpointInterval): string {
  return `${daysOf(interval)}-day check unavailable — the page did not answer.`;
}

/* ── Digest ──────────────────────────────────────────────────── */

/**
 * The three digest lines moved to `digest-copy.ts` in S7.
 *
 * W1 wrote them here so the row, the drawer, the case and the digest could not
 * describe one checkpoint reading in four voices, and that reasoning still
 * holds — but S7 locked their wording as digest copy, and one statement of a
 * string beats a tidy home for it (rule 20). Two of the three now take readings
 * and limits this module knows nothing about.
 *
 * What Watch renders stays here, and the shared parts are shared from here:
 * `formatDate` and `CHECKPOINT_LABEL` are imported by the digest rather than
 * reimplemented, which is the coupling that actually mattered.
 */

/* ── Accessible names ───────────────────────────────────────────────────── */

/**
 * The name a screen reader gives one mark.
 *
 * Names the check, its outcome and its date, because the mark's shape carries
 * all three and none of the three is in the surrounding text.
 */
export function ariaCheckpoint(
  interval: CheckpointInterval,
  result: CheckpointResult,
  date: string | undefined,
  locale?: string,
): string {
  return `${daysOf(interval)}-day check: ${CHECKPOINT_RESULT_LABEL[result]}, ${formatDate(date, locale)}`;
}
