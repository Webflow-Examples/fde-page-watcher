import { readFileSync, readdirSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { applyCaseDecisions, issueCasesFrom } from "../issue-cases";
import { caseDecisionFrom, decisionOf, CASE_DECISIONS, CaseDecisionError } from "../case-decisions";
import {
  applicabilityOf,
  applyAction,
  excludedPageIds,
  includedPages,
  remediationIdentity,
  remediationKey,
  type IssueCase,
} from "../issue-case";
import { recordCheckpointReading } from "../checkpoint-evaluation";
import { DECISION_STRANDED, historyExcluded } from "../case-copy";
import { recordCaseDecision } from "../mutations";
import { insertRecommendations } from "../collector";
import { createFsStore, type DataStore } from "../store/fsStore";
import { pendingPage } from "../mutations";
import type {
  AppState,
  CaseDecisionRecord,
  Rec,
  ScoreByCategory,
  WatchPage,
  WebflowPerformanceClassification,
} from "../types";

/**
 * Case persistence (F5), and the two ways it could be a lie.
 *
 * A decision that does not survive a reload is the failure this chunk exists to
 * fix, and it is the obvious one. The other is quieter and worse: a decision
 * that survives but reattaches to something else. Both are properties of the
 * KEY, so most of what is asserted here is about what the key is made of and
 * what it is deliberately not made of.
 */

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const srcDir = path.resolve(moduleDir, "../..");
const AT = "2026-08-25T09:00:00.000Z";
const ZERO: ScoreByCategory = { perf: 0, a11y: 0, bp: 0, seo: 0 };

function makePage(overrides: Partial<WatchPage> = {}): WatchPage {
  return {
    id: "home",
    title: "Home",
    url: "/",
    flag: "watching",
    status: "stable",
    current: { mobile: ZERO, desktop: ZERO },
    history: [],
    markers: [],
    agent: [],
    lastRunAt: "2026-08-24T06:00:00.000Z",
    ...overrides,
  };
}

function makeRec(overrides: Partial<Rec> = {}): Rec {
  return {
    key: "home:unused-javascript",
    pageId: "home",
    pageTitle: "Home",
    url: "/",
    id: "unused-javascript",
    source: "lighthouse",
    title: "Reduce unused JavaScript",
    category: "Performance",
    savings: "1.8 s",
    estTime: "2 days",
    status: "inbox",
    taskStatus: "todo",
    added: "2026-08-22",
    doneDate: null,
    ...overrides,
  };
}

/** A classification carrying nothing but the actionability under test. */
function classified(actionability: "direct" | "none"): WebflowPerformanceClassification {
  return {
    version: 1,
    metric: "LCP",
    metricWeight: 25,
    culprit: "global-javascript",
    culpritLabel: "Global JavaScript",
    remediation: "available",
    remediationLabel: "Available",
    guidance: "",
    actionability,
    source: "published-page-performance",
  };
}

/** A record carrying documented steps, so its remediation has a real key. */
function withSteps(overrides: Partial<Rec> = {}): Rec {
  return makeRec({
    agentIssue: {
      caseKey: "agent:unused-javascript",
      title: "Reduce unused JavaScript",
      scope: "page",
      capturedAt: AT,
      remediation: ["Remove the unused bundle.", "Re-publish."],
      successCriteria: "The bundle is gone.",
      verificationCheckIds: [],
    },
    webflow: classified("direct"),
    ...overrides,
  });
}

/** Three pages, one cause, so exclusion has something to bite on. */
function threePageState(caseDecisions: CaseDecisionRecord[] = []): Pick<AppState, "recs" | "pages" | "caseDecisions"> {
  return {
    pages: [
      makePage({ id: "home", title: "Home", url: "/" }),
      makePage({ id: "pricing", title: "Pricing", url: "/pricing" }),
      makePage({ id: "docs", title: "Docs", url: "/docs" }),
    ],
    recs: [
      makeRec({ key: "home:unused-javascript", pageId: "home" }),
      makeRec({ key: "pricing:unused-javascript", pageId: "pricing", pageTitle: "Pricing", url: "/pricing" }),
      makeRec({ key: "docs:unused-javascript", pageId: "docs", pageTitle: "Docs", url: "/docs" }),
    ],
    caseDecisions,
  };
}

function exclusion(remediation: string, pageId: string, at = AT): CaseDecisionRecord {
  return {
    decision: "exclude",
    remediationKey: remediation,
    pageId,
    reason: "Intentional",
    at,
    actor: "person",
  };
}

const only = (cases: IssueCase[]): IssueCase => {
  expect(cases).toHaveLength(1);
  return cases[0];
};

/* ── It survives the reload, which is the whole point ───────────────────── */

describe("a decision and a reload", () => {
  it("keeps an exclusion, with its reason, across a re-derivation", () => {
    const key = remediationKey(only(issueCasesFrom(threePageState())));
    const state = threePageState([exclusion(key, "docs")]);

    // Two derivations of one stored state IS the reload: nothing is held in a
    // component, so a second pass is what the reader gets after a refresh.
    const first = only(issueCasesFrom(state));
    const second = only(issueCasesFrom(state));
    expect(first).toEqual(second);

    expect(applicabilityOf(first, "docs")).toBe("excluded");
    expect(excludedPageIds(first)).toEqual(["docs"]);
    expect(includedPages(first)).toEqual(["home", "pricing"]);
    // The reason is carried, not just the fact — an exclusion nobody can
    // account for is the thing excluding-with-a-reason exists to prevent.
    expect(first.excludedPages?.docs).toBe("Intentional");
  });

  it("replays the history line S2 locked, against the reader's own path", () => {
    const key = remediationKey(only(issueCasesFrom(threePageState())));
    const issue = only(issueCasesFrom(threePageState([exclusion(key, "docs")])));
    expect(issue.history.at(-1)?.reason).toBe(historyExcluded("/docs", "Intentional"));
    expect(issue.history.at(-1)?.reason).toBe("/docs excluded — Intentional");
    expect(issue.history.at(-1)?.actor).toBe("person");
  });

  it("reverses with a second entry rather than by editing the first", () => {
    const key = remediationKey(only(issueCasesFrom(threePageState())));
    const log: CaseDecisionRecord[] = [
      exclusion(key, "docs"),
      { decision: "include", remediationKey: key, pageId: "docs", at: "2026-08-26T09:00:00.000Z", actor: "person" },
    ];
    const issue = only(issueCasesFrom(threePageState(log)));
    expect(excludedPageIds(issue)).toEqual([]);
    // Both entries are still there, and both are in the history the panel
    // renders. A change of mind is something that happened.
    expect(log).toHaveLength(2);
    expect(issue.history.map((entry) => entry.reason)).toEqual([
      "/docs excluded — Intentional",
      "/docs included again",
    ]);
  });

  it("orders by the log, so exclude-then-include differs from the reverse", () => {
    const key = remediationKey(only(issueCasesFrom(threePageState())));
    const excludeFirst: CaseDecisionRecord[] = [
      exclusion(key, "docs", "2026-08-25T09:00:00.000Z"),
      { decision: "include", remediationKey: key, pageId: "docs", at: "2026-08-26T09:00:00.000Z", actor: "person" },
    ];
    const includeLast = [...excludeFirst].reverse();
    expect(excludedPageIds(only(issueCasesFrom(threePageState(excludeFirst))))).toEqual([]);
    expect(excludedPageIds(only(issueCasesFrom(threePageState(includeLast))))).toEqual(["docs"]);
  });
});

/* ── The key is a remediation, never a case ─────────────────────────────── */

describe("what a decision is keyed on", () => {
  it("never keys on the case id, which moves when membership does", () => {
    // The case id is whichever member came first. Reversing the records changes
    // it, and that is exactly the instability a stored key must not inherit.
    const forwards = only(issueCasesFrom(threePageState()));
    const reversed = threePageState();
    reversed.recs = [...reversed.recs].reverse();
    const backwards = only(issueCasesFrom(reversed));

    expect(backwards.id).not.toBe(forwards.id);
    expect(remediationKey(backwards)).toBe(remediationKey(forwards));
    expect(remediationKey(forwards)).not.toContain(forwards.id);
    // A record with no documented remediation is the ordinary case, so this is
    // the common path rather than an edge worth tolerating.
    expect(remediationKey(forwards)).toBe("cause:unused-javascript");
  });

  it("applies the same exclusion whichever member the case took its id from", () => {
    const key = remediationKey(only(issueCasesFrom(threePageState())));
    const reversed = threePageState([exclusion(key, "docs")]);
    reversed.recs = [...reversed.recs].reverse();
    expect(excludedPageIds(only(issueCasesFrom(reversed)))).toEqual(["docs"]);
  });

  it("keys on the steps and the actionability when there are steps", () => {
    const issue = only(issueCasesFrom({ pages: [makePage()], recs: [withSteps()] }));
    expect(remediationKey(issue)).toBe(
      `steps:direct:${JSON.stringify(["Remove the unused bundle.", "Re-publish."])}`,
    );
  });

  it("stores no case id, group index or row position on an entry", () => {
    const entry = caseDecisionFrom(
      { decision: "exclude", remediationKey: "cause:x", pageId: "docs", reason: "Intentional" },
      { at: AT, actor: "person" },
    );
    expect(Object.keys(entry).sort()).toEqual(
      ["actor", "at", "decision", "pageId", "reason", "remediationKey"],
    );
  });
});

/* ── 4b's promise: accept covers what the remediation covers ────────────── */

describe("a remediation that was already accepted", () => {
  const steps = ["Remove the unused bundle.", "Re-publish."];
  const key = `steps:direct:${JSON.stringify(steps)}`;
  const accepted: CaseDecisionRecord[] = [
    { decision: "accept", remediationKey: key, at: AT, actor: "person" },
  ];

  it("arrives accepted, rather than being re-asked", () => {
    const issue = only(issueCasesFrom({
      pages: [makePage()],
      recs: [withSteps()],
      caseDecisions: accepted,
    }));
    expect(issue.state).toBe("todo");
    expect(issue.history.at(-1)).toMatchObject({ from: "new", to: "todo", actor: "person" });
  });

  it("carries a new record that joins the same remediation", () => {
    /**
     * The reason accept keys on the remediation rather than on the case. A
     * record found on another page tonight is the same piece of work, already
     * agreed to — asking again would be asking a question that was answered.
     */
    const arrived = issueCasesFrom({
      pages: [makePage(), makePage({ id: "pricing", title: "Pricing", url: "/pricing" })],
      recs: [
        withSteps(),
        // A different cause, so a second case — and the same steps, so the same
        // remediation.
        withSteps({ key: "pricing:render-blocking", pageId: "pricing", id: "render-blocking", url: "/pricing" }),
      ],
      caseDecisions: accepted,
    });
    expect(arrived).toHaveLength(2);
    for (const issue of arrived) {
      expect(remediationKey(issue)).toBe(key);
      expect(issue.state).toBe("todo");
    }
  });

  it("does not re-accept a case the evidence has already moved past", () => {
    // The registry says accept is legal from new and reopened. A record the
    // collector has since marked done is not re-decided by a replay.
    const issue = only(issueCasesFrom({
      pages: [makePage()],
      recs: [withSteps({ status: "task", taskStatus: "done" })],
      caseDecisions: accepted,
    }));
    expect(issue.state).toBe("resolved");
  });
});

/* ── A page leaving, and coming back ────────────────────────────────────── */

describe("a page that leaves the case", () => {
  it("stops matching without its entry being touched, and applies again on return", () => {
    const key = "cause:unused-javascript";
    const log = [exclusion(key, "docs")];
    const before = threePageState(log);
    expect(excludedPageIds(only(issueCasesFrom(before)))).toEqual(["docs"]);

    // The nightly run no longer finds it on /docs.
    const without = threePageState(log);
    without.recs = without.recs.filter((rec) => rec.pageId !== "docs");
    without.pages = without.pages.filter((page) => page.id !== "docs");
    const shrunk = only(issueCasesFrom(without));
    expect(shrunk.pageIds).toEqual(["home", "pricing"]);
    expect(excludedPageIds(shrunk)).toEqual([]);
    // Nothing was pruned to make that happen.
    expect(log).toEqual([exclusion(key, "docs")]);

    // And when it comes back, so does the decision.
    expect(excludedPageIds(only(issueCasesFrom(threePageState(log))))).toEqual(["docs"]);
  });

  it("declines an exclusion that would leave the case counting nothing", () => {
    // The model refuses it, so the replay asks first rather than throwing. The
    // entry survives to apply again once the case has more than one page.
    const key = "cause:unused-javascript";
    const log = [exclusion(key, "home"), exclusion(key, "pricing"), exclusion(key, "docs")];
    const issue = only(issueCasesFrom(threePageState(log)));
    expect(excludedPageIds(issue)).toEqual(["home", "pricing"]);
    expect(includedPages(issue)).toEqual(["docs"]);
    expect(log).toHaveLength(3);
  });
});

/* ── Stranded: the fix changed after somebody agreed to it ──────────────── */

describe("a decision the remediation moved out from under", () => {
  const steps = ["Remove the unused bundle.", "Re-publish."];
  const key = `steps:direct:${JSON.stringify(steps)}`;

  function reclassified(caseDecisions: CaseDecisionRecord[]) {
    return {
      pages: [makePage()],
      // Same steps, reclassified as platform-owned. `classificationForPage`
      // writing "none" is what the case reads as `platform`.
      recs: [withSteps({ webflow: classified("none") })],
      caseDecisions,
    };
  }

  it("reads undecided, says the fix changed, and keeps the entry", () => {
    const log: CaseDecisionRecord[] = [
      { decision: "accept", remediationKey: key, at: AT, actor: "person" },
    ];
    const issue = only(issueCasesFrom(reclassified(log)));

    expect(remediationKey(issue)).not.toBe(key);
    // Undecided: the decision was about a fix that is not this one.
    expect(issue.state).toBe("new");
    expect(issue.strandedDecision).toBe(true);
    // Not dropped. Silently losing somebody's decision is the failure; silently
    // reapplying it to a different remediation is worse.
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ decision: "accept", remediationKey: key });
  });

  it("recognises the entry by its steps, because the steps are what was agreed", () => {
    expect(remediationIdentity(key)).toBe(remediationIdentity(`steps:platform:${JSON.stringify(steps)}`));
    // A genuinely different fix is a different remediation, not a stranded one.
    expect(remediationIdentity(key)).not.toBe(
      remediationIdentity(`steps:direct:${JSON.stringify(["Something else."])}`),
    );
  });

  it("says nothing when there is nothing stranded", () => {
    const issue = only(issueCasesFrom({ pages: [makePage()], recs: [withSteps()], caseDecisions: [] }));
    expect(issue.strandedDecision).toBeUndefined();
  });

  it("renders the locked sentence on the case", () => {
    expect(DECISION_STRANDED).toBe(
      "The fix for this changed after it was accepted, so it needs deciding again.",
    );
    const detail = readFileSync(path.join(srcDir, "components/case-detail.tsx"), "utf8");
    expect(detail).toMatch(/issue\.strandedDecision \? \(/);
    expect(detail).toMatch(/\{DECISION_STRANDED\}/);
  });
});

