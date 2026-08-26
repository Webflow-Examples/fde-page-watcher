import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  IssueCaseError,
  applicabilityOf,
  excludePage,
  excludedPageIds,
  includePage,
  includedPages,
  markFixed,
  type IssueCase,
} from "../issue-case";
import { recordCheckpointReading } from "../checkpoint-evaluation";
import { attributionOf, type Caller } from "../caller";
import { acceptLabel, excludedNote, historyExcluded, historyIncluded, pagesCount } from "../case-copy";

import { formatImpact } from "../impact-format";
import { EXCLUSION_REASONS } from "../vocabulary";

/**
 * Per-page applicability on a case (4b), and what it is required to reach.
 *
 * The interesting assertions here are not that the map updates — they are that
 * excluding a page changes the things a reader would expect it to change, and
 * nothing else. An exclusion the Accept button ignores is cosmetic; an
 * exclusion the checkpoint evaluator ignores is worse than cosmetic, because it
 * lets a page the reader dismissed reopen the case.
 */

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const AT = "2026-08-20T00:00:00.000Z";

/** Exclude and Include are a person's two moves, so the caller says who. */
const RAE = "rae@webflow.com";
const PERSON: Caller = { kind: "person", userId: RAE };

function caseOf(overrides: Partial<IssueCase> = {}): IssueCase {
  return {
    id: "PW-1",
    cause: "c",
    state: "todo",
    title: "t",
    diagnosis: "The homepage ships a bundle nothing on it uses.",
    detectedAt: AT,
    confirmedRuns: 2,
    scope: "pages",
    pageIds: ["p1", "p2", "p3"],
    strategies: ["mobile"],
    impactMs: 1800,
    effort: "hours",
    confidence: "confirmed",
    remediation: { steps: ["Remove it."], actionability: "direct" },
    successCriteria: "Gone.",
    checkpoints: [],
    evidence: [],
    history: [],
    ...overrides,
  };
}

/* ── The default, and what excluding changes ────────────────────────────── */

