import type { Sensitivity } from "./sensitivity";
import type { EvidenceSource } from "./vocabulary";

/**
 * The words Settings says, in one place.
 *
 * Locked copy from the S8 brief. Four strings the brief lists are deliberately
 * NOT here, because something else already owns them and a second statement
 * would be a defect waiting (rule 20):
 *
 *   - `settings.title` — "Settings" is `DESTINATION_LABEL.settings`. The
 *     registry names the destinations; a screen does not get to name itself.
 *   - `settings.excluded.include` — "Include" is the registry's applicability
 *     action, produced by `applicabilityActionLabel`. The same button on the
 *     case detail already reads it from there, and two screens spelling one
 *     action differently is exactly what that concept exists to prevent.
 *   - the limits shown under the sensitivity control. Those are
 *     `digestLimit`'s, from S7. The screen's promise is that it shows what the
 *     digest will say, and it can only keep that promise by asking the digest.
 *   - the appearance options. `APPEARANCE_LABEL` owns Auto, Light and Dark, and
 *     the pre-paint script depends on those exact values.
 *
 * What is here is the copy nothing else states.
 */

/* ── The page ───────────────────────────────────────────────────────────── */

export function settingsSubtitle(site: string): string {
  return `For ${site}. Changes apply from the next nightly run.`;
}

/* ── Sensitivity ────────────────────────────────────────────────────────── */

export const SETTINGS_SENSITIVITY_LABEL = "What is worth telling you";
export const SETTINGS_SENSITIVITY_HELP = "Sets the limits every digest line refers to.";

/** The three positions, in the words the reader chooses between. */
export const SENSITIVITY_LABEL: Record<Sensitivity, string> = {
  low: "Only big moves",
  normal: "Normal",
  high: "Everything",
};

/**
 * What the limit beneath the control governs.
 *
 * The label is this screen's; the value beside it is the digest's. That split
 * is the whole point of the row: a reader who wants to know why a line said
 * "above the 250 ms you set" can see the 250 ms here, spelled the same way,
 * and see which position put it there.
 */
export const SETTINGS_SENSITIVITY_LIMIT_LABEL = "Smallest saving a digest line will mention";

/* ── Digest ─────────────────────────────────────────────────────────────── */

export const SETTINGS_DIGEST_LABEL = "Digest";
/**
 * What "per run" means, said where the reader meets the phrase.
 *
 * The glossary used to define "nightly run" on a page of its own, which is the
 * wrong shape for it twice over: a reader who has to leave this screen to learn
 * what a run is will not, and most of this product's copy is read outside the
 * app entirely. So the run is explained in the clause that uses it — what it
 * does, and how often — rather than defined somewhere a link could reach.
 */
export const SETTINGS_DIGEST_HELP =
  "One message per run — overnight, every watched page measured again. Sent even when nothing changed, so silence means the run failed.";

/** Who it goes to. One field, one address per line — there is no other granularity. */
export const SETTINGS_DIGEST_RECIPIENTS_LABEL = "Recipients";
export const SETTINGS_DIGEST_RECIPIENTS_HELP = "One address per line.";
export const SETTINGS_DIGEST_RECIPIENTS_EMPTY = "Nobody is named yet, so the message is built and not sent.";
export const SETTINGS_DIGEST_RECIPIENTS_INVALID = "One of these is not an email address.";

/* ── Excluded from results ──────────────────────────────────────────────── */

export const SETTINGS_EXCLUDED_LABEL = "Excluded from results";
export const SETTINGS_EXCLUDED_HELP =
  "Pages and checks that do not apply to this site. Each keeps its last reading and its reason.";

/** Nothing set aside is good news, and rule 15 says an empty list must say so. */
export const SETTINGS_EXCLUDED_EMPTY = "Nothing is set aside. Every page and check counts toward this site's results.";

/* ── Connected systems ──────────────────────────────────────────────────── */

export const SETTINGS_SYSTEMS_LABEL = "Connected systems";
export const SETTINGS_SYSTEMS_HELP =
  "Each one speaks for itself in the evidence ledger. Readings are never combined.";

/**
 * What each system contributes, and how often it measures.
 *
 * This is the operational half of the retired glossary, moved to the group it
 * describes. Keyed by `EvidenceSource` rather than written as prose, for two
 * reasons: the ledger's entries are the registry's, so a system added there
 * arrives here as a missing key rather than as a row nobody explained; and the
 * cadence differs per system, so one screen-level claim about "how often" would
 * be false for whichever system it did not describe. Nightly is true of the
 * lab test and the agent checks; the visitor figures move once a week.
 *
 * Every line puts the plain meaning first and the industry term after it, in
 * parentheses — the one pattern, applied here as everywhere.
 */
