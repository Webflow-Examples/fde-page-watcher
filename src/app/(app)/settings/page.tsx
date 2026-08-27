"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { AppearanceControl } from "@/components/appearance";
import { ExclusionReasonPicker } from "@/components/exclusion-reason-picker";
import { PageHeader } from "@/components/page-header";
import { ProjectMembers } from "@/components/ProjectMembers";
import { SegmentedControl } from "@/components/segmented-control";
import { useStore } from "@/components/store";
import { WebflowConnection } from "@/components/webflow-connection";
import { AGENT_CHECK_GROUPS, ALL_AGENT_CHECKS, agentCheckLabel, agentGroupLabel } from "@/lib/agentChecks";
import { consentCallerName, consentWasEverGranted } from "@/lib/agentConsent";
import { agentCheckKey, normalizeAgentIgnoreSettings } from "@/lib/agentScoring";
import { digestLimit } from "@/lib/digest-copy";
import { DIGEST_CADENCES, DIGEST_CADENCE_LABEL, normalizeDigestCadence } from "@/lib/digestCadence";
import {
  formatDigestRecipients,
  digestRecipientIsValid,
  parseDigestRecipients,
} from "@/lib/digestRecipients";
import { digestSiteOf } from "@/lib/digest";
import { issueCasesFrom } from "@/lib/issue-cases";
import { remediationKey } from "@/lib/issue-case";
import { normalizePerformanceThresholds } from "@/lib/performanceThresholds";
import { SENSITIVITIES, normalizeSensitivity, type Sensitivity } from "@/lib/sensitivity";
import {
  SENSITIVITY_LABEL,
  SETTINGS_APPEARANCE_HELP,
  SETTINGS_APPEARANCE_LABEL,
  SETTINGS_DIGEST_HELP,
  SETTINGS_DIGEST_LABEL,
  SETTINGS_DIGEST_RECIPIENTS_EMPTY,
  SETTINGS_DIGEST_RECIPIENTS_HELP,
  SETTINGS_DIGEST_RECIPIENTS_INVALID,
  SETTINGS_DIGEST_RECIPIENTS_LABEL,
  SETTINGS_EXCLUDED_EMPTY,
  SETTINGS_EXCLUDED_HELP,
  SETTINGS_EXCLUDED_LABEL,
  SETTINGS_EXCLUDED_SITE_SCOPE,
  SETTINGS_SENSITIVITY_HELP,
  SETTINGS_SENSITIVITY_LABEL,
  SETTINGS_SENSITIVITY_LIMIT_LABEL,
  SETTINGS_SYSTEMS_HELP,
  SETTINGS_SYSTEMS_LABEL,
  SETTINGS_CONSENT_HISTORY_LABEL,
  SETTINGS_CONSENT_NEVER,
  SETTINGS_CONSENT_RETENTION,
  SETTINGS_CONSENT_UNRECORDED,
  SETTINGS_SYSTEM_CONTRIBUTES,
  settingsConsentGranted,
  settingsConsentWithdrawn,
  settingsSubtitle,
} from "@/lib/settings-copy";
import { excludedFromResults, type ExcludedRow } from "@/lib/settings-exclusions";
import type { ExternalAgentConsentEntry } from "@/lib/types";
import { formatDate } from "@/lib/watch-copy";
import { alertWebhookUrlIsValid } from "@/lib/webhook";
import {
  DESTINATION_LABEL,
  EVIDENCE_SOURCES,
  EVIDENCE_SOURCE_LABEL,
  applicabilityActionLabel,
  type ExclusionReason,
} from "@/lib/vocabulary";

/**
 * Settings: one page, five groups, no tabs.
 *
 * The groups are in the order a reader needs them, and the order is an
 * argument. What is worth telling you comes first because it is the only
 * setting that changes what the product says. The digest is second because it
 * is how it says it. What is set aside is third because it is the answer to
 * "why am I not seeing X". Connected systems is fourth because it is
 * infrastructure. Appearance is last because it is the only one that is not
 * about the site at all.
 *
 * No tabs, deliberately. Five groups fit on one scroll, and a tab is a place to
 * hide a setting somebody will later swear does not exist — which is exactly how
 * the twelve thresholds this chunk deleted survived as long as they did.
 *
 * Three things are conspicuously absent and must stay absent:
 *
 *   - Any per-metric threshold. One control, three positions, and the limits it
 *     resolves to are printed beneath it in the digest's own words. Rebuilding
 *     the twelve fields somewhere tidier is the same product with a nicer
 *     drawer.
 *   - Any per-page sensitivity. S3 removed the page-detail calibration panel;
 *     this screen does not adopt it.
 *   - Any weighting, ranking or trust order over the connected systems. The
 *     evidence ledger exists so that two systems disagreeing is visible rather
 *     than averaged away, and a control that ordered them would be an average
 *     with extra steps.
 */

