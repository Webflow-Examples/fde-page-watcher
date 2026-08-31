import type { Strategy } from "./types";

/**
 * Where a case was seen, in words.
 *
 * This used to live in `issue-row.tsx`, which was fine while the list was the
 * only thing that said it. The digest says it too — "came back on Home" and
 * "came back on 4 pages" are the same phrase the row shows — and a second
 * spelling of it would have drifted the first time someone changed where the
 * "4 pages" cut-off sits (rule 20). `issue-row` re-exports this, so the list's
 * existing importers keep one name for it; the same move `formatImpact` made
 * into `impact-format.ts` for the same reason.
 *
 * Devices are not a registry concept — `Strategy` is a measurement axis, not a
 * status — so the display names live here with the one function that renders
 * them.
 */
const STRATEGY_LABEL: Record<Strategy, string> = { mobile: "Mobile", desktop: "Desktop" };

/**
 * How many pages a scope line names before it gives up and shows a count.
 *
 * Two titles are still a list a reader can hold; past that the count is the more
 * useful fact, and a sentence naming six pages is a sentence nobody finishes.
 *
 * Exported because the list row renders this same decision as links rather than
 * as a string, and a second copy of "two" is how the string and the links start
 * disagreeing about when a page stops being named (rule 20).
 */
export const PAGE_SCOPE_NAME_LIMIT = 2;

/** The pages a scope covers, titled, in the order the case lists them. */
export function pageScopeNames(
  pageIds: readonly string[],
  pageTitles: Record<string, string>,
): { id: string; title: string }[] {
  return pageIds.map((pageId) => ({ id: pageId, title: pageTitles[pageId] ?? pageId }));
}

/**
 * Just the pages, with no device clause: "Pricing" · "Pricing, Home" · "4 pages".
 *
 * The string form. `pageScopeNames` is the same decision with the ids kept, for
 * the row that needs to link each one.
 */
export function pageScopeOf(
  pageIds: readonly string[],
  pageTitles: Record<string, string>,
): string {
  const names = pageScopeNames(pageIds, pageTitles);
  if (names.length === 0) return "";
  return names.length <= PAGE_SCOPE_NAME_LIMIT
    ? names.map((page) => page.title).join(", ")
    : `${names.length} pages`;
}

/**
 * The device clause on its own: "Mobile" · "Mobile, Desktop".
 *
 * Split out for the same reason as `pageScopeNames`: the list row renders the
 * page half as links and the device half as text, so it needs the two pieces
 * rather than the finished sentence, and it must not spell either itself.
 */
export function deviceScopeOf(strategies: readonly Strategy[]): string {
  return strategies.map((strategy) => STRATEGY_LABEL[strategy]).join(", ");
}

/** The separator between the two halves, and between two named pages. */
export const SCOPE_SEPARATOR = " \u00b7 ";

/** "Pricing" · "Pricing, Home" · "4 pages", then the devices it was seen on. */
export function scopeLineOf(
  pageIds: readonly string[],
  strategies: readonly Strategy[],
  pageTitles: Record<string, string>,
): string {
  const where = pageScopeOf(pageIds, pageTitles);
  return [where, deviceScopeOf(strategies)].filter(Boolean).join(SCOPE_SEPARATOR);
}
