import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  applyAction,
  byWorstMeasured,
  markFixed,
  start,
  type IssueCase,
  type IssueState,
} from "../issue-case";
import { FIX_GROUPS, FIX_QUEUE_NOTE, OWNER_AMBER_DAYS, fixOwnerMeta, fixTodoMeta, startedLongAgo } from "../fix-copy";
import { ticketMarkdown } from "../fix-ticket";
import { EFFORT_LABEL, NOT_MEASURED, formatCaseImpact } from "../impact-format";
import {
  DISMISS_REASONS,
  ISSUE_TRANSITIONS,
  WORK_STATE_LABEL,
  type IssueAction,
  type TransitionActor,
} from "../vocabulary";
import { UNKNOWN_USER, attributionOf, type Caller } from "../caller";
import { casePath } from "../paths";

/**
 * S5 — the fix queue, and the two fields the start transition writes.
 *
 * Registry rule 21: these assert the decision rather than the code. Where the
 * registry states a fact — the fix queue's two states and their order, their
 * labels — the assertion reads it off `vocabulary.json`, so a change to the
 * decided vocabulary that this chunk has not been brought in line with fails
 * here rather than shipping. Where the decision is S5's own, the assertion
 * checks the two halves of it against each other: the thirty in the sentence the
 * reader is shown against the thirty the predicate actually turns on, and the
 * ticket's saving against the one the case renders.
 *
 * Asserting the locked strings against themselves is deliberately not done. A
 * literal here and the same literal in `fix-copy.ts` is a mirror against a
 * mirror — it proves the two copies agree and never that either is right.
 */

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const srcDir = path.resolve(moduleDir, "../..");
const registry = JSON.parse(
  readFileSync(path.resolve(moduleDir, "../../../vocabulary.json"), "utf8"),
) as {
  concepts: {
    queue: { values: { key: string; holds: string[] }[] };
    work_state: { values: { key: string; label: string }[] };
    action: { values: { key: string; from: string[]; to: string }[] }
  };
};

const registryActions = registry.concepts.action.values;
const registryFixHolds = registry.concepts.queue.values.find((value) => value.key === "fix")!.holds;

/** Every source file under `src/`, so a new writer cannot arrive unnoticed. */
function sourceFiles(): string[] {
  const found: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== "__tests__") walk(full);
      } else if (/\.tsx?$/.test(entry.name)) {
        found.push(full);
      }
    }
  };
  walk(srcDir);
  return found;
}

/** Files under `src/` whose text matches, named relative to `src/`. */
function filesMatching(pattern: RegExp): string[] {
  return sourceFiles()
    .filter((file) => pattern.test(readFileSync(file, "utf8")))
    .map((file) => path.relative(srcDir, file).replace(/\\/g, "/"))
    .sort();
}

/**
 * The files that could write to a case at all — the module itself and everything
 * that imports from it.
 *
 * The narrowing matters. `startedAt` is an ordinary field name elsewhere in the
 * app: collection jobs have one, so do runs and projects, and a scan of every
 * file would be answering a different question loudly enough to be turned off.
 * Nothing can write a case's field without reaching the case, and nothing
 * reaches the case without importing from here.
 */
function caseWriters(pattern: RegExp): string[] {
  const imports = /from "(?:\.\/|\.\.\/|@\/lib\/)issue-case"/;
  return sourceFiles()
    .filter((file) => {
      const text = readFileSync(file, "utf8");
      if (!imports.test(text) && !/lib[\\/]issue-case\.ts$/.test(file)) return false;
      return pattern.test(text);
    })
    .map((file) => path.relative(srcDir, file).replace(/\\/g, "/"))
    .sort();
}

const DAY_MS = 86_400_000;
const NOW = new Date("2026-08-26T12:00:00.000Z");
const daysBefore = (days: number) => new Date(NOW.getTime() - days * DAY_MS).toISOString();

/** A person's id in this app is their account email (F4's `Caller`). */
const GRACE: Caller = { kind: "person", userId: "grace@example.com" };
const ADA: Caller = { kind: "person", userId: "ada@example.com" };

