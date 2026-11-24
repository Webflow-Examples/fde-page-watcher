import { hasMeasuredImpact, includedPages, type Effort, type IssueCase } from "./issue-case";
import { impactReading, type ImpactReading } from "./impact-units";

/**
 * What an impact reading means, for every surface that writes or reads one.
 *
 * This used to live in `issue-row.tsx`, which was fine while the list was the
 * only thing that rendered a saving. The case detail renders the same figure,
 * and "Not measured" is in S2's locked copy list — so a second literal on the
 * case would have been two copies of one string, drifting the first time
 * someone reworded one of them (rule 20). The copy list documents the string;
 * this module owns it.
 *
 * `partitionByImpact` joined it in S7 for the same reason. The list folds a
 * finding below the project's savings gate into one row; the digest declines to
 * write a line about it, on the identical grounds. Two spellings of "too small
 * to hear about" would be two places to get rule 18 wrong, and rule 18 is the
 * hard part of that predicate rather than the comparison.
 *
 * `EFFORT_LABEL` moved here in S5, one move behind the other two. It lived in
 * `issue-row.tsx` while the list and the case header were the only readers, and
 * both of those are components. "Copy as ticket" is the third reader and it is
 * not — it builds a string in a plain module, and a lib importing a `.tsx` to
 * find out that `hours` is spelled "Hours" would drag React into the one place
 * that has no use for it. `issue-row` re-exports it, so the list keeps one name.
 */

/**
 * The reading one case is worth, before it is worded.
 *
 * The worst reading on a page this case counts — never a sum (rule 19), because
 * adding four pages' savings would invent a figure no run produced, and never a
 * reading from a page the case has excluded, because an excluded page is one the
 * work is not about.
 *
 * This is a function rather than four lines in a component because S5 gave the
 * figure a second reader that is not on screen. "Copy as ticket" writes the
 * saving into a string that leaves the app, and a ticket quoting 1.9 s beside a
 * case showing 2.1 s is the audit's "same finding explained four different ways"
 * arriving by post. One derivation, so the two cannot part.
 */
export function caseImpactMs(issue: IssueCase, impactByPage?: Record<string, number>): number {
  const readings = includedPages(issue).map((pageId) => impactByPage?.[pageId] ?? 0);
  const worst = readings.length ? Math.max(...readings, 0) : issue.impactMs;
  // `|| issue.impactMs` catches the case whose per-page readings are all absent:
  // 0 here means nothing was measured per page, not that the case is worth
  // nothing, so the case's own figure is the better answer (rule 18).
  return worst || issue.impactMs;
}

/** The same reading, worded. Every surface that shows a case's saving calls this. */
export function formatCaseImpact(
  issue: IssueCase,
  impactByPage?: Record<string, number>,
): { text: string; measured: boolean } {
  const reading = caseImpactReading(issue, impactByPage);
  return { text: reading.text, measured: reading.measured };
}

/**
 * A case's reading, with its unit and origin.
 *
 * The per-page map still decides the TIME reading, because a surface that has
 * per-page figures knows the worst measured one on a page this case counts. The
 * byte reading has no per-page counterpart, so it comes from the case itself.
 * When the per-page readings were all absent the case's own time stands
 * (`|| issue.impactMs`), and when even that is absent the bytes do — which is
 * the ordering `impactReading` states once.
 */
export function caseImpactReading(
  issue: IssueCase,
  impactByPage?: Record<string, number>,
): ImpactReading {
  const ms = caseImpactMs(issue, impactByPage);
  return impactReading({
    impactMs: hasMeasuredImpact(ms) ? ms : 0,
    ...(issue.impactBytes !== undefined ? { impactBytes: issue.impactBytes } : {}),
    ...(issue.impactOrigin ? { impactOrigin: issue.impactOrigin } : {}),
  });
}

export {
  NOT_MEASURED,
  formatBytes,
  formatGroupImpact,
  formatImpact,
  groupImpactReading,
  impactOriginLabel,
  impactReading,
  type ImpactReading,
} from "./impact-units";

/* ── Effort ────────────────────────────────────────────────────── */

/**
 * Effort is a band on the case rather than a registry concept, so its words live
 * here beside impact — the two are read together everywhere they are read at
 * all, and a ticket that quoted one from the registry and the other from a
 * component would be quoting two vocabularies.
 */
export const EFFORT_LABEL: Record<Effort, string> = {
  minutes: "Minutes",
  hours: "Hours",
  days: "Days",
  // Not a dash. The stored estimate said "Needs review", which is the absence of
  // a band, and rule 18's reasoning applies to any missing reading: say so.
  unknown: "No estimate",
};

/* ── The savings gate ──────────────────────────────────────────── */

/**
 * Cases split into what a surface states outright and what it holds back.
 *
 * A case is in the tail when it has a measured saving smaller than the project's
 * `minimumSavingsMs`. Two cases are deliberately not in it:
 *
 *   - A case with no measured time at all. Registry rule 18: an absent
 *     measurement is not a small measurement, so a finding with no reading is
 *     never folded as though its value were zero. It is the same call
 *     `recommendationMeetsEvidenceThresholds` already makes when it lets an
 *     unmeasured finding past the savings gate.
 *   - Anything, when the threshold is 0. At 0 the gate is off, so the tail is
 *     empty and the list is flat.
 *
 * Every case lands in exactly one side. On the list the tail is folded rather
 * than filtered — the row that holds it says how many and expands in place. In
 * the digest it is simply not written about, which is what the reader asked for
 * when they set the gate; the list is still there and still holds all of it.
 */
export function partitionByImpact(
  cases: readonly IssueCase[],
  minimumSavingsMs: number,
): { inline: IssueCase[]; tail: IssueCase[] } {
  const inline: IssueCase[] = [];
  const tail: IssueCase[] = [];
  for (const item of cases) {
    const folds = minimumSavingsMs > 0 && hasMeasuredImpact(item.impactMs) && item.impactMs < minimumSavingsMs;
    (folds ? tail : inline).push(item);
  }
  return { inline, tail };
}