describe("a case's pages", () => {
  it("includes every page until someone says otherwise", () => {
    const issue = caseOf();
    expect(includedPages(issue)).toEqual(["p1", "p2", "p3"]);
    expect(excludedPageIds(issue)).toEqual([]);
    expect(issue.excludedPages).toBeUndefined();
    for (const pageId of issue.pageIds) expect(applicabilityOf(issue, pageId)).toBe("included");
  });

  it("changes the Accept label when a page is excluded", () => {
    const issue = caseOf();
    expect(acceptLabel(includedPages(issue).length, issue.pageIds.length)).toBe("Accept");
    const narrowed = excludePage(issue, "p3", "Not applicable to this site", { by: PERSON, at: AT });
    expect(acceptLabel(includedPages(narrowed).length, narrowed.pageIds.length)).toBe("Accept for 2 pages");
  });

  it("writes a history entry naming the page and the reason", () => {
    const narrowed = excludePage(caseOf(), "p2", "Intentional", {
      by: PERSON,
      at: AT,
      page: "/pricing",
    });
    expect(narrowed.history.at(-1)).toMatchObject({
      by: PERSON,
      reason: historyExcluded("/pricing", "Intentional"),
    });
    expect(narrowed.history.at(-1)?.reason).toBe("/pricing excluded — Intentional");
  });

  it("keeps the page, its row and its reading — excluding is not deleting", () => {
    const narrowed = excludePage(caseOf(), "p2", "Accepted risk", { by: PERSON, at: AT });
    // Still covered by the case, and still countable again.
    expect(narrowed.pageIds).toContain("p2");
    expect(excludedPageIds(narrowed)).toEqual(["p2"]);
    expect(pagesCount(includedPages(narrowed).length, excludedPageIds(narrowed).length))
      .toBe("2 included · 1 excluded");
    // And the reason is shown rather than implied.
    expect(excludedNote("Accepted risk")).toContain("Accepted risk");
  });

  it("puts a page back, with no reason required", () => {
    const narrowed = excludePage(caseOf(), "p2", "Intentional", { by: PERSON, at: AT });
    const restored = includePage(narrowed, "p2", { by: PERSON, at: AT, page: "/pricing" });
    expect(includedPages(restored)).toEqual(["p1", "p2", "p3"]);
    // The map goes away entirely rather than lingering as an empty object.
    expect(restored.excludedPages).toBeUndefined();
    expect(restored.history.at(-1)?.reason).toBe(historyIncluded("/pricing"));
    expect(restored.history.at(-1)?.reason).toBe("/pricing included again");
  });

  it("attributes the two person-fired lines without touching the line", () => {
    // Both locked lines lead with a page, so there is no "{line} by {name}"
    // that reads correctly: "/pricing excluded — Intentional by Rae" makes the
    // name part of the reason. The identity is a field of its own beside the
    // date, and the sentence is exactly what the registry's copy says.
    const narrowed = excludePage(caseOf(), "p2", "Intentional", { by: PERSON, at: AT, page: "/pricing" });
    const restored = includePage(narrowed, "p2", { by: PERSON, at: AT, page: "/pricing" });
    for (const entry of restored.history) {
      expect(attributionOf(entry.by)).toBe(RAE);
      expect(entry.reason).not.toContain(RAE);
    }
    expect(narrowed.history.at(-1)?.reason).toBe(historyExcluded("/pricing", "Intentional"));
    expect(restored.history.at(-1)?.reason).toBe(historyIncluded("/pricing"));
  });

  it("refuses a reason the registry does not bless", () => {
    expect(() =>
      // @ts-expect-error — the type forbids it; the guard is for untyped callers.
      excludePage(caseOf(), "p2", "Because I said so", { by: PERSON, at: AT }),
    ).toThrow(IssueCaseError);
    for (const reason of EXCLUSION_REASONS) {
      expect(() => excludePage(caseOf(), "p2", reason, { by: PERSON, at: AT })).not.toThrow();
    }
  });

  it("refuses to exclude the last counted page", () => {
    // A case counting nothing is a Dismiss. Two ways to say one thing is what
    // rule 11 exists to stop.
    const one = caseOf({ pageIds: ["p1"] });
    expect(() => excludePage(one, "p1", "Intentional", { by: PERSON, at: AT })).toThrow(
      IssueCaseError,
    );
  });

  it("refuses a page the case does not cover, and a double exclude", () => {
    expect(() => excludePage(caseOf(), "p9", "Intentional", { by: PERSON, at: AT })).toThrow(
      IssueCaseError,
    );
    const once = excludePage(caseOf(), "p2", "Intentional", { by: PERSON, at: AT });
    expect(() => excludePage(once, "p2", "Intentional", { by: PERSON, at: AT })).toThrow(
      IssueCaseError,
    );
    expect(() => includePage(caseOf(), "p2", { by: PERSON, at: AT })).toThrow(IssueCaseError);
  });
});

/* ── The guarantee that matters: exclusions reach the evaluator ─────────── */

describe("an excluded page and W1's checkpoints", () => {
  /** Fixed, with one page excluded before the fix shipped. */
  function fixedWithExclusion(): IssueCase {
    const narrowed = excludePage(caseOf({ state: "in_progress" }), "p3", "Intentional", {
      by: PERSON,
      at: AT,
    });
    return markFixed(narrowed, { by: PERSON, at: AT });
  }

  it("does not reopen the case when only an excluded page comes back", () => {
    /**
     * This is the whole point of the feature. The reader said this page does
     * not apply; a checkpoint that reopened the case on it would overrule that
     * decision without telling anyone, and the exclusion would be decoration.
     */
    const issue = fixedWithExclusion();
    const { effect, issue: after } = recordCheckpointReading(issue, {
      interval: "2d",
      outcome: "disagreed",
      at: "2026-08-22T00:00:00.000Z",
      pageIds: ["p3"],
    });
    expect(effect).toBe("recorded");
    expect(after.state).toBe("fixed");
    expect(after.history.some((entry) => entry.to === "reopened")).toBe(false);
  });

  it("still reopens when a counted page comes back", () => {
    const issue = fixedWithExclusion();
    const { effect, issue: after } = recordCheckpointReading(issue, {
      interval: "2d",
      outcome: "disagreed",
      at: "2026-08-22T00:00:00.000Z",
      pageIds: ["p1"],
    });
    expect(effect).toBe("reopened");
    expect(after.state).toBe("reopened");
    expect(after.pageIds).toEqual(["p1"]);
  });

  it("measures the counted pages by default", () => {
    // A reading that names no pages is about what the case claims, which is
    // the included set and not every page it covers.
    const issue = fixedWithExclusion();
    const { issue: after } = recordCheckpointReading(issue, {
      interval: "2d",
      outcome: "disagreed",
      at: "2026-08-22T00:00:00.000Z",
    });
    expect(after.pageIds).toEqual(["p1", "p2"]);
    expect(after.pageIds).not.toContain("p3");
  });
});

