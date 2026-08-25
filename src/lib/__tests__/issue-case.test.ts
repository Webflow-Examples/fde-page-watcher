import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  ISSUE_STATES,
  IssueCaseError,
  accept,
  actionabilityFrom,
  actionsFor,
  appendEvidence,
  applyAction,
  checkpointsAgree,
  confidenceFrom,
  dismiss,
  excludePage,
  EVIDENCE_SOURCE,
  EVIDENCE_SOURCE_FOR_AGENT_SYSTEM,
  fromAgentIssue,
  fromRec,
  groupByCause,
  groupByRemediation,
  markFixed,
  parseEffort,
  parseImpactMs,
  queueOf,
  recStatusOf,
  scheduleCheckpoints,
  reopenForPages,
  taskStatusOf,
  type EvidenceEntry,
  type IssueCase,
  type IssueState,
} from "../issue-case";
import { COUNTED_QUEUES, DISMISS_REASONS, EVIDENCE_SOURCES, QUEUE_HOLDS, WORK_STATES, WORK_STATE_QUEUE, type IssueAction } from "../vocabulary";
import { taskStatusWorkState } from "../workState";
import type { AgentIssueCase } from "../agentIssueCases";
import type { Rec } from "../types";

/**
 * `vocabulary.json` is the source of truth for the lifecycle, so the transition
 * and queue tests below are checked against the registry itself rather than
 * against the module's own constants. A change to the decided vocabulary that
 * this module has not been brought in line with fails here.
 */
const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const registryPath = path.resolve(moduleDir, "../../../vocabulary.json");
const sourcePath = path.resolve(moduleDir, "../issue-case.ts");
const registry = JSON.parse(readFileSync(registryPath, "utf8"));
const source = readFileSync(sourcePath, "utf8");

interface RegistryAction { key: string; from: string[]; to: string; requires?: string }
const registryActions: RegistryAction[] = registry.concepts.action.values;

function makeRec(overrides: Partial<Rec> = {}): Rec {
  return {
    key: "p1:unused-javascript",
    pageId: "p1",
    pageTitle: "Home",
    url: "https://example.com/",
    id: "unused-javascript",
    source: "lighthouse",
    title: "Reduce unused JavaScript",
    category: "Performance",
    savings: "1.8 s",
    estTime: "2 days",
    status: "inbox",
    taskStatus: "todo",
    added: "2026-08-12",
    doneDate: null,
    ...overrides,
  };
}

function makeCase(overrides: Partial<IssueCase> = {}): IssueCase {
  return {
    ...fromRec(makeRec(), { at: "2026-08-20T00:00:00.000Z" }),
    remediation: { steps: ["Remove the unused bundle."], actionability: "direct" },
    ...overrides,
  };
}

const AT = "2026-08-24T12:00:00.000Z";

/**
 * A case set up so the registry's stated requirement for `action` is met.
 *
 * Read off `action.requires` rather than branching on the action's name, so a
 * requirement added to `vocabulary.json` arrives here as a missing arm rather
 * than as a silently-satisfied one.
 */
function satisfying(action: RegistryAction, issue: IssueCase): IssueCase {
  if (action.requires !== "checkpoint_agreement") return issue;
  return { ...issue, checkpoints: [{ interval: "30d", result: "agreed" }] };
}

/* ── AC1 — one lifecycle field, union imported ──────────────────────────── */