/* ── Group chrome ───────────────────────────────────────────────────────── */

function SettingsGroup({
  id,
  label,
  help,
  action,
  children,
}: {
  id: string;
  label: string;
  help: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section aria-labelledby={`${id}-heading`} className="settings-group">
      <div className="settings-group__head">
        <div style={{ minWidth: 0 }}>
          <h2 id={`${id}-heading`} className="settings-group__label">{label}</h2>
          <p className="settings-group__help">{help}</p>
        </div>
        {action ? <div className="settings-group__action">{action}</div> : null}
      </div>
      {children}
    </section>
  );
}

/* ── 1. What is worth telling you ───────────────────────────────────────── */

const SENSITIVITY_OPTIONS = SENSITIVITIES.map((value) => ({ value, label: SENSITIVITY_LABEL[value] }));

/**
 * The control, and the limits it resolves to, together.
 *
 * The second half is not decoration. A three-position control over twelve
 * numbers is only honest if the reader can see what a position means, and the
 * one thing they can check it against is the digest — so the limit printed here
 * is the string `digestLimit` gives the digest, not a second formatting of the
 * same milliseconds. `settings-sensitivity.test.ts` asserts the two are the
 * same characters; if somebody changes the unit in one place, the test fails
 * rather than the screen quietly lying.
 */
function SensitivityGroup({
  value,
  onChange,
  limit,
  disabled,
}: {
  value: Sensitivity;
  onChange: (next: Sensitivity) => void;
  limit: string | null;
  disabled: boolean;
}) {
  return (
    <SettingsGroup
      id="settings-sensitivity"
      label={SETTINGS_SENSITIVITY_LABEL}
      help={SETTINGS_SENSITIVITY_HELP}
    >
      <div className="settings-sensitivity">
        <SegmentedControl
          className="settings-sensitivity__control"
          ariaLabel={SETTINGS_SENSITIVITY_LABEL}
          value={value}
          options={SENSITIVITY_OPTIONS.map((option) => ({ ...option, disabled }))}
          onChange={(next) => onChange(next as Sensitivity)}
        />
        {limit ? (
          <dl className="settings-limits" aria-live="polite">
            <div className="settings-limits__row">
              <dt className="settings-limits__label">{SETTINGS_SENSITIVITY_LIMIT_LABEL}</dt>
              <dd className="settings-limits__value">{limit}</dd>
            </div>
          </dl>
        ) : null}
      </div>
    </SettingsGroup>
  );
}

/* ── 2. Digest ──────────────────────────────────────────────────────────── */

const CADENCE_OPTIONS = DIGEST_CADENCES.map((value) => ({ value, label: DIGEST_CADENCE_LABEL[value] }));

function DigestGroup({ disabled }: { disabled: boolean }) {
  const { digestCadence, digestRecipients, updateDigestSettings } = useStore();
  const cadence = normalizeDigestCadence(digestCadence);
  const stored = digestRecipients ?? [];
  const storedText = formatDigestRecipients(stored);
  // Adjusted during render rather than in an effect: the draft follows the
  // stored list when the store changes underneath it, and an effect that called
  // setState would render twice for every keystroke's worth of reconciliation.
  const [draft, setDraft] = useState(storedText);
  const [syncedFrom, setSyncedFrom] = useState(storedText);
  if (storedText !== syncedFrom) {
    setSyncedFrom(storedText);
    setDraft(storedText);
  }

  const entered = parseDigestRecipients(draft);
  const invalid = entered.find((entry) => !digestRecipientIsValid(entry));
  const dirty = formatDigestRecipients(entered) !== storedText;

  return (
    <SettingsGroup
      id="settings-digest"
      label={SETTINGS_DIGEST_LABEL}
      help={SETTINGS_DIGEST_HELP}
      action={
        <SegmentedControl
          ariaLabel={SETTINGS_DIGEST_LABEL}
          value={cadence}
          options={CADENCE_OPTIONS.map((option) => ({ ...option, disabled }))}
          onChange={(next) => updateDigestSettings(normalizeDigestCadence(next), stored)}
        />
      }
    >
      <label htmlFor="digest-recipients" className="settings-field">
        <span className="settings-field__label">{SETTINGS_DIGEST_RECIPIENTS_LABEL}</span>
        <textarea
          id="digest-recipients"
          rows={Math.min(6, Math.max(2, entered.length + 1))}
          value={draft}
          disabled={disabled}
          spellCheck={false}
          onChange={(event) => setDraft(event.target.value)}
          aria-invalid={invalid !== undefined}
          aria-describedby="digest-recipients-help"
          className="settings-field__input"
        />
      </label>
      <div className="settings-field__foot">
        <p
          id="digest-recipients-help"
          aria-live="polite"
          className={`settings-field__help${invalid === undefined ? "" : " is-invalid"}`}
        >
          {invalid !== undefined
            ? SETTINGS_DIGEST_RECIPIENTS_INVALID
            : entered.length === 0
              ? SETTINGS_DIGEST_RECIPIENTS_EMPTY
              : SETTINGS_DIGEST_RECIPIENTS_HELP}
        </p>
        <button
          type="button"
          className="settings-save"
          disabled={disabled || !dirty || invalid !== undefined}
          onClick={() => updateDigestSettings(cadence, entered)}
        >
          Save
        </button>
      </div>
    </SettingsGroup>
  );
}

