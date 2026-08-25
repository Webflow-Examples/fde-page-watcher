import { fromRec, groupByCause, type IssueCase } from "./issue-case";
import type { AppState, WatchPage } from "./types";

/**
 * The canonical case list, derived from stored records.
 *
 * This used to live in `store.tsx`, which was fine while the issues list was the
 * only reader. The digest is the second, and it runs in the collector — a Worker
 * with no React in it and no business importing a `"use client"` module to find
 * out what cases exist. Moving the two functions here is what makes that
 * possible; `store.tsx` re-exports them, so every existing importer keeps one
 * name for each.
 *
 * There is exactly one derivation of a case from a record, and this is it. Two
 * would be two answers to "what is open right now", and the digest's whole claim
 * is that the message and the screen agree.
 */

/**
 * The newest completed run across the watchlist.
 *
 * Used as the reference "now" for the case adapters, so a render is a pure
 * function of stored state: `fromRec` and `groupByCause` otherwise stamp history
 * with `new Date()`, which differs between the server render and the client one.
 * It also dates the "what changed" sort, which is a question about the last run
 * rather than about the wall clock.
 */
export function lastRunAtOf(pages: readonly WatchPage[]): string | undefined {
  return pages
    .map((page) => page.lastRunAt)
    .filter((value): value is string => !!value)
    .sort()
    .at(-1);
}

/**
 * One case per problem.
 *
 * Recommendations are the stored shape; `fromRec` reads their four legacy
 * lifecycles and `groupByCause` collapses the same problem seen on several
 * pages. Both come from `issue-case.ts` — this only feeds them.
 */
export function issueCasesFrom(state: Pick<AppState, "recs" | "pages">): IssueCase[] {
  const at = lastRunAtOf(state.pages);
  const options = at ? { at, referenceYear: Number(at.slice(0, 4)) } : {};
  return groupByCause(state.recs.map((rec) => fromRec(rec, options)), options);
}
