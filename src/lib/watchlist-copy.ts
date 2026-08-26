/**
 * The watchlist's group copy, in one place.
 *
 * Four strings, and the reason they are here rather than inline is the count in
 * the first one. "Priority · {n} of 3" states the priority cap, and the cap is
 * already stated by `MAX_PRIORITY_PAGES` — which the capacity line, the tier
 * control's disabled state, and `flagCapacityError` all read. Interpolating the
 * constant means the heading cannot come to disagree with the rule it is
 * describing, which registry rule 20 asks for wherever a fact would otherwise
 * be written twice.
 *
 * These are not registry vocabulary. `vocabulary.json` decides the words for a
 * concept's values; a tier's own labels (Priority, Watching, Paused) are the
 * `Flag` union's, and what is below is the chunk's presentation copy around
 * them.
 */

import type { Flag } from "./types";
import { MAX_PRIORITY_PAGES } from "./watchCapacity";

/**
 * `Record<Flag, ...>` rather than a switch: a new tier fails to compile here
 * instead of rendering a group with no heading.
 */
const GROUP_LABEL: Record<Flag, (count: number) => string> = {
  priority: (count) => `Priority · ${count} of ${MAX_PRIORITY_PAGES}`,
  watching: (count) => `Watching · ${count}`,
  paused: (count) => `Paused · ${count}`,
};

/** The heading for one tier's group, with that tier's current count. */
export function watchlistGroupLabel(tier: Flag, count: number): string {
  return GROUP_LABEL[tier](count);
}

/**
 * What Paused costs, said once under the group it applies to.
 *
 * Both halves are the existing behaviour: `changePageFlagOrder` moves a page to
 * the end of its new tier, so pausing does lose its place in the order, and
 * `watchCapacity` does not count a paused page as active, so it holds no slot
 * and no priority while it is there.
 */
export const WATCHLIST_PAUSED_NOTE =
  "A paused page keeps its history and its consent record, and loses its priority and its place in the order.";
