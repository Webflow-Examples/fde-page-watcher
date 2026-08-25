import { DIGEST_CADENCE_LABEL, type DigestCadence } from "./digestCadence";
import { formatDate } from "./watch-copy";

/**
 * The words the digest says, in one place.
 *
 * Locked copy from the S7 brief. Three of these lines used to live in
 * `watch-copy.ts`, where W1 put them so the row, the drawer, the case and the
 * digest could not describe the same checkpoint reading in four voices. They are
 * here now because the brief locked their wording as digest copy, and one
 * statement of a string beats a tidy home for it (rule 20). What stays in
 * `watch-copy` is what Watch actually renders — the marks, the countdown, the
 * history lines — plus `formatDate`, which this module imports rather than
 * reimplements.
 *
 * Two shapes recur, and both are rule 18 rather than style:
 *
 *   - A line is built from a required part and an optional one. Where the
 *     optional part rests on a reading nobody took, it is withheld and the
 *     required part still goes out. That is the difference between a digest that
 *     says less on a bad night and one that says something false.
 *   - Nothing here throws. A malformed shape fails loudly where it is built —
 *     `nightScore` in `scoring.ts` is the example — but an absent value is not a
 *     malformed one, and a digest that crashed rather than omitting a clause
 *     would have traded a false claim for no message at all, which is the one
 *     outcome the whole design is arranged against.
 */

/* ── The subject ────────────────────────────────────────────────────────── */

export const DIGEST_NOTHING = "nothing needs you";

/**
 * The verdict, in the subject line.
 *
 * Two forms, and what came back is the one that decides between them. A fix that
 * did not hold is the only thing in the message that overturns something the
 * reader already believed; everything else is work they already knew about or
 * news they do not have to act on.
 *
 * Singular reads as a sentence rather than as a template. "1 fixes came back" is
 * the tell that nobody read the output.
 */
export function digestSubject(site: string, cameBack: number): string {
  if (cameBack === 0) return `${site} · ${DIGEST_NOTHING}`;
  return `${site} · ${cameBack} ${cameBack === 1 ? "fix" : "fixes"} came back`;
}

/* ── The section headings ───────────────────────────────────────────────── */

export const DIGEST_SECTION_HEADING = {
  came_back: "Came back",
  to_decide: "To decide",
  held: "Held",
  could_not_measure: "Could not measure",
} as const;

/* ── Came back ──────────────────────────────────────────────────────────── */

/**
 * What the check measured, against the limit the reader chose.
 *
 * Three things, because a threshold sentence that drops any one of them stops
 * being answerable: the reading (so the reader knows what was measured), the
 * limit (so they know why this crossed and something else did not), and that
 * they set it (so the answer to "why am I being told this" is a setting rather
 * than a judgement the product made).
 */
export interface DigestThreshold {
  /** The measurement, in the unit it was measured in. From `impact-format`. */
  reading: string;
  /** The limit, in the same unit. Also from `impact-format`. */
  limit: string;
}

/**
 * A fix that did not hold.
 *
 * The first sentence is the news and always goes out. The second is the
 * threshold claim, and it is withheld when there is no reading behind it —
 * rule 18's withhold half. "still measured Not measured, above the 500 ms you
 * set" is a conclusion resting on a reading nobody took, and the honest response
 * is to say less, not to fail: the reader still learns the fix came back, which
 * is the part they can act on.
 */
export function digestLineBack(
  issue: string,
  page: string,
  days: number,
  threshold: DigestThreshold | null,
): string {
  const back = `The ${issue} on ${page} is back.`;
  if (!threshold) return back;
  return `${back} The ${days}-day check still measured ${threshold.reading}, above the ${threshold.limit} you set.`;
}

/* ── To decide ──────────────────────────────────────────────────────────── */

/**
 * One case waiting on an answer: what is wrong, and how long it has been.
 *
 * The diagnosis is the case's own sentence, so this authors nothing about the
 * problem. What it adds is the fact the diagnosis cannot carry — that nobody has
 * answered yet, and since when — because a list of diagnoses with no age reads
 * as a list of things that arrived today.
 *
 * `since` is withheld rather than rendered as an unknown date. `formatDate`
 * answers "date unknown", which is right in a table cell and wrong mid-sentence:
 * "Open since date unknown." is a worse sentence than one that stops early.
 */
