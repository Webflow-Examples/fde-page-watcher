import type { Caller } from "./caller";
import { applyAction, canApply, type IssueCase } from "./issue-case";
import type { CaseTransitionKind, CaseTransitionRecord } from "./types";

/**
 * The case-level lifecycle log.
 *
 * Decisions are about a remediation and keyed on `remediationKey`; transitions
 * are about one case and keyed on its cause. Keeping them apart is what lets an
 * accepted remediation survive a membership change while a start still belongs
 * to the finding somebody actually picked up.
 *
 * Append-only. A transition that no longer applies to the case's current state
 * stays in the log and is skipped on replay, exactly like a decision whose
 * remediation has changed.
 */

const DECLARED: Record<CaseTransitionKind, true> = {
  start: true,
  mark_fixed: true,
  reopen: true,
};

export const CASE_TRANSITIONS = Object.keys(DECLARED) as readonly CaseTransitionKind[];

export class CaseTransitionError extends Error {}

export interface CaseTransitionInput {
  caseKey?: unknown;
  action?: unknown;
}

export interface CaseTransitionStamp {
  /** ISO. */
  at: string;
  by: Caller;
}

export type CaseTransitionRequest = {
  caseKey: string;
  action: CaseTransitionKind;
};

function isCaseTransitionKind(value: unknown): value is CaseTransitionKind {
  return typeof value === "string" && (CASE_TRANSITIONS as readonly string[]).includes(value);
}

/** The one gate into the log, for writers and for readers of persisted state. */
export function caseTransitionFrom(
  input: CaseTransitionInput,
  stamp: CaseTransitionStamp,
): CaseTransitionRecord {
  if (!isCaseTransitionKind(input.action)) {
    throw new CaseTransitionError(`action must be one of: ${CASE_TRANSITIONS.join(", ")}`);
  }
  const caseKey = typeof input.caseKey === "string" ? input.caseKey.trim() : "";
  if (!caseKey) throw new CaseTransitionError("caseKey is required");
  return { caseKey, action: input.action, ...stamp };
}

/** Narrow a stored entry, or decline to apply it. */
export function transitionOf(record: CaseTransitionRecord): CaseTransitionRecord | null {
  try {
    return caseTransitionFrom(record, { at: record.at, by: record.by });
  } catch {
    return null;
  }
}

/**
 * Apply one stored transition, if the registry still permits it.
 *
 * Resolve is deliberately absent: the registry gives it to the system, fired
 * by an agreed checkpoint, never to a person. The state guard here is what
 * makes an entry left behind by an earlier state a skip rather than a crash.
 */
export function applyCaseTransition(
  issue: IssueCase,
  record: CaseTransitionRecord,
): IssueCase {
  if (!canApply(issue, record.action)) return issue;
  return applyAction(issue, record.action, { by: record.by, at: record.at });
}
