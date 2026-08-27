import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  CALLER_KINDS_ARE_THE_REGISTRY_CLASSES,
  CallerError,
  UNKNOWN_USER,
  attributionOf,
  callerFromLegacyActor,
} from "../caller";

/**
 * The identity half of `concepts.action.actor_note`.
 *
 * `actor` meant two things: a permission set in the registry, a record of who
 * did in the runtime. Splitting them made validation possible, and these are
 * the properties the split has to keep — that the class cannot be stated twice,
 * that every value the old field ever held has a reading, and that a value it
 * never held stops the migration rather than being guessed at.
 */

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const registryPath = path.resolve(moduleDir, "../../../vocabulary.json");
const registry = JSON.parse(readFileSync(registryPath, "utf8"));
const srcDir = path.resolve(moduleDir, "../..");

/** Every class the registry permits anywhere in the transition table. */
const REGISTRY_CLASSES: string[] = [
  ...new Set(
    (registry.concepts.action.values as { actor: string | string[] }[])
      .flatMap((action) => (Array.isArray(action.actor) ? action.actor : [action.actor])),
  ),
];

describe("the caller's class", () => {
  it("is the tag, so it is the only place the class is stated", () => {
    // The rejected alternatives both let a caller name a class it is not: a
    // `class` field beside the identity, or a lookup from identity to class.
    // A caller has exactly two keys, and one of them is the class.
    expect(Object.keys(callerFromLegacyActor("checkpoint")).sort()).toEqual(["agent", "kind"]);
    expect(Object.keys(callerFromLegacyActor("rae@webflow.com")).sort()).toEqual(["kind", "userId"]);
  });

  it("covers exactly the classes the registry permits", () => {
    // The compiler already refuses to build this file if the two unions differ;
    // the constant is that check, and this reads it so the mechanism has a
    // reader rather than sitting in the type system unexercised.
    expect(CALLER_KINDS_ARE_THE_REGISTRY_CLASSES).toBe(true);
    const built = [
      callerFromLegacyActor("system").kind,
      callerFromLegacyActor("rae@webflow.com").kind,
    ];
    expect([...built].sort()).toEqual([...REGISTRY_CLASSES].sort());
  });
});

describe("migrating a stored actor", () => {
  it("reads every value the old field ever held", () => {
    // Enumerable because they are literals in this repo's own writers, not an
    // open vocabulary: two from the checkpoint evaluator, one each from the
    // legacy-record adapter and the same-cause merge.
    expect(callerFromLegacyActor("system")).toEqual({ kind: "system", agent: "system" });
    expect(callerFromLegacyActor("checkpoint")).toEqual({ kind: "system", agent: "checkpoint" });
    expect(callerFromLegacyActor("migration")).toEqual({ kind: "system", agent: "migration" });
    expect(callerFromLegacyActor("grouping")).toEqual({ kind: "system", agent: "grouping" });
  });

  it("keeps a user id, and says so when the row never carried one", () => {
    const id = "rae@webflow.com";
    expect(callerFromLegacyActor(id)).toEqual({ kind: "person", userId: id });
    // The bare class recorded the kind and threw the identity away. A sentinel
    // says that; a plausible name would invent a reader who never existed.
    expect(callerFromLegacyActor("person")).toEqual({ kind: "person", userId: UNKNOWN_USER });
    expect(UNKNOWN_USER).not.toBe(id);
  });

  it("throws on a value no writer produced, and names it", () => {
    // Rule 18's second half. Every legacy value is known, so an unknown one is
    // a broken invariant rather than an absent reading — defaulting it to a
    // person would file somebody else's decision under a person who never
    // made one, and it would do so silently.
    for (const rogue of ["matthew", "collector", "", "PERSON", "unknown"]) {
      expect(() => callerFromLegacyActor(rogue)).toThrow(CallerError);
      let message = "";
      try {
        callerFromLegacyActor(rogue);
      } catch (error) {
        message = (error as Error).message;
      }
      expect(message, `the throw must name "${rogue}"`).toContain(`"${rogue}"`);
    }
  });

  it("never falls back to a person", () => {
    // The specific failure this replaces: an unrecognised string that reads as
    // an identity, filed as one. The sentinel is not a landing zone either.
    expect(() => callerFromLegacyActor("someone")).toThrow(CallerError);
    expect(() => callerFromLegacyActor(UNKNOWN_USER)).toThrow(CallerError);
  });
});