export const SETTINGS_SYSTEM_CONTRIBUTES: Record<EvidenceSource, string> = {
  lighthouse:
    "Scores the page on a simulated phone and desktop every night, keeping the middle result of several runs so one slow load cannot move the number (Lighthouse, run through PageSpeed Insights).",
  crux:
    "Reports what real Chrome visitors met, updated weekly over a rolling 28 days — so it moves more slowly than the nightly score, and disagreeing with it is not a fault in either (the Chrome UX Report).",
  "native-elements":
    "Reads the published page for the elements Webflow generated, which is how a finding can tell you whether the fix is yours to make.",
  "agent-readiness":
    "Asks this site, one page a night, the questions an AI agent asks before it reads anything.",
  ora:
    "Audits the whole site rather than a page, so every watched page on it shares one reading. The only system here you have to switch on.",
  kitesurf:
    "Opens the page in a real browser and records what actually rendered, which is how a finding is confirmed on a page that needs scripts to run.",
};

/* ── Consent, on the Ora row of Connected systems ───────────────────────── */

/**
 * The retention half of the Ora disclosure.
 *
 * DRAFT, PENDING LEGAL REVIEW. It is rendered, because a reader deciding today
 * needs it more than the review needs to finish first, and it states a
 * consequence about third-party publication rather than a fact about this app —
 * so it is not reworded here. It has one home for that reason: a sentence under
 * review that is inline in a screen is a sentence nobody can find when the
 * review lands.
 *
 * It appends to the shipped Ora note rather than replacing any of it. S9
 * rewrote that note in plain language and it survives here word for word; what
 * it still did not say is what turning the switch back off does and does not
 * undo, which is the question a withdrawal makes somebody ask.
 */
export const SETTINGS_CONSENT_RETENTION =
  "Turning this off stops new scans but does not remove what has already been published.";

/**
 * The heading over the history.
 *
 * "Consent history", not "Connection history": the entries name the action
 * somebody took and so use the control's words, but the heading names the
 * RECORD, and `types.ts` is explicit that the boolean is a consent record and
 * not a presentation flag. It is also the only place the word consent appears
 * on screen.
 */
export const SETTINGS_CONSENT_HISTORY_LABEL = "Consent history";

/** One change, in the control's own words. `name` is a caller's display name. */
export function settingsConsentGranted(name: string): string {
  return `Connected by ${name}`;
}

export function settingsConsentWithdrawn(name: string): string {
  return `Disconnected by ${name}`;
}

/**
 * The answer to "was this ever on?", which an empty list does not give.
 *
 * Rule 15's shape: nothing recorded is a real answer and the screen says it,
 * rather than leaving a reader to infer it from a gap.
 */
export const SETTINGS_CONSENT_NEVER = "Ora has never been connected for this project.";

/**
 * The other empty state: connected, but from before there was a record of it.
 *
 * Rule 18. An absent record is not nothing to report — it is a project whose
 * consent plainly was granted and whose grant has no date, and saying so is the
 * only honest answer. Suppressing the block would treat the absence as a
 * smaller fact than it is, and `consent.never` would be a flat lie about a
 * project that is connected right now.
 */
export const SETTINGS_CONSENT_UNRECORDED =
  "Ora was connected before this project kept a consent record, so there is no date for it.";

/**
 * What S4's ledger adds to a reading that predates the current withdrawal.
 *
 * Imported by the ledger row rather than restated there: one string, one home,
 * two renderers being the thing rule 20 forbids. It names Ora rather than the
 * permission in the abstract because it renders beside an Ora row, and it does
 * not repeat that the scan was public — that is disclosed at the control, and
 * this clause only has to say the permission behind the reading is gone.
 */
export const SETTINGS_CONSENT_STALE_READING =
  "collected while Ora was connected, which it no longer is";

/* ── Appearance ─────────────────────────────────────────────────────────── */

export const SETTINGS_APPEARANCE_LABEL = "Appearance";
export const SETTINGS_APPEARANCE_HELP = "Applies to this browser only.";

/* ── Migration ──────────────────────────────────────────────────────────── */

/**
 * What a site with hand-tuned thresholds is told, once.
 *
 * Named by the position rather than by the numbers, because the numbers are
 * what the reader no longer has a control for and repeating them would only
 * describe something they cannot get back. Silently discarding somebody's
 * configuration is worse than the configuration was; silently replacing it is
 * the same failure with a nicer result.
 */
export function settingsMigrated(position: string): string {
  return `Your per-metric thresholds became the ${position} setting. Change it in Settings.`;
}
