/**
 * Who the digest is for.
 *
 * One message per site, so one list of addresses per site. There is no per-page
 * recipient, no per-section recipient and no per-severity recipient, and that
 * is the same decision as everything else in S8: the digest is one message, so
 * every setting about it is one setting.
 *
 * The addresses are carried to the delivery endpoint in the webhook payload
 * rather than posted to a mail server here. Page Watch has no mail transport,
 * and a recipients field that no producer read would be a slot that is not a
 * slot (rule 15) — so it goes where the message goes, and the system on the
 * other end knows who it is for.
 */

/**
 * Deliberately not RFC 5322.
 *
 * A validator strict enough to be correct rejects addresses that work, and one
 * loose enough to accept everything that works catches nothing. This rejects
 * the shapes that are certainly wrong — no @, nothing before it, no dot after
 * it, whitespace inside — and lets the delivery endpoint be the authority on
 * the rest, which it is anyway.
 */
const SHAPE = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;

export const MAX_DIGEST_RECIPIENTS = 20;

export function digestRecipientIsValid(value: string): boolean {
  return SHAPE.test(value.trim());
}

/**
 * The stored list: trimmed, de-duplicated, capped, and free of anything that is
 * not an address.
 *
 * Silently dropping a malformed entry is right here and wrong in the form. The
 * form tells the reader which line is not an address and refuses to save; this
 * runs on stored state that has already been through that gate, where the only
 * way a bad value arrives is a hand-edited record, and where keeping it would
 * mean the digest names a recipient it can never reach.
 */
export function normalizeDigestRecipients(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  for (const entry of value) {
    if (typeof entry !== "string") continue;
    const trimmed = entry.trim();
    if (!digestRecipientIsValid(trimmed)) continue;
    seen.add(trimmed.toLowerCase());
    if (seen.size >= MAX_DIGEST_RECIPIENTS) break;
  }
  return [...seen];
}

/** What a textarea of one address per line means. Blank lines are not addresses. */
export function parseDigestRecipients(text: string): string[] {
  return text.split("\n").map((line) => line.trim()).filter(Boolean);
}

/** The same list, back in the shape the textarea shows. */
export function formatDigestRecipients(recipients: readonly string[]): string {
  return recipients.join("\n");
}
