import { describe, expect, it } from "vitest";
import { GUIDE_CATEGORIES, GUIDE_ENTRIES } from "../guide";

const CATEGORY_IDS = new Set(GUIDE_CATEGORIES.map((category) => category.id));
const TERMS = new Set(GUIDE_ENTRIES.map((entry) => entry.term));
const LOOKUPS = new Set([
  ...GUIDE_ENTRIES.map((entry) => entry.term),
  ...GUIDE_ENTRIES.flatMap((entry) => entry.aliases ?? []),
]);

describe("guide integrity", () => {
  it("gives every entry a unique id and term", () => {
    const ids = GUIDE_ENTRIES.map((entry) => entry.id);
    const terms = GUIDE_ENTRIES.map((entry) => entry.term);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(terms).size).toBe(terms.length);
  });

  it("files every entry under a real category", () => {
    for (const entry of GUIDE_ENTRIES) {
      expect(CATEGORY_IDS, `${entry.id} has category ${entry.category}`).toContain(entry.category);
    }
  });

  it("resolves every cross-reference to a term or alias", () => {
    // A dangling "related" link is a dead end for the reader.
    for (const entry of GUIDE_ENTRIES) {
      for (const related of entry.related ?? []) {
        expect(LOOKUPS, `${entry.id} links to unknown term ${related}`).toContain(related);
      }
    }
  });

  it("does not let an alias shadow a different entry's term", () => {
    for (const entry of GUIDE_ENTRIES) {
      for (const alias of entry.aliases ?? []) {
        if (!TERMS.has(alias)) continue;
        expect(alias, `${entry.id} aliases another entry's term`).toBe(entry.term);
      }
    }
  });

  it("never links an entry to itself", () => {
    for (const entry of GUIDE_ENTRIES) {
      expect(entry.related ?? []).not.toContain(entry.term);
    }
  });

  it("gives every entry usable prose", () => {
    for (const entry of GUIDE_ENTRIES) {
      expect(entry.shortDefinition.length, `${entry.id} definition`).toBeGreaterThan(15);
      expect(entry.appMeaning.length, `${entry.id} meaning`).toBeGreaterThan(30);
      // A short definition is a sentence, not a paragraph.
      expect(entry.shortDefinition.length).toBeLessThan(160);
    }
  });
});

describe("agent access is explained inline, not only as jargon", () => {
  function entry(id: string) {
    const found = GUIDE_ENTRIES.find((item) => item.id === id);
    if (!found) throw new Error(`missing guide entry ${id}`);
    return found;
  }

  it("covers the verdict and every one of its states", () => {
    const verdict = entry("agent-access-verdict");
    for (const state of ["Ready", "Needs attention", "Blocked", "Unknown"]) {
      expect(verdict.appMeaning).toContain(state);
    }
    // The verdict must not be described as an average of provider scores.
    expect(verdict.appMeaning).toContain("never an average");
  });

  it("explains that sources are merged rather than averaged", () => {
    expect(entry("agent-access-issue").appMeaning).toContain("rather than averaged");
  });

  it("distinguishes not-applicable, ignored, unavailable, and partial", () => {
    const meaning = entry("not-applicable").appMeaning;
    for (const term of ["Not applicable", "Ignored", "Unavailable", "Partial"]) {
      expect(meaning).toContain(term);
    }
  });

  it("discloses that external scans are public and origin-scoped", () => {
    const external = entry("external-agent-audit");
    expect(external.appMeaning).toContain("public");
    expect(external.appMeaning).toContain("origin");
    // Staging is explicitly out of scope.
    expect(external.appMeaning).toContain("staging");
    // Names the relationship the plan asks us to explain.
    expect(external.appMeaning).toContain("Is Agentic");
  });

  it("says provider silence is not proof a fix failed", () => {
    expect(entry("agent-verification").appMeaning).toContain("never treated as proof");
  });

  it("defines an essential blocker precisely", () => {
    const blocker = entry("essential-blocker").appMeaning;
    expect(blocker).toContain("essential-tier and currently failing");
    // A partial essential finding is deliberately not a blocker.
    expect(blocker).toContain("not counted as a blocker");
  });
});
