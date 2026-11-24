/**
 * When a case was last checked, and whether that was long enough ago to say so.
 *
 * A case is derived from records the collector rewrites, so it stays present
 * while the problem does. That is correct — and it is why a four-month-old row
 * saying New is a row people learn to ignore: nothing on it says whether the
 * reader is looking at last night's reading or July's.
 *
 * Two facts, both read off the pages the case covers and neither stored as case
 * state:
 *
 *   - `lastCheckedAt` is the latest successful page run among the case's pages.
 *     A case is still being checked if any page it covers was read, so the
 *     newest run is the honest answer to "when was this last looked at".
 *   - `stale` is whether that was more than seven days before the reference —
 *     the project's newest run, not the wall clock, so a render is a pure
 *     function of stored state and the server and client agree.
 *
 * A stale case is information, never a decision. Nothing dismisses, settles or
 * re-scores because of it: the reader is told when the reading is from, and
 * decides what to do about a case nobody has re-measured.
 */

export const STALE_AFTER_DAYS = 7;

const DAY_MS = 86_400_000;

/**
 * The latest successful run among the pages a case covers.
 *
 * Only `lastRunAt` counts: an agent or CrUX run time is a different reading and
 * would let a case look checked when no Lighthouse collection has read it. A
 * page that has never run contributes nothing; when no page has, the answer is
 * undefined, which is not the same as "checked long ago" — rule 18.
 */
export function lastCheckedAtFor(
  pageIds: readonly string[],
  pages: readonly { id: string; lastRunAt?: string }[],
): string | undefined {
  const byId = new Map(pages.map((page) => [page.id, page]));
  return pageIds
    .flatMap((pageId) => {
      const lastRunAt = byId.get(pageId)?.lastRunAt;
      return lastRunAt ? [lastRunAt] : [];
    })
    .sort()
    .at(-1);
}

/** Whole days from a reading to the reference. Undefined when either is unreadable. */
export function daysSince(iso: string | undefined, referenceAt: string | undefined): number | undefined {
  const age = elapsedMs(iso, referenceAt);
  return age === undefined ? undefined : Math.floor(age / DAY_MS);
}

/**
 * Whether a case's last reading is old enough to mark.
 *
 * "Older than seven days" is strict: exactly seven days is not stale.
 *
 * The reference is the project's newest run rather than the wall clock, for two
 * reasons. A render stays a pure function of stored state, so the server and the
 * client cannot disagree about a marker. And the marker then answers the
 * question it is for — which cases have not been read while the rest of the
 * project was being collected. A project whose collection stopped weeks ago has
 * a collection problem, which other surfaces say out loud; marking every case
 * stale would report that fault once per row.
 */
export function caseStaleness(
  lastCheckedAt: string | undefined,
  referenceAt: string | undefined,
): { daysSince?: number; stale: boolean } {
  const age = elapsedMs(lastCheckedAt, referenceAt);
  if (age === undefined) return { stale: false };
  return { daysSince: Math.floor(age / DAY_MS), stale: age > STALE_AFTER_DAYS * DAY_MS };
}

/** Milliseconds from a reading to the reference. Undefined when either is unreadable. */
function elapsedMs(iso: string | undefined, referenceAt: string | undefined): number | undefined {
  if (!iso || !referenceAt) return undefined;
  const from = Date.parse(iso);
  const to = Date.parse(referenceAt);
  if (!Number.isFinite(from) || !Number.isFinite(to)) return undefined;
  return to - from;
}
