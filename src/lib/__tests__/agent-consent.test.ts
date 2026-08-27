import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { createFsStore, type DataStore } from "../store/fsStore";
import { setExternalAgentAuditEnabled } from "../mutations";
import {
  appendConsentEntry,
  consentCallerName,
  consentWasEverGranted,
  normalizeExternalAgentConsentHistory,
  readingPredatesWithdrawal,
} from "../agentConsent";
import { SETTINGS_CONSENT_NEVER, SETTINGS_CONSENT_UNRECORDED } from "../settings-copy";
import type { ExternalAgentConsentEntry } from "../types";
import type { Caller } from "../caller";

/**
 * Consent as a record rather than a switch.
 *
 * The boolean is the live answer and the gate reads it; these are about the
 * history behind it — that it moves with the boolean, that nothing prunes it,
 * and that a stored reading can be asked which side of a withdrawal it falls
 * on. Nothing here touches the gate itself; `agent-audit-isolation` owns that.
 */

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

const RAE: Caller = { kind: "person", userId: "rae@webflow.com" };
const SAM: Caller = { kind: "person", userId: "sam@webflow.com" };

const T1 = "2026-08-01T00:00:00.000Z";
const T2 = "2026-08-05T00:00:00.000Z";
const T3 = "2026-08-10T00:00:00.000Z";
const T4 = "2026-08-15T00:00:00.000Z";

const entry = (enabled: boolean, at: string, by: Caller = RAE): ExternalAgentConsentEntry =>
  ({ enabled, at, by });

async function store(): Promise<DataStore> {
  const root = await mkdtemp(path.join(tmpdir(), "fde-consent-"));
  roots.push(root);
  const dataStore = createFsStore("test", root);
  // The updater mutates in place; a returned object is not the state.
  await dataStore.updateState((state) => {
    state.pages = [];
    state.recs = [];
    state.followUps = [];
  });
  return dataStore;
}

/* ── Reading the record ─────────────────────────────────────────────────── */

describe("the stored history", () => {
  it("reads legacy state, which has none, as nothing recorded", () => {
    expect(normalizeExternalAgentConsentHistory(undefined)).toEqual([]);
    expect(normalizeExternalAgentConsentHistory(null)).toEqual([]);
    expect(normalizeExternalAgentConsentHistory("on")).toEqual([]);
  });

  it("keeps every entry that is one, in the order it was written", () => {
    const history = [entry(true, T1), entry(false, T2), entry(true, T3)];
    expect(normalizeExternalAgentConsentHistory(history)).toEqual(history);
  });

  it("drops what is structurally not an entry, and only that", () => {
    // The same treatment an unreadable provider snapshot gets: skipped rather
    // than surfaced half-built. A record with no value, no timestamp or no
    // identity is not a decision somebody made.
    const kept = entry(true, T1);
    expect(normalizeExternalAgentConsentHistory([
      kept,
      { at: T2, by: RAE },
      { enabled: false, by: RAE },
      { enabled: false, at: T2 },
      { enabled: false, at: T2, by: { kind: "person" } },
      { enabled: false, at: "", by: RAE },
      null,
      "off",
    ])).toEqual([kept]);
  });

  it("never prunes a well-formed entry, however old or however contradicted", () => {
    // Withdrawal is not a retraction. A grant from months ago stays in the log
    // after it has been withdrawn twice over, because it is the only thing that
    // can answer what was permitted when a stored reading was taken.
    const history = [entry(true, T1), entry(false, T2), entry(true, T3), entry(false, T4)];
    expect(normalizeExternalAgentConsentHistory(history)).toHaveLength(4);
    expect(appendConsentEntry(history, true, SAM, "2026-08-20T00:00:00.000Z")).toHaveLength(5);
  });
});

/* ── Writing it ─────────────────────────────────────────────────────────── */

