import {
  applicabilityOf,
  applyAction,
  canApply,
  excludePage,
  includePage,
  includedPages,
  fromRec,
  groupByCause,
  remediationIdentity,
  remediationKey,
  type IssueCase,
} from "./issue-case";
import { decisionOf, type CaseDecision, type CaseDecisionRecord } from "./case-decisions";
import { applyCaseTransition, transitionOf } from "./case-transitions";
import { planOf } from "./case-plans";
import { lastCheckedAtFor } from "./case-recency";
import type { AppState, CasePlanRecord, CaseTransitionRecord, WatchPage } from "./types";

/**
 * The canonical case list, derived from stored records.
 *
 * This used to live in `store.tsx`, which was fine while the issues list was the
 * only reader. The digest is the second, and it runs in the collector — a Worker
 * with no React in it and no business importing a `"use client"` module to find
 * out what cases exist. Moving the two functions here is what makes that
 * possible; `store.tsx` re-exports them, so every existing importer keeps one
 * name for each.
 *
 * There is exactly one derivation of a case from a record, and this is it. Two
 * would be two answers to "what is open right now", and the digest's whole claim
 * is that the message and the screen agree.
 */

/**
 * The newest completed run across the watchlist.
 *
 * Used as the reference "now" for the case adapters, so a render is a pure
 * function of stored state: `fromRec` and `groupByCause` otherwise stamp history
 * with `new Date()`, which differs between the server render and the client one.
 * It also dates the "what changed" sort, which is a question about the last run
 * rather than about the wall clock.
 */
export function lastRunAtOf(pages: readonly WatchPage[]): string | undefined {
  return pages
    .map((page) => page.lastRunAt)
    .filter((value): value is string => !!value)
    .sort()
    .at(-1);
}

/** What the log has to say about one remediation. */
export interface DecisionMatch {
  /**
   * Entries that apply to this case, oldest first.
   *
   * Mostly entries keyed on its remediation. Also the `cause:<cause>` entries
   * taken before that remediation was documented — see `matchDecisions`.
   */
  matched: CaseDecisionRecord[];
  /**
   * Whether a decision was taken about this remediation under a key it no
   * longer has.
   *
   * The named cause is a reclassification: actionability is part of the key, so
   * a record moving from `direct` to `platform` gives the same steps a new key
   * and leaves the old entry matching nothing. The steps did not change, and
   * the steps are what the person read — so the entry is recognisably about
   * this remediation, and it is equally recognisably not about it any more.
   *
   * Neither dropping it nor reapplying it is honest. Dropping it loses a
   * person's decision without saying so; reapplying it silently attaches their
   * agreement to a fix that is no longer the one they agreed to, which is
   * worse. So the entry stays in the log, stays unapplied, and the case says
   * out loud that it needs deciding again.
   */
  stranded: boolean;
}

/**
 * Read the log for one case.
 *
 * Nothing is removed, compacted or rewritten — this only reads. An entry that
 * matches nothing today matches again the day its remediation comes back, which
 * is what makes a page leaving a case and rejoining it work without the log
 * having to be told.
 *
 * Three ways an entry relates to the case, and the difference between them is
 * the whole of this function:
 *
 *   1. **Its key is this remediation's.** It applies. This is the ordinary case,
 *      including a fix shared by several causes: the key is the fix, so accepting
 *      it once covers them all.
 *   2. **Its key is `cause:<this cause>` and the case now has steps.** The
 *      remediation library documents audits that arrived without steps, which
 *      moves the key from the cause to the steps. The problem the person decided
 *      about has not changed — same cause, same pages, same finding — and the
 *      only thing that is new is that the fix is now written down. So the
 *      decision CARRIES: a case dismissed as Intentional stays dismissed, and a
 *      page excluded stays excluded. Calling it stranded would say the fix
 *      changed, which is not what happened, and would ask the reader a question
 *      they already answered.
 *   3. **It names this cause but not this remediation** — a plan that was edited
 *      after somebody accepted it, or any other move of the key with the problem
 *      unchanged. The steps really did change, so the decision was about a
 *      different piece of work: `stranded` is set and the case says so rather
 *      than silently returning to New. Entries written before `cause` existed
 *      cannot be attributed to a case this way, so they stay unmatched — the
 *      claim is withheld rather than guessed (rule 18).
 *
 * Same-identity entries (the steps match, the actionability does not) are
 * stranded too, and predate this: a reclassification changed who owns the work
 * that was agreed to, which is `DECISION_STRANDED`'s sentence exactly.
 */