/**
 * A caller of a given class, for driving a transition this test does not care
 * about the identity of.
 *
 * Keyed on the class rather than asking whether a permission set contains one.
 * F4's guard forbids testing `transition.actor` against anything but a caller's
 * `kind`, and that is the right shape here too: the permission set names a
 * class this transition allows, and this builds a caller of it.
 */
function callerOfKind(kind: TransitionActor): Caller {
  return kind === "person"
    ? { kind: "person", userId: "someone-else@example.com" }
    : { kind: "system", agent: "checkpoint" };
}

function makeCase(overrides: Partial<IssueCase> = {}): IssueCase {
  return {
    id: "PW-2291",
    cause: "fonts.example.com:font-display",
    state: "todo",
    title: "Ensure text remains visible during webfont load",
    diagnosis: "Body text is invisible for a second while the webfont loads.",
    detectedAt: daysBefore(40),
    confirmedRuns: 3,
    scope: "pages",
    pageIds: ["p1", "p2"],
    strategies: ["mobile"],
    impactMs: 1900,
    effort: "hours",
    confidence: "confirmed",
    remediation: { steps: ["Add font-display: swap.", "Preload the two weights in use."], actionability: "direct" },
    successCriteria: "Text paints with the fallback within 100 ms.",
    checkpoints: [],
    evidence: [],
    history: [{ at: daysBefore(35), from: "new", to: "todo", by: ADA }],
    ...overrides,
  };
}

/* ── The two fields, and the one transition that writes them ────────────── */

describe("S5 — start is what assigns a case", () => {
  it("stamps the owner and the start date, from the transition that moved it", () => {
    const at = daysBefore(3);
    const started = start(makeCase(), { by: GRACE, at });

    expect(started.state).toBe("in_progress");
    expect(started.owner).toBe(attributionOf(GRACE));
    expect(started.startedAt).toBe(at);
    // The stamp and the history entry are one fact recorded once: the same
    // instant, and the same identity the history column renders. Nothing can
    // show one date for "started" and another for the move that started it, or
    // name one owner in the queue and another in the history.
    expect(started.history.at(-1)!.at).toBe(started.startedAt);
    expect(attributionOf(started.history.at(-1)!.by)).toBe(started.owner);
  });

  it("leaves the owner absent where F4 declines to name one", () => {
    // A migrated person caller recorded the class and threw the identity away.
    // `attributionOf` withholds it, so the stamp withholds it too — a sentinel
    // in an owner field would render as a person nobody can find (rule 18).
    const migrated = start(makeCase(), { by: { kind: "person", userId: UNKNOWN_USER }, at: daysBefore(3) });
    expect(migrated.owner).toBeUndefined();
    // The date is still a fact and is still recorded. Not knowing who started
    // it is not the same as not knowing when.
    expect(migrated.startedAt).toBe(daysBefore(3));
  });

  it("is the only transition that writes either field", () => {
    const owned = makeCase({ owner: attributionOf(GRACE)!, startedAt: daysBefore(3) });

    for (const action of registryActions) {
      if (action.key === "start") continue;
      for (const from of action.from as IssueState[]) {
        const before: IssueCase = {
          ...owned,
          state: from,
          // `resolve` requires checkpoint agreement, and `dismiss` a reason;
          // supply both so every registry transition is genuinely exercised.
          checkpoints: [{ interval: "30d", result: "agreed" }],
        };
        // F4 validates the caller's CLASS, so a system-only transition has to
        // be offered a system caller or it is refused before it can prove
        // anything about the owner fields. The class is taken from the
        // registry's own permission set, so `resolve` is exercised rather than
        // skipped and no class is assumed here.
        const [permitted] = ISSUE_TRANSITIONS[action.key as IssueAction].actor;
        const after = applyAction(before, action.key as IssueAction, {
          by: callerOfKind(permitted),
          at: daysBefore(1),
          // The registry's own first reason, not a hand-written one — a literal
          // here would fail for saying the wrong word rather than for the thing
          // this test is about.
          reason: DISMISS_REASONS[0],
        });
        expect(after.owner, `${action.key} from ${from} rewrote the owner`).toBe(owned.owner);
        expect(after.startedAt, `${action.key} from ${from} rewrote the start date`).toBe(owned.startedAt);
      }
    }
  });

  it("cannot be fired twice, so the stamp is never overwritten", () => {
    // The registry's guarantee, not this module's: `start` is legal only from
    // `todo`, and a started case is `in_progress`.
    const startAction = registryActions.find((action) => action.key === "start")!;
    expect(startAction.from).toEqual(["todo"]);
    expect(startAction.to).toBe("in_progress");
    expect(startAction.from).not.toContain(startAction.to);
  });

  it("keeps both fields out of every hand but the transition's", () => {
    // A field a screen can set is a field that drifts from its history entry.
    // Any new file that writes either name shows up here as a failure and has to
    // justify itself, which is the mechanism rule 20 asks for.
    expect(caseWriters(/\bstartedAt\b/)).toEqual([
      "components/fix-row.tsx",
      "lib/fix-copy.ts",
      "lib/issue-case.ts",
    ]);
    // `owner:` and `owner =` are the assignment shapes; `issue.owner` is a read
    // and prose about ownership is neither, so neither is matched. Exactly one
    // file assigns it, and that file assigns it in exactly one place.
    expect(caseWriters(/\bowner\s*[:=][^=]/)).toEqual(["lib/issue-case.ts"]);
  });

  it("carries free-text notes and neither a checklist nor a due date", () => {
    const withNote = makeCase({ notes: "Ping the brand team about the fallback stack." });
    expect(withNote.notes).toBe("Ping the brand team about the fallback stack.");
    // The two shapes S5 deletes. A note has no schema; the moment it grows
    // required fields it is a task object with a different name.
    expect(filesMatching(/\bchecklist\b/)).toEqual([]);
    expect(filesMatching(/\bdueDate\b|\bdue_date\b/)).toEqual([]);
  });
});