describe("the canonical case", () => {
  it("uses the registry's states rather than a second list", () => {
    const fromRegistry = registry.concepts.work_state.values.map((value: { key: string }) => value.key);
    expect([...ISSUE_STATES]).toEqual(fromRegistry);
    expect([...ISSUE_STATES]).toEqual([...WORK_STATES]);
  });

  it("declares no state union of its own", () => {
    // A redeclared union would be the four lifecycles starting over.
    expect(source).not.toMatch(/type\s+IssueState\s*=\s*["']/);
    expect(source).toMatch(/export type IssueState = WorkState;/);
  });

  it("carries exactly one lifecycle field", () => {
    const issue = makeCase();
    const lifecycleFields = Object.keys(issue).filter((key) => /status|lifecycle|state/i.test(key));
    expect(lifecycleFields).toEqual(["state"]);
  });
});

/* ── AC2 — queueOf is total and single-valued ───────────────────────────── */

describe("queue membership", () => {
  it("maps every state to exactly one queue", () => {
    for (const state of ISSUE_STATES) {
      const holders = COUNTED_QUEUES.filter((queue) => QUEUE_HOLDS[queue].includes(state));
      expect(holders.length, `${state} is held by ${holders.length} counted queues`).toBeLessThanOrEqual(1);
      expect(queueOf(state)).toBeDefined();
    }
  });

  it("never maps a state to two queues", () => {
    const seen = new Map<IssueState, string>();
    for (const state of ISSUE_STATES) {
      const queue = queueOf(state);
      expect(seen.has(state)).toBe(false);
      seen.set(state, queue);
    }
    expect(seen.size).toBe(ISSUE_STATES.length);
  });

  it("agrees with the registry about which queue holds what", () => {
    for (const queue of registry.concepts.queue.values) {
      if (queue.holds === "*") continue;
      for (const state of queue.holds as IssueState[]) {
        expect(queueOf(state)).toBe(queue.key);
      }
    }
    for (const state of ISSUE_STATES) expect(queueOf(state)).toBe(WORK_STATE_QUEUE[state]);
  });

  it("sends the states no counted queue claims to the unfiltered view", () => {
    expect(queueOf("resolved")).toBe("show_all");
    expect(queueOf("dismissed")).toBe("show_all");
  });
});

/* ── AC4 — impact is a number, effort is a band ─────────────────────────── */

describe("impact and effort parsers", () => {
  it("reads milliseconds out of every savings format in the fixtures", () => {
    expect(parseImpactMs("1.8 s")).toBe(1800);
    expect(parseImpactMs("1.5 s")).toBe(1500);
    expect(parseImpactMs("0.6 s")).toBe(600);
    expect(parseImpactMs("1.0 s")).toBe(1000);
    expect(parseImpactMs("Field p75 620 ms")).toBe(620);
    expect(parseImpactMs("Field p75 4.8 s")).toBe(4800);
  });

  it("returns zero for a savings label that is not a time", () => {
    for (const label of ["Observed", "Detected", "Field signal", "Essential", "Agent access", "180 KB", "", undefined]) {
      expect(parseImpactMs(label as string | undefined)).toBe(0);
    }
  });

  it("reads a band out of every estTime format in the fixtures", () => {
    expect(parseEffort("2 days")).toBe("days");
    expect(parseEffort("1 day")).toBe("days");
    expect(parseEffort("3 hours")).toBe("hours");
    expect(parseEffort("2 hours")).toBe("hours");
    expect(parseEffort("30 minutes")).toBe("minutes");
    expect(parseEffort("Needs review")).toBe("unknown");
    expect(parseEffort("No direct action")).toBe("unknown");
    expect(parseEffort(undefined)).toBe("unknown");
  });

  it("stores numbers and bands on the case, never display strings", () => {
    const issue = fromRec(makeRec({ savings: "1.8 s", estTime: "2 days" }));
    expect(issue.impactMs).toBe(1800);
    expect(typeof issue.impactMs).toBe("number");
    expect(issue.effort).toBe("days");
    // The stored display strings survive only as the source's own words in the
    // ledger, never as the impact or effort the app reasons with.
    expect(JSON.stringify({ impactMs: issue.impactMs, effort: issue.effort })).not.toContain("1.8 s");
    expect(issue).not.toHaveProperty("savings");
    expect(issue).not.toHaveProperty("estTime");
  });

  it("maps the stored actionability onto the case's four dispositions", () => {
    expect(actionabilityFrom("direct")).toBe("direct");
    expect(actionabilityFrom("workaround")).toBe("workaround");
    // Written only where the platform owns the audit on a Webflow page.
    expect(actionabilityFrom("none")).toBe("platform");
    // No documented customer remediation exists, so there is nothing to accept.
    expect(actionabilityFrom("review")).toBe("none");
    expect(actionabilityFrom(undefined)).toBe("none");
  });
});

/* ── AC5, AC9 — confidence from the ledger, never a composite ───────────── */

function entry(overrides: Partial<EvidenceEntry> = {}): EvidenceEntry {
  return { source: "lighthouse", reading: "Reduce unused JavaScript — 1.8 s", observedAt: "2026-08-20T00:00:00.000Z", supports: true, ...overrides };
}

describe("confidence", () => {
  it("is confirmed when two or more sources support the diagnosis", () => {
    expect(confidenceFrom([entry(), entry({ source: "crux" })])).toBe("confirmed");
    expect(confidenceFrom([entry(), entry({ source: "crux" }), entry({ source: "kitesurf" })])).toBe("confirmed");
  });

  it("is probable when exactly one source supports it", () => {
    expect(confidenceFrom([entry()])).toBe("probable");
  });

  it("is unclear when sources disagree", () => {
    expect(confidenceFrom([entry(), entry({ source: "crux", supports: false })])).toBe("unclear");
    // Disagreement is not outvoted: three against one is still a disagreement.
    expect(confidenceFrom([
      entry(),
      entry({ source: "crux" }),
      entry({ source: "kitesurf" }),
      entry({ source: "ora", supports: false }),
    ])).toBe("unclear");
  });

  it("is unclear when the only reading could not determine anything", () => {
    expect(confidenceFrom([entry({ source: "ora", reading: "Provider unreachable", supports: false })])).toBe("unclear");
    expect(confidenceFrom([])).toBe("unclear");
  });

  it("never averages, sums, or composites two sources into one number", () => {
    // The guard is behavioural and textual: confidence is a count of agreement,
    // and nothing in the module divides or sums across the ledger.
    expect(source).not.toMatch(/evidence\.(length|reduce)\s*[)\]]?\s*[+/*]/);
    expect(source).not.toMatch(/[+/]\s*(evidence|sources)\.length/);
    expect(source).not.toMatch(/\.reduce\([^)]*\+\s*/);
    const mixed = [entry({ observedAt: "2026-08-01T00:00:00.000Z" }), entry({ source: "crux", observedAt: "2026-08-20T00:00:00.000Z" })];
    // Each reading keeps its own timestamp and wording; nothing is merged.
    expect(mixed.map((item) => item.observedAt)).toEqual(["2026-08-01T00:00:00.000Z", "2026-08-20T00:00:00.000Z"]);
    expect(confidenceFrom(mixed)).toBe("confirmed");
  });
});

describe("the evidence ledger", () => {
  it("appends without touching what is already there", () => {
    const issue = makeCase();
    const before = issue.evidence;
    const after = appendEvidence(issue, entry({ source: "crux", observedAt: "2026-08-22T00:00:00.000Z" }));
    expect(after.evidence).toHaveLength(before.length + 1);
    expect(after.evidence.slice(0, before.length)).toEqual(before);
    // The original case is untouched, so no reader sees a ledger change under it.
    expect(issue.evidence).toBe(before);
    expect(issue.evidence).toHaveLength(1);
  });

  it("keeps one entry per source", () => {
    const issue = makeCase();
    expect(() => appendEvidence(issue, entry({ source: "lighthouse" }))).toThrow(IssueCaseError);
  });

  it("gives every entry its own observedAt", () => {
    const issue = appendEvidence(makeCase(), entry({ source: "kitesurf", observedAt: "2026-08-23T09:00:00.000Z" }));
    expect(issue.evidence.map((item) => item.observedAt)).toEqual([
      "2026-08-12T00:00:00.000Z",
      "2026-08-23T09:00:00.000Z",
    ]);
    expect(new Set(issue.evidence.map((item) => item.source)).size).toBe(issue.evidence.length);
  });

  it("recomputes confidence from the whole ledger", () => {
    const issue = makeCase();
    expect(issue.confidence).toBe("probable");
    expect(appendEvidence(issue, entry({ source: "crux" })).confidence).toBe("confirmed");
  });
});

/* ── AC7 — the registry's transition table, enforced ────────────────────── */

describe("transitions", () => {
  it("offers exactly the actions the registry allows from each state", () => {
    for (const state of ISSUE_STATES) {
      const expected = registryActions
        .filter((action) => action.from.includes(state))
        .map((action) => action.key);
      expect(actionsFor(state).sort()).toEqual(expected.sort());
    }
  });

  it("throws on every transition the registry does not name", () => {
    const legal = new Set(registryActions.flatMap((action) => action.from.map((from) => `${from}:${action.key}`)));
    for (const state of ISSUE_STATES) {
      for (const action of registryActions) {
        const issue = satisfying(action, makeCase({ state }));
        const options = { actor: "matthew", at: AT, reason: DISMISS_REASONS[0] };
        if (legal.has(`${state}:${action.key}`)) {
          expect(() => applyAction(issue, action.key as IssueAction, options)).not.toThrow();
        } else {
          expect(() => applyAction(issue, action.key as IssueAction, options)).toThrow(IssueCaseError);
        }
      }
    }
  });

  it("lands on the state the registry names", () => {
    for (const action of registryActions) {
      for (const from of action.from) {
        const moved = applyAction(satisfying(action, makeCase({ state: from as IssueState })), action.key as IssueAction, {
          actor: "matthew",
          at: AT,
          reason: DISMISS_REASONS[0],
        });
        expect(moved.state).toBe(action.to);
      }
    }
  });

  it("appends every move to history and never rewrites it", () => {
    const accepted = accept(makeCase({ state: "new", history: [] }), { actor: "matthew", at: AT });
    const started = applyAction(accepted, "start", { actor: "matthew", at: AT });
    expect(started.history).toEqual([
      { at: AT, from: "new", to: "todo", actor: "matthew" },
      { at: AT, from: "todo", to: "in_progress", actor: "matthew" },
    ]);
    expect(accepted.history).toHaveLength(1);
  });

  it("schedules the checks that settle a fixed case", () => {
    const fixed = markFixed(makeCase({ state: "in_progress" }), { actor: "matthew", at: AT });
    expect(fixed.checkpoints.map((item) => item.interval)).toEqual(["2d", "7d", "30d"]);
    expect(fixed.checkpoints.every((item) => item.result === "scheduled")).toBe(true);
    expect(fixed.checkpoints[0].due).toBe("2026-08-26T12:00:00.000Z");
  });
});

/* ── AC6 — no commitment without a plan, no dismissal without a reason ──── */

describe("guards", () => {
  it("refuses to accept a case with no remediation steps", () => {
    const issue = makeCase({ state: "new", remediation: { steps: [], actionability: "none" } });
    expect(() => accept(issue, { actor: "matthew", at: AT })).toThrow(IssueCaseError);
    expect(() => accept(issue, { actor: "matthew", at: AT })).toThrow(/no remediation steps/);
  });

  it("closes every path to the fix queue for a case with no steps", () => {
    // Accept is the only way in, per the registry, so guarding it is sufficient.
    const waysToTodo = registryActions.filter((action) => action.to === "todo").map((action) => action.key);
    expect(waysToTodo).toEqual(["accept"]);

    const stepless = makeCase({ remediation: { steps: [], actionability: "none" } });
    for (const state of ISSUE_STATES) {
      for (const action of registryActions) {
        try {
          const moved = applyAction({ ...stepless, state }, action.key as IssueAction, {
            actor: "matthew",
            at: AT,
            reason: DISMISS_REASONS[0],
          });
          expect(moved.state).not.toBe("todo");
        } catch (error) {
          expect(error).toBeInstanceOf(IssueCaseError);
        }
      }
    }
  });

  it("refuses to dismiss without a reason the registry blesses", () => {
    const issue = makeCase({ state: "new" });
    expect(() => dismiss(issue, { actor: "matthew", at: AT, reason: "" })).toThrow(IssueCaseError);
    expect(() => dismiss(issue, { actor: "matthew", at: AT, reason: "Because I said so" })).toThrow(IssueCaseError);
    expect(() => applyAction(issue, "dismiss", { actor: "matthew", at: AT })).toThrow(/Not applicable/);
  });

  it("records the dismissal reason in history", () => {
    for (const reason of DISMISS_REASONS) {
      const dismissed = dismiss(makeCase({ state: "new", history: [] }), { actor: "matthew", at: AT, reason });
      expect(dismissed.state).toBe("dismissed");
      expect(dismissed.history.at(-1)).toEqual({ at: AT, from: "new", to: "dismissed", actor: "matthew", reason });
    }
  });

  /**
   * The registry states this requirement twice — `action.resolve.requires` is
   * `checkpoint_agreement`, and `checkpoint.evaluation` says what agreement is.
   * Until R1, `ISSUE_TRANSITIONS.resolve.requires` carried the word and
   * `applyAction` enforced only the reason guard, so a case could reach
   * Resolved with three checkpoints still scheduled.
   *
   * These assert the registry's sentences, not the predicate's code.
   */
  describe("checkpoint agreement — the requirement resolve states", () => {
    const RESOLVE = registryActions.find((action) => action.key === "resolve")!;
    const evaluation: string[] = registry.concepts.checkpoint.evaluation;
    const fixedWith = (checkpoints: IssueCase["checkpoints"]) =>
      makeCase({ state: "fixed", checkpoints });
    const resolving = (issue: IssueCase) =>
      applyAction(issue, "resolve", { actor: "checkpoint", at: AT });

    it("is a requirement the registry actually states", () => {
      expect(RESOLVE.requires).toBe("checkpoint_agreement");
      expect(evaluation.length).toBeGreaterThan(0);
    });

    it("refuses a case whose checkpoints have not reported", () => {
      expect(() => resolving(fixedWith(scheduleCheckpoints(AT)))).toThrow(IssueCaseError);
      expect(() => resolving(fixedWith([]))).toThrow(/checkpoint agreement/);
    });

    it("resolves once the last checkpoint agreed", () => {
      // Evaluation rule 3: the 30-day checkpoint fires resolve when every
      // checkpoint that produced a reading agreed.
      const agreed = fixedWith([
        { interval: "2d", result: "agreed" },
        { interval: "7d", result: "agreed" },
        { interval: "30d", result: "agreed" },
      ]);
      expect(resolving(agreed).state).toBe("resolved");
    });

    it("skips unavailable readings rather than counting them against", () => {
      // Evaluation rule 3, second sentence.
      const patchy = fixedWith([
        { interval: "2d", result: "unavailable" },
        { interval: "7d", result: "unavailable" },
        { interval: "30d", result: "agreed" },
      ]);
      expect(resolving(patchy).state).toBe("resolved");
    });

    it("does not resolve on three unavailable readings", () => {
      // Evaluation rule 4: the case stays Fixed and says no check could be taken.
      const dark = fixedWith([
        { interval: "2d", result: "unavailable" },
        { interval: "7d", result: "unavailable" },
        { interval: "30d", result: "unavailable" },
      ]);
      expect(() => resolving(dark)).toThrow(IssueCaseError);
      expect(checkpointsAgree(dark.checkpoints)).toBe(false);
    });

    it("never resolves on the 2 and 7-day checkpoints alone", () => {
      // Evaluation rule 5: holding takes the full span.
      const early = fixedWith([
        { interval: "2d", result: "agreed" },
        { interval: "7d", result: "agreed" },
        { interval: "30d", result: "scheduled" },
      ]);
      expect(() => resolving(early)).toThrow(IssueCaseError);
    });

    it("never resolves when a checkpoint disagreed", () => {
      // Evaluation rule 1: a disagreement fires reopen, not resolve.
      const disagreed = fixedWith([
        { interval: "2d", result: "disagreed" },
        { interval: "7d", result: "agreed" },
        { interval: "30d", result: "agreed" },
      ]);
      expect(() => resolving(disagreed)).toThrow(IssueCaseError);
      expect(applyAction(disagreed, "reopen", { actor: "checkpoint", at: AT }).state).toBe("reopened");
    });

    it("names the resolving checkpoint from the schedule, not from a literal", () => {
      // The schedule and the rule that reads it must name the same checkpoint.
      const intervals = scheduleCheckpoints(AT).map((checkpoint) => checkpoint.interval);
      const last = intervals.at(-1)!;
      expect(checkpointsAgree([{ interval: last, result: "agreed" }])).toBe(true);
      for (const earlier of intervals.slice(0, -1)) {
        expect(checkpointsAgree([{ interval: earlier, result: "agreed" }])).toBe(false);
      }
    });
  });

  it("takes its reasons from the registry, not from a local list", () => {
    expect([...DISMISS_REASONS]).toEqual(registry.concepts.work_state.values.find((value: { key: string }) => value.key === "dismissed").reasons);
  });
});

/* ── AC3 — the four old lifecycles collapse into one ────────────────────── */

describe("migrating a legacy recommendation", () => {
  it("maps every pairing the design names", () => {
    const at = AT;
    expect(fromRec(makeRec({ status: "inbox", taskStatus: "todo" }), { at }).state).toBe("new");
    expect(fromRec(makeRec({ status: "task", taskStatus: "todo" }), { at }).state).toBe("todo");
    expect(fromRec(makeRec({ status: "task", taskStatus: "in-progress" }), { at }).state).toBe("in_progress");
    expect(fromRec(makeRec({ status: "task", taskStatus: "done" }), { at }).state).toBe("resolved");
    expect(fromRec(makeRec({ status: "ignored", taskStatus: "todo" }), { at }).state).toBe("dismissed");
  });

  it("takes a settled or returned field lifecycle over the stored pair", () => {
    const field = (status: "resolved" | "regressed"): Partial<Rec> => ({
      source: "crux-field-only",
      fieldLifecycle: {
        mobile: {
          status,
          firstDetectedAt: "2026-08-01T00:00:00.000Z",
          lastDetectedAt: "2026-08-10T00:00:00.000Z",
          lastEvaluatedCollectionEnd: "2026-08-10",
          consecutiveGoodWindows: status === "resolved" ? 2 : 0,
        },
      },
    });
    expect(fromRec(makeRec(field("resolved")), { at: AT }).state).toBe("resolved");
    expect(fromRec(makeRec(field("regressed")), { at: AT }).state).toBe("reopened");
  });

  it("reopens when an agent verification came back", () => {
    const rec = makeRec({
      status: "task",
      taskStatus: "done",
      source: "agent-readiness",
      agentIssue: {
        caseKey: "agent-discoverability:robots",
        title: "Agent crawler policy is unclear",
        scope: "origin",
        capturedAt: "2026-08-10T00:00:00.000Z",
        remediation: ["Publish a robots.txt."],
        successCriteria: "robots.txt resolves.",
        verificationCheckIds: ["robots-ai-policy-quality"],
        verification: { status: "returned" },
      },
    });
    const issue = fromRec(rec, { at: AT });
    expect(issue.state).toBe("reopened");
    expect(issue.history.at(-1)?.actor).toBe("migration");
  });

  it("resolves a contradictory pair to the later state and writes the ambiguity down", () => {
    // Untriaged and finished at once — the pairing that proves the old model broke.
    const issue = fromRec(makeRec({ status: "inbox", taskStatus: "done" }), { at: AT });
    expect(issue.state).toBe("resolved");
    // Two entries: the pair disagreed, and the outcome is asserted not verified.
    expect(issue.history).toHaveLength(2);
    expect(issue.history[0]).toMatchObject({ at: AT, to: "resolved", actor: "migration" });
    expect(issue.history[0].reason).toMatch(/disagreed/);
  });

  it("migrates a contradictory record without throwing", () => {
    expect(() => fromRec(makeRec({ status: "inbox", taskStatus: "done" }))).not.toThrow();
    expect(() => fromRec(makeRec({ status: "inbox", taskStatus: "in-progress" }))).not.toThrow();
    expect(() => fromRec(makeRec({ status: "ignored", taskStatus: "done" }))).not.toThrow();
  });

  it("records that a migrated \"done\" carries no checkpoint evidence", () => {
    // Mapping legacy "done" onto Resolved was accepted only on the condition
    // that the missing verification is written into history. Resolved otherwise
    // claims "the evidence agreed and held", which nobody ever checked.
    const issue = fromRec(makeRec({ status: "task", taskStatus: "done" }), { at: AT });
    expect(issue.state).toBe("resolved");
    const caveat = issue.history.find((entry) => /no checkpoint evidence/i.test(entry.reason ?? ""));
    expect(caveat, "a migrated done must say the outcome is asserted, not verified").toBeDefined();
    expect(caveat).toMatchObject({ at: AT, to: "resolved", actor: "migration" });
    expect(issue.checkpoints).toEqual([]);
  });

  it("does not claim a missing checkpoint when the field lifecycle really settled", () => {
    // That path has evidence behind it, so it must not pick up the caveat.
    const issue = fromRec(makeRec({ status: "task", taskStatus: "todo" }), { at: AT });
    expect(issue.history.some((entry) => /no checkpoint evidence/i.test(entry.reason ?? ""))).toBe(false);
  });

  it("keeps a set-aside record set aside, and says so when work progress disagreed", () => {
    const issue = fromRec(makeRec({ status: "ignored", taskStatus: "done" }), { at: AT });
    expect(issue.state).toBe("dismissed");
    expect(issue.history[0]?.actor).toBe("migration");
  });

  it("leaves history empty when the old pair agreed", () => {
    expect(fromRec(makeRec({ status: "task", taskStatus: "in-progress" }), { at: AT }).history).toEqual([]);
  });

  it("never passes the audit title off as a diagnosis", () => {
    const issue = fromRec(makeRec({ title: "Reduce unused JavaScript" }), { at: AT });
    expect(issue.title).toBe("Reduce unused JavaScript");
    expect(issue.diagnosis).toBe("");
    const summarized = fromRec(makeRec({ aiSummary: "The page ships a bundle nobody runs." }), { at: AT });
    expect(summarized.diagnosis).toBe("The page ships a bundle nobody runs.");
  });

  it("reads the record's own timestamps, in whichever format it stored them", () => {
    expect(fromRec(makeRec({ added: "2026-08-12" }), { at: AT }).detectedAt).toBe("2026-08-12T00:00:00.000Z");
    expect(fromRec(makeRec({ added: "Jul 16" }), { at: AT, referenceYear: 2026 }).detectedAt).toBe("2026-07-16T00:00:00.000Z");
  });

  it("records one source reading in that source's own words", () => {
    const issue = fromRec(makeRec(), { at: AT });
    expect(issue.evidence).toHaveLength(1);
    expect(issue.evidence[0]).toMatchObject({ source: "lighthouse", supports: true });
    expect(issue.confidence).toBe("probable");
  });

  it("stops supporting the diagnosis once the field windows come good", () => {
    const resolved = fromRec(makeRec({
      source: "crux-field-only",
      savings: "Field p75 620 ms",
      fieldLifecycle: {
        mobile: {
          status: "resolved",
          firstDetectedAt: "2026-08-01T00:00:00.000Z",
          lastDetectedAt: "2026-08-10T00:00:00.000Z",
          lastEvaluatedCollectionEnd: "2026-08-10",
          consecutiveGoodWindows: 2,
        },
      },
    }), { at: AT });
    expect(resolved.evidence[0].source).toBe("crux");
    expect(resolved.evidence[0].supports).toBe(false);
    expect(resolved.confidence).toBe("unclear");
  });
});

describe("migrating an assembled agent-access issue", () => {
  const issue: AgentIssueCase = {
    key: "agent-discoverability:robots",
    title: "Agent crawler policy is unclear",
    consequence: "Agents read robots.txt before anything else.",
    scope: "origin",
    status: "failed",
    tier: "essential",
    confidence: "corroborated",
    sources: [
      { system: "page-watch", label: "robots.txt", result: "failed", scope: "page", observedAt: "2026-08-20T00:00:00.000Z" },
      { system: "kitesurf", label: "Rendered robots policy", result: "failed", scope: "page", observedAt: "2026-08-21T00:00:00.000Z" },
    ],
    remediation: ["Publish a robots.txt that names the AI user agents you intend to allow."],
    successCriteria: "robots.txt resolves and states an explicit policy for AI user agents.",
    verificationCheckIds: ["robots-ai-policy-quality"],
  };

  it("keeps independent systems as separate ledger entries", () => {
    const migrated = fromAgentIssue(issue, { pageIds: ["p1"], at: AT });
    expect(migrated.evidence.map((item) => item.source)).toEqual(["agent-readiness", "kitesurf"]);
    expect(migrated.confidence).toBe("confirmed");
    expect(migrated.state).toBe("new");
    expect(migrated.scope).toBe("origin");
  });

  it("gives Page Watch, Ora, and Kitesurf a slot each, with their own observedAt", () => {
    const migrated = fromAgentIssue({
      ...issue,
      sources: [
        ...issue.sources,
        { system: "ora", label: "AI policy", result: "failed", scope: "page", observedAt: "2026-08-22T00:00:00.000Z" },
      ],
    }, { pageIds: ["p1"], at: AT });
    // Three systems read the same origin, so the ledger holds three readings.
    expect(migrated.evidence.map((item) => item.source)).toEqual(["agent-readiness", "ora", "kitesurf"]);
    // Each keeps the time IT observed — nothing is collapsed onto one stamp.
    expect(migrated.evidence.map((item) => item.observedAt)).toEqual([
      "2026-08-20T00:00:00.000Z",
      "2026-08-22T00:00:00.000Z",
      "2026-08-21T00:00:00.000Z",
    ]);
    expect(migrated.confidence).toBe("confirmed");
  });

  it("lets Page Watch and Ora disagree, and reports that as unclear", () => {
    // The whole reason the two are not merged: a merged entry would have
    // resolved this disagreement before anyone could see it.
    const migrated = fromAgentIssue({
      ...issue,
      sources: [
        { system: "page-watch", label: "robots.txt", result: "failed", scope: "page", observedAt: "2026-08-20T00:00:00.000Z" },
        { system: "ora", label: "AI policy", result: "pass", scope: "page", observedAt: "2026-08-22T00:00:00.000Z" },
      ],
    }, { pageIds: ["p1"], at: AT });
    expect(migrated.evidence.map((item) => item.source)).toEqual(["agent-readiness", "ora"]);
    expect(migrated.evidence.map((item) => item.supports)).toEqual([true, false]);
    expect(migrated.confidence).toBe("unclear");
  });

  it("reopens a fixed case when a checkpoint finds the problem back", () => {
    // reopen.from gained "fixed" in registry v3: a 2, 7, or 30-day checkpoint
    // can fail, and the case has to have somewhere to go when it does.
    const fixed: IssueCase = { ...fromAgentIssue(issue, { pageIds: ["p1"], at: AT }), state: "fixed" };
    const reopened = reopenForPages(fixed, ["p1"], { actor: "checkpoint", at: AT });
    expect(reopened.state).toBe("reopened");
    expect(queueOf(reopened.state)).toBe("decide");
    expect(reopened.history.at(-1)).toMatchObject({ from: "fixed", to: "reopened", actor: "checkpoint" });
  });

  it("leaves applicability and policy readings out of the ledger", () => {
    const migrated = fromAgentIssue({
      ...issue,
      sources: [
        { system: "page-watch", label: "robots.txt", result: "ignored", scope: "page" },
        { system: "ora", label: "robots-ai-policy-quality", result: "not-applicable", scope: "origin" },
      ],
    }, { at: AT });
    // A check nobody counts is not evidence that the problem is absent.
    expect(migrated.evidence).toEqual([]);
    expect(migrated.confidence).toBe("unclear");
  });

  it("does not let a system that could not read count as one that disagrees", () => {
    // `supports` is a boolean, so an unavailable reading in the ledger is
    // indistinguishable from a system saying "the problem is not there". That
    // turned a provider outage into a disagreement and dropped a corroborated
    // diagnosis to Unclear.
    //
    // Registry rule 18 and checkpoint.unavailable both say an absent
    // measurement is neither agreement nor disagreement, and the assembler
    // already keeps `unavailable` out of its own `determined` set. This asserts
    // the adapter agrees with the registry, not with the assembler's code.
    const outage = fromAgentIssue({
      ...issue,
      sources: [
        { system: "page-watch", label: "robots.txt", result: "failed", scope: "page", observedAt: "2026-08-20T00:00:00.000Z" },
        { system: "ora", label: "AI policy", result: "unavailable", scope: "origin", observedAt: "2026-08-22T00:00:00.000Z" },
      ],
    }, { pageIds: ["p1"], at: AT });
    expect(outage.evidence.map((item) => item.source)).toEqual(["agent-readiness"]);
    expect(outage.confidence).toBe("probable");
  });

  it("does not resolve to unclear when every system was unavailable", () => {
    // Nothing read, so nothing supports and nothing dissents. `unclear` is
    // right here — but it must come from an empty ledger, not from readings
    // counted as dissent.
    const dark = fromAgentIssue({
      ...issue,
      sources: [
        { system: "page-watch", label: "robots.txt", result: "unavailable", scope: "page" },
        { system: "ora", label: "AI policy", result: "unavailable", scope: "origin" },
      ],
    }, { at: AT });
    expect(dark.evidence).toEqual([]);
    expect(dark.confidence).toBe("unclear");
    expect(dark.confirmedRuns).toBe(0);
  });

  it("cannot be accepted when the family has no steps", () => {
    const stepless = fromAgentIssue({ ...issue, remediation: [] }, { at: AT });
    expect(stepless.remediation.actionability).toBe("none");
    expect(() => accept(stepless, { actor: "matthew", at: AT })).toThrow(IssueCaseError);
  });
});

/* ── AC8 — one cause, one case ──────────────────────────────────────────── */

describe("grouping by cause", () => {
  const onPage = (pageId: string, overrides: Partial<Rec> = {}) =>
    fromRec(makeRec({ key: `${pageId}:unused-javascript`, pageId, ...overrides }), { at: AT });

  it("turns two findings that share a cause into one case listing both pages", () => {
    const grouped = groupByCause([onPage("p1"), onPage("p2")], { at: AT });
    expect(grouped).toHaveLength(1);
    expect(grouped[0].cause).toBe("unused-javascript");
    expect(grouped[0].pageIds).toEqual(["p1", "p2"]);
    expect(grouped[0].scope).toBe("pages");
  });

  it("keeps findings with different causes apart", () => {
    const other = fromRec(makeRec({ key: "p2:render-blocking", pageId: "p2", id: "render-blocking" }), { at: AT });
    expect(groupByCause([onPage("p1"), other], { at: AT })).toHaveLength(2);
  });

  it("never hides an active finding behind a resolved or set-aside sibling", () => {
    const grouped = groupByCause([
      onPage("p1", { status: "ignored" }),
      onPage("p2", { status: "inbox", taskStatus: "todo" }),
    ], { at: AT });
    expect(grouped[0].state).toBe("new");
    expect(grouped[0].history.at(-1)).toMatchObject({ from: "dismissed", to: "new", actor: "grouping" });
  });

  it("takes the worst observed impact rather than inventing a sum", () => {
    const grouped = groupByCause([
      onPage("p1", { savings: "1.8 s" }),
      onPage("p2", { savings: "0.6 s" }),
    ], { at: AT });
    expect(grouped[0].impactMs).toBe(1800);
  });

  it("resolving the case resolves it for every page it covers", () => {
    const grouped = groupByCause([onPage("p1"), onPage("p2")], { at: AT });
    const accepted = accept({ ...grouped[0], remediation: { steps: ["Remove it."], actionability: "direct" } }, { actor: "matthew", at: AT });
    const fixed = markFixed(applyAction(accepted, "start", { actor: "matthew", at: AT }), { actor: "matthew", at: AT });
    const resolved: IssueCase = { ...fixed, state: "resolved" };
    expect(resolved.pageIds).toEqual(["p1", "p2"]);
    expect(queueOf(resolved.state)).toBe("show_all");
  });

  it("reopens on a subset scoped to the pages that came back", () => {
    const grouped = groupByCause([onPage("p1"), onPage("p2")], { at: AT });
    const resolved: IssueCase = { ...grouped[0], state: "resolved" };
    const reopened = reopenForPages(resolved, ["p2"], { actor: "checkpoint", at: AT });
    expect(reopened.state).toBe("reopened");
    expect(reopened.pageIds).toEqual(["p2"]);
    expect(reopened.scope).toBe("page");
    expect(queueOf(reopened.state)).toBe("decide");
    expect(reopened.history.at(-1)).toMatchObject({ from: "resolved", to: "reopened", actor: "checkpoint" });
  });

  it("refuses to reopen for a page the case does not cover", () => {
    const resolved: IssueCase = { ...groupByCause([onPage("p1")], { at: AT })[0], state: "resolved" };
    expect(() => reopenForPages(resolved, ["p9"], { actor: "checkpoint", at: AT })).toThrow(IssueCaseError);
    expect(() => reopenForPages(resolved, [], { actor: "checkpoint", at: AT })).toThrow(IssueCaseError);
  });

  it("keeps one entry per source when two ledgers merge", () => {
    const grouped = groupByCause([onPage("p1"), onPage("p2")], { at: AT });
    expect(grouped[0].evidence).toHaveLength(1);
    expect(new Set(grouped[0].evidence.map((item) => item.source)).size).toBe(1);
  });
});

/* ── S1 — one remediation, one decision ─────────────────────────────────── */

describe("grouping by remediation", () => {
  const REMOVE_BUNDLE = ["Remove the unused bundle.", "Publish."];
  const RESIZE = ["Export the hero at 2x.", "Publish."];

  /** A cause-grouped case with a remediation on it. */
  const withFix = (id: string, steps: string[], overrides: Partial<IssueCase> = {}): IssueCase => ({
    ...makeCase({ id, cause: id, remediation: { steps, actionability: "direct" } }),
    ...overrides,
  });

  it("puts two cases the same steps fix in one group", () => {
    const groups = groupByRemediation([
      withFix("a", REMOVE_BUNDLE, { pageIds: ["p1"], impactMs: 1800 }),
      withFix("b", REMOVE_BUNDLE, { pageIds: ["p2"], impactMs: 600 }),
    ], { at: AT });
    expect(groups).toHaveLength(1);
    expect(groups[0].cases.map((item) => item.id)).toEqual(["a", "b"]);
    expect(groups[0].pageIds).toEqual(["p1", "p2"]);
  });

  it("keeps cases with different steps apart", () => {
    const groups = groupByRemediation([withFix("a", REMOVE_BUNDLE), withFix("b", RESIZE)], { at: AT });
    expect(groups).toHaveLength(2);
  });

  it("keeps cases apart when the same words are the platform's job on one of them", () => {
    // Same steps, different owner. Not the same piece of work.
    const groups = groupByRemediation([
      withFix("a", REMOVE_BUNDLE),
      { ...withFix("b", REMOVE_BUNDLE), remediation: { steps: REMOVE_BUNDLE, actionability: "platform" } },
    ], { at: AT });
    expect(groups).toHaveLength(2);
  });

  it("never groups cases that have no documented steps", () => {
    // An empty remediation is the absence of a shared fix, not a shared one.
    const groups = groupByRemediation([withFix("a", []), withFix("b", []), withFix("c", [])], { at: AT });
    expect(groups).toHaveLength(3);
    expect(groups.every((group) => group.cases.length === 1)).toBe(true);
  });

  it("reuses the cause grouping rather than repeating it", () => {
    // Two findings, one cause, one remediation: one case, so one row listing
    // both pages. Accepting that case covers both.
    const shared = (pageId: string) =>
      ({ ...fromRec(makeRec({ key: `${pageId}:unused-javascript`, pageId }), { at: AT }),
         remediation: { steps: REMOVE_BUNDLE, actionability: "direct" as const } });
    const groups = groupByRemediation([shared("p1"), shared("p2")], { at: AT });
    expect(groups).toHaveLength(1);
    expect(groups[0].cases).toHaveLength(1);
    expect(groups[0].cases[0].pageIds).toEqual(["p1", "p2"]);
    expect(groups[0].pageIds).toEqual(["p1", "p2"]);
  });

  it("takes the worst member reading, never a total, and keeps the one shared effort", () => {
    const groups = groupByRemediation([
      withFix("a", REMOVE_BUNDLE, { impactMs: 1800, effort: "hours" }),
      withFix("b", REMOVE_BUNDLE, { impactMs: 600, effort: "hours" }),
    ], { at: AT });
    // Rule 19: the same statistic as the rows beneath it. 2400 would be a figure
    // no run produced, and one the reader could not reconcile against 1800 + 600
    // sitting under it.
    expect(groups[0].impactMs).toBe(1800);
    expect(groups[0].impactMs).toBe(Math.max(...groups[0].cases.map((item) => item.impactMs)));
    expect(groups[0].cases.some((item) => item.impactMs === groups[0].impactMs)).toBe(true);
    // Not "hours + hours" either. The remediation is carried out once.
    expect(groups[0].effort).toBe("hours");
  });

  it("sorts an unmeasured member last and never lets it lead the group", () => {
    // Rule 18: an absent measurement is not a small one, so it goes last rather
    // than ranking on the zero it never measured.
    const groups = groupByRemediation([
      withFix("blank", REMOVE_BUNDLE, { impactMs: 0 }),
      withFix("small", REMOVE_BUNDLE, { impactMs: 120 }),
    ], { at: AT });
    expect(groups[0].cases.map((item) => item.id)).toEqual(["small", "blank"]);
    expect(groups[0].primary.id).toBe("small");
    expect(groups[0].impactMs).toBe(120);
  });

  it("reports no reading at all when no member has one", () => {
    const groups = groupByRemediation([
      withFix("a", REMOVE_BUNDLE, { impactMs: 0 }),
      withFix("b", REMOVE_BUNDLE, { impactMs: 0 }),
    ], { at: AT });
    expect(groups[0].impactMs).toBe(0);
  });

  it("takes the wider band where members disagree about the effort", () => {
    const groups = groupByRemediation([
      withFix("a", REMOVE_BUNDLE, { effort: "minutes" }),
      withFix("b", REMOVE_BUNDLE, { effort: "days" }),
    ], { at: AT });
    expect(groups[0].effort).toBe("days");
  });

  it("never hides an active member behind a settled one", () => {
    const groups = groupByRemediation([
      withFix("a", REMOVE_BUNDLE, { state: "dismissed" }),
      withFix("b", REMOVE_BUNDLE, { state: "reopened" }),
    ], { at: AT });
    expect(groups[0].state).toBe("reopened");
    expect(queueOf(groups[0].state)).toBe("decide");
  });

  it("is no more certain than its least certain member", () => {
    const groups = groupByRemediation([
      withFix("a", REMOVE_BUNDLE, { confidence: "confirmed" }),
      withFix("b", REMOVE_BUNDLE, { confidence: "unclear" }),
    ], { at: AT });
    expect(groups[0].confidence).toBe("unclear");
  });

  it("dates the group from its earliest member", () => {
    const groups = groupByRemediation([
      withFix("a", REMOVE_BUNDLE, { detectedAt: "2026-08-20T00:00:00.000Z" }),
      withFix("b", REMOVE_BUNDLE, { detectedAt: "2026-08-11T00:00:00.000Z" }),
    ], { at: AT });
    expect(groups[0].detectedAt).toBe("2026-08-11T00:00:00.000Z");
  });

  it("shows the worst-measured member first, and always in the same order", () => {
    const input = [
      withFix("a", REMOVE_BUNDLE, { impactMs: 600 }),
      withFix("b", REMOVE_BUNDLE, { impactMs: 2400 }),
    ];
    const groups = groupByRemediation(input, { at: AT });
    expect(groups[0].primary.id).toBe("b");
    expect(groupByRemediation(input, { at: AT })).toEqual(groups);
  });

  it("accounts for every case exactly once", () => {
    const input = [
      withFix("a", REMOVE_BUNDLE),
      withFix("b", REMOVE_BUNDLE),
      withFix("c", RESIZE),
      withFix("d", []),
    ];
    const groups = groupByRemediation(input, { at: AT });
    const ids = groups.flatMap((group) => group.cases.map((item) => item.id));
    expect(ids.sort()).toEqual(["a", "b", "c", "d"]);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

/* ── AC10, AC11 — vocabulary, and applicability kept out ────────────────── */

/* ── R1 — pairs that were kept in step by a comment ─────────────────────── */

describe("the legacy \"done\" mapping is one decision", () => {
  it("migrates and displays a legacy done as the same work state", () => {
    // The storage-side migration (`stateFromTaskStatus`) and the display-side
    // adapter (`taskStatusWorkState`) are the same decision about the same
    // legacy value, in two files, joined by a comment asking whoever edits one
    // to remember the other. That comment is exactly what failed: this arm
    // shipped as `fixed` on one side and `resolved` on the other.
    //
    // Asserting them against each other, rather than each against the literal
    // it happens to hold, is what makes the pair a pair.
    const migrated = fromRec(makeRec({ status: "task", taskStatus: "done" }), { at: AT });
    expect(migrated.state).toBe(taskStatusWorkState("done"));
  });

  it("keeps the caveat that the mapping was approved on", () => {
    // The two are only allowed to agree on `resolved` because the migration
    // writes down that nothing was ever measured. If that record went away the
    // case would be claiming a verification that never happened.
    const migrated = fromRec(makeRec({ status: "task", taskStatus: "done" }), { at: AT });
    const caveat = migrated.history.find((entry) => entry.to === "resolved" && entry.actor === "migration");
    expect(caveat?.reason).toMatch(/no checkpoint evidence/i);
  });

  it("agrees on every legacy value the two adapters share", () => {
    // `todo` deliberately differs — `taskStatus` alone carries no triage
    // information, so the migration lands it on `new`. Only the values both
    // adapters claim to decide the same way are compared.
    for (const taskStatus of ["in-progress", "done"] as const) {
      const migrated = fromRec(makeRec({ status: "task", taskStatus }), { at: AT });
      expect(migrated.state, `${taskStatus} disagrees between the two adapters`)
        .toBe(taskStatusWorkState(taskStatus));
    }
  });
});

describe("every evidence slot has a producer", () => {
  it("writes to exactly the slots the registry defines — rule 15", () => {
    // Rule 15: an evidence slot with no producer is not a slot, because an
    // empty slot reads to the user as a reading that found nothing. The rule
    // was stated in the registry and in three comments, and checked by a single
    // assertion that `is-agentic` had gone. This derives it instead.
    const produced = new Set<string>([
      ...Object.values(EVIDENCE_SOURCE),
      ...Object.values(EVIDENCE_SOURCE_FOR_AGENT_SYSTEM),
    ]);
    expect([...produced].sort()).toEqual([...EVIDENCE_SOURCES].sort());
  });

  it("names every slot in the registry, in the registry's spelling", () => {
    const slots: string[] = registry.concepts.evidence_source.values.map((value: { key: string }) => value.key);
    expect([...EVIDENCE_SOURCES]).toEqual(slots);
  });
});

describe("vocabulary discipline", () => {
  it("uses none of the globally banned terms", () => {
    for (const term of registry.banned_global.terms as string[]) {
      expect(new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(source), `"${term}" appears in issue-case.ts`).toBe(false);
    }
  });

  it("never treats set aside and excluded as one thing", () => {
    /**
     * This used to be a source-text ban: no "applicability" and no "excluded"
     * anywhere in the module. S2 gives a case's PAGES applicability — the
     * registry's own concept, applied to the pages rather than to the case — so
     * the text ban now forbids the decided design instead of the mistake it was
     * written for.
     *
     * The mistake it was written for was conflating two concepts: `dismissed`
     * (set aside — a decision about the case) and `excluded` (does not apply —
     * a fact about a page). Those are asserted directly below, which is a
     * stronger guard than the regex was: the regex would have passed a module
     * that spelled dismissal "excluded" as long as it used neither word.
     */

    // 1. The CASE has no applicability of its own. Its state is the only
    //    lifecycle it has, and "not this one" is spelled `dismissed`.
    expect(Object.keys(makeCase())).not.toContain("applicability");
    expect(source).not.toMatch(/applicability:\s*("|')/);

    // 2. Per-page applicability does not touch the case's queue. A case with an
    //    excluded page is in exactly the queue its state puts it in.
    const withExclusion = excludePage(
      makeCase({ state: "todo", pageIds: ["p1", "p2"] }),
      "p2",
      "Intentional",
      { actor: "person", at: AT },
    );
    expect(withExclusion.state).toBe("todo");
    expect(queueOf(withExclusion.state)).toBe(queueOf("todo"));

    // 3. Excluding is not dismissing. The last counted page cannot be excluded,
    //    because a case that counts nothing is a Dismiss and there must not be
    //    two ways to say it.
    expect(() =>
      excludePage(makeCase({ pageIds: ["p1"] }), "p1", "Intentional", { actor: "person", at: AT }),
    ).toThrow(IssueCaseError);

    // 4. Dismissing does not exclude anything, and excluding does not dismiss.
    const setAside = dismiss(makeCase({ state: "new" }), { actor: "person", at: AT, reason: "Intentional" });
    expect(setAside.excludedPages).toBeUndefined();
    expect(withExclusion.state).not.toBe("dismissed");
  });

  it("keeps the retired lifecycles as read-only views", () => {
    expect(recStatusOf("new")).toBe("inbox");
    expect(recStatusOf("reopened")).toBe("inbox");
    expect(recStatusOf("todo")).toBe("task");
    expect(recStatusOf("dismissed")).toBe("ignored");
    expect(taskStatusOf("in_progress")).toBe("in-progress");
    expect(taskStatusOf("fixed")).toBe("done");
    expect(taskStatusOf("new")).toBe("todo");
  });

  it("reads the old lifecycles only inside the migration section", () => {
    // taskStatus is legacy input. It must never become a field on the case, and
    // no code above the migration divider may read it.
    expect(makeCase()).not.toHaveProperty("taskStatus");
    expect(makeCase()).not.toHaveProperty("status");

    const divider = "/* ── Migration: derived views";
    const [before, ...after] = source.split(divider);
    expect(after.join("")).toMatch(/taskStatus/);
    const code = before
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*$/gm, "");
    expect(code).not.toMatch(/taskStatus/);
  });
});