/* ── Rule 19 — the case's number is the worst page, never a total ───────── */

describe("the case's impact figure", () => {
  it("is one page's reading, not the sum of its pages", () => {
    const readings = { p1: 600, p2: 500, p3: 400 };
    const worst = Math.max(...Object.values(readings));
    expect(worst).toBe(600);
    // The number a reader can find on a row beneath it. 1500 would be a figure
    // no run produced.
    expect(formatImpact(worst).text).toBe("600 ms");
    expect(formatImpact(worst).text).not.toBe("1.5 s");
  });

  it("says so in words when nothing was measured", () => {
    // Rule 18, and the string is `formatImpact`'s rather than a second copy.
    expect(formatImpact(0)).toEqual({ text: "Not measured", measured: false });
  });
});

/* ── The control is offered, because F5 can keep what it is told ─────── */

describe("the exclude control", () => {
  // A case is addressed by its id and nothing else. `digest-arrival` is where
  // that route's shape is asserted; this only needs to read the file.
  const route = readFileSync(
    path.resolve(moduleDir, "../../app/(app)/issues/[id]/page.tsx"),
    "utf8",
  );
  const table = readFileSync(path.resolve(moduleDir, "../../components/case-pages.tsx"), "utf8");

  it("is offered, and what it writes is keyed on the remediation", () => {
    /**
     * S2 withheld this control because an exclusion had nowhere to live: it
     * would have been shown as applied and lost on reload, and an exception
     * that forgets itself is worse than none. F5 gave it somewhere, so the
     * gate came off.
     *
     * What replaced the gate is the condition the gate was standing in for. A
     * handler that kept the decision in component state would satisfy "the
     * control is wired" and fail the reader in exactly the old way, so this
     * asserts the key it writes rather than the presence of a prop.
     */
    const code = route.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(code).toMatch(/onExclude=/);
    expect(code).toMatch(/onInclude=/);
    expect(code).toMatch(/recordCaseDecision\(\{/);
    expect(code).toMatch(/remediationKey: remediationKey\(issue\)/);
    // No local copy of the answer. `case-decisions` holds the exclusion; a
    // `useState` here would be a second one that disagrees after a reload.
    expect(code).not.toMatch(/useState/);
  });

  it("offers no verb the log cannot keep", () => {
    /**
     * The header takes ONE action handler on purpose, so a caller cannot wire
     * four verbs and leave a fifth as a button that does nothing. The log holds
     * accept and dismiss but not start, mark_fixed or reopen — so wiring
     * `onAction` here would produce precisely that dead button. It stays unwired
     * until there is somewhere for all of them to go.
     */
    const code = route.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(code).not.toMatch(/onAction=/);
  });

  it("renders no control when no handler can keep the result", () => {
    // The gate is structural rather than a flag: no handler, no button. So a
    // caller cannot show the control and forget to make it durable.
    expect(table).toMatch(/const canExclude = Boolean\(onExclude\)/);
    expect(table).toMatch(/const canInclude = Boolean\(onInclude\)/);
  });

  it("still shows every page, and still renders an exclusion it is given", () => {
    // Gating the control must not hide a reading. The model is untouched by the
    // gate, so a persisted exclusion renders the moment F5 supplies one.
    const narrowed = excludePage(caseOf(), "p2", "Intentional", { by: PERSON, at: AT });
    expect(narrowed.pageIds).toHaveLength(3);
    expect(applicabilityOf(narrowed, "p2")).toBe("excluded");
    expect(table).toMatch(/textDecoration: isExcluded \? "line-through"/);
    expect(table).toMatch(/excludedNote\(reason\)/);
  });
});

/* ── One header pattern per kind of thing ─────────────────────────────── */

describe("the object-detail header", () => {
  it("is used by every route that shows one object, and by no destination", () => {
    /**
     * Two patterns exist: `PageHeader` for a destination, `ObjectDetailHeader`
     * for one object inside one. A third is a bug.
     *
     * The count is derived rather than asserted as 2. S3 adds the page detail;
     * hardcoding the number it will then reach would be a test asserting a
     * schedule, and it would have to fail until that chunk lands.
     */
    const appDir = path.resolve(moduleDir, "../../app");
    const users: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
          continue;
        }
        if (!/\.tsx$/.test(entry.name)) continue;
        const code = readFileSync(full, "utf8");
        if (/ObjectDetailHeader|CaseDetail\b/.test(code)) users.push(path.relative(appDir, full));
      }
    };
    walk(appDir);
    // Every user is a dynamic segment — one object, not a place.
    expect(users.length).toBeGreaterThan(0);
    for (const file of users) {
      expect(file, `${file} renders an object header but is not an object route`).toMatch(/\[/);
    }
  });

  it("keeps taxonomy below the diagnosis", () => {
    /**
     * Reading order is the argument: a chip strip above the title asks the
     * reader to classify a problem they have not been told about yet. The
     * header renders its metadata last, so this is a property of the component
     * rather than of each caller remembering.
     */
    const header = readFileSync(
      path.resolve(moduleDir, "../../components/object-detail-header.tsx"),
      "utf8",
    );
    expect(header.indexOf("{title}")).toBeLessThan(header.indexOf("{metadata}"));
    expect(header.indexOf("{explanation}")).toBeLessThan(header.indexOf("{metadata}"));
  });
});