/* ── 3. Excluded from results ───────────────────────────────────────────── */

/**
 * One row, whatever kind of thing it is.
 *
 * The reading stays and is struck through rather than removed, which is the
 * same treatment the case's pages table gives an excluded page and for the same
 * reason: struck through says "not counted", and an empty cell would say "never
 * measured", which is a lie about a thing that was measured.
 */
function ExcludedRowView({ row, onInclude }: { row: ExcludedRow; onInclude?: () => void }) {
  return (
    <li className="excluded-row">
      <div className="excluded-row__body">
        <span className="excluded-row__title">{row.title}</span>
        {row.scope ? <span className="excluded-row__scope">{row.scope}</span> : null}
        {/*
          A check is set aside for the whole site, and the row has to say so.
          The rows either side of this one are scoped to a page or to a case, so
          a check row that named no scope read as though it were scoped too —
          and the decision it records is the one thing here that never is.
        */}
        {row.kind === "check"
          ? <span className="excluded-row__scope">{SETTINGS_EXCLUDED_SITE_SCOPE}</span>
          : null}
        <span className="excluded-row__reason">{row.reason}</span>
      </div>
      <span className={`excluded-row__reading${row.measured ? "" : " is-unmeasured"}`}>{row.reading}</span>
      {/*
        The control is offered only where the change can be KEPT — the same rule
        `CasePages` states for the same concept. A button that took a reader's
        decision, showed it and lost it on reload is the trust failure this
        product exists to fix, and it is worse than no button. The row is still
        here, with its reading and its reason, so nothing is hidden meanwhile.
      */}
      {onInclude ? (
        <button type="button" className="excluded-row__include" onClick={onInclude}>
          {/* The registry names this action, not this screen. */}
          {applicabilityActionLabel("excluded")}
        </button>
      ) : null}
    </li>
  );
}

