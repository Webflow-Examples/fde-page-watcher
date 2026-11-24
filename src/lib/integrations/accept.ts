import type { Caller } from "../caller";
import { remediationKey } from "../issue-case";
import { recordCaseDecision } from "../mutations";
import type { AppState } from "../types";
import type { DataStore } from "../store";
import { caseForRemediation } from "./tasks";

/**
 * Accept a remediation, on the way to creating its task.
 *
 * The combined "Accept and create task" action is Accept plus a second act, so
 * the acceptance is written through the ordinary decision log, keyed on the
 * remediation like every other decision. This module exists so a route that
 * also handles a batch of case ids does not compose the key itself: the key is
 * still produced in one place, and the guard that reads the source for that
 * property stays true.
 *
 * Returns the state with the acceptance appended, the same state when the
 * remediation is already past Decide, or `null` when there is nothing to
 * accept — no case, or no plan.
 */
export async function acceptRemediation(input: {
  remediationKey: string;
  by: Caller;
  dataStore: DataStore;
  state: AppState;
}): Promise<AppState | null> {
  const issue = caseForRemediation(input.state, input.remediationKey);
  if (!issue || issue.remediation.steps.length === 0) return null;
  if (issue.state !== "new" && issue.state !== "reopened") return input.state;
  return recordCaseDecision(
    { decision: "accept", remediationKey: remediationKey(issue) },
    input.by,
    input.dataStore,
  );
}