/* ── The one nudge ──────────────────────────────────────────────────────── */

describe("S5 — the started date is the only nudge", () => {
  it("turns amber at the threshold the reader was promised", () => {
    // The two halves of one decision: the number in the sentence shown to the
    // reader, and the number the predicate turns on. Neither is asserted against
    // a literal, so they can only pass by agreeing with each other.
    expect(FIX_QUEUE_NOTE).toContain(`${OWNER_AMBER_DAYS} days`);
    expect(startedLongAgo(daysBefore(OWNER_AMBER_DAYS - 1), NOW)).toBe(false);
    expect(startedLongAgo(daysBefore(OWNER_AMBER_DAYS), NOW)).toBe(true);
    expect(startedLongAgo(daysBefore(OWNER_AMBER_DAYS + 1), NOW)).toBe(true);
  });

  it("has no second threshold behind it", () => {
    // A case that has been open for three months looks exactly like one that has
    // been open for thirty days. Nothing escalates, so the predicate changes
    // value exactly once across the whole range — a second nudge would be a
    // second flip, whatever it was called.
    const readings = Array.from({ length: 180 }, (_, day) => startedLongAgo(daysBefore(day), NOW));
    const flips = readings.filter((value, index) => index > 0 && value !== readings[index - 1]);
    expect(flips).toHaveLength(1);
    // And the state it settles into is amber, not something further along.
    expect(readings.at(-1)).toBe(true);
  });

  it("does not call an unowned case stale", () => {
    // Absent is not overdue. A case with no start date is unowned, which the row
    // says in its own words rather than by turning a date it does not have amber.
    expect(startedLongAgo(undefined, NOW)).toBe(false);
  });
});

/* ── The queue ──────────────────────────────────────────────────────────── */