export function matchDecisions(
  key: string,
  decisions: readonly CaseDecisionRecord[],
  cause?: string,
): DecisionMatch {
  const identity = remediationIdentity(key);
  const causeKey = cause ? `cause:${cause}` : undefined;
  const matched: CaseDecisionRecord[] = [];
  let stranded = false;
  for (const entry of decisions) {
    if (entry.remediationKey === key) {
      matched.push(entry);
    } else if (causeKey && entry.remediationKey === causeKey && key.startsWith("steps:")) {
      matched.push(entry);
    } else if (cause && entry.cause === cause) {
      stranded = true;
    } else if (remediationIdentity(entry.remediationKey) === identity) {
      stranded = true;
    }
  }
  return { matched, stranded };
}

/**
 * What history should call a page.
 *
 * A page id is an internal handle and history is read by people, so the log's
 * entries are replayed against the reader's own path where the watchlist has
 * one. Resolved at derivation rather than stored on the entry: the title is the
 * page's to change, and a decision made last month should not keep quoting a
 * path that was renamed since.
 */
function pageLabelsOf(pages: readonly WatchPage[]): Record<string, string> {
  return Object.fromEntries(pages.map((page) => [page.id, page.url ?? page.title]));
}

/**
 * Replay one entry from the decisions log onto the case it names.
 *
 * Every branch asks the model's own preconditions before calling it, rather
 * than calling and catching. `excludePage` and the transition table throw for a
 * caller that has got it wrong, and a replay is not a caller that has got it
 * wrong — it is a true record of a decision that was legal when it was taken
 * and may not be legal now. An entry that cannot apply is skipped and stays in
 * the log, because the evidence that made it inapplicable can go away again.
 *
 * The model does the applying. Nothing here writes `excludedPages` or a history
 * line directly: those belong to `issue-case/`, and a second writer is how the
 * table and the log start wording the same event differently.
 */
function replay(
  issue: IssueCase,
  record: CaseDecisionRecord,
  pageLabels: Record<string, string>,
): IssueCase {
  // Narrowed through the same door that wrote it. A stored entry missing what
  // its decision needs, or naming a reason the registry does not, does not
  // apply — and stays in the log, because declining to apply an entry and
  // deleting it are different things.
  const entry: CaseDecision | null = decisionOf(record);
  if (!entry) return issue;
  const at = entry.at;
  // The caller the entry recorded, replayed whole. A replay attributes the
  // history line to whoever decided, not to whoever is looking at it now.
  const by = entry.by;
  switch (entry.decision) {
    case "exclude": {
      if (!issue.pageIds.includes(entry.pageId)) return issue;
      if (applicabilityOf(issue, entry.pageId) !== "included") return issue;
      // The model refuses to leave a case counting nothing, and so does this.
      if (includedPages(issue).length <= 1) return issue;
      const page = pageLabels[entry.pageId];
      return excludePage(issue, entry.pageId, entry.reason, { by, at, ...(page ? { page } : {}) });
    }
    case "include": {
      if (applicabilityOf(issue, entry.pageId) !== "excluded") return issue;
      const page = pageLabels[entry.pageId];
      return includePage(issue, entry.pageId, { by, at, ...(page ? { page } : {}) });
    }
    case "accept":
      // A case whose evidence has since moved it past Decide is not re-accepted,
      // and one with no documented steps cannot be accepted at all — both are
      // the registry's rules, asked here rather than restated.
      if (!canApply(issue, "accept") || issue.remediation.steps.length === 0) return issue;
      return applyAction(issue, "accept", { by, at });
    case "dismiss":
      if (!canApply(issue, "dismiss")) return issue;
      return applyAction(issue, "dismiss", { by, at, reason: entry.reason });
  }
}

/**
 * Apply the decisions log to a set of cases.
 *
 * AFTER grouping, always. A decision is about a remediation, and which cases
 * share a remediation is not known until the grouping has run — applying
 * beforehand would be deciding about a record, which is the thing the log was
 * built not to do.
 *
 * Entries are replayed oldest first, so the log's order is the outcome's order:
 * exclude then include leaves the page counted, and the reverse does not. That
 * is the whole reason the log is append-only rather than a map of current
 * values — the map would have to be edited in place, and the panel's history
 * would then have to be kept separately and kept in step.
 */
export function applyCaseDecisions(
  cases: readonly IssueCase[],
  decisions: readonly CaseDecisionRecord[],
  pageLabels: Record<string, string> = {},
): IssueCase[] {
  if (decisions.length === 0) return [...cases];
  return cases.map((issue) => {
    const { matched, stranded } = matchDecisions(remediationKey(issue), decisions, issue.cause);
    let next = issue;
    for (const entry of matched) next = replay(next, entry, pageLabels);
    return stranded ? { ...next, strandedDecision: true } : next;
  });
}