describe("attribution", () => {
  it("gives the identity for a person and nothing for the system", () => {
    expect(attributionOf(callerFromLegacyActor("rae@webflow.com"))).toBe("rae@webflow.com");
    expect(attributionOf(callerFromLegacyActor("checkpoint"))).toBeNull();
    expect(attributionOf(callerFromLegacyActor("migration"))).toBeNull();
  });

  it("withholds rather than naming the person a migrated row lost", () => {
    // Rule 18's first half: the reading is absent, so the claim is not made.
    expect(attributionOf(callerFromLegacyActor("person"))).toBeNull();
  });

  it("returns an identity or nothing, never a word", () => {
    // Which is why F4 adds no copy. Anything this returns came from the data.
    for (const value of ["system", "checkpoint", "migration", "grouping", "person"]) {
      expect(attributionOf(callerFromLegacyActor(value))).toBeNull();
    }
  });
});

/* ── The guard is on the class, and only on the class ─────────────────── */

/**
 * Every comparison against a permission set in a file, with the argument it was
 * handed.
 *
 * This is a text scan, so it reads comments as well as code and cannot tell the
 * difference. Nothing in this file may spell the pattern out in prose — doing so
 * makes the guard report itself, which is a failure that looks exactly like a
 * real one and wastes the next reader's afternoon.
 */
const COMPARISON = /\.actor\b\s*\.\s*includes\(([^)]*)\)/g;

/**
 * Whether one such comparison is testing something that is not a class.
 *
 * `transition.actor` is a PERMISSION SET — a list of classes. Two things may
 * legitimately be tested against it, and they are both classes:
 *
 *   - a caller's `kind`, which is the runtime check `applyAction` performs;
 *   - a class named outright, which is how a caller asks a question ABOUT the
 *     permission set rather than about a caller. `personActionsFor` does this:
 *     "which actions may a person fire" is precisely what a permission set is
 *     for, and the answer drives which buttons exist.
 *
 * What is forbidden is comparing an IDENTITY against it — a user id, an agent
 * name, any string naming who rather than which class. That guard answers for
 * the strings it lists and has to guess for the rest, so an unlisted caller
 * either gets in or is locked out for having a new name, and a caller that picks
 * a listed name gets in on the strength of the name alone. F4 exists because
 * `actor` conflated the two; a check that cannot tell them apart either is the
 * same defect one level up.
 *
 * The permitted literals are read off the registry rather than written here, so
 * a third class added to `vocabulary.json` is permitted the moment it is
 * declared, and an agent name — `"checkpoint"`, `"grouping"`, `"migration"` —
 * is never one of them.
 *
 * A class held in a variable is still flagged. That is deliberate: it is rare,
 * it is indistinguishable from an identity by reading, and the two call sites in
 * this codebase both have a better form available. Erring tight on a check like
 * this costs an author one line of justification; erring loose costs the guard.
 */
function comparesANonClass(argument: string): boolean {
  const text = argument.trim();
  if (/\.kind\b/.test(text)) return false;
  return !REGISTRY_CLASSES.some((className) => text === `"${className}"` || text === `'${className}'`);
}

describe("no identity string is ever compared against a permission list", () => {
  it("knows an identity from a class", () => {
    // The guard was narrowed in R2, so what it still catches is asserted rather
    // than assumed. A check that was loosened without this is a check nobody can
    // tell from a deleted one.
    expect(comparesANonClass("options.by.kind")).toBe(false);
    expect(comparesANonClass("by.kind")).toBe(false);
    for (const className of REGISTRY_CLASSES) {
      expect(comparesANonClass(`"${className}"`), `${className} is a class the registry declares`).toBe(false);
    }
    // Identities, every one of which the old field could hold and none of which
    // is a class.
    for (const identity of ['"checkpoint"', '"grouping"', '"migration"', '"rae@webflow.com"', "rec.owner", "userId", "entry.by.userId"]) {
      expect(comparesANonClass(identity), `${identity} is an identity, not a class`).toBe(true);
    }
  });

  it("is true of every file under src/", () => {
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (/\.tsx?$/.test(entry.name)) files.push(full);
      }
    };
    walk(srcDir);

    const offenders: string[] = [];
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      for (const match of source.matchAll(COMPARISON)) {
        if (comparesANonClass(match[1])) offenders.push(`${path.relative(srcDir, file)}: ${match[0]}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
