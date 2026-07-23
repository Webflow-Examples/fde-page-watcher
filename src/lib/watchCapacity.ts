import type { Flag, WatchPage } from "./types";

export const MAX_ACTIVE_PAGES = 10;
export const MAX_PRIORITY_PAGES = 3;

export function isActiveFlag(flag: Flag): boolean {
  return flag !== "paused";
}

export function isPageActivelyMonitored(page: Pick<WatchPage, "flag">): boolean {
  return isActiveFlag(page.flag);
}

export interface WatchCapacity {
  active: number;
  priority: number;
  paused: number;
  total: number;
}

export function watchCapacity(pages: Pick<WatchPage, "flag">[]): WatchCapacity {
  const active = pages.filter(isPageActivelyMonitored).length;
  const priority = pages.filter((page) => page.flag === "priority").length;
  return { active, priority, paused: pages.length - active, total: pages.length };
}

/** New pages consume an active slot when one is available, otherwise they wait Paused. */
export function defaultNewPageFlag(pages: Pick<WatchPage, "flag">[]): Flag {
  return watchCapacity(pages).active < MAX_ACTIVE_PAGES ? "watching" : "paused";
}

/**
 * Return the user-facing reason a new flag cannot be applied. The current page
 * is excluded before adding its proposed state, so active-to-active changes do
 * not consume another slot.
 */
export function flagCapacityError(
  pages: Pick<WatchPage, "id" | "flag">[],
  pageId: string | null,
  nextFlag: Flag,
): string | null {
  const others = pageId === null ? pages : pages.filter((page) => page.id !== pageId);
  const nextPriority = others.filter((page) => page.flag === "priority").length + (nextFlag === "priority" ? 1 : 0);
  if (nextPriority > MAX_PRIORITY_PAGES) {
    return `Only ${MAX_PRIORITY_PAGES} pages can be Priority. Change another Priority page to Watching or Paused first.`;
  }
  const nextActive = others.filter(isPageActivelyMonitored).length + (isActiveFlag(nextFlag) ? 1 : 0);
  if (nextActive > MAX_ACTIVE_PAGES) {
    return `Only ${MAX_ACTIVE_PAGES} pages can be actively monitored. Pause another page first.`;
  }
  return null;
}

/** Deterministically bring legacy state within the current limits. */
export function normalizeWatchCapacity(pages: Pick<WatchPage, "flag">[]): boolean {
  let changed = false;
  let priority = 0;
  for (const page of pages) {
    if (page.flag !== "priority") continue;
    priority += 1;
    if (priority > MAX_PRIORITY_PAGES) {
      page.flag = "watching";
      changed = true;
    }
  }

  let active = 0;
  for (const page of pages) {
    if (!isPageActivelyMonitored(page)) continue;
    active += 1;
    if (active > MAX_ACTIVE_PAGES) {
      page.flag = "paused";
      changed = true;
    }
  }
  return changed;
}