export function digestLineDecide(diagnosis: string, since: string | null): string {
  return since ? `${diagnosis} Open since ${since}.` : diagnosis;
}

/** The date a case has been open since, or null when it cannot be read. */
export function digestOpenSince(detectedAt: string, locale?: string): string | null {
  const formatted = formatDate(detectedAt, locale);
  return formatted === formatDate(undefined, locale) ? null : formatted;
}

/* ── Held ───────────────────────────────────────────────────────────────── */

/**
 * W1's ruling: one line with a count, never a list.
 *
 * A list of fixes that are holding is a list of things the reader does not have
 * to do anything about, which is the definition of noise. The count is the
 * reassurance; the queue is where the detail lives.
 */
export function digestLineHeld(count: number): string {
  return `${count} ${count === 1 ? "fix" : "fixes"} held.`;
}

/* ── Could not measure ──────────────────────────────────────────────────── */

/**
 * A fix that cannot be checked, named by the page that stopped answering.
 *
 * This is the one line in the digest that leads with a page rather than a case,
 * and the page is the point: the fix is fine as far as anyone knows, and what is
 * wrong is that nothing has been able to look. Rule 18 again — no reading is
 * neither good news nor bad, and the reader is owed the sentence rather than a
 * silent gap in the record.
 */
export function digestLineNoCheck(page: string, days: number): string {
  return `${page} has not answered for ${days} ${days === 1 ? "day" : "days"}, so one fix cannot be checked.`;
}

/* ── The footer ─────────────────────────────────────────────────────────── */

/** The words the footer's link carries. The setting behind it is S8's. */
export const DIGEST_FOOTER_CHANGE = "change how often";

/**
 * How much was measured, when, how often this arrives, and where to change it.
 *
 * The cadence is here because it is what makes an absent digest readable: a
 * reader who knows one arrives after every nightly run knows that no digest
 * means no run. Without the sentence, silence is ambiguous between a quiet night
 * and a broken collector, and the quiet-night message exists precisely so it is
 * not.
 *
 * The page count is the other half of that. "7 pages measured" and "2 pages
 * measured" are different nights even when the body is identical, and only the
 * footer says which one this was.
 */
export function digestFooter(
  pagesMeasured: number,
  time: string,
  cadence: DigestCadence,
  site: string,
): string {
  const pages = `${pagesMeasured} ${pagesMeasured === 1 ? "page" : "pages"} measured at ${time}.`;
  return `${pages} ${DIGEST_CADENCE_LABEL[cadence]} digest for ${site} — ${DIGEST_FOOTER_CHANGE}.`;
}

/* ── Arrival ────────────────────────────────────────────────────────────── */

/**
 * The banner on the case the reader followed a digest link to.
 *
 * It repeats the line rather than summarising it, because the reader's question
 * on arrival is "is this the thing I clicked" and a paraphrase cannot answer it.
 * The line is regenerated from the case by `digestLineFor`, not carried in the
 * URL, so the banner and the message cannot word it differently.
 *
 * No full stop after the reason. Every digest line already ends in one — they
 * are sentences, which is the rule the lines are built to — and a second would
 * render "is back..". The brief's template shows the stop because it shows the
 * shape; the reason supplies it.
 */
export function digestArrivalBanner(date: string, reason: string): string {
  return `From your digest of ${date}: ${reason}`;
}

export const DIGEST_ARRIVAL_DISMISS = "Dismiss this note";

/**
 * A cohort's calendar day, in the reader's locale.
 *
 * `formatDate` reads an instant, and a cohort date is not one:
 * `new Date("2026-08-25")` parses as UTC midnight, which renders as the 24th
 * everywhere west of Greenwich — the banner would date the digest to the day
 * before the run for half the world. Appending the time makes it local midnight,
 * which is what a calendar day means to the person reading it. Same formatter,
 * so the digest and the checkpoint dates are written the same way.
 */
export function digestDate(dateKey: string, locale?: string): string {
  return formatDate(`${dateKey}T00:00:00`, locale);
}