describe("S5 — the fix queue", () => {
  it("groups To do above In progress, in the registry's own order", () => {
    expect(FIX_GROUPS).toEqual(registryFixHolds);
    expect(FIX_GROUPS[0]).toBe("todo");
    expect(FIX_GROUPS[1]).toBe("in_progress");
    expect(FIX_GROUPS).toHaveLength(2);
  });

  it("heads each group with the registry's word for the state", () => {
    for (const state of FIX_GROUPS) {
      const declared = registry.concepts.work_state.values.find((value) => value.key === state)!;
      expect(WORK_STATE_LABEL[state]).toBe(declared.label);
    }
  });

  it("orders each group by impact, with unmeasured findings last", () => {
    const cases = [
      makeCase({ id: "unmeasured", impactMs: 0 }),
      makeCase({ id: "small", impactMs: 400 }),
      makeCase({ id: "worst", impactMs: 2600 }),
    ];
    // Rule 18: the unmeasured one is moved as a block rather than sorted by its
    // zero, so it cannot outrank a 400 ms finding on an empty reading.
    expect([...cases].sort(byWorstMeasured).map((item) => item.id)).toEqual(["worst", "small", "unmeasured"]);
  });

  it("says a different thing on each group's rows", () => {
    const accepted = daysBefore(2);
    const todo = fixTodoMeta(4, accepted, "hours", NOW);
    expect(todo).toBe(`4 pages · accepted 2 days ago · ${EFFORT_LABEL.hours}`);
    expect(fixTodoMeta(1, accepted, "hours", NOW)).toContain("1 page ·");

    const owner = fixOwnerMeta("Grace Hopper", daysBefore(1), NOW);
    expect(owner).toBe("Grace Hopper · started yesterday");
    // The owner line carries no accepted date and no effort: the question on an
    // In progress row is who has it, not what it would cost to pick up.
    expect(owner).not.toContain("accepted");
    expect(owner).not.toContain(EFFORT_LABEL.hours);
  });
});

/* ── Copy as ticket ─────────────────────────────────────────────────────── */

