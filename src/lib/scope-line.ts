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
 * Just the pages, with no device clause: "Pricing" · "Pricing, Home" · "4 pages".
 *
 * Two titles are named because two is still a list a reader can hold; past that
 * the count is the more useful fact, and a sentence naming six pages is a
 * sentence nobody finishes.
 */
export function pageScopeOf(
  pageIds: readonly string[],
  pageTitles: Record<string, string>,
): string {
  const titles = pageIds.map((pageId) => pageTitles[pageId] ?? pageId);
  if (titles.length === 0) return "";
  return titles.length <= 2 ? titles.join(", ") : `${titles.length} pages`;
}

/** "Pricing" · "Pricing, Home" · "4 pages", then the devices it was seen on. */
export function scopeLineOf(
  pageIds: readonly string[],
  strategies: readonly Strategy[],
  pageTitles: Record<string, string>,
): string {
  const where = pageScopeOf(pageIds, pageTitles);
  const devices = strategies.map((strategy) => STRATEGY_LABEL[strategy]).join(", ");
  return [where, devices].filter(Boolean).join(" · ");
}
