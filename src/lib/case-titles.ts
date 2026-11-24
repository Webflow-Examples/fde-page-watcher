/**
 * The name a case has on screen, for the findings whose stored title is not one.
 *
 * A case names a symptom a person notices. The production list broke that rule
 * in one place: Lighthouse's own audit titles reached the list verbatim for the
 * accessibility and console audits — "Links do not have a discernible name" —
 * and the four field-only cases were stored as "Investigate visitor-only content
 * loading", which is a task rather than a problem, and sends the reader to do the
 * work the product has not done.
 *
 * So the raw ids get a title here, in the words a visitor or a reader of a
 * screen reader would use. The id stays the case's `cause`: it is the grouping
 * key, it is what the remediation library is keyed by, and it is what an
 * engineer matches to an upstream report. A key is not copy (registry v10, on
 * `kitesurf`'s key), which is exactly the distinction this module is built on.
 *
 * Not every audit is here, deliberately. An audit whose stored title already
 * names a symptom — "Images were bigger than the space they fill" — needs no
 * second title, and inventing one would be a second statement of the same fact.
 * The fallback is the stored title, unchanged.
 *
 * This is applied when the case is built (`fromRec`), never in a component: the
 * row, the detail header, the digest and the ticket all read `issue.title`, and
 * rewriting it at one of those would make the four disagree (rule 20).
 */

export const CASE_TITLE_BY_AUDIT_ID: Record<string, string> = {
  /* ── Accessibility ─────────────────────────────────────────────────── */
  "link-name": "Icon links have no name for screen readers",
  "link-descriptive": "Links say “learn more” instead of where they go",
  "heading-order": "Heading levels skip, so the page outline breaks",
  "label-content-name-mismatch": "Visible labels disagree with the accessible name",
  "color-contrast": "Text is too faint to read",
  "target-size": "Taps miss because targets are too small",

  /* ── The browser's own complaints ──────────────────────────────────── */
  "errors-in-console": "The page logs browser errors",
  "devtools-issues": "Chrome reports page issues",

  /* ── Field-only: what real visitors experienced, not what to investigate ─ */
  "crux-field-only-lcp": "The main content arrives late for real visitors",
  "crux-field-only-inp": "Taps take longer to answer for real visitors",
  "crux-field-only-cls": "The page jumps around for real visitors",
  "crux-field-only-ttfb": "Pages start arriving late for real visitors",
};

/**
 * The case's title: the plain one for a known audit, the stored one otherwise.
 *
 * An unknown id keeps the source's own title rather than a generic label. The
 * source's words are still a name for the finding — they are just not the plain
 * name this module has for the ones it knows — and replacing them with
 * "Untitled finding" would be strictly less true.
 */
export function caseTitleFor(auditId: string, storedTitle: string | undefined): string {
  return CASE_TITLE_BY_AUDIT_ID[auditId.trim().toLowerCase()] ?? storedTitle ?? auditId;
}