/* ── W1 still measures the counted pages, after a reload ────────────────── */

describe("an excluded page and the checkpoints", () => {
  /** Three pages sharing one documented remediation, so Accept is legal. */
  function fixable(caseDecisions: CaseDecisionRecord[] = []) {
    const state = threePageState(caseDecisions);
    state.recs = state.recs.map((rec) => withSteps({ ...rec }));
    return state;
  }

  it("does not reopen the case when only the excluded page comes back", () => {
    const key = remediationKey(only(issueCasesFrom(fixable())));
    const derived = only(issueCasesFrom(fixable([exclusion(key, "docs")])));
    expect(excludedPageIds(derived)).toEqual(["docs"]);

    // Drive the case that came out of storage — not a hand-built one — through
    // to Fixed, so the exclusion W1 reads is the persisted one.
    const fixed = (["accept", "start", "mark_fixed"] as const).reduce<IssueCase>(
      (issue, action) => applyAction(issue, action, { actor: "person", at: AT }),
      derived,
    );

    const excluded = recordCheckpointReading(fixed, {
      interval: "2d",
      outcome: "disagreed",
      at: "2026-08-27T00:00:00.000Z",
      pageIds: ["docs"],
    });
    expect(excluded.effect).toBe("recorded");
    expect(excluded.issue.state).toBe("fixed");

    const counted = recordCheckpointReading(fixed, {
      interval: "2d",
      outcome: "disagreed",
      at: "2026-08-27T00:00:00.000Z",
      pageIds: ["home"],
    });
    expect(counted.effect).toBe("reopened");
  });
});

