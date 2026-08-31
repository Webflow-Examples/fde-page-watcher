import { CONFIDENCE_LABEL, type Confidence, type ExclusionReason } from "./vocabulary";
import { webflowClassificationFor } from "./webflowPerformance";

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
 */
export function acceptLabel(included: number, total: number): string {
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
 * Structurally typed on purpose. `issue-case.ts` imports this module, so naming
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
 * findings and the agent ones all land there. So the fallback is the diagnosis
 * itself: the column is shorter where there is something shorter to say, and
 * never emptier than it was.
 */
export function causeLineOf(issue: { cause: string; title: string; diagnosis: string }): string {
  const classification = webflowClassificationFor({ id: issue.cause, title: issue.title });
  return classification.culprit === "other" ? diagnosisLineOf(issue) : classification.culpritLabel;
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
export const IMPACT_LABEL = "Worst page saves";
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
  return `${sources} sources, no disagreement — so ${CONFIDENCE_LABEL[confidence].toLowerCase()}. Never averaged.`;
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
  none: "No remediation is documented for this yet, so there is nothing to accept.",
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
  return `Detected on ${pages} pages`;
}

export function historyExcluded(page: string, reason: ExclusionReason): string {
  return `${page} excluded — ${reason}`;
}

export function historyIncluded(page: string): string {
  return `${page} included again`;
}
