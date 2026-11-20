import type { Caller } from "./caller";
import type { CasePlanRecord } from "./types";

/**
 * User-authored remediation plans for cases whose source supplied no steps.
 *
 * Keyed on the case's cause, like transitions, and append-only: the latest
 * entry wins. A plan is not a state change; it supplies the plan Accept and the
 * ticket need, without pretending the source documented it.
 */
export interface CasePlanInput {
  caseKey?: unknown;
  steps?: unknown;
}

export type CasePlanRequest = { caseKey: string; steps: string[] };

export interface CasePlanStamp {
  at: string;
  by: Caller;
}

export class CasePlanError extends Error {}

export function casePlanFrom(input: CasePlanInput, stamp: CasePlanStamp): CasePlanRecord {
  const caseKey = typeof input.caseKey === "string" ? input.caseKey.trim() : "";
  if (!caseKey) throw new CasePlanError("caseKey is required");
  const steps = Array.isArray(input.steps)
    ? input.steps
      .filter((step): step is string => typeof step === "string")
      .map((step) => step.trim())
      .filter(Boolean)
    : [];
  if (steps.length === 0) throw new CasePlanError("a plan needs at least one step");
  return { caseKey, steps, ...stamp };
}

export function planOf(record: CasePlanRecord): CasePlanRecord | null {
  try {
    return casePlanFrom(record, { at: record.at, by: record.by });
  } catch {
    return null;
  }
}
