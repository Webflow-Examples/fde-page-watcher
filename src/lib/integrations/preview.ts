import { remediationKey as remediationKeyOf, type IssueCase } from "../issue-case";
import { issueCasesFrom } from "../issue-cases";
import type { TaskLinkRecord, TaskProviderKind } from "./types";
import type { AppState } from "../types";

/**
 * What a selection would do, without doing it.
 *
 * Client-safe: no node imports, so the list can show the sentence before a
 * request is made. `tasks.ts` re-exports this, and the server uses the same
 * function for the result it returns — the preview and the outcome cannot
 * count different things.
 *
 * Deduplicated by remediation: two selected cases of one fix are one task, and
 * a fix that is already linked is already linked.
 */

export const CASE_BATCH_LIMIT = 25;

export interface BulkPreview {
  cases: number;
  tasks: number;
  alreadyLinked: number;
  withoutPlan: number;
  duplicates: number;
}

export function previewBulk(input: {
  state: AppState;
  links: readonly TaskLinkRecord[];
  provider: TaskProviderKind;
  caseIds: readonly string[];
}): BulkPreview {
  const cases = issueCasesFrom(input.state);
  const byId = new Map<string, IssueCase>(cases.map((issue) => [issue.id, issue]));
  const linked = new Set(
    input.links.filter((link) => link.provider === input.provider).map((link) => link.remediationKey),
  );
  const seen = new Set<string>();
  const preview: BulkPreview = { cases: 0, tasks: 0, alreadyLinked: 0, withoutPlan: 0, duplicates: 0 };
  for (const caseId of input.caseIds) {
    const issue = byId.get(caseId);
    if (!issue) continue;
    preview.cases += 1;
    const key = remediationKeyOf(issue);
    if (seen.has(key)) {
      preview.duplicates += 1;
      continue;
    }
    seen.add(key);
    if (linked.has(key)) preview.alreadyLinked += 1;
    else if (issue.remediation.steps.length === 0) preview.withoutPlan += 1;
    else preview.tasks += 1;
  }
  return preview;
}