/**
 * One case per problem, with what anyone decided about it applied.
 *
 * Recommendations are the stored shape; `fromRec` reads their four legacy
 * lifecycles and `groupByCause` collapses the same problem seen on several
 * pages. Both come from `issue-case/` — this only feeds them.
 *
 * The decisions log is read last and is never written here. The collector
 * rewrites records nightly and how it merges them is not this app's property;
 * keeping the two apart is what lets a decision survive a run that rewrote
 * every record the case is made of.
 */
type CaseEvent =
  | { at: string; order: 0; decision: CaseDecisionRecord }
  | { at: string; order: 1; transition: CaseTransitionRecord };

/**
 * Replay a case's decisions and transitions in the order they happened.
 *
 * The two logs have different keys and different grains, but they describe one
 * case's life. Applying every decision before every transition would lose the
 * second accept after a reopen: the decision would be tried against the state
 * the case has since left. Merging them by timestamp keeps the stored scopes
 * while making the replay match what a person actually did.
 */
function applyCaseEvents(
  cases: readonly IssueCase[],
  decisions: readonly CaseDecisionRecord[],
  transitions: readonly CaseTransitionRecord[],
  pageLabels: Record<string, string>,
): IssueCase[] {
  if (decisions.length === 0 && transitions.length === 0) return [...cases];
  return cases.map((issue) => {
    const { matched, stranded } = matchDecisions(remediationKey(issue), decisions, issue.cause);
    const caseTransitions = transitions
      .filter((record) => record.caseKey === issue.cause)
      .map(transitionOf)
      .filter((record): record is CaseTransitionRecord => record !== null);
    const events: CaseEvent[] = [
      ...matched.map((decision) => ({ at: decision.at, order: 0 as const, decision })),
      ...caseTransitions.map((transition) => ({ at: transition.at, order: 1 as const, transition })),
    ].sort((left, right) => left.at.localeCompare(right.at) || left.order - right.order);
    let next = issue;
    for (const event of events) {
      next = "decision" in event
        ? replay(next, event.decision, pageLabels)
        : applyCaseTransition(next, event.transition);
    }
    return stranded ? { ...next, strandedDecision: true } : next;
  });
}

/** Apply the latest user-authored plan for each cause before anything else. */
function applyCasePlans(
  cases: readonly IssueCase[],
  plans: readonly CasePlanRecord[],
): IssueCase[] {
  if (plans.length === 0) return [...cases];
  const latest = new Map<string, string[]>();
  for (const record of plans) {
    const plan = planOf(record);
    if (plan) latest.set(plan.caseKey, plan.steps);
  }
  return cases.map((issue) => {
    const steps = latest.get(issue.cause);
    return steps ? { ...issue, remediation: { ...issue.remediation, steps } } : issue;
  });
}

export function issueCasesFrom(
  state: Pick<AppState, "recs" | "pages"> & Partial<Pick<AppState, "caseDecisions" | "caseTransitions" | "casePlans">>,
): IssueCase[] {
  const at = lastRunAtOf(state.pages);
  const options = at ? { at, referenceYear: Number(at.slice(0, 4)) } : {};
  const grouped = groupByCause(state.recs.map((rec) => fromRec(rec, options)), options);
  const planned = applyCasePlans(grouped, state.casePlans ?? []);
  const decisions = state.caseDecisions ?? [];
  const transitions = state.caseTransitions ?? [];
  const pageLabels = pageLabelsOf(state.pages);
  // A decision-only log keeps its append order, which is its contract; there is
  // nothing from the other grain to interleave it with. Once both logs exist,
  // timestamp order is the only common ordering, and it is what makes a second
  // accept after a reopen apply.
  const applied = transitions.length === 0
    ? applyCaseDecisions(planned, decisions, pageLabels)
    : applyCaseEvents(planned, decisions, transitions, pageLabels);
  /**
   * When each case was last checked, read off the pages it covers.
   *
   * Last, because a decision can shrink a case's pages and the reading should
   * follow what the case counts now. Nothing is stored: it is a date the pages
   * already hold, and a second copy of it could disagree with them.
   */
  return applied.map((issue) => {
    const lastCheckedAt = lastCheckedAtFor(issue.pageIds, state.pages);
    return lastCheckedAt ? { ...issue, lastCheckedAt } : issue;
  });
}