/* ── The collector writes records, never decisions ──────────────────────── */

describe("the collector and the log", () => {
  const roots: string[] = [];
  afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  });

  async function storeWith(caseDecisions: CaseDecisionRecord[]): Promise<DataStore> {
    const root = await mkdtemp(path.join(tmpdir(), "fde-f5-"));
    roots.push(root);
    const dataStore = createFsStore("test", root);
    await dataStore.updateState((state) => {
      state.pages = [pendingPage("home", "Home", "https://example.com", "priority")];
      state.recs = [];
      state.caseDecisions = caseDecisions;
    });
    return dataStore;
  }

  it("leaves the log untouched while rewriting every record", async () => {
    /**
     * Asserted rather than assumed. The collector rewrites records nightly and
     * how it merges them is not this app's property — which is the entire
     * reason a decision is not stored on one.
     */
    const log = [exclusion("cause:unused-javascript", "docs")];
    const dataStore = await storeWith(log);
    const after = await insertRecommendations(
      dataStore,
      "home",
      [{ id: "unused-javascript", title: "Reduce unused JavaScript", savingsMs: 1800, strategies: ["mobile"] }],
      new Date("2026-08-26T06:00:00.000Z"),
      { summarize: false },
    );
    expect(after.recs.length).toBeGreaterThan(0);
    expect(after.caseDecisions).toEqual(log);
  });

  it("has no mention of the log in its source", () => {
    const collector = readFileSync(path.join(srcDir, "lib/collector.ts"), "utf8");
    expect(collector).not.toMatch(/caseDecisions/);
  });
});

