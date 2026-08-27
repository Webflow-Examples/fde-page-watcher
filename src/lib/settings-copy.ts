import type { Sensitivity } from "./sensitivity";

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
export const SETTINGS_DIGEST_HELP =
  "One message per run. Sent even when nothing changed, so silence means the run failed.";

/** Who it goes to. One field, one address per line — there is no other granularity. */
export const SETTINGS_DIGEST_RECIPIENTS_LABEL = "Recipients";
export const SETTINGS_DIGEST_RECIPIENTS_HELP = "One address per line.";
export const SETTINGS_DIGEST_RECIPIENTS_EMPTY = "Nobody is named yet, so the message is built and not sent.";
export const SETTINGS_DIGEST_RECIPIENTS_INVALID = "One of these is not an email address.";

/* ── Excluded from results ──────────────────────────────────────────────── */

export const SETTINGS_EXCLUDED_LABEL = "Excluded from results";
export const SETTINGS_EXCLUDED_HELP =
  "Pages and checks that do not apply to this site. Each keeps its last reading and its reason.";

/**
 * Where a set-aside check applies: every page of the site, always.
 *
 * The one string F6 added to this list, and the reason is that the rows either
 * side of it are scoped — a native-element finding to its page, a case page to
 * its case — so a check row naming no scope read as though it were scoped to
 * something the reader had not been told. Excluding a check has only ever been
 * a site-wide decision; this is the row saying so rather than the reader having
 * to know it.
 */
export const SETTINGS_EXCLUDED_SITE_SCOPE = "Every page";

/** Nothing set aside is good news, and rule 15 says an empty list must say so. */
export const SETTINGS_EXCLUDED_EMPTY = "Nothing is set aside. Every page and check counts toward this site's results.";

/* ── Connected systems ──────────────────────────────────────────────────── */

export const SETTINGS_SYSTEMS_LABEL = "Connected systems";
export const SETTINGS_SYSTEMS_HELP =
  "Each one speaks for itself in the evidence ledger. Readings are never combined.";

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
