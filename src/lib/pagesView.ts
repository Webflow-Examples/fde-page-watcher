import { DESTINATION_PATH } from "./vocabulary";

/**
 * The pages destination's two views, and how a URL says which one you want.
 *
 * A view is a place, so it lives in the URL rather than in component state: a
 * person should be able to send someone the view they are looking at, and a
 * reload should come back to it. That makes the parsing a decision rather than
 * a detail, which is why it is here and tested rather than inline in the route.
 *
 * Changes is the default, so it is the view with no query parameter at all —
 * the plain `/pages` address is the one people already have.
 */

export const PAGES_VIEWS = ["changes", "all"] as const;
export type PagesView = (typeof PAGES_VIEWS)[number];

export const DEFAULT_PAGES_VIEW: PagesView = "changes";

// The tab labels and both header lines are copy, so they live with the rest of
// this screen's copy in `pages-copy.ts`. What is decided here is the set, the
// default, and the address.

export function parsePagesView(value: string | undefined): PagesView {
  return (PAGES_VIEWS as readonly string[]).includes(value ?? "") ? (value as PagesView) : DEFAULT_PAGES_VIEW;
}

/**
 * The address of one view, from the app root.
 *
 * The matrix's filter travels with the matrix and nowhere else. It is a control
 * on that table, so carrying it onto Changes would put a filter in the URL of a
 * screen that has none — and dropping it on the way back would silently reset
 * the reader's table.
 */
export function pagesViewPath(view: PagesView, filter?: string): string {
  const params = new URLSearchParams();
  if (view !== DEFAULT_PAGES_VIEW) params.set("view", view);
  if (view === "all" && filter && filter !== "all") params.set("filter", filter);
  const query = params.toString();
  return `${DESTINATION_PATH.pages}${query ? `?${query}` : ""}`;
}
