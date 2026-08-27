/**
 * Turning agent issue cases into recommendations, and closing the loop after a
 * fix. Essential blockers still enter automatically via
 * `reconcileAgentIssueRecsInState`; there is no separate "promote to task"
 * path — an agent finding is already a case (`agentIssueCases`), and decisions
 * live in the append-only case store.
 *
 * A recommendation keeps the provider check ids and success criteria that were
 * true when it was created, so a later verification re-runs exactly the right
 * checks even if the issue has since been re-assembled from newer evidence.
 */

import { costBand } from "./cost";
import { shortDate } from "./ui";
import type {
  AgentIssueTaskEvidence,
  AgentIssueVerification,
  AgentIssueVerificationResult,
  AppState,
  Rec,
  WatchPage,
} from "./types";
import type { AgentIssueCase } from "./agentIssueCases";
import { essentialAgentBlockers } from "./agentIssueCases";

/** Stable recommendation id for an issue case. */
export function agentIssueRecId(caseKey: string): string {
  return `agent-issue:${caseKey}`;
}

function evidenceFor(
  issue: AgentIssueCase,
  origin: string | undefined,
  now: Date,
): AgentIssueTaskEvidence {
  const observed = issue.sources
    .map((source) => source.observedAt)
    .filter((value): value is string => !!value)
    .sort();
  return {
    caseKey: issue.key,
    title: issue.title,
    scope: issue.scope,
    ...(origin ? { origin } : {}),
    capturedAt: observed.at(-1) ?? now.toISOString(),
    remediation: [...issue.remediation],
    successCriteria: issue.successCriteria,
    verificationCheckIds: [...issue.verificationCheckIds],
  };
}

/**
 * Build the recommendation for one issue case. The summary states the
 * consequence and how Page Watch knows, so a reader can judge the claim without
 * opening the provider report.
 */
export function agentIssueRec(
  page: WatchPage,
  issue: AgentIssueCase,
  now: Date,
  origin?: string,
): Rec {
  const id = agentIssueRecId(issue.key);
  const systems = [...new Set(issue.sources
    .filter((source) => source.result === "failed" || source.result === "partial")
    .map((source) => source.system))];
  const knowledge = systems.length > 1
    ? `Reported independently by ${systems.length} sources.`
    : systems.length === 1
      ? "Reported by one source."
      : "No source currently reports a determined failure.";
  return {
    key: `${page.id}:${id}`,
    pageId: page.id,
    pageTitle: page.title,
    url: page.url,
    id,
    source: "agent-readiness",
    title: issue.title,
    category: "Agent access",
    savings: issue.tier === "essential" ? "Essential" : "Agent access",
    estTime: costBand(`${id} ${issue.title}`),
    status: "inbox",
    taskStatus: "todo",
    added: shortDate(now),
    doneDate: null,
    aiSummary: `${issue.consequence} ${knowledge}`,
    agentIssue: evidenceFor(issue, origin, now),
  };
}

export interface AgentIssueReconciliation {
  created: number;
  updated: number;
}

/**
 * File essential blockers into the Inbox and keep existing agent tasks' evidence
 * current. Ignored and completed work is left alone: a still-present issue must
 * not reopen a decision the user already made.
 */
export function reconcileAgentIssueRecsInState(
  state: AppState,
  casesByPage: Map<string, { cases: AgentIssueCase[]; origin?: string }>,
  now: Date,
): AgentIssueReconciliation {
  let created = 0;
  let updated = 0;

  for (const page of state.pages) {
    const entry = casesByPage.get(page.id);
    if (!entry) continue;
    const byKey = new Map(entry.cases.map((issue) => [issue.key, issue]));

    // Keep evidence current on every agent task this page already has.
    for (const rec of state.recs) {
      if (rec.pageId !== page.id || rec.source !== "agent-readiness") continue;
      const issue = rec.agentIssue && byKey.get(rec.agentIssue.caseKey);
      if (!issue) continue;
      const refreshed = evidenceFor(issue, entry.origin, now);
      const before = JSON.stringify(rec.agentIssue);
      rec.agentIssue = {
        ...refreshed,
        ...(rec.agentIssue?.verification ? { verification: rec.agentIssue.verification } : {}),
      };
      if (JSON.stringify(rec.agentIssue) !== before) updated += 1;
    }

    for (const blocker of essentialAgentBlockers(entry.cases)) {
      const key = `${page.id}:${agentIssueRecId(blocker.key)}`;
      if (state.recs.some((rec) => rec.key === key)) continue;
      state.recs.push(agentIssueRec(page, blocker, now, entry.origin));
      created += 1;
    }
  }
  return { created, updated };
}

