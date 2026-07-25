import type { Flag } from "./types";

export interface WatchlistOrderPage {
  id: string;
  flag: Flag;
}

type DropPosition = "before" | "after";

const FLAG_RANK: Record<Flag, number> = {
  priority: 0,
  watching: 1,
  paused: 2,
};

/** Group pages by monitoring flag while preserving the stored order in each tier. */
export function sortWatchlistPages<T extends WatchlistOrderPage>(
  pages: ReadonlyArray<T>,
): T[] {
  return pages
    .map((page, index) => ({ page, index }))
    .sort((left, right) => (
      FLAG_RANK[left.page.flag] - FLAG_RANK[right.page.flag]
      || left.index - right.index
    ))
    .map(({ page }) => page);
}

/** Move a page to the end of its new flag tier when its monitoring flag changes. */
export function changePageFlagOrder<T extends WatchlistOrderPage>(
  pages: ReadonlyArray<T>,
  pageId: string,
  flag: Flag,
): T[] {
  const page = pages.find((item) => item.id === pageId);
  if (!page || page.flag === flag) return sortWatchlistPages(pages);
  const updated = { ...page, flag };
  return sortWatchlistPages([
    ...pages.filter((item) => item.id !== pageId),
    updated,
  ]);
}

/** Reorder a page before or after another page in the same monitoring tier. */
export function reorderPageWithinFlag<T extends WatchlistOrderPage>(
  pages: ReadonlyArray<T>,
  pageId: string,
  targetId: string,
  position: DropPosition,
): T[] {
  const ordered = sortWatchlistPages(pages);
  const page = ordered.find((item) => item.id === pageId);
  const target = ordered.find((item) => item.id === targetId);
  if (!page || !target || page.id === target.id || page.flag !== target.flag) {
    return ordered;
  }

  const withoutPage = ordered.filter((item) => item.id !== pageId);
  const targetIndex = withoutPage.findIndex((item) => item.id === targetId);
  const insertionIndex = targetIndex + (position === "after" ? 1 : 0);
  return [
    ...withoutPage.slice(0, insertionIndex),
    page,
    ...withoutPage.slice(insertionIndex),
  ];
}

/** Keyboard equivalent of dragging one slot within the current monitoring tier. */
export function movePageWithinFlag<T extends WatchlistOrderPage>(
  pages: ReadonlyArray<T>,
  pageId: string,
  direction: -1 | 1,
): T[] {
  const ordered = sortWatchlistPages(pages);
  const page = ordered.find((item) => item.id === pageId);
  if (!page) return ordered;
  const tier = ordered.filter((item) => item.flag === page.flag);
  const index = tier.findIndex((item) => item.id === pageId);
  const target = tier[index + direction];
  if (!target) return ordered;
  return reorderPageWithinFlag(
    ordered,
    pageId,
    target.id,
    direction < 0 ? "before" : "after",
  );
}

/** Apply a persisted page-id permutation, then enforce the flag-tier hierarchy. */
export function applyWatchlistPageOrder<T extends WatchlistOrderPage>(
  pages: ReadonlyArray<T>,
  pageIds: ReadonlyArray<string>,
): T[] {
  const uniqueIds = new Set(pageIds);
  if (pageIds.length !== pages.length || uniqueIds.size !== pages.length) {
    throw new Error("page order must include every page exactly once");
  }
  const pageById = new Map(pages.map((page) => [page.id, page]));
  const ordered = pageIds.map((id) => pageById.get(id));
  if (ordered.some((page) => !page)) {
    throw new Error("page order contains an unknown page");
  }
  return sortWatchlistPages(ordered as T[]);
}
