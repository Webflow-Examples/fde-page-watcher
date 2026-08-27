import type { AppState } from "../types";
import { captureAgentReadiness, normalizeAgentIgnoreSettings } from "../agentScoring";
import { normalizeDigestCadence } from "../digestCadence";
import { normalizePerformanceThresholds } from "../performanceThresholds";
import { pageTrend } from "../scoring";
import { exactSensitivity, nearestSensitivity, normalizeSensitivity, thresholdsFor } from "../sensitivity";
import { SENSITIVITY_LABEL } from "../settings-copy";
import { normalizeWatchCapacity } from "../watchCapacity";
import { sortWatchlistPages } from "../watchlistOrder";
import { reconcileTaskMarkers } from "../taskMarkers";
import { normalizeNativeElementControls } from "../nativeElements";
import { normalizeExternalAgentConsentHistory } from "../agentConsent";
import { normalizeAlertWebhookUrl } from "../webhook";
import { normalizeDigestRecipients } from "../digestRecipients";

/**
 * Bring a stored threshold set onto the one control that now edits it.
 *
 * Three cases, and the third is the whole reason this function exists:
 *
 *   - A stored position. It wins, and the limits are rewritten from it. The
 *     position is the setting; the limits are its resolution, and a resolution
 *     that disagreed with its input would be a second setting nobody could see.
 *   - No position, and limits that already match one exactly. That set was
 *     produced by this control before the field was persisted, or by the
 *     defaults. Nothing was tuned, so nobody is told anything.
 *   - No position, and limits that match none of them. Somebody sat down with
 *     twelve fields and made decisions. Those decisions no longer have a
 *     control, and the two dishonest answers are to drop them (their site
 *     quietly starts reporting different things) or to keep them (a setting
 *     screen that cannot show the state it is in). So they are mapped to the
 *     nearest position and the reader is told once, in the digest footer.
 *
 * Idempotent, like everything else here: the notice is written once because the
 * position it writes is also stored, so the next read takes the first branch.
 */
function normalizeSensitivitySettings(state: AppState): void {
  if (state.sensitivity === undefined) {
    const stored = state.performanceThresholds;
    const exact = exactSensitivity(stored);
    if (exact === null && stored !== undefined) {
      const nearest = nearestSensitivity(stored);
      state.sensitivity = nearest;
      state.sensitivityNotice = SENSITIVITY_LABEL[nearest];
    } else {
      state.sensitivity = exact ?? normalizeSensitivity(undefined);
    }
  }
  const sensitivity = normalizeSensitivity(state.sensitivity);
  state.sensitivity = sensitivity;
  state.performanceThresholds = thresholdsFor(sensitivity);
}

/** Apply compatible, idempotent upgrades when reading persisted state. */
export function normalizeState(state: AppState): AppState {
  // Product escalations were a customer workflow. Retained run history remains
  // the authoritative evidence source for internal known-issue reporting.
  delete (state as AppState & { productEscalations?: unknown }).productEscalations;
  state.alertWebhookUrl = normalizeAlertWebhookUrl(state.alertWebhookUrl);
  state.alertDigests = (state.alertDigests ?? []).slice(-30);
  state.visitorExperienceVisible = state.visitorExperienceVisible === true;
  // Consent defaults closed: anything other than an explicit true means no
  // external provider request is permitted for this project.
  state.externalAgentAuditEnabled = state.externalAgentAuditEnabled === true;
  // The record behind that boolean. Read whole and never pruned: an entry is
  // dropped only when it is structurally not an entry at all.
  state.externalAgentAuditConsentHistory =
    normalizeExternalAgentConsentHistory(state.externalAgentAuditConsentHistory);
  state.agentIgnoreDefaults = normalizeAgentIgnoreSettings(state.agentIgnoreDefaults);
  normalizeSensitivitySettings(state);
  state.digestCadence = normalizeDigestCadence(state.digestCadence);
  state.digestRecipients = normalizeDigestRecipients(state.digestRecipients);
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
    // Page-specific calibration is gone rather than relocated: S3 removed the
    // panel that edited it and S8 gives it no new home, so a stored override
    // would be a value nothing can change and nothing should read.
    delete (page as { performanceThresholdOverrides?: unknown }).performanceThresholdOverrides;
    page.status = pageTrend(page, "mobile", normalizePerformanceThresholds(state.performanceThresholds));
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
  // Defaulted, never filtered. Normalisation is the obvious place to drop the
  // entries that match nothing, and dropping them is exactly the failure the
  // log exists to prevent: a decision whose remediation is gone today is still
  // a decision a person made, and the remediation can come back.
  state.caseDecisions = state.caseDecisions ?? [];
  return state;
}
