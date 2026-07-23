import type { AppState } from "../types";
import { normalizeAgentIgnoreSettings } from "../agentScoring";
import { pageTrend } from "../scoring";

/** Apply compatible, idempotent upgrades when reading persisted state. */
export function normalizeState(state: AppState): AppState {
  for (const page of state.pages) {
    // Older pending records carried a zero-filled placeholder baseline. The
    // timestamp is the authoritative proof that baseline capture occurred.
    if (!page.baselineCapturedAt) delete page.baseline;
    // Migrate the original health vocabulary into the baseline-trend model.
    // Recomputing from source data is safer than mapping "improvable" because
    // that legacy value described a transient drop, not improvement.
    const storedStatus = page.status as string;
    if (["healthy", "improvable", "degraded"].includes(storedStatus)) {
      page.status = pageTrend(page, "mobile");
    }
    page.agentIgnores = normalizeAgentIgnoreSettings(page.agentIgnores);
  }
  state.followUps = (state.followUps ?? []).map((followUp) => ({
    ...followUp,
    id: followUp.id ?? `legacy:${followUp.pageId}:${followUp.markerId}:${followUp.interval}:${followUp.dueISO}`,
  }));
  state.jobs = state.jobs ?? [];
  return state;
}
