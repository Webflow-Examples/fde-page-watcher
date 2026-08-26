import { includedPages, type IssueCase } from "./issue-case";
import { EFFORT_LABEL, formatCaseImpact } from "./impact-format";
import { EFFORT_LABEL_TEXT, IMPACT_LABEL } from "./case-copy";
import { absoluteUrl, casePath } from "./paths";

/**
 * A case as a ticket, in plain markdown.
 *
 * Six things, in the order a person reading a ticket needs them: what is wrong,
 * where, what to do about it, what it is worth, what it costs, and where the
 * evidence lives. Nothing else. This is not a summary of the case — it is the
 * part of the case that survives being pasted somewhere Page Watch cannot see.
 *
 * There are no tracker integrations here and there is not going to be one. An
 * integration is a second place the work's state lives, and a second place the
 * work's state lives is a place it disagrees with the first — which is the
 * defect the whole case object was built to remove, re-created across a network
 * boundary where nobody can reconcile it. Markdown on the clipboard has no
 * state, so it cannot drift; it is a copy of a fact, taken at a moment, by a
 * person who knows they took it.
 *
 * Three things this module is careful about:
 *
 *   1. The saving comes from `formatCaseImpact`, which is the same call the case
 *      detail makes. Not a reimplementation of it, and not `formatImpact` on a
 *      differently-derived number — the brief requires the ticket's string to be
 *      byte-identical to the case's, and the only way to promise that is for
 *      there to be one string.
 *   2. An unmeasured finding therefore says "Not measured" and never 0
 *      (rule 18). This module contains no number formatting at all, which is
 *      what makes that true rather than remembered.
 *   3. The link is `casePath`, which is the app's one statement of a case's
 *      address: `/issues/{id}`. There is no `/issues/case/` route to get wrong,
 *      and a ticket outlives the person who filed it, so a link spelled by hand
 *      here would be discovered broken by a stranger.
 */

export interface TicketOptions {
  /** Page titles by id. Ids are the fallback, so a missing map degrades to something resolvable. */
  pageTitles?: Record<string, string>;
  /**
   * Per-page savings, exactly as the case detail receives them.
   *
   * Pass whatever the case is rendering. Passing nothing is legal and yields the
   * case's own `impactMs`, which is what a surface with no per-page readings
   * shows too — so the two still agree.
   */
  impactByPage?: Record<string, number>;
  /**
   * The deployment's public URL, for a link that resolves outside the app.
   *
   * Absent yields the root-relative `/issues/{id}`. That is wrong in a ticket in
   * a visible way rather than a silent one, which is the same trade
   * `absoluteUrl` was written for.
   */
  appUrl?: string;
}

/** Steps as a numbered list; the honest line when a migrated case has none. */
function remediationOf(issue: IssueCase): string {
  const steps = issue.remediation.steps.filter((step) => step.trim() !== "");
  // `accept` refuses a case with no steps, so a case that reached the fix queue
  // through the app always has them. A case migrated straight to `todo` from the
  // legacy `status: "task"` never passed that guard, and an empty section would
  // read as a fix with no work in it.
  if (steps.length === 0) return "_None recorded._";
  return steps.map((step, index) => `${index + 1}. ${step}`).join("\n");
}

/** The pages the case counts. Excluded pages are not in the work, so not in the ticket. */
function pagesOf(issue: IssueCase, pageTitles: Record<string, string>): string {
  const pages = includedPages(issue);
  if (pages.length === 0) return "_None recorded._";
  return pages.map((pageId) => `- ${pageTitles[pageId] ?? pageId}`).join("\n");
}

export function ticketMarkdown(issue: IssueCase, options: TicketOptions = {}): string {
  const impact = formatCaseImpact(issue, options.impactByPage);
  // The case's own plain sentence where it has one. `fromRec` leaves `diagnosis`
  // empty rather than authoring copy, and the stored title is what the source
  // called it — the same fallback the list row makes, not a second one.
  const diagnosis = issue.diagnosis || issue.title;

  return [
    `# ${issue.id} — ${diagnosis}`,
    "",
    "## Pages",
    pagesOf(issue, options.pageTitles ?? {}),
    "",
    "## Remediation",
    remediationOf(issue),
    "",
    `${IMPACT_LABEL}: ${impact.text}`,
    `${EFFORT_LABEL_TEXT}: ${EFFORT_LABEL[issue.effort]}`,
    "",
    absoluteUrl(options.appUrl ?? "", casePath(issue.id)),
    "",
  ].join("\n");
}