/** Every distinct provider check id a task expects to be re-verified. */
export function verificationTargetsFor(rec: Rec): string[] {
  return [...new Set(rec.agentIssue?.verificationCheckIds ?? [])];
}

/**
 * Tasks whose implementation is complete and whose fix has provider checks that
 * can confirm it. A task with no provider coverage is never left waiting on a
 * verification that can never arrive.
 */
export function agentTasksAwaitingVerification(state: AppState): Rec[] {
  return state.recs.filter((rec) =>
    rec.source === "agent-readiness"
    && rec.status === "task"
    && rec.taskStatus === "done"
    && verificationTargetsFor(rec).length > 0
    && (rec.agentIssue?.verification?.status ?? "not-started") !== "resolved");
}

/** Mark a task as awaiting provider confirmation. */
export function beginAgentVerification(rec: Rec, now: Date): void {
  if (!rec.agentIssue) return;
  rec.agentIssue.verification = {
    ...(rec.agentIssue.verification ?? {}),
    status: "verifying",
    requestedAt: now.toISOString(),
  };
}

/**
 * Fold provider re-check results into a task's verification state.
 *
 *   - Every selected check passing, or becoming correctly not applicable,
 *     resolves the issue.
 *   - Any check still failing or partial returns it.
 *   - A provider non-answer leaves it verifying and retryable: the provider
 *     being unavailable is not evidence that the fix did not work.
 */
export function applyAgentVerificationResults(
  rec: Rec,
  results: AgentIssueVerificationResult[],
  now: Date,
): AgentIssueVerification {
  const targets = verificationTargetsFor(rec);
  const relevant = results.filter((result) => targets.includes(result.checkId));
  const previous = rec.agentIssue?.verification;
  const determined = relevant.filter((result) => result.result !== "unavailable");
  const unresolved = determined.filter((result) =>
    result.result === "failed" || result.result === "partial");

  const status: AgentIssueVerification["status"] = determined.length === 0
    ? "verifying"
    : unresolved.length > 0
      ? "returned"
      : determined.length === targets.length
        ? "resolved"
        // Some checks answered and all of those were clean, but the provider
        // did not report on every target. Not enough to call it resolved.
        : "verifying";

  const verification: AgentIssueVerification = {
    ...(previous ?? {}),
    status,
    lastCheckedAt: now.toISOString(),
    results: relevant,
  };
  delete verification.errorCode;
  delete verification.errorMessage;
  if (rec.agentIssue) rec.agentIssue.verification = verification;
  return verification;
}

/** Record a provider failure without judging the remediation. */
export function recordAgentVerificationFailure(
  rec: Rec,
  error: { code: string; message: string },
  now: Date,
): void {
  if (!rec.agentIssue) return;
  rec.agentIssue.verification = {
    ...(rec.agentIssue.verification ?? {}),
    // Stays verifying: the fix is unproven, not disproven.
    status: "verifying",
    lastCheckedAt: now.toISOString(),
    errorCode: error.code,
    errorMessage: error.message.slice(0, 300),
  };
}

/** A returned issue goes back to open work so it reappears in the task list. */
export function reopenReturnedAgentTask(rec: Rec): boolean {
  if (rec.agentIssue?.verification?.status !== "returned") return false;
  if (rec.taskStatus !== "done") return false;
  rec.taskStatus = "in-progress";
  rec.doneDate = null;
  return true;
}
