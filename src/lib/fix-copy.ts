import type { Effort } from "./issue-case";
import { EFFORT_LABEL } from "./impact-format";
import { QUEUE_HOLDS, type WorkState } from "./vocabulary";
import { daysUntil } from "./watch-copy";
import { naturalDate } from "./ui";

/**
 * The words the Fix queue says, in one place.
 *
 * Locked copy from the S5 brief. Four of its ten strings are deliberately NOT
 * restated here, because something already owns them and rule 20 says a string
 * is stated once:
 *
 *   - `fix.group.todo` and `fix.group.in_progress` are `WORK_STATE_LABEL.todo`
 *     and `WORK_STATE_LABEL.in_progress`. The registry names the states, and
 *     the group headings are those names — a second literal would let the
 *     heading and the chip on the row beneath it disagree about what the state
 *     is called.
 *   - `fix.action.start` and `fix.action.mark_fixed` are
 *     `ISSUE_ACTION_LABEL.start` and `.mark_fixed`, for the same reason. The
 *     buttons are already built from the registry's transition table by
 *     `primaryActionFor`; giving them a second source of words would mean a
 *     relabelled transition renamed the button on the case and not the one on
 *     the row.
 *
 * `watch-copy.ts` made the identical call about the four checkpoint outcome
 * labels. This module is its counterpart for the queue one step to its left.
 */

/* ── The groups ─────────────────────────────────────────────────────────── */

/**
 * The two groups, To do above In progress.
 *
 * Read off the registry rather than written down, because the registry already
 * states this order: `queue.fix.holds` is `["todo", "in_progress"]`, and that is
 * the order the queue reads in — what has been committed to but not picked up,
 * then what someone is holding. A hand-kept array here would be a second
 * statement of an order the registry owns, and the two would part company the
 * first time a state joined the queue.
 */
export const FIX_GROUPS: readonly WorkState[] = QUEUE_HOLDS.fix;

/* ── The one nudge ──────────────────────────────────────────────────────── */

/**
 * When a start date turns amber.
 *
 * The number and the sentence that explains it sit together so they cannot
 * drift apart — `FIX_QUEUE_NOTE` below promises the reader thirty days, and this
 * is the thirty. It is the whole of the queue's pressure: there is no second
 * threshold after it, no colour past amber, no email, and nothing that escalates
 * on the thirty-first day. A queue that nags twice has taught the reader to
 * ignore it once.
 */
export const OWNER_AMBER_DAYS = 30;

/**
 * Whether a start date has passed the amber mark.
 *
 * Whole calendar days, through the same `daysUntil` the Watch countdown uses, so
 * the two never disagree about when a day turned over. A case with no start date
 * is not stale — it is unowned, which is a different thing the row says in
 * different words.
 */
export function startedLongAgo(startedAt: string | undefined, now: Date): boolean {
  if (!startedAt) return false;
  const until = daysUntil(startedAt, now);
  return until !== null && -until >= OWNER_AMBER_DAYS;
}

/* ── The rows ───────────────────────────────────────────────────────────── */

/**
 * What a To do row says under its diagnosis: how much of the site it covers,
 * when it was committed to, and what doing it costs.
 *
 * The page figure is a count rather than a list of titles. The scope line on the
 * issues list already names pages where naming them fits; here the reader is
 * choosing what to pick up next, and the size of the job is the useful fact.
 */
export function fixTodoMeta(pages: number, acceptedAt: string | undefined, effort: Effort, now?: Date): string {
  return `${pages} ${pages === 1 ? "page" : "pages"} · accepted ${whenOf(acceptedAt, now)} · ${EFFORT_LABEL[effort]}`;
}

/** What an In progress row says under its diagnosis: who has it, and since when. */
export function fixOwnerMeta(name: string, startedAt: string | undefined, now?: Date): string {
  return `${name} · started ${whenOf(startedAt, now)}`;
}

/**
 * The row for a case that is in progress with nobody recorded against it.
 *
 * NOT from the locked list, and deliberately so. The locked copy covers the
 * case S5 creates, where `start` stamped an owner and a date on the way in. It
 * does not cover the legacy record that arrives already `in_progress` through
 * `stateFromTaskStatus`, having never passed through `start` — and there is no
 * honest way to render `fix.owner.meta` for one, because there is no name and no
 * date to put in it.
 *
 * So it says what is true. This is rule 18's reasoning applied to a name instead
 * of a reading: an absent owner is not an unimportant owner, and the two things
 * that must not happen are inventing one and printing an empty line where one
 * belongs. "No estimate" and "Not measured" are the same sentence about
 * different fields.
 */
export const FIX_NO_OWNER = "No owner recorded";

/**
 * A date as the reader would say it — "today", "4 days ago", "Dec 8, 2025".
 *
 * `naturalDate` is the app's one statement of that, and it already degrades to
 * the input string for something it cannot parse. An absent date is the case
 * this adds: a migrated case whose history begins mid-lifecycle has no accepted
 * date, and rule 18 says the row says so rather than rendering a plausible one.
 */
function whenOf(iso: string | undefined, now?: Date): string {
  if (!iso) return "on an unrecorded date";
  return naturalDate(iso, now ?? new Date());
}

/* ── The queue ──────────────────────────────────────────────────────────── */

/**
 * The sentence under the tabs, which is the queue's entire theory of pressure.
 *
 * It says what the amber means and, more importantly, what it does not mean and
 * what does not follow it. A reader who has been told there is no escalation can
 * leave a case sitting for thirty-one days on purpose, which is a decision; a
 * reader who suspects there might be one manages the queue instead of the work.
 */
export const FIX_QUEUE_NOTE =
  "The started date is the only nudge in this queue. After 30 days it turns amber — a statement of fact, not a warning, and there is no escalation after it.";

/* ── Notes ──────────────────────────────────────────────────────────────── */

/**
 * The empty state of the notes field.
 *
 * It names the reader rather than the format, because there is no format. No
 * schema, no required fields, nothing derived from what is typed here.
 */
export const FIX_NOTES_PLACEHOLDER = "Notes for whoever picks this up";

/* ── Copy as ticket ─────────────────────────────────────────────────────── */

export const FIX_ACTION_COPY_TICKET = "Copy as ticket";

/**
 * What the button says once it has done it.
 *
 * "wherever your work lives" is the point of the whole affordance: there is no
 * tracker integration here and there is not going to be one. Page Watch does not
 * know or care whether the paste lands in Jira, Linear, a pull request or a
 * message, and a ticket that is plain markdown works in all four.
 */
export const FIX_TICKET_COPIED = "Copied. Paste it wherever your work lives.";
