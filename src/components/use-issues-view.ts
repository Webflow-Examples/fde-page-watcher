"use client";

import { useMemo } from "react";
import {
  DEFAULT_SORT_DIRECTION,
  queueCountsOf,
  sortRemediationGroups,
  type IssueSort,
  type QueueCounts,
  type SortDirection,
} from "@/lib/issue-list";
import { casesInQueue, groupByRemediation, type IssueCase, type RemediationGroup } from "@/lib/issue-case";
import { issueCasesFrom, lastRunAtOf } from "@/lib/issue-cases";
import { partitionByImpact } from "@/lib/impact-format";
import { normalizePerformanceThresholds } from "@/lib/performanceThresholds";
import type { Queue } from "@/lib/vocabulary";
import { useStore } from "./store";

/* ── The hook the list uses ─────────────────────────────────────────────── */

export interface IssuesView {
  /** Every case in the project, one per problem. */
  cases: IssueCase[];
  /** Counted queues only. `settled` is absent by design. */
  counts: QueueCounts;
  /** The cases in the requested queue. */
  inQueue: IssueCase[];
  /** Those of them the list shows as rows, grouped by remediation and sorted. */
  groups: RemediationGroup[];
  /** Those of them the fold holds, grouped the same way and sorted the same way. */
  tail: RemediationGroup[];
  /** The cases behind the fold, for the count it states. */
  tailCases: IssueCase[];
  /** The project's threshold, so the fold can name it. */
  minimumSavingsMs: number;
  /** Page titles by id, for the scope line on a row. */
  pageTitles: Record<string, string>;
  lastRunAt?: string;
}

/**
 * One derivation of the issues list, memoised on the store's state.
 *
 * The queue and the sort come from the URL rather than from here: both are
 * things a person should be able to link someone to, and neither is a
 * preference worth persisting.
 */
export function useIssuesView(
  queue: Queue,
  sort: IssueSort,
  direction: SortDirection = DEFAULT_SORT_DIRECTION[sort],
): IssuesView {
  const { recs, pages, performanceThresholds, caseDecisions, caseTransitions, casePlans } = useStore();
  return useMemo(() => {
    // The decisions log is part of the derivation's input, not a filter applied
    // after it: what someone decided about a remediation changes which queue
    // its cases are in, so the counts and the rows have to be read from the
    // same pass or the badge and the list disagree.
    const cases = issueCasesFrom({ recs, pages, caseDecisions, caseTransitions, casePlans });
    const lastRunAt = lastRunAtOf(pages);
    const at = lastRunAt ? { at: lastRunAt } : {};
    const { minimumSavingsMs } = normalizePerformanceThresholds(performanceThresholds);
    const inQueue = casesInQueue(cases, queue);
    const { inline, tail } = partitionByImpact(inQueue, minimumSavingsMs);
    return {
      cases,
      counts: queueCountsOf(cases),
      inQueue,
      groups: sortRemediationGroups(groupByRemediation(inline, at), sort, direction),
      tail: sortRemediationGroups(groupByRemediation(tail, at), sort, direction),
      tailCases: tail,
      minimumSavingsMs,
      pageTitles: Object.fromEntries(pages.map((page) => [page.id, page.title])),
      lastRunAt,
    };
  }, [recs, pages, caseDecisions, caseTransitions, casePlans, performanceThresholds, queue, sort, direction]);
}
