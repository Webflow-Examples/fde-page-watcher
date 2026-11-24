import { CONFIDENCE_LABEL, type Confidence, type ExclusionReason } from "./vocabulary";
import { webflowClassificationFor } from "./webflowPerformance";
import { impactReading } from "./impact-format";
import { pageScopeOf } from "./scope-line";
import { formatDate } from "./watch-copy";

/**
 * The words the case says, in one place.
 *
 * Locked copy from the S2 brief. Two things here are deliberately NOT restated:
 *
 *   - "Not measured". `formatImpact` in `impact-format.ts` already produces it,
 *     and it is the same string on the list row and on the case. The locked
 *     list documents it; `formatImpact` owns it, and callers import it from
 *     there. Re-exporting it through here would have made this module and
 *     `issue-case` import each other in a cycle.
 *   - the applicability labels and reasons, which the registry owns.
 */

/* ── Accept ─────────────────────────────────────────────────────────────── */

/**
 * What the button commits to.
 *
 * Plain "Accept" when the selection is everything, because the count adds
 * nothing a reader did not already assume. The moment it is a subset, the
 * number is the whole point: accepting four of seven pages is a different
 * commitment from accepting seven, and the button is the last place to say so.
 *
 * `sharedCases` counts every case the remediation covers. Accept is recorded
 * against the remediation, not one case, so a shared fix names its real scope.
 */
export function acceptLabel(included: number, total: number, sharedCases = 1): string {
  if (sharedCases > 1) return `Accept shared fix (${sharedCases} cases)`;
  return included === total ? "Accept" : `Accept for ${included} pages`;
}

/* ── The diagnosis line ─────────────────────────────────────────────────── */

/**
 * The sentence the list and the digest show for a case.
 *
 * `fromRec` leaves `diagnosis` empty rather than authoring copy, so the stored
 * title — what the source called it — is the fallback. That is a choice between
 * two strings the case already carries, not a third spelling of either.
 *
 * It lives here because the row is no longer its only reader: sorting by
 * diagnosis has to order rows by the text they actually show, and a comparator
 * with its own copy of the fallback is the drift rule 20 exists to stop.
 *
 * Structurally typed on purpose. `issue-case/` imports this module, so naming
 * `IssueCase` here would close a cycle for a two-field read.
 */
export function diagnosisLineOf(issue: { diagnosis: string; title: string }): string {
  return issue.diagnosis || issue.title;
}

/**
 * What KIND of problem this is, in three or four words.
 *
 * "Code running at startup", "Images bigger than they are shown". The classifier
 * already authors these against the audit id, and the page detail already shows
 * them as a chip — this is not a new vocabulary, it is the existing one reaching
 * the list.
 *
 * It exists because a diagnosis is a sentence and a list of four dozen rows is
 * read by scanning, not by reading. The sentence is still the answer; it is one
 * disclosure away rather than truncated at the column edge.
 *
 * `cause` is the audit id and `title` is what the source called it — the two
 * inputs the classifier takes, and both are fields the case already carries.
 *
 * Where the classifier does NOT recognise the audit it answers `other`, and its
 * label for that is "Something else the nightly test found" — which tells a
 * reader strictly less than the sentence it would be replacing. The visitor
 * findings and the agent ones all land there. So the fallback is the source's
 * own title: short enough to scan, specific enough to name the finding, and the
 * full diagnosis stays one disclosure away instead of filling the column.
 */
export function causeLineOf(issue: { cause: string; title: string; diagnosis: string }): string {
  const classification = webflowClassificationFor({ id: issue.cause, title: issue.title });
  return classification.culprit === "other" ? issue.title : classification.culpritLabel;
}

/* ── The pages table ────────────────────────────────────────────────────── */

export function pagesCount(included: number, excluded: number): string {
  return `${included} included · ${excluded} excluded`;
}

/**
 * Why this page is not counted, and what that costs.
 *
 * It names both consequences because they are the ones a reader would
 * otherwise discover later: the checkpoints will not look at this page, and a
 * regression on it will not bring the case back.
 */
export function excludedNote(reason: ExclusionReason): string {
  return `Excluded — ${reason}. Checkpoints will not measure this page, and a regression here will not reopen the case.`;
}

/* ── Impact and effort ──────────────────────────────────────────────────── */

