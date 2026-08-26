/**
 * The one pattern for a technical term: plain meaning first, term after it in
 * parentheses.
 *
 * Option 11b, from S9. Tooltips and glossary links were both considered and
 * rejected, and the reason is where this copy is read. A digest arrives in
 * email, a fix is pasted into a ticket, a case is screenshotted into Slack —
 * none of those carry a hover target or a link back into the app. A term whose
 * meaning lives in a tooltip is a term without a meaning everywhere the copy
 * actually travels, so the meaning goes in the sentence.
 *
 * Two groups, two treatments:
 *
 *   Group A, internal names and rule ids. Rewritten out of reader-facing copy
 *   entirely. "uses-optimized-images" is Lighthouse's key for a finding, not a
 *   name for the problem, and a reader who searches for it finds Google's
 *   documentation rather than their own page. A rule id survives only in a
 *   case's metadata chips, where it is labelled as an identifier and exists so
 *   an engineer can match a row to an upstream report.
 *
 *   Group B, industry-standard measurements and web standards. The term is
 *   KEPT — renaming "cumulative layout shift" would cut the reader off from
 *   every other tool and article that measures it — and introduced with its
 *   plain meaning on first use.
 *
 * The rule this file can enforce is the ORDERING: meaning first, term second.
 * `plain-language.test.ts` asserts that no reader-facing string leads with a
 * Group B term and that no Group A term appears in one at all. What it
 * deliberately does not enforce is "one appositive per term per screen" — a
 * screen is not a thing a lint rule can see, and the second mention being bare
 * is a review call, as the brief says.
 */

/**
 * Plain meaning first, term second. Always build an introduction through this
 * rather than writing the parentheses by hand, so the ordering is structural
 * rather than remembered.
 */
export function appositive(plain: string, term: string): string {
  return `${plain} (${term})`;
}

/**
 * Group B — the terms a reader may meet, kept because they are what the rest of
 * the industry calls these things.
 *
 * Written lower-case; the checks are case-insensitive. Longest first, so
 * "cumulative layout shift" is recognised before a substring of it could be.
 *
 * `robots.txt` and `sitemap.xml` are deliberately NOT here, and the decided
 * copy is the reason: "Your robots.txt file tells ChatGPT's crawler not to read
 * this site" opens with the filename and needs no gloss, because the filename
 * is a thing the reader owns and can go and look at. A term needs introducing
 * when the reader cannot act on it; a file on their own site is not that.
 */
export const INDUSTRY_TERMS: readonly string[] = [
  "largest contentful paint",
  "cumulative layout shift",
  "interaction to next paint",
  "first contentful paint",
  "total blocking time",
  "time to first byte",
  "core web vitals",
  "chrome ux report",
  "pagespeed insights",
  "render-blocking",
  "structured data",
  "meta description",
  "speed index",
  "schema.org",
  "lighthouse",
  "hreflang",
  "json-ld",
  "llms.txt",
  "viewport",
  "crux",
  "p75",
  "lcp",
  "inp",
  "cls",
  "ttfb",
  "tbt",
  "fcp",
];

/**
 * Group A — internal names, vendor codenames, and rule ids. None of these may
 * appear in reader-facing copy.
 *
 * `psi` is Page Watch's own shorthand for PageSpeed Insights and means nothing
 * to anyone else; the industry term is in Group B and is what the copy says
 * when it needs to name the service. `dom` is here rather than in Group B on
 * the strength of the decided rewrite — "The page nests elements 34 levels
 * deep" drops the acronym rather than parenthesising it, because the plain
 * sentence is complete without it and a reader cannot act on the initialism.
 */
export const INTERNAL_TERMS: readonly string[] = [
  "psi",
  "dom",
  "gptbot",
  "kitesurf",
  "audit id",
  "audit ids",
  "form factor",
  "diagnostic proxy",
];

/**
 * Lighthouse audit ids and other kebab-case rule identifiers, recognised by
 * shape rather than by list — the upstream catalogue grows without asking us,
 * and a finding whose id nobody added to a list is exactly the one that would
 * reach a reader unnoticed.
 *
 * Ordinary hyphenated English matches the same shape, so the test that uses
 * this carries the exceptions. This is the shape, not the verdict.
 */
export const RULE_ID_SHAPE = /^[a-z][a-z0-9]*(?:-[a-z0-9]+){2,}$/;
