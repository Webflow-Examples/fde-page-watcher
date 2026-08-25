import type { Rec } from "./types";
import { isFieldRecommendationActionable } from "./fieldOnlyRecommendations";

/**
 * How many issue cases are waiting in the Decide queue — work states New plus
 * Reopened (see `vocabulary.json`).
 *
 * The canonical issue case does not exist yet; chunk F2 introduces it. Until
 * then this deliberately reuses the exact predicate the old badge used, so the
 * number the sidebar shows does not change on the way through this refactor.
 *
 * This is the single named selector behind the sidebar's decision count. When
 * F2 lands, replace the body with a count of issue cases whose state is in
 * `statesInQueue("decide")` — the sidebar itself does not need to change.
 */
export function decideQueueCount(recs: readonly Rec[]): number {
  return recs.filter((rec) => rec.status === "inbox" && isFieldRecommendationActionable(rec)).length;
}