describe("changing consent", () => {
  it("appends an entry and flips the boolean, together", async () => {
    const dataStore = await store();
    const on = await setExternalAgentAuditEnabled(true, RAE, dataStore, new Date(T1));
    expect(on.externalAgentAuditEnabled).toBe(true);
    expect(on.externalAgentAuditConsentHistory).toEqual([entry(true, T1)]);

    const off = await setExternalAgentAuditEnabled(false, SAM, dataStore, new Date(T2));
    expect(off.externalAgentAuditEnabled).toBe(false);
    // The grant survives the withdrawal. Both are the record.
    expect(off.externalAgentAuditConsentHistory).toEqual([entry(true, T1), entry(false, T2, SAM)]);
  });

  it("does neither when the value is not changing", async () => {
    // Re-selecting the position a project is already in is not a decision, and
    // recording one would put a change in the history that never happened.
    const dataStore = await store();
    await setExternalAgentAuditEnabled(true, RAE, dataStore, new Date(T1));
    const again = await setExternalAgentAuditEnabled(true, SAM, dataStore, new Date(T2));
    expect(again.externalAgentAuditEnabled).toBe(true);
    expect(again.externalAgentAuditConsentHistory).toEqual([entry(true, T1)]);
  });

  it("records who, from the caller rather than from the request body", async () => {
    const dataStore = await store();
    const state = await setExternalAgentAuditEnabled(true, SAM, dataStore, new Date(T1));
    expect(state.externalAgentAuditConsentHistory?.[0]?.by).toEqual(SAM);
    expect(consentCallerName(SAM)).toBe("sam@webflow.com");
    expect(consentCallerName({ kind: "system", agent: "migration" })).toBe("migration");
  });

  it("leaves a legacy project reading as off, with nothing recorded", async () => {
    const dataStore = await store();
    const state = await dataStore.getState();
    expect(state.externalAgentAuditEnabled).toBe(false);
    expect(state.externalAgentAuditConsentHistory).toEqual([]);
    expect(consentWasEverGranted(state.externalAgentAuditConsentHistory, false)).toBe(false);
  });
});

/* ── Was it ever on ─────────────────────────────────────────────────────── */

describe("was this ever on", () => {
  it("separates never-granted from granted-and-withdrawn", () => {
    // The question the boolean cannot answer, and the reason the screen shows a
    // line rather than an empty list.
    expect(consentWasEverGranted([], false)).toBe(false);
    expect(consentWasEverGranted([entry(true, T1), entry(false, T2)], false)).toBe(true);
  });

  it("says yes for a project that is on now but predates the record", () => {
    // Legacy: the boolean shipped before the history did. "Never been connected"
    // would be false about a project that plainly is.
    expect(consentWasEverGranted([], true)).toBe(true);
  });
});

/* ── A reading and the permission behind it ─────────────────────────────── */

describe("a reading that predates a withdrawal", () => {
  it("is marked when consent has since been withdrawn", () => {
    expect(readingPredatesWithdrawal([entry(true, T1), entry(false, T3)], false, T2)).toBe(true);
  });

  it("is not marked while consent stands", () => {
    // Nothing is stale on a connected project: the clause says the permission
    // is gone, and it is not.
    expect(readingPredatesWithdrawal([entry(true, T1)], true, T2)).toBe(false);
  });

  it("is not marked after a later re-grant — both sides", () => {
    // The half that needs the history rather than the boolean. Same reading
    // date, same project, two different answers depending on what the record
    // says happened after it.
    const withdrawn = [entry(true, T1), entry(false, T2)];
    const regranted = [entry(true, T1), entry(false, T2), entry(true, T3)];
    const takenBeforeTheWithdrawal = "2026-08-03T00:00:00.000Z";
    expect(readingPredatesWithdrawal(withdrawn, false, takenBeforeTheWithdrawal)).toBe(true);
    expect(readingPredatesWithdrawal(regranted, true, takenBeforeTheWithdrawal)).toBe(false);
    // And a reading taken after the re-grant, on a project still connected.
    expect(readingPredatesWithdrawal(regranted, true, T4)).toBe(false);
  });

  it("uses the most recent withdrawal when there have been several", () => {
    // Two permitted stretches. A reading from either one predates the current
    // withdrawal, so both carry the clause.
    const twice = [entry(true, T1), entry(false, T2), entry(true, T3), entry(false, T4)];
    expect(readingPredatesWithdrawal(twice, false, "2026-08-03T00:00:00.000Z")).toBe(true);
    expect(readingPredatesWithdrawal(twice, false, "2026-08-12T00:00:00.000Z")).toBe(true);
  });

  it("marks nothing when consent was never withdrawn, and nothing undated", () => {
    expect(readingPredatesWithdrawal([entry(true, T1)], false, T2)).toBe(false);
    expect(readingPredatesWithdrawal([entry(true, T1), entry(false, T3)], false, undefined)).toBe(false);
    // A date nobody can read is not evidence for a claim about when.
    expect(readingPredatesWithdrawal([entry(true, T1), entry(false, T3)], false, "whenever")).toBe(false);
  });
});

