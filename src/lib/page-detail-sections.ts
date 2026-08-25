/**
 * The page detail's reading order, as data.
 *
 * Reading order is this chunk's acceptance criterion, so it is a value the app
 * reads rather than a shape the JSX happens to have. `page/[id]` renders by
 * mapping this array over a `Record` of section views: the record's own key
 * order cannot affect what appears where, so this array is the only statement
 * of the order in `src/` (rule 20) and reordering it reorders the page.
 *
 * That also makes the order assertable without a renderer. There is no DOM in
 * this suite and this chunk does not add one — the property that had to be
 * guaranteed was the order, and turning the order into data is what made a
 * machine for observing rendered output unnecessary. When a chunk needs
 * GEOMETRY — overlap, wrapping, measured contrast at a rendered size — that is
 * a program-level decision, not one to take here.
 *
 * The order is an argument, not a layout preference:
 *
 *   1 status    how the page is doing right now, and whether the last
 *               collection even succeeded. Everything below is worthless if it
 *               did not.
 *   2 cases     what is wrong and what to do about it. The cases ARE the
 *               recommendations, so they lead the body rather than following a
 *               screenful of numbers.
 *   3 readings  the evidence the two above are drawn from, in full. Last
 *               because it is what you go to when you doubt them, and the jump
 *               link in the status strip is how you get there in one move.
 *
 * There are no tabs. Four tabs meant four routes into one object, three of
 * which a reader had to guess at; one scroll means the argument arrives in the
 * order it is made.
 */

export const PAGE_DETAIL_SECTIONS = ["status", "cases", "readings"] as const;

export type PageDetailSectionId = (typeof PAGE_DETAIL_SECTIONS)[number];

/**
 * Each section's heading.
 *
 * A `Record`, deliberately: it is keyed by id and its key order says nothing.
 * The array above says the order, and this says the words.
 */
export const PAGE_DETAIL_SECTION_HEADING: Record<PageDetailSectionId, string> = {
  status: "Status",
  cases: "Open cases",
  readings: "Every reading",
};

/**
 * Where the jump link goes.
 *
 * Named rather than written twice: the anchor the strip links to and the id the
 * section carries are one fact. A jump link and a target that disagree is a
 * link to nowhere, which is exactly the failure two literals produce.
 */
export const PAGE_DETAIL_JUMP_TARGET: PageDetailSectionId = "readings";

/** The section the jump link lives in. It must precede its target. */
export const PAGE_DETAIL_JUMP_SOURCE: PageDetailSectionId = "status";

/** The link's words. It names the section it lands on, not "jump to table". */
export const PAGE_DETAIL_JUMP_LABEL = `${PAGE_DETAIL_SECTION_HEADING[PAGE_DETAIL_JUMP_TARGET]} ↓`;

/** The DOM id a section carries, and the fragment the jump link targets. */
export function pageDetailAnchor(id: PageDetailSectionId): string {
  return `page-detail-${id}`;
}
