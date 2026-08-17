import type { AppState } from "../types";
import { captureAgentReadiness, normalizeAgentIgnoreSettings } from "../agentScoring";
import { effectivePerformanceThresholds, normalizePerformanceThresholdOverrides, normalizePerformanceThresholds } from "../performanceThresholds";
import { pageTrend } from "../scoring";
import { normalizeWatchCapacity } from "../watchCapacity";
import { sortWatchlistPages } from "../watchlistOrder";
import { reconcileTaskMarkers } from "../taskMarkers";
import { normalizeNativeElementControls } from "../nativeElements";
import { normalizeAlertWebhookUrl } from "../webhook";

/** Apply compatible, idempotent upgrades when reading persisted state. */
export function normalizeState(state: AppState): AppState {
  // Product escalations were a customer workflow. Retained run history remains
  // the authoritative evidence source for internal known-issue reporting.
  delete (state as AppState & { productEscalations?: unknown }).productEscalations;
  state.alertWebhookUrl = normalizeAlertWebhookUrl(state.alertWebhookUrl);
  state.alertDigests = (state.alertDigests ?? []).slice(-30);
  state.visitorExperienceVisible = state.visitorExperienceVisible === true;
  state.agentIgnoreDefaults = normalizeAgentIgnoreSettings(state.agentIgnoreDefaults);
  state.performanceThresholds = normalizePerformanceThresholds(state.performanceThresholds);
  if (normalizeWatchCapacity(state.pages)) delete state.watcherNote;
  state.pages = sortWatchlistPages(state.pages);
  for (const page of state.pages) {
    // Older pending records carried a zero-filled placeholder baseline. The
    // timestamp is the authoritative proof that baseline capture occurred.
    if (!page.baselineCapturedAt) delete page.baseline;
    // Migrate the original health vocabulary into the baseline-trend model.
    // Recomputing from source data is safer than mapping "improvable" because
    // that legacy value described a transient drop, not improvement.
    page.agentIgnores = normalizeAgentIgnoreSettings(page.agentIgnores);
    page.agentIgnoreRestores = normalizeAgentIgnoreSettings(page.agentIgnoreRestores);
    page.performanceThresholdOverrides = normalizePerformanceThresholdOverrides(page.performanceThresholdOverrides);
    page.status = pageTrend(page, "mobile", effectivePerformanceThresholds(state.performanceThresholds, page));
    page.nativeElementControls = normalizeNativeElementControls(page.nativeElementControls);
    for (const night of page.history) {
      if (!night.agentReadiness && Array.isArray(night.agent)) {
        night.agentReadiness = captureAgentReadiness(
          night.agent,
          page.agentIgnores,
          state.agentIgnoreDefaults,
          page.agentIgnoreRestores,
        );
      } else if (night.agentReadiness && !Array.isArray(night.agentReadiness.ignoredCheckKeys)) {
        night.agentReadiness.ignoredCheckKeys = [];
      }
    }
  }
  state.followUps = (state.followUps ?? []).map((followUp) => ({
    ...followUp,
    id: followUp.id ?? `legacy:${followUp.pageId}:${followUp.markerId}:${followUp.interval}:${followUp.dueISO}`,
  }));
  reconcileTaskMarkers(state);
  state.jobs = state.jobs ?? [];
  return state;
}