describe("S5 — copy as ticket", () => {
  const pageTitles = { p1: "Home", p2: "Pricing" };

  it("carries the diagnosis, the pages, the remediation, the impact, the effort and the link", () => {
    const issue = makeCase();
    const ticket = ticketMarkdown(issue, { pageTitles });

    expect(ticket).toContain(issue.diagnosis);
    expect(ticket).toContain("- Home");
    expect(ticket).toContain("- Pricing");
    expect(ticket).toContain("1. Add font-display: swap.");
    expect(ticket).toContain("2. Preload the two weights in use.");
    expect(ticket).toContain(EFFORT_LABEL.hours);
    expect(ticket).toContain(casePath(issue.id));
  });

  it("links to /issues/{id} and to no other shape of address", () => {
    const ticket = ticketMarkdown(makeCase(), { pageTitles });
    expect(ticket).toContain("/issues/PW-2291");
    // The id is the whole address. There is no `/issues/case/` route, and a
    // ticket outlives the person who filed it.
    expect(ticket).not.toContain("/issues/case/");
    expect(ticket).not.toContain("?queue=");
  });

  it("keeps the origin when it has one, so the link resolves from outside the app", () => {
    const ticket = ticketMarkdown(makeCase(), { pageTitles, appUrl: "https://watch.example.com/app" });
    expect(ticket).toContain("https://watch.example.com/app/issues/PW-2291");
  });

  it("states the impact the case states, to the byte", () => {
    const issue = makeCase();
    const impactByPage = { p1: 2600, p2: 900 };
    // The figure the case detail renders, from the call the case detail makes.
    // Not a second derivation that happens to agree — the same one.
    const onScreen = formatCaseImpact(issue, impactByPage);
    expect(onScreen.text).toBe("2.6 s");
    expect(ticketMarkdown(issue, { pageTitles, impactByPage })).toContain(onScreen.text);

    // Both readers reach the figure through the one function, which is what
    // makes the agreement above structural rather than coincidental.
    for (const reader of ["lib/fix-ticket.ts", "components/case-detail.tsx"]) {
      expect(readFileSync(path.join(srcDir, reader), "utf8")).toContain("formatCaseImpact");
    }
  });

  it("says Not measured for an unmeasured finding, and never 0", () => {
    const issue = makeCase({ impactMs: 0 });
    const ticket = ticketMarkdown(issue, { pageTitles });

    // Rule 18. An absent measurement is not a small one, and a ticket reading
    // "0 ms" would be read by a stranger as a finding worth nothing.
    expect(ticket).toContain(NOT_MEASURED);
    expect(ticket).toBe(ticketMarkdown(issue, { pageTitles, impactByPage: {} }));
    expect(ticket).not.toMatch(/\b0\s*(ms|s)\b/);
    expect(ticket).not.toMatch(/:\s*0\s*$/m);
  });

  it("offers no tracker integration to disagree with the case", () => {
    // The whole point of markdown on a clipboard: it holds no state, so it
    // cannot drift from the case it was taken from. An integration would be a
    // second home for the work's state, which is the defect the case object was
    // built to remove, re-created where nobody can reconcile it.
    //
    // Asserted as "this path talks to nothing" rather than as a list of vendor
    // names, because the next tracker is not on the list.
    for (const file of ["lib/fix-ticket.ts", "components/copy-ticket-button.tsx"]) {
      const text = readFileSync(path.join(srcDir, file), "utf8");
      expect(text, `${file} reaches the network`).not.toMatch(/\bfetch\s*\(|XMLHttpRequest|\bapi\//);
    }
  });
});

/* ── The hand-off, and what S5 deletes ──────────────────────────────────── */

describe("S5 — marking fixed hands off to the checkpoints", () => {
  it("schedules W1's checks rather than a verification target", () => {
    const at = daysBefore(0);
    const fixed = markFixed(start(makeCase(), { by: GRACE, at: daysBefore(5) }), { by: GRACE, at });

    expect(fixed.state).toBe("fixed");
    expect(fixed.checkpoints.map((checkpoint) => checkpoint.interval)).toEqual(["2d", "7d", "30d"]);
    expect(fixed.checkpoints.every((checkpoint) => checkpoint.result === "scheduled")).toBe(true);
    // The owner and the start date survive the fix. Who did it and when they
    // began are facts about what happened, not a status that expires.
    expect(fixed.owner).toBe(attributionOf(GRACE));
    expect(fixed.startedAt).toBe(daysBefore(5));
  });

  it("has no standalone verification endpoint left to call", () => {
    expect(filesMatching(/agent-audits\/verify|requestAgentAuditVerify/)).toEqual([]);
  });
});

describe("S5 — what the fix queue replaces", () => {
  it("leaves no task UI — only the retired redirect may keep the name", () => {
    // S10 restored /tasks as a redirect so old links stop 404ing. That file is
    // allowed; anything else named task would be a second destination.
    const named = sourceFiles()
      .map((file) => path.relative(srcDir, file).replace(/\\/g, "/"))
      .filter((file) => /(^|\/)tasks?(\/|\.|-)/i.test(file))
      .filter((file) => file !== "app/(app)/tasks/page.tsx");
    expect(named).toEqual([]);
    const redirect = readFileSync(path.join(srcDir, "app/(app)/tasks/page.tsx"), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    expect(redirect).toContain("DESTINATION_PATH.issues");
    expect(redirect).toContain("redirect(");
  });

  it("leaves no add-to-tasks affordance", () => {
    expect(filesMatching(/Add to tasks|Add workaround to tasks/i)).toEqual([]);
  });

  it("introduces no plan or batch object with a state of its own", () => {
    // Considered and dropped: a plan spanning three cases needs a state of its
    // own, and that state disagrees with its cases' states inside a week. Batch
    // work is a saved filter over cases, which has nothing to disagree with.
    expect(filesMatching(/\b(interface|type|class)\s+(Fix)?(Plan|Batch)\b/)).toEqual([]);
  });
});