/** Worst page, never a total. The label says which page it is about. */
export const IMPACT_LABEL = "Worst-page impact";
/**
 * Named `_TEXT` because `EFFORT_LABEL` is already the effort-band word map in
 * `issue-row`. Two different things called the same name in one import list is
 * how the wrong one gets used.
 */
export const EFFORT_LABEL_TEXT = "Effort";

/* ── The evidence ledger ────────────────────────────────────────────────── */

/**
 * Why the confidence reads the way it does.
 *
 * The confidence WORD comes from the registry and is lowercased here for the
 * sentence — the casing is this sentence's business, and the word is not.
 */
export function evidenceAgreement(sources: number, confidence: Confidence): string {
  const word = CONFIDENCE_LABEL[confidence].toLowerCase();
  return sources === 1
    ? `1 source supports the diagnosis, so confidence is ${word}.`
    : `${sources} sources, no disagreement, so confidence is ${word}.`;
}

export function evidenceConflict(a: string, b: string): string {
  return `${a} and ${b} disagree, so the diagnosis reads Unclear. Both readings are below.`;
}

/* ── No action, and why (registry rule 17) ──────────────────────────────── */

/**
 * The sentence that stands where Accept would be.
 *
 * Keyed by the two actionabilities that have nothing to accept, so a third
 * added to the registry arrives here as a missing key rather than as a case
 * that silently renders no button and no explanation.
 */
export const NO_ACTION_REASON = {
  none: "No remediation is documented for this yet. Write a plan below, take it on, or dismiss it.",
  no_plan: "This case was taken on without a remediation plan. Write one below before marking it fixed.",
  no_plan_closed: "No remediation plan was recorded for this case.",
  platform: "Webflow owns this one. It is shown so the reading is not hidden from you.",
} as const;

/* ── A decision that no longer applies ──────────────────────────────────── */

/**
 * What a case says when a decision about it was stranded.
 *
 * The case is undecided and its buttons are live, so this is not an apology for
 * a missing control — it is the reason the reader is being asked a question they
 * remember answering. Naming the cause is the whole value: without it the case
 * looks like it lost their decision, which is the failure, rather than like the
 * fix moved out from under it, which is what happened.
 */
export const DECISION_STRANDED =
  "The fix for this changed after it was accepted, so it needs deciding again.";

/* ── History ────────────────────────────────────────────────────────────── */

export function historyDetected(pages: number): string {
  return `Detected on ${pages} ${pages === 1 ? "page" : "pages"}`;
}

export function historyExcluded(page: string, reason: ExclusionReason): string {
  return `${page} excluded — ${reason}`;
}

export function historyIncluded(page: string): string {
  return `${page} included again`;
}

/* ── Start Here ─────────────────────────────────────────────────────────── */

/**
 * Why a case is in Start Here, in one line.
 *
 * The ranking has three keys and this says which one placed the case: real
 * visitors measured it, a simulated run measured it, or nothing measured it yet.
 * That is the reason a reader can check — "Real visitors see 11 s on Homepage"
 * is the fact that put this row first, and the row above a simulated 12 s
 * estimate says so in its own words rather than in a legend.
 */
export function startHereReason(
  issue: { pageIds: readonly string[]; impactMs: number; impactBytes?: number; impactOrigin?: "observed" | "simulated"; detectedAt: string },
  pageTitles: Record<string, string>,
): string {
  const pages = pageScopeOf(issue.pageIds, pageTitles) || "this page";
  // No per-page reading here: this line states the case's own figure, which is
  // the one the block ranks on. `impactReading` is the same wording a row uses.
  const reading = impactReading({
    impactMs: issue.impactMs,
    ...(issue.impactBytes !== undefined ? { impactBytes: issue.impactBytes } : {}),
    ...(issue.impactOrigin ? { impactOrigin: issue.impactOrigin } : {}),
  });
  if (!reading.measured) return `First seen ${formatDate(issue.detectedAt)}, not measured in any run yet.`;
  if (reading.origin === "observed") {
    return reading.unit === "bytes"
      ? `Real visitors download ${reading.text} they do not need on ${pages}.`
      : `Real visitors see ${reading.text} on ${pages}.`;
  }
  return `Simulated saving of ${reading.text} on ${pages}.`;
}
