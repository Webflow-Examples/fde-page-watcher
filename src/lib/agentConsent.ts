import type { Caller } from "./caller";
import type { ExternalAgentConsentEntry, StoredCaller } from "./types";

/**
 * The project's consent record for external agent audits: the history behind
 * the boolean, and the one question a stored reading has to be asked.
 *
 * `externalAgentAuditEnabled` is the live answer and the gate reads it. This
 * module never touches that gate — it exists so that the history and the
 * boolean move together, and so that the rule for "was this permitted when it
 * was taken" is written once rather than once per screen.
 *
 * Deliberately free of copy. What a history line SAYS is settings copy; which
 * lines there are, and whether a reading predates a withdrawal, are facts about
 * the record and belong here.
 */

/**
 * The compiler's check that the stored caller IS `Caller`.
 *
 * `types.ts` imports nothing, so the shape is written out there. This is what
 * makes drift a build failure rather than a history that describes a caller the
 * app no longer has — the same device `case-decisions.ts` uses for the log.
 */
type SameSet<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
export const STORED_CONSENT_CALLER_IS_THE_CALLER: SameSet<StoredCaller, Caller> = true;

function isStoredCaller(value: unknown): value is StoredCaller {
  if (!value || typeof value !== "object") return false;
  const by = value as Partial<StoredCaller> & Record<string, unknown>;
  if (by.kind === "person") return typeof by.userId === "string" && by.userId.length > 0;
  if (by.kind === "system") return typeof by.agent === "string" && by.agent.length > 0;
  return false;
}

/**
 * Read the stored history, keeping every entry that is one.
 *
 * An entry that is structurally not an entry — no value, no timestamp, no
 * caller — is not a decision somebody made, and it is dropped on read the same
 * way an unreadable provider snapshot is skipped rather than surfaced
 * half-built. That is the only thing ever removed here: a well-formed entry is
 * never pruned, never edited, never reordered, however old it is and whatever
 * the boolean says today.
 */
export function normalizeExternalAgentConsentHistory(value: unknown): ExternalAgentConsentEntry[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry): ExternalAgentConsentEntry[] => {
    if (!entry || typeof entry !== "object") return [];
    const item = entry as Partial<ExternalAgentConsentEntry>;
    if (typeof item.enabled !== "boolean") return [];
    if (typeof item.at !== "string" || item.at.length === 0) return [];
    if (!isStoredCaller(item.by)) return [];
    return [{ enabled: item.enabled, at: item.at, by: item.by }];
  });
}

/**
 * The history with one more change on the end.
 *
 * Append only, and the caller supplies the instant so a mutation stays a pure
 * function of its inputs.
 */
export function appendConsentEntry(
  history: readonly ExternalAgentConsentEntry[] | undefined,
  enabled: boolean,
  by: Caller,
  at: string,
): ExternalAgentConsentEntry[] {
  return [...normalizeExternalAgentConsentHistory(history), { enabled, at, by }];
}

/**
 * Has this project ever turned external audits on?
 *
 * Asked of the history rather than the boolean, because the boolean cannot tell
 * "never granted" from "granted and withdrawn" — and those are different
 * answers to the only question a reader has about a control that is off.
 */
export function consentWasEverGranted(
  history: readonly ExternalAgentConsentEntry[] | undefined,
  enabled: boolean,
): boolean {
  return enabled || normalizeExternalAgentConsentHistory(history).some((entry) => entry.enabled);
}

/**
 * Was this reading collected under a permission that has since been withdrawn?
 *
 * Computed against the history, not against the boolean alone, and that is the
 * whole point: a project that turned audits off, on again and off again has
 * readings from two separate permitted stretches, and both predate the current
 * withdrawal. A reading taken while consent stands is not stale at all, which
 * is why an enabled project answers `false` before anything else is examined.
 *
 * An unparseable timestamp answers `false`. The clause is a claim about when
 * something happened, and a date nobody can read is not evidence for it.
 */
export function readingPredatesWithdrawal(
  history: readonly ExternalAgentConsentEntry[] | undefined,
  enabled: boolean,
  observedAt: string | undefined,
): boolean {
  if (enabled || !observedAt) return false;
  const entries = normalizeExternalAgentConsentHistory(history);
  const withdrawal = entries.filter((entry) => !entry.enabled).at(-1);
  if (!withdrawal) return false;
  const taken = Date.parse(observedAt);
  const withdrawn = Date.parse(withdrawal.at);
  if (!Number.isFinite(taken) || !Number.isFinite(withdrawn)) return false;
  return taken < withdrawn;
}

/**
 * The name a history line is attributed to.
 *
 * Total, and it can be: this is new storage, so no entry in it predates F4's
 * split and none carries `UNKNOWN_USER` — the same reason `case-decisions.ts`
 * gives for the log never reaching for `callerFromLegacyActor`. `normalize`
 * drops an entry whose caller has no identity, so what reaches a screen always
 * has one.
 *
 * `attributionOf` is not the right tool here and deliberately is not used: it
 * withholds a name for a system caller, which is correct where the identity is
 * a separate field beside a line that reads without it. C3's line does not read
 * without it — "Connected by" needs somebody — so this resolves a name for
 * either class instead of returning null for one of them.
 */
export function consentCallerName(by: StoredCaller): string {
  return by.kind === "person" ? by.userId : by.agent;
}
