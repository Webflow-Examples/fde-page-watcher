/**
 * Who fired a transition — the identity, kept apart from the permission set.
 *
 * The registry's `action.*.actor` is a PERMISSION SET: which classes of caller
 * may fire a transition. The runtime needs something else — the record of who
 * actually did — and until v9 both were spelled `actor`, one word carrying two
 * meanings, which rule 4 forbids. `concepts.action.actor_note` in
 * `vocabulary.json` is the decision; this is the identity half of it.
 *
 * Because the two were one field, validation was impossible: `applyAction`
 * recorded whatever string it was handed, so "resolve is system-only" held only
 * because the checkpoint evaluator was its single caller and hardcoded the
 * word. A stated rule with no mechanism is what rule 14 exists to name.
 *
 * THE TAG IS THE CLASS. `kind` is not a label describing the identity, it is
 * the identity's class, and there is no way to construct a caller without
 * committing to one. Two other shapes were considered and rejected:
 *
 *   - a separate `class` field beside the identity, which a caller sets to
 *     whatever it likes;
 *   - a table mapping identity strings to classes, which answers for the
 *     strings it lists and has to guess for the rest.
 *
 * Both produce a guard that a lying or unlisted caller satisfies. This one
 * cannot be lied to about the class, because the class is the constructor.
 *
 * It lives next to `ISSUE_TRANSITIONS` — the table `applyAction` validates
 * against — rather than in `vocabulary.ts`, which mirrors the registry file and
 * is checked against it. An identity is a runtime fact, not a registry value.
 */

import { validEmail } from "./accessJwt";
import type { TransitionActor } from "./vocabulary";

/**
 * A system caller names the agent that ran; a person caller names the user.
 *
 * `agent` is free text on purpose. The registry's note says validation is on
 * the class and never on the string, which is what lets a richer identity — a
 * new evaluator, a named job — arrive without a registry change, while an
 * unpermitted class still cannot get through.
 */
export type Caller =
  | { kind: "system"; agent: string }
  | { kind: "person"; userId: string };

/**
 * The compiler's check that the tags are exactly the registry's classes.
 *
 * If `vocabulary.json` grows a third actor class, `TransitionActor` grows with
 * it and this stops type-checking, because a class with no variant is a class
 * nothing can be constructed as — and a transition permitted to it could never
 * be fired. Missing it would look like the transition simply never happening.
 */
type SameSet<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
export const CALLER_KINDS_ARE_THE_REGISTRY_CLASSES: SameSet<Caller["kind"], TransitionActor> = true;

/** Thrown for a legacy actor value no writer in this app ever wrote. */
export class CallerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CallerError";
  }
}

/**
 * The person a migrated row cannot name.
 *
 * Legacy rows written under the bare string `"person"` recorded the class and
 * threw the identity away — there is nothing to recover. A sentinel says that
 * out loud where a plausible-looking name would invent a reader who never
 * existed. Nothing renders it: `attributionOf` withholds instead, which is
 * rule 18's first half.
 */
export const UNKNOWN_USER = "unknown-user";

/**
 * The agents this app wrote into `history.actor` before the field split.
 *
 * Enumerable because they are literals in this repo's own writers, not a
 * registry list and not an open vocabulary: `"system"` and `"checkpoint"` from
 * the checkpoint evaluator, `"migration"` from the legacy-record adapters, and
 * `"grouping"` from the same-cause merge.
 *
 * This is a migration table, read once per stored row on the way in. It is NOT
 * the transition guard and must never become one — `applyAction` reads
 * `by.kind` and nothing else, so no caller reaches a permission decision by
 * matching its identity against this list.
 */
const LEGACY_SYSTEM_AGENTS = ["system", "checkpoint", "migration", "grouping"] as const;

/** The one legacy value that named a class instead of a person. */
const LEGACY_UNNAMED_PERSON = "person";

/**
 * One stored `actor` string, as the caller it always meant.
 *
 * Call this on the way in, wherever a persisted history row is read:
 * `{ ...row, by: callerFromLegacyActor(row.actor) }`. Every row written after
 * F4 carries a whole `Caller` and needs none of this.
 *
 * A person's id in this app is their account email (`Identity` in
 * `src/lib/identity.ts`), so a legacy person identity is recognisable rather
 * than assumed. That is what makes the last branch a throw instead of a
 * default: every value this app ever wrote is above, so one that is neither a
 * known agent nor an id is a broken invariant, not an absent reading. Rule 18's
 * second half — fail loudly, and name the value, because the value is the only
 * thing that tells anyone which writer produced it.
 */
export function callerFromLegacyActor(value: string): Caller {
  if ((LEGACY_SYSTEM_AGENTS as readonly string[]).includes(value)) {
    return { kind: "system", agent: value };
  }
  if (value === LEGACY_UNNAMED_PERSON) {
    return { kind: "person", userId: UNKNOWN_USER };
  }
  if (validEmail(value)) {
    return { kind: "person", userId: value };
  }
  throw new CallerError(
    `callerFromLegacyActor: "${value}" is not an actor this app ever wrote. Known agents are ${LEGACY_SYSTEM_AGENTS.join(", ")}; a person is "${LEGACY_UNNAMED_PERSON}" or an account email. Find the writer rather than guessing a class.`,
  );
}

/**
 * The identity a history row is attributed to, or nothing.
 *
 * Nothing for a system caller: the checkpoint evaluator is the implementation,
 * and "by the checkpoint evaluator" beside a line the reader already
 * understands is the implementation talking. Nothing for the unknown user
 * either — a migrated row knows a person acted and does not know which one, and
 * a blank field is the honest shape of that.
 *
 * This returns an identity or null and never a word, which is why F4 adds no
 * copy: the field renders data the reader supplied or it does not render.
 */
export function attributionOf(by: Caller): string | null {
  if (by.kind !== "person") return null;
  return by.userId === UNKNOWN_USER ? null : by.userId;
}
