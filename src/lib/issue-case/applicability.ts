import { narrowCasePageExclusionReason } from "../case-decisions";
import { APPLICABILITY_TRANSITIONS, EXCLUSION_REASONS } from "../vocabulary";
import type { Applicability, ExclusionReason } from "../vocabulary";
import { historyExcluded, historyIncluded } from "../case-copy";
import type { IssueCase, TransitionOptions } from "./core";
import { IssueCaseError } from "./core";

/* ── Per-page applicability ───────────────────────────────────────── */

/**
 * Whether this case counts this page.
 *
 * Included is the default and the absence of an entry, so a case that has never
 * been touched needs no `excludedPages` at all. Reading it through here rather
 * than checking the map directly means "missing means included" is stated once.
 */
export function applicabilityOf(issue: IssueCase, pageId: string): Applicability {
  return issue.excludedPages?.[pageId] ? "excluded" : "included";
}

/** The reason a page is excluded, or undefined when it is not. */
export function exclusionReasonOf(issue: IssueCase, pageId: string): ExclusionReason | undefined {
  return issue.excludedPages?.[pageId];
}

/**
 * The pages this case counts.
 *
 * This is the list every downstream consumer wants: what Accept commits to,
 * what the checkpoints measure, and what a regression has to appear on to
 * reopen the case. `pageIds` remains the full set, because an excluded page is
 * still covered by the case — it is just not counted.
 */
export function includedPages(issue: IssueCase): string[] {
  return issue.pageIds.filter((pageId) => applicabilityOf(issue, pageId) === "included");
}

/** The pages it covers but does not count, in the case's own page order. */
export function excludedPageIds(issue: IssueCase): string[] {
  return issue.pageIds.filter((pageId) => applicabilityOf(issue, pageId) === "excluded");
}

/**
 * Stop counting one page, with a reason.
 *
 * The registry requires the reason, so the type does too — there is no way to
 * call this without one. The move goes through `APPLICABILITY_TRANSITIONS`
 * rather than being written out here, so a case the registry gives no exclude
 * path from throws instead of being forced.
 *
 * Refuses to exclude the last counted page: a case that counts nothing is a
 * case with nothing to accept, and Dismiss is the word for that decision. Two
 * ways to say "not this" is what rule 11 exists to stop.
 */
export function excludePage(
  issue: IssueCase,
  pageId: string,
  reason: ExclusionReason,
  options: TransitionOptions & { page?: string },
): IssueCase {
  if (!issue.pageIds.includes(pageId)) {
    throw new IssueCaseError(`excludePage: ${issue.id} does not cover ${pageId}.`);
  }
  const current = applicabilityOf(issue, pageId);
  if (!APPLICABILITY_TRANSITIONS.exclude.from.includes(current)) {
    throw new IssueCaseError(`excludePage: ${pageId} is already ${current} on ${issue.id}.`);
  }
  if (narrowCasePageExclusionReason(reason) === null) {
    throw new IssueCaseError(
      `excludePage: reason must be one of ${EXCLUSION_REASONS.join(", ")}.`,
    );
  }
  if (includedPages(issue).length <= 1) {
    throw new IssueCaseError(
      `excludePage: ${pageId} is the last counted page on ${issue.id}. Dismiss the case instead.`,
    );
  }
  return {
    ...issue,
    excludedPages: { ...issue.excludedPages, [pageId]: reason },
    history: [
      ...issue.history,
      {
        at: options.at ?? new Date().toISOString(),
        to: issue.state,
        by: options.by,
        // The reader's own path where there is one — a page id is an internal
        // handle, and history is read by people.
        reason: historyExcluded(options.page ?? pageId, reason),
      },
    ],
  };
}

/** Count one page again. Needs no reason: the registry asks for none. */
export function includePage(
  issue: IssueCase,
  pageId: string,
  options: TransitionOptions & { page?: string },
): IssueCase {
  const current = applicabilityOf(issue, pageId);
  if (!APPLICABILITY_TRANSITIONS.include.from.includes(current)) {
    throw new IssueCaseError(`includePage: ${pageId} is already ${current} on ${issue.id}.`);
  }
  const next = { ...(issue.excludedPages ?? {}) };
  delete next[pageId];
  return {
    ...issue,
    ...(Object.keys(next).length > 0 ? { excludedPages: next } : { excludedPages: undefined }),
    history: [
      ...issue.history,
      {
        at: options.at ?? new Date().toISOString(),
        to: issue.state,
        by: options.by,
        reason: historyIncluded(options.page ?? pageId),
      },
    ],
  };
}

