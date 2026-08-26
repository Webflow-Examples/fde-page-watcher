import type { CaseDecisionKind, CaseDecisionRecord } from "./types";
import {
  DISMISS_REASONS,
  EXCLUSION_REASONS,
  type DismissReason,
  type ExclusionReason,
} from "./vocabulary";

/**
 * What a person decided, kept somewhere the collector does not write.
 *
 * A case is derived from records on every read (F2), so a decision about one
 * has nowhere to live on the thing it is about. This is that somewhere. It is a
 * log, not a table of current values: an entry is appended and never edited,
 * never deleted, and never pruned on read. The log IS the history the case
 * panel renders, so deriving a state from it and storing that beside it would
 * be one fact written twice — which is the pair F2 deleted.
 *
 * Three properties this module exists to keep:
 *
 *   1. Nothing is keyed on a case. A case is a group with no identity of its
 *      own — the merged case takes the id of whichever member came first, and
 *      membership changes whenever evidence does. A decision keyed on that
 *      would detach from the thing it was about the first time a page joined or
 *      left. Everything here keys on the REMEDIATION, which is what a person
 *      read and agreed to.
 *   2. Two grains, one log. Excluding is about one page of one remediation;
 *      accepting is about the remediation entire. Different questions, so
 *      different keys — and a new record joining an accepted remediation
 *      arrives accepted precisely because accept did not key on the membership
 *      that just changed.
 *   3. A reason where the registry requires one, enforced by the type rather
 *      than by a check a caller can forget. `exclude` and `dismiss` cannot be
 *      constructed without one; `include` and `accept` have nowhere to put one.
 *
 * Deliberately narrow: it imports the registry and the stored shape, and
 * nothing else. Reading the log against a case needs the case model, and that
 * lives in `issue-cases.ts` with the rest of the derivation — keeping it out of
 * here is what lets `types.ts` stay the no-import leaf that keeps provider
 * evidence out of the persisted state.
 */

export type { CaseDecisionKind, CaseDecisionRecord };

/**
 * The four, derived from the stored union rather than restated beside it.
 *
 * A `Record` over the union, so a decision added to `types.ts` is a missing
 * property here rather than a value the door quietly rejects — the same idiom
 * `MERGE_PRECEDENCE` and `MARK_SHAPE` use, and for the same reason.
 */
const DECLARED: Record<CaseDecisionKind, true> = {
  exclude: true,
  include: true,
  accept: true,
  dismiss: true,
};

export const CASE_DECISIONS = Object.keys(DECLARED) as readonly CaseDecisionKind[];

/**
 * One decision as a caller states it, in the shape its grain requires.
 *
 * A union rather than one interface with optional fields, so the two grains
 * cannot be mixed: there is no way to write an exclusion without naming the
 * page, and no way to accept one page of a remediation — which is not a thing
 * anybody can do, and would quietly mean something else if it were storable.
 */
export type CaseDecisionRequest =
  | { decision: "exclude"; remediationKey: string; pageId: string; reason: ExclusionReason }
  | { decision: "include"; remediationKey: string; pageId: string }
  | { decision: "accept"; remediationKey: string }
  | { decision: "dismiss"; remediationKey: string; reason: DismissReason };

/** What every entry carries, whatever it decided. */
export interface DecisionStamp {
  /** ISO. Also the entry's place in the log, which is kept in append order. */
  at: string;
  /**
   * Who decided.
   *
   * The same `actor` field, spelled the same way, as `HistoryEntry.actor` and
   * every transition F2 and W1 write today. Deliberately NOT a tagged caller
   * yet: F4 migrates every call site in the app to one in a single change, and
   * a store that had half-migrated ahead of it is the one place that sweep
   * could not simply carry along.
   */
  actor: string;
}

/** A validated entry: what was decided, plus when and by whom. */
export type CaseDecision = CaseDecisionRequest & DecisionStamp;

/** Thrown for an entry the store will not accept. */
export class CaseDecisionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CaseDecisionError";
  }
}

/** The unvalidated shape a request body arrives in. */
export interface CaseDecisionInput {
  decision?: unknown;
  remediationKey?: unknown;
  pageId?: unknown;
  reason?: unknown;
}

function isDecisionKind(value: unknown): value is CaseDecisionKind {
  return typeof value === "string" && (CASE_DECISIONS as readonly string[]).includes(value);
}

/**
 * Narrow a stored entry, or decline to.
 *
 * The read half of the door, and the same validator as the write half — one
 * statement of what a well-formed decision is, rather than one for each
 * direction that can disagree about a reason the registry retired.
 *
 * `null` means "this does not apply", never "this is gone". The caller skips
 * it and the entry stays in the log exactly where it was. Nothing in the app
 * removes an entry, and a read path that silently dropped one would be the
 * precise failure the log exists to prevent.
 */
export function decisionOf(record: CaseDecisionRecord): CaseDecision | null {
  try {
    return caseDecisionFrom(record, { at: record.at, actor: record.actor });
  } catch {
    return null;
  }
}

/**
 * Build an entry, or refuse to.
 *
 * The one door into the log, so the properties above hold for an untyped caller
 * too. The reasons are checked against the registry's lists rather than against
 * a copy: a fourth exclusion reason added there is accepted here without anyone
 * remembering to widen a check.
 */
export function caseDecisionFrom(input: CaseDecisionInput, stamp: DecisionStamp): CaseDecision {
  const { decision, remediationKey, pageId, reason } = input;
  if (!isDecisionKind(decision)) {
    throw new CaseDecisionError(`decision must be one of: ${CASE_DECISIONS.join(", ")}`);
  }
  if (typeof remediationKey !== "string" || !remediationKey.trim()) {
    throw new CaseDecisionError("remediationKey is required");
  }
  const key = remediationKey.trim();

  if (decision === "exclude" || decision === "include") {
    if (typeof pageId !== "string" || !pageId.trim()) {
      throw new CaseDecisionError(`${decision} is about one page, so pageId is required`);
    }
    const page = pageId.trim();
    if (decision === "include") return { decision, remediationKey: key, pageId: page, ...stamp };
    if (!(EXCLUSION_REASONS as readonly string[]).includes(reason as string)) {
      throw new CaseDecisionError(`reason must be one of: ${EXCLUSION_REASONS.join(", ")}`);
    }
    return { decision, remediationKey: key, pageId: page, reason: reason as ExclusionReason, ...stamp };
  }

  if (decision === "accept") return { decision, remediationKey: key, ...stamp };
  if (!(DISMISS_REASONS as readonly string[]).includes(reason as string)) {
    throw new CaseDecisionError(`reason must be one of: ${DISMISS_REASONS.join(", ")}`);
  }
  return { decision, remediationKey: key, reason: reason as DismissReason, ...stamp };
}
