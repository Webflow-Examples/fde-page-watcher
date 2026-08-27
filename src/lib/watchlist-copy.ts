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
 * Both halves are the existing behaviour. `watchCapacity` does not count a
 * paused page as active, so it holds no slot and no priority while it is there;
 * and the Paused group has no drag handles at all, so a page in it has no place
 * in the order to hold — which is what "until it is watched again" is doing.
 *
 * That clause says the loss lasts while it is paused, not that resuming undoes
 * it: `changePageFlagOrder` moves a page to the END of the tier it joins, so a
 * resumed page gets a place in the order again, never the one it had.
 *
 * An earlier draft said "keeps its history and its consent record". Consent is
 * project-level and origin-scoped, and it is not on this screen — so that half
 * named something a reader could not see. It is gone rather than reworded.
 */
export const WATCHLIST_PAUSED_NOTE =
  "A paused page keeps its history. It loses its priority and its place in the order until it is watched again.";
