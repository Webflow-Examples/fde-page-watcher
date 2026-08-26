/**
 * How often the digest arrives, as the footer states it.
 *
 * The value only, not the control. The writable setting is S8's — one switch,
 * daily or weekly, per site — and building it here would have meant a persisted
 * field with nothing writing to it, which registry rule 15 calls not a slot at
 * all: an empty slot reads to the user as a reading that found nothing.
 *
 * So the digest states the cadence it is actually being sent on, which today is
 * every nightly run, and the footer links to Settings for the reader who wants
 * it different. When S8 lands the setting, `digestFor` reads it and passes it in;
 * nothing here changes.
 *
 * These two words are not a registry concept, and that is deliberate. Rule 11
 * asks whether an existing concept already means this before a new one is added
 * — none does — but neither is a delivery frequency a condition of an object the
 * way `work_state` or `health` are. It sits with the device labels: named beside
 * the thing that renders it.
 */

export const DIGEST_CADENCES = ["daily", "weekly"] as const;
export type DigestCadence = (typeof DIGEST_CADENCES)[number];

/**
 * Daily, until something says otherwise.
 *
 * Not an arbitrary default. The collector runs nightly, so a digest after every
 * run is what the product actually does; any other default would have the footer
 * describing a cadence nothing implements.
 */
export const DEFAULT_DIGEST_CADENCE: DigestCadence = "daily";

export const DIGEST_CADENCE_LABEL: Record<DigestCadence, string> = {
  daily: "Daily",
  weekly: "Weekly",
};

export function isDigestCadence(value: unknown): value is DigestCadence {
  return typeof value === "string" && (DIGEST_CADENCES as readonly string[]).includes(value);
}

/** An unset or unrecognised cadence reads as the default rather than as nothing. */
export function normalizeDigestCadence(value: unknown): DigestCadence {
  return isDigestCadence(value) ? value : DEFAULT_DIGEST_CADENCE;
}