function ExcludedGroup({ disabled }: { disabled: boolean }) {
  const store = useStore();
  const { pages, recs, agentIgnoreDefaults, caseDecisions } = store;
  // The cases are derived, so the excluded PAGES in this list come from the
  // same derivation the case detail draws its own pages table from — decisions
  // and all (F5). One list covering pages and checks means reading both, not
  // describing both.
  const rows = useMemo(() => {
    const state = { pages, recs, agentIgnoreDefaults, caseDecisions };
    return excludedFromResults(state, issueCasesFrom(state));
  }, [pages, recs, agentIgnoreDefaults, caseDecisions]);
  const [choosing, setChoosing] = useState<string | null>(null);

  const defaults = normalizeAgentIgnoreSettings(agentIgnoreDefaults);
  /**
   * What can still be set aside.
   *
   * The Exclude half lives here rather than in a grid of every check, because a
   * screen that lists twenty checks with a toggle each IS the per-metric panel
   * this chunk deleted, wearing a different noun. This asks for one thing and
   * one reason, which is what applicability requires.
   */
  const excludable = [
    ...AGENT_CHECK_GROUPS
      .filter((group) => !defaults.groups.includes(group.name))
      .map((group) => ({ key: `group:${group.name}`, label: agentGroupLabel(group.name), scope: "group" as const, value: group.name })),
    ...ALL_AGENT_CHECKS
      .filter((check) => !defaults.groups.includes(check.group) && !defaults.checks.includes(agentCheckKey(check)))
      .map((check) => ({
        key: `check:${agentCheckKey(check)}`,
        label: `${agentGroupLabel(check.group)} · ${agentCheckLabel(check.name)}`,
        scope: "check" as const,
        value: agentCheckKey(check),
      })),
  ];
  const [target, setTarget] = useState("");

  /**
   * What Include does for this row.
   *
   * Three kinds of record, three writers, one word on the button. Each row
   * knows which record it is, so nothing here guesses — and the control is only
   * offered where the change can be KEPT, which since F5 is all three: the
   * decision log persists a case-page exclusion, so the button is real rather
   * than withheld.
   */
  const includeFor = (row: ExcludedRow): (() => void) | undefined => {
    const to = row.include;
    if (disabled) return undefined;
    if (to.target === "native-element") {
      return () => store.setNativeElementApplicability(to.pageId, to.findingId, null);
    }
    if (to.target === "agent-check") {
      return () => store.setDefaultAgentIgnore(to.scope, to.value, false);
    }
    // The key is derived here, from the case, by its single producer. A row
    // carrying a precomputed one would be a second key in circulation.
    return () => store.recordCaseDecision({
      decision: "include",
      remediationKey: remediationKey(to.issue),
      pageId: to.pageId,
    });
  };

  /**
   * Excluding IS choosing the reason.
   *
   * There is no separate confirm step, and the reason is not a follow-up
   * prompt: applicability requires one, and a prompt that appears afterwards is
   * a prompt nobody completes. The chosen reason is stored against the record,
   * so the row it produces reports what this reader decided rather than what
   * the old unlabelled toggle used to mean.
   */
  const exclude = (reason: ExclusionReason) => {
    const chosen = excludable.find((item) => item.key === target);
    setChoosing(null);
    setTarget("");
    if (!chosen) return;
    store.setDefaultAgentIgnore(chosen.scope, chosen.value, true, reason);
  };

  return (
    <SettingsGroup
      id="settings-excluded"
      label={SETTINGS_EXCLUDED_LABEL}
      help={SETTINGS_EXCLUDED_HELP}
    >
      {rows.length === 0 ? (
        <p className="settings-empty">{SETTINGS_EXCLUDED_EMPTY}</p>
      ) : (
        <ul className="excluded-list">
          {rows.map((row) => (
            <ExcludedRowView key={row.id} row={row} onInclude={includeFor(row)} />
          ))}
        </ul>
      )}

      {disabled ? null : (
        <div className="excluded-add">
          <label htmlFor="excluded-add-target" className="visually-hidden">
            Choose a check that does not apply to this site
          </label>
          <select
            id="excluded-add-target"
            className="settings-field__input"
            value={target}
            onChange={(event) => {
              setTarget(event.target.value);
              setChoosing(event.target.value || null);
            }}
          >
            <option value="">Add a check that does not apply…</option>
            {excludable.map((item) => (
              <option key={item.key} value={item.key}>{item.label}</option>
            ))}
          </select>
          {choosing ? (
            <ExclusionReasonPicker
              label="Reason it does not apply"
              onChoose={exclude}
              onCancel={() => {
                setChoosing(null);
                setTarget("");
              }}
            />
          ) : null}
        </div>
      )}
    </SettingsGroup>
  );
}

/* ── 4. Connected systems ───────────────────────────────────────────────── */

/**
 * Connect, disconnect, credentials. Nothing else.
 *
 * No weighting, no ranking and no trust order, and that is the registry's
 * ruling rather than a layout preference: the evidence ledger keeps one entry
 * per system precisely so a disagreement is visible instead of averaged away. A
 * control that ordered these would be a blend with a nicer name, and the group
 * says so in its own help line.
 */
/**
 * Every change to Ora consent, oldest first, and never anything else.
 *
 * The list IS the history rather than a summary derived from one (F5's rule),
 * so nothing here folds, counts or collapses entries — a project that connected
 * and disconnected four times has eight lines, because that is what happened.
 *
 * The three states are distinct on purpose, and none of them is a blank. Entries,
 * so they render. No entries and never connected, which is a real answer and
 * gets said in as many words. And no entries while connected — a project that
 * turned Ora on before this record existed — which is not nothing to report:
 * it is a grant with no date, and rule 18 says an absent measurement is not a
 * small one. Two empty states, two different lines, because "never connected"
 * would be a flat lie about a project that is connected right now.
 */