/* ── Append-only, at the only writer ────────────────────────────────────── */

describe("the writer", () => {
  const roots: string[] = [];
  afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  });

  async function emptyStore(): Promise<DataStore> {
    const root = await mkdtemp(path.join(tmpdir(), "fde-f5-write-"));
    roots.push(root);
    const dataStore = createFsStore("test", root);
    await dataStore.updateState((state) => {
      state.pages = [];
      state.recs = [];
    });
    return dataStore;
  }

  it("appends, and never edits what is already there", async () => {
    const dataStore = await emptyStore();
    const first = await recordCaseDecision(
      { decision: "exclude", remediationKey: "cause:a", pageId: "docs", reason: "Intentional" },
      dataStore,
      new Date("2026-08-25T09:00:00.000Z"),
    );
    const second = await recordCaseDecision(
      { decision: "include", remediationKey: "cause:a", pageId: "docs" },
      dataStore,
      new Date("2026-08-26T09:00:00.000Z"),
    );
    expect(second.caseDecisions).toHaveLength(2);
    expect(second.caseDecisions?.[0]).toEqual(first.caseDecisions?.[0]);
    expect(second.caseDecisions?.[1]).toMatchObject({ decision: "include", at: "2026-08-26T09:00:00.000Z" });
  });

  it("stamps the caller with the same actor word every transition writes today", async () => {
    // Not a tagged caller: F4 migrates every call site in one change, and a
    // store that had half-migrated is the one place that sweep could not carry.
    const dataStore = await emptyStore();
    const state = await recordCaseDecision(
      { decision: "accept", remediationKey: "steps:direct:[]" },
      dataStore,
    );
    expect(state.caseDecisions?.[0]?.actor).toBe("person");
  });

  it("refuses an entry the registry would not recognise", async () => {
    const dataStore = await emptyStore();
    await expect(recordCaseDecision({ decision: "snooze", remediationKey: "cause:a" }, dataStore))
      .rejects.toBeInstanceOf(CaseDecisionError);
    await expect(recordCaseDecision({ decision: "exclude", remediationKey: "cause:a", pageId: "docs" }, dataStore))
      .rejects.toBeInstanceOf(CaseDecisionError);
    await expect(recordCaseDecision({ decision: "exclude", remediationKey: "cause:a", reason: "Intentional" }, dataStore))
      .rejects.toBeInstanceOf(CaseDecisionError);
    await expect(recordCaseDecision({ decision: "dismiss", remediationKey: "cause:a", reason: "Because" }, dataStore))
      .rejects.toBeInstanceOf(CaseDecisionError);
  });

  it("declines a malformed stored entry on read without removing it", () => {
    const broken: CaseDecisionRecord = {
      decision: "exclude",
      remediationKey: "cause:unused-javascript",
      pageId: "docs",
      reason: "Because I said so",
      at: AT,
      actor: "person",
    };
    expect(decisionOf(broken)).toBeNull();
    const log = [broken];
    expect(excludedPageIds(only(issueCasesFrom(threePageState(log))))).toEqual([]);
    expect(log).toHaveLength(1);
  });
});