/* ── Rule 17 — no action means a sentence, never a dead button ──────────── */

describe("a case with nothing to accept", () => {
  it("renders a reason instead of a disabled Accept", () => {
    const detail = readFileSync(path.resolve(moduleDir, "../../components/case-detail.tsx"), "utf8");
    // The sentence is chosen by actionability, and the button is not rendered
    // at all on that branch.
    expect(detail).toMatch(/NO_ACTION_REASON\.none/);
    expect(detail).toMatch(/NO_ACTION_REASON\.platform/);
    // No disabled ATTRIBUTE anywhere — prose about why there isn't one is fine,
    // which is why this looks for the property rather than the word.
    const code = detail.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "");
    expect(code).not.toMatch(/\bdisabled[=:]/);
    expect(code).not.toMatch(/aria-disabled/);
  });
});

/* ── An empty track is absent, not blank ────────────────────────────────── */

describe("the checkpoint track on a case", () => {
  it("is absent before mark_fixed", () => {
    const detail = readFileSync(path.resolve(moduleDir, "../../components/case-detail.tsx"), "utf8");
    // Rendered only when the run has something in it.
    expect(detail).toMatch(/run\.length > 0 \? \(/);
  });

  it("appears once the case is fixed", () => {
    const fixed = markFixed(caseOf({ state: "in_progress" }), { by: PERSON, at: AT });
    expect(fixed.checkpoints).toHaveLength(3);
  });

  it("is imported from W1 rather than rebuilt", () => {
    const detail = readFileSync(path.resolve(moduleDir, "../../components/case-detail.tsx"), "utf8");
    expect(detail).toMatch(/from "@\/components\/checkpoint-track"/);
    // One component, two contexts — the Watch drawer is the other.
    const row = readFileSync(path.resolve(moduleDir, "../../components/watch-row.tsx"), "utf8");
    expect(row).toMatch(/from "@\/components\/checkpoint-track"/);
  });
});