function ConsentHistory({
  entries,
  on,
}: {
  entries: readonly ExternalAgentConsentEntry[];
  on: boolean;
}) {
  const everGranted = consentWasEverGranted(entries, on);
  return (
    <div className="settings-consent">
      <h4 className="settings-consent__label">{SETTINGS_CONSENT_HISTORY_LABEL}</h4>
      {entries.length === 0 ? (
        <p className="settings-consent__none">
          {everGranted ? SETTINGS_CONSENT_UNRECORDED : SETTINGS_CONSENT_NEVER}
        </p>
      ) : (
        <ul className="settings-consent__list">
          {entries.map((entry, index) => (
            <li className="settings-consent__entry" key={`${entry.at}:${index}`}>
              <span>
                {entry.enabled
                  ? settingsConsentGranted(consentCallerName(entry.by))
                  : settingsConsentWithdrawn(consentCallerName(entry.by))}
              </span>
              {/* Absolute, never "3 days ago": a consent record is evidence
                  about a moment, and a relative date stops being true. */}
              <span>{formatDate(entry.at)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ConnectedSystemsGroup({ disabled }: { disabled: boolean }) {
  const {
    pathFor,
    alertWebhookUrl,
    updateAlertWebhookUrl,
    externalAgentAuditEnabled,
    externalAgentAuditConsentHistory,
    setExternalAgentAuditEnabled,
  } = useStore();
  const consentOn = externalAgentAuditEnabled === true;
  const consentHistory = externalAgentAuditConsentHistory ?? [];
  const stored = alertWebhookUrl ?? "";
  const [webhookDraft, setWebhookDraft] = useState(stored);
  const [syncedFrom, setSyncedFrom] = useState(stored);
  if (stored !== syncedFrom) {
    setSyncedFrom(stored);
    setWebhookDraft(stored);
  }
  const webhook = webhookDraft.trim();
  const webhookValid = !webhook || alertWebhookUrlIsValid(webhook);
  const webhookDirty = webhook !== (alertWebhookUrl ?? "");

  return (
    <SettingsGroup
      id="settings-systems"
      label={SETTINGS_SYSTEMS_LABEL}
      help={SETTINGS_SYSTEMS_HELP}
    >
      <WebflowConnection
        connectionUrl={pathFor("/api/settings/webflow")}
        syncUrl={pathFor("/api/settings/webflow/sync")}
      />

      {/*
        The systems with nothing to configure, and what each one contributes.

        This is the operational half of the retired glossary, and it sits here
        rather than on a reference page for the reason the glossary was retired:
        a reader who has to leave the screen to find out what took a reading
        will not go, and most of this product's copy is read outside the app
        entirely, where no link is reachable.

        Derived from the registry's evidence sources rather than listed by hand,
        so a system added to the ledger appears here instead of arriving
        unexplained. Ora is the one with a control and has its own row below.
      */}
      <div className="settings-system settings-system--stacked">
        <div style={{ minWidth: 0 }}>
          <h3 className="settings-system__name">Always on</h3>
          <p className="settings-system__note">
            These need no connecting and cannot be switched off. Each one is a separate voice in the evidence
            ledger, so where two of them disagree you see both readings rather than an average.
          </p>
        </div>
        <dl className="settings-contributes">
          {EVIDENCE_SOURCES.filter((source) => source !== "ora").map((source) => (
            <div key={source} className="settings-contributes__row">
              <dt className="settings-contributes__name">{EVIDENCE_SOURCE_LABEL[source]}</dt>
              <dd className="settings-contributes__note">{SETTINGS_SYSTEM_CONTRIBUTES[source]}</dd>
            </div>
          ))}
        </dl>
      </div>

      {/*
        The Ora row IS the consent control, and it stays exactly where it is.
        What it gains is the retention sentence — the half of the disclosure it
        did not say — and the record of who changed it, beneath. The disclosure
        reads ABOVE the control because it is what somebody needs before
        deciding, not an explanation of what they just did.

        Stacked, because the card now holds two things: the row, and the record
        beneath it. Without this the card's own flex would lay the history out
        BESIDE the control as a third column. `--stacked` is S8's existing
        modifier and `.settings-consent__row` reproduces the original row inside
        it, so the Ora row itself looks exactly as it did.
      */}
      <div className="settings-system settings-system--stacked">
        <div className="settings-consent__row">
          <div style={{ minWidth: 0 }}>
            <h3 className="settings-system__name">{EVIDENCE_SOURCE_LABEL.ora}</h3>
            <p className="settings-system__note">
              {SETTINGS_SYSTEM_CONTRIBUTES.ora} Switching it on sends the live web address of each watched page to
              Ora, whose scans are public: the result enters Ora&apos;s directory and anyone can read it. Webflow
              staging addresses are never sent.{" "}
              {/* Draft, pending legal review. Rendered rather than withheld: a
                  reader deciding today needs it more than the review needs to
                  land first. Not reworded here — it states a consequence about
                  third-party publication. */}
              {SETTINGS_CONSENT_RETENTION}
            </p>
          </div>
          <SegmentedControl
            ariaLabel="Ora"
            value={externalAgentAuditEnabled ? "connected" : "off"}
            options={[
              { value: "connected", label: "Connected", disabled },
              { value: "off", label: "Not connected", disabled },
            ]}
            onChange={(next) => setExternalAgentAuditEnabled(next === "connected")}
          />
        </div>
        <ConsentHistory entries={consentHistory} on={consentOn} />
      </div>

      <div className="settings-system settings-system--stacked">
        <div style={{ minWidth: 0 }}>
          <h3 className="settings-system__name">Digest endpoint</h3>
          <p className="settings-system__note">
            Where the digest is delivered, with the recipients this site named. Treat the URL as a credential;
            it is used for nothing else.
          </p>
        </div>
        <label htmlFor="digest-endpoint" className="settings-field">
          <span className="settings-field__label">Endpoint URL</span>
          <input
            id="digest-endpoint"
            type="url"
            inputMode="url"
            autoComplete="url"
            maxLength={2048}
            disabled={disabled}
            value={webhookDraft}
            onChange={(event) => setWebhookDraft(event.target.value)}
            placeholder="https://hooks.example.com/page-watch"
            aria-invalid={!webhookValid}
            aria-describedby="digest-endpoint-help"
            className="settings-field__input"
          />
        </label>
        <div className="settings-field__foot">
          <p
            id="digest-endpoint-help"
            aria-live="polite"
            className={`settings-field__help${webhookValid ? "" : " is-invalid"}`}
          >
            {webhookValid
              ? webhook
                ? "HTTPS only."
                : "Leave this blank and the digest is built but not delivered."
              : "Enter an HTTPS URL with no embedded username or password."}
          </p>
          <button
            type="button"
            className="settings-save"
            disabled={disabled || !webhookDirty || !webhookValid}
            onClick={() => updateAlertWebhookUrl(webhook)}
          >
            Save
          </button>
        </div>
      </div>
    </SettingsGroup>
  );
}

/* ── 5. Appearance ──────────────────────────────────────────────────────── */

/**
 * Canonical here.
 *
 * The sidebar footer keeps its copy of this control as a shortcut, and it may
 * collapse below 480px. That is correct rather than a bug to patch: a shortcut
 * that disappears when the sidebar has no room is fine precisely because this
 * screen exists, and this screen is reachable at 320px. If the only appearance
 * control were the sidebar's, the collapse would be a defect.
 */
function AppearanceGroup() {
  const { appearance, setAppearance } = useStore();
  return (
    <SettingsGroup
      id="settings-appearance"
      label={SETTINGS_APPEARANCE_LABEL}
      help={SETTINGS_APPEARANCE_HELP}
      action={<AppearanceControl className="settings-appearance__control" value={appearance} onChange={setAppearance} />}
    >
      {null}
    </SettingsGroup>
  );
}

/* ── The page ───────────────────────────────────────────────────────────── */

export default function SettingsPage() {
  const store = useStore();
  const { canManageProject, pathFor, sensitivity, performanceThresholds, setSensitivity } = store;
  const router = useRouter();
  useEffect(() => {
    if (!canManageProject) router.replace(pathFor("/dashboard"));
  }, [canManageProject, pathFor, router]);

  const site = digestSiteOf(store);
  const position = normalizeSensitivity(sensitivity);
  const limit = digestLimit(normalizePerformanceThresholds(performanceThresholds));

  if (!canManageProject) return null;
  return (
    <div>
      <PageHeader title={DESTINATION_LABEL.settings} purpose={settingsSubtitle(site)} />
      <div className="settings-page">
        <SensitivityGroup value={position} onChange={setSensitivity} limit={limit} disabled={!canManageProject} />
        <DigestGroup disabled={!canManageProject} />
        <ExcludedGroup disabled={!canManageProject} />
        <ConnectedSystemsGroup disabled={!canManageProject} />
        <AppearanceGroup />
        <ProjectMembers />
      </div>
    </div>
  );
}