/* ── The properties, read off the source ────────────────────────────────── */

describe("the log's shape, across src", () => {
  function walk(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== "__tests__") walk(full, out);
        continue;
      }
      if (/\.tsx?$/.test(entry.name)) out.push(full);
    }
    return out;
  }
  const files = walk(srcDir);

  it("keys every decision it writes on the remediation", () => {
    /**
     * The key is produced in one place and read in one place. A call site
     * composing its own key would be a second one, and a second key is the one
     * that detaches when membership moves.
     */
    const callers = files.filter((file) => /recordCaseDecision\(\{/.test(readFileSync(file, "utf8")));
    expect(callers.length).toBeGreaterThan(0);
    for (const file of callers) {
      const code = readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
      for (const call of code.match(/recordCaseDecision\(\{[\s\S]*?\}/g) ?? []) {
        expect(call, `${path.relative(srcDir, file)} keys a decision on something else`)
          .toMatch(/remediationKey: remediationKey\(/);
      }
    }
  });

  it("names no case id, group index or row position anywhere it handles decisions", () => {
    // Scoped to the modules that touch the log. `rowIndex` is a real thing
    // elsewhere — a chart marker's row — and a scan that flagged it would be
    // asserting a rule about the whole app rather than about this one.
    const touching = files.filter((file) => /caseDecision|CaseDecision/.test(readFileSync(file, "utf8")));
    expect(touching.length).toBeGreaterThan(0);
    for (const file of touching) {
      const code = readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
      expect(code, `${path.relative(srcDir, file)} keys a decision on a case`)
        .not.toMatch(/caseId|caseIndex|rowIndex|groupIndex/);
      // `issue.id` is the case id. It may be read for a link or a heading, but
      // never written into a decision.
      expect(code, `${path.relative(srcDir, file)} puts a case id in a decision`)
        .not.toMatch(/remediationKey:\s*(?!remediationKey\()[^,\n]*\bid\b/);
    }
  });

  it("never prunes, filters or edits the log", () => {
    // Nothing anywhere reduces the array. Reading it is a match, not a rewrite.
    for (const file of files) {
      const code = readFileSync(file, "utf8");
      expect(code, `${path.relative(srcDir, file)} rewrites the log`)
        .not.toMatch(/caseDecisions[\s\S]{0,40}?\.(filter|splice|pop|shift|sort|reverse)\(/);
      expect(code, `${path.relative(srcDir, file)} deletes from the log`)
        .not.toMatch(/delete\s+\w+\.caseDecisions/);
    }
  });

  it("has one writer, and it is a server mutation", () => {
    const writers = files.filter((file) => /state\.caseDecisions\s*=/.test(readFileSync(file, "utf8")));
    expect(writers.map((file) => path.relative(srcDir, file)).sort()).toEqual([
      "lib/mutations.ts",
      "lib/store/normalize.ts",
    ]);
  });

  it("names four decisions and no more, all of them rendered", () => {
    // Rule 15: a value nothing renders is not a value. Exclusion and inclusion
    // are drawn by the pages table; accept and dismiss move the case's state,
    // which the chip, the queue tabs and the counts all read.
    expect([...CASE_DECISIONS].sort()).toEqual(["accept", "dismiss", "exclude", "include"]);
  });
});

/* ── applyCaseDecisions is a no-op when there is nothing to say ─────────── */

describe("an empty log", () => {
  it("changes nothing", () => {
    const cases = issueCasesFrom(threePageState());
    expect(applyCaseDecisions(cases, [])).toEqual(cases);
  });
});