/* ── Where the words live ───────────────────────────────────────────────── */

describe("one string, one home", () => {
  it("has S4's ledger import the clause rather than restate it", () => {
    const ledger = readFileSync(path.join(SRC, "components", "agent-access.tsx"), "utf8");
    expect(ledger).toContain("SETTINGS_CONSENT_STALE_READING");
    expect(ledger, "the ledger restates the clause instead of importing it")
      .not.toContain("collected while Ora was connected");
  });

  it("keeps the toggle's option labels inline, matching the sibling control", () => {
    // S8's file mixes two conventions and this follows both: sub-control and
    // option labels are inline literals, sentence-length copy is a constant.
    const page = readFileSync(path.join(SRC, "app", "(app)", "settings", "page.tsx"), "utf8");
    expect(page).toContain('label: "Connected"');
    expect(page).toContain('label: "Not connected"');
    const copy = readFileSync(path.join(SRC, "lib", "settings-copy.ts"), "utf8");
    expect(copy).not.toContain('"Connected"');
    expect(copy).not.toContain('"Not connected"');
  });

  it("keeps every sentence-length string in the shared module", () => {
    const page = readFileSync(path.join(SRC, "app", "(app)", "settings", "page.tsx"), "utf8");
    for (const constant of [
      "SETTINGS_CONSENT_HISTORY_LABEL",
      "SETTINGS_CONSENT_NEVER",
      "SETTINGS_CONSENT_UNRECORDED",
      "SETTINGS_CONSENT_RETENTION",
      "settingsConsentGranted",
      "settingsConsentWithdrawn",
    ]) {
      expect(page, `${constant} is not read from the shared module`).toContain(constant);
    }
    expect(page, "the never line is written into the screen")
      .not.toContain("has never been connected for this project");
  });

  it("gives both empty states a line, and suppresses neither", () => {
    // Rule 18: an absent record is not nothing to report. A project connected
    // before the record existed has a grant with no date, and says so; it does
    // not fall through to "never connected", and the block is never hidden.
    const page = readFileSync(path.join(SRC, "app", "(app)", "settings", "page.tsx"), "utf8");
    expect(page).toContain("everGranted ? SETTINGS_CONSENT_UNRECORDED : SETTINGS_CONSENT_NEVER");
    expect(page, "the history block is suppressed for a state that has something to say")
      .not.toMatch(/entries\.length === 0 && everGranted\) return null/);
    // The two lines are different sentences, so neither can stand in for the other.
    expect(SETTINGS_CONSENT_UNRECORDED).not.toBe(SETTINGS_CONSENT_NEVER);
  });

  it("stacks the Ora card, so the history sits under the control and not beside it", () => {
    // Found by looking at it, not by a test: `.settings-system` is a flex ROW,
    // so a card with two children lays the history out as a third column next
    // to the toggle. `--stacked` is S8's own modifier and
    // `.settings-consent__row` reproduces the original row inside it, so the Ora
    // row looks unchanged and the record lands beneath it.
    const page = readFileSync(path.join(SRC, "app", "(app)", "settings", "page.tsx"), "utf8");
    const card = page.indexOf('<div className="settings-consent__row">');
    expect(card).toBeGreaterThan(-1);
    const opensCard = page.lastIndexOf("<div className=\"settings-system", card);
    expect(page.slice(opensCard, card), "the Ora card is not stacked")
      .toContain("settings-system--stacked");
  });

  it("writes the consent boolean from exactly one place", () => {
    // One writer, so the boolean cannot move without the history moving with it.
    const mutations = readFileSync(path.join(SRC, "lib", "mutations.ts"), "utf8");
    // Assignments only — the guard above it compares, and `normalize` defaulting
    // a missing field closed is not a change of consent.
    expect(mutations.match(/state\.externalAgentAuditEnabled\s*=(?!=)/g) ?? []).toHaveLength(1);
  });

  it("discloses the consequence once, at the control", () => {
    const page = readFileSync(path.join(SRC, "app", "(app)", "settings", "page.tsx"), "utf8");
    // Rendered once. The import is the other occurrence and is not a rendering.
    expect(page.match(/\{SETTINGS_CONSENT_RETENTION\}/g) ?? []).toHaveLength(1);
    // And above the control, which is where somebody deciding needs it.
    expect(page.indexOf("{SETTINGS_CONSENT_RETENTION}"))
      .toBeLessThan(page.indexOf('ariaLabel="Ora"'));
  });
});
