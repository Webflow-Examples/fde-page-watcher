import { describe, expect, it } from "vitest";
import type { AppState, CaseDecisionRecord, CaseTransitionRecord, Rec, ScoreByCategory, WatchPage } from "../../types";
import { remediationKey as keyOf } from "../../issue-case";
import { issueCasesFrom } from "../../issue-cases";
import { createFakeProvider } from "../fake";
import { createMemoryIntegrationStore } from "../store";
import type { IntegrationConnectionRecord } from "../types";
import { connectionAad, sealSecret } from "../crypto";
import {
  CASE_BATCH_LIMIT,
  bulkCreateTasks,
  createTaskForCase,
  previewBulk,
  recordTaskNote,
  refreshTaskLink,
  unlinkTask,
} from "../tasks";
import { afterDecision, afterTransition } from "../automations";

const KEY = "a-test-key-that-is-at-least-32-characters";
const ZERO: ScoreByCategory = { perf: 0, a11y: 0, bp: 0, seo: 0 };
const AT = "2026-11-01T09:00:00.000Z";

function page(id: string, title: string): WatchPage {
  return {
    id,
    title,
    url: `/${id}`,
    flag: "watching",
    status: "stable",
    current: { mobile: ZERO, desktop: ZERO },
    history: [],
    markers: [],
    agent: [],
    lastRunAt: "2026-11-01T06:00:00.000Z",
  };
}

function rec(overrides: Partial<Rec> & { key: string; pageId: string; id: string }): Rec {
  return {
    pageTitle: overrides.pageId,
    url: `/${overrides.pageId}`,
    source: "lighthouse",
    title: `Fix ${overrides.id}`,
    category: "Performance",
    savings: "1.0 s",
    estTime: "1 day",
    status: "inbox",
    taskStatus: "todo",
    added: "2026-10-30",
    doneDate: null,
    ...overrides,
  };
}

function planned(id: string, steps: string[] = ["Remove the unused bundle.", "Re-publish."]): Partial<Rec> {
  return {
    agentIssue: {
      caseKey: `agent:${id}`,
      title: `Fix ${id}`,
      scope: "page",
      capturedAt: AT,
      remediation: steps,
      successCriteria: "The bundle is gone.",
      verificationCheckIds: [],
    },
    webflow: {
      version: 1,
      metric: "LCP",
      metricWeight: 25,
      culprit: "global-javascript",
      culpritLabel: "Global JavaScript",
      remediation: "available",
      remediationLabel: "Available",
      guidance: "",
      actionability: "direct",
      source: "published-page-performance",
    },
  };
}

function stateWith(input: {
  recs: Rec[];
  decisions?: CaseDecisionRecord[];
  transitions?: CaseTransitionRecord[];
}): AppState {
  return {
    pages: [page("home", "Home"), page("pricing", "Pricing"), page("docs", "Docs")],
    recs: input.recs,
    caseDecisions: input.decisions ?? [],
    caseTransitions: input.transitions ?? [],
    casePlans: [],
  } as unknown as AppState;
}

function twoSiblings(): AppState {
  return stateWith({
    recs: [
      rec({ key: "home:alpha", pageId: "home", id: "alpha", title: "Alpha problem", ...planned("alpha") }),
      rec({ key: "pricing:beta", pageId: "pricing", id: "beta", title: "Beta problem", ...planned("beta") }),
    ],
  });
}

function connection(projectId = "brand-studio"): IntegrationConnectionRecord {
  const sealed = sealSecret("token", KEY, connectionAad(projectId, "asana"));
  return {
    id: "conn-asana",
    projectId,
    provider: "asana",
    workspaceId: "ws-1",
    workspaceName: "Brand Studio",
    defaultDestinationId: "dest-engineering",
    defaultDestinationName: "Engineering",
    encryptedToken: sealed.ciphertext,
    tokenNonce: sealed.nonce,
    scopes: ["tasks:write"],
    installedBy: "rae@webflow.com",
    installedAt: AT,
    status: "connected",
  };
}

function fakeHarness(projectId = "brand-studio") {
  const fake = createFakeProvider();
  const conn = connection(projectId);
  const store = createMemoryIntegrationStore(projectId, { connections: [conn] });
  return { fake, store, conn, projectId };
}

describe("creating and linking one task per remediation", () => {
  it("creates one task and links both siblings to it", async () => {
    const { fake, store, conn, projectId } = fakeHarness();
    const state = twoSiblings();
    const cases = issueCasesFrom(state);
    expect(cases).toHaveLength(2);
    // The two cases share a remediation because they carry the same steps.
    expect(keyOf(cases[0])).toBe(keyOf(cases[1]));

    const first = await createTaskForCase({
      projectId,
      state,
      store,
      provider: fake,
      connection: conn,
      remediationKey: keyOf(cases[0]),
      createdBy: "rae@webflow.com",
      now: new Date(AT),
    });
    expect(first.status).toBe("created");
    const second = await createTaskForCase({
      projectId,
      state,
      store,
      provider: fake,
      connection: conn,
      remediationKey: keyOf(cases[1]),
      createdBy: "rae@webflow.com",
      now: new Date(AT),
    });
    expect(second.status).toBe("already_linked");
    if (first.status !== "created" || second.status !== "already_linked") throw new Error("unreachable");
    expect(second.link.id).toBe(first.link.id);
    expect(fake.tasks).toHaveLength(1);
  });

  it("puts the ticket and the hidden marker in the task, and nothing else", async () => {
    const { fake, store, conn, projectId } = fakeHarness();
    const state = twoSiblings();
    const issue = issueCasesFrom(state)[0];
    await createTaskForCase({
      projectId,
      state,
      store,
      provider: fake,
      connection: conn,
      remediationKey: keyOf(issue),
      createdBy: "rae@webflow.com",
    });
    const body = fake.tasks[0].body;
    expect(body).toContain("Remove the unused bundle.");
    expect(body).toContain(`<!-- page-watch:${projectId}:${keyOf(issue)} -->`);
    // Nothing from the evidence ledger, raw reports or visitor data.
    expect(body).not.toContain("lighthouse");
    expect(body).not.toContain("crux");
  });

  it("skips a case with no plan, with a reason", async () => {
    const { fake, store, conn, projectId } = fakeHarness();
    const state = stateWith({ recs: [rec({ key: "home:unplanned", pageId: "home", id: "unplanned" })] });
    const issue = issueCasesFrom(state)[0];
    const result = await createTaskForCase({
      projectId,
      state,
      store,
      provider: fake,
      connection: conn,
      remediationKey: keyOf(issue),
      createdBy: "rae@webflow.com",
    });
    expect(result.status).toBe("skipped");
    if (result.status === "skipped") expect(result.reason).toMatch(/no plan/);
    expect(fake.tasks).toHaveLength(0);
  });

  it("leaves the task unassigned with a visible note when no user matches the owner", async () => {
    const { fake, store, conn, projectId } = fakeHarness();
    const state = twoSiblings();
    const issue = issueCasesFrom(state)[0];
    const decisions: CaseDecisionRecord[] = [
      { decision: "accept", remediationKey: keyOf(issue), at: AT, by: { kind: "person", userId: "rae@webflow.com" } },
    ];
    const transitions: CaseTransitionRecord[] = [
      { caseKey: issue.cause, action: "start", at: AT, by: { kind: "person", userId: "nobody@example.test" } },
    ];
    const withOwner = stateWith({
      recs: (state as unknown as { recs: Rec[] }).recs,
      decisions,
      transitions,
    });
    const owner = issueCasesFrom(withOwner)[0];
    const result = await createTaskForCase({
      projectId,
      state: withOwner,
      store,
      provider: fake,
      connection: conn,
      remediationKey: keyOf(owner),
      createdBy: "rae@webflow.com",
    });
    expect(result.status).toBe("created");
    if (result.status === "created") {
      expect(result.assigneeNote).toMatch(/unassigned/);
      expect(result.link.assignee).toBeUndefined();
    }
  });

  it("unlinks without touching the task or the case", async () => {
    const { fake, store, conn, projectId } = fakeHarness();
    const state = twoSiblings();
    const issue = issueCasesFrom(state)[0];
    await createTaskForCase({
      projectId, state, store, provider: fake, connection: conn,
      remediationKey: keyOf(issue), createdBy: "rae@webflow.com",
    });
    await unlinkTask(store, "asana", keyOf(issue));
    expect(await store.getLink("asana", keyOf(issue))).toBeNull();
    expect(fake.tasks).toHaveLength(1);
    expect(issueCasesFrom(state).find((candidate) => candidate.id === issue.id)?.state).toBe(issue.state);
  });
});

describe("bulk create", () => {
  it("counts the preview by remediation, not by case", async () => {
    const state = twoSiblings();
    const cases = issueCasesFrom(state);
    const preview = previewBulk({
      state,
      links: [],
      provider: "asana",
      caseIds: cases.map((issue) => issue.id),
    });
    expect(preview.cases).toBe(2);
    expect(preview.tasks).toBe(1);
    expect(preview.duplicates).toBe(1);
  });

  it("creates one task, skips the duplicate and reports partial success", async () => {
    const { fake, store, conn, projectId } = fakeHarness();
    const state = twoSiblings();
    const cases = issueCasesFrom(state);
    const result = await bulkCreateTasks({
      projectId,
      state,
      store,
      provider: fake,
      connection: conn,
      caseIds: cases.map((issue) => issue.id),
      createdBy: "rae@webflow.com",
    });
    expect(result.results.map((item) => item.status)).toEqual(["created", "skipped"]);
    expect(result.results[1].reason).toMatch(/shares a fix/);
    expect(result.ok).toBe(true);
    expect(fake.tasks).toHaveLength(1);
  });

  it("keeps the successes when one item fails", async () => {
    const { fake, store, conn, projectId } = fakeHarness();
    const state = stateWith({
      recs: [
        rec({ key: "home:alpha", pageId: "home", id: "alpha", title: "Alpha problem", ...planned("alpha") }),
        rec({ key: "docs:gamma", pageId: "docs", id: "gamma", title: "Gamma problem", ...planned("gamma", ["Fix the gamma thing."]) }),
      ],
    });
    const cases = issueCasesFrom(state);
    // Fail the second create, after the first has been created.
    let calls = 0;
    const original = fake.createTask.bind(fake);
    fake.createTask = async (input) => {
      calls += 1;
      if (calls === 2) throw new Error("provider down");
      return original(input);
    };
    const result = await bulkCreateTasks({
      projectId,
      state,
      store,
      provider: fake,
      connection: conn,
      caseIds: cases.map((issue) => issue.id),
      createdBy: "rae@webflow.com",
    });
    expect(result.results.map((item) => item.status)).toEqual(["created", "failed"]);
    expect(result.ok).toBe(false);
    expect(fake.tasks).toHaveLength(1);
  });

  it("caps a synchronous batch", async () => {
    const { fake, store, conn, projectId } = fakeHarness();
    const state = twoSiblings();
    await expect(bulkCreateTasks({
      projectId,
      state,
      store,
      provider: fake,
      connection: conn,
      caseIds: Array.from({ length: CASE_BATCH_LIMIT + 1 }, (_, index) => `case-${index}`),
      createdBy: "rae@webflow.com",
    })).rejects.toThrow(/capped/);
  });
});

describe("refresh, notes and the boundary", () => {
  it("records a completion as a note, never as a resolution", async () => {
    const { fake, store, conn, projectId } = fakeHarness();
    const state = twoSiblings();
    const issue = issueCasesFrom(state)[0];
    const created = await createTaskForCase({
      projectId, state, store, provider: fake, connection: conn,
      remediationKey: keyOf(issue), createdBy: "rae@webflow.com",
    });
    if (created.status !== "created") throw new Error("expected a link");
    fake.setTaskState(created.link.externalId, { completed: true, state: "completed" });

    const refreshed = await refreshTaskLink({ store, provider: fake, link: created.link });
    expect(refreshed.completed).toBe(true);
    expect(refreshed.note).toMatch(/not a resolution/);
    expect(refreshed.link.externalState).toBe("completed");

    const noted = await recordTaskNote({ store, link: refreshed.link, kind: "completed", text: refreshed.note! });
    expect(noted).toBe(true);
    // The same ending is one note, not one per refresh.
    expect(await recordTaskNote({ store, link: refreshed.link, kind: "completed", text: refreshed.note! })).toBe(false);

    // Nothing about the case changed: no decision, no transition.
    const after = issueCasesFrom(state).find((candidate) => candidate.id === issue.id);
    expect(after?.state).toBe(issue.state);
  });

  it("closes the task with the dismissal reason when that automation is on", async () => {
    const { fake, store, conn, projectId } = fakeHarness();
    const state = twoSiblings();
    const issue = issueCasesFrom(state)[0];
    const created = await createTaskForCase({
      projectId, state, store, provider: fake, connection: conn,
      remediationKey: keyOf(issue), createdBy: "rae@webflow.com",
    });
    if (created.status !== "created") throw new Error("expected a link");
    await store.saveSettings({
      ...(await store.getSettings()),
      automations: { ...(await store.getSettings()).automations, dismissClosesTask: true },
    });

    const decision: CaseDecisionRecord = {
      decision: "dismiss",
      remediationKey: keyOf(issue),
      reason: "Not now",
      at: AT,
      by: { kind: "person", userId: "rae@webflow.com" },
    };
    const runs = await afterDecision({
      projectId, store, state, decision,
      providerFactory: () => fake,
    });
    expect(runs[0].outcome).toBe("ran");
    expect(fake.tasks[0].completed).toBe(true);
    expect(fake.tasks[0].comments.join("\n")).toContain("Not now");

    // A second dispatch of the same decision does nothing.
    const again = await afterDecision({ projectId, store, state, decision, providerFactory: () => fake });
    expect(again[0].outcome).toBe("already_ran");
  });

  it("reopen comments on and reopens the task", async () => {
    const { fake, store, conn, projectId } = fakeHarness();
    const state = twoSiblings();
    const issue = issueCasesFrom(state)[0];
    const created = await createTaskForCase({
      projectId, state, store, provider: fake, connection: conn,
      remediationKey: keyOf(issue), createdBy: "rae@webflow.com",
    });
    if (created.status !== "created") throw new Error("expected a link");
    fake.setTaskState(created.link.externalId, { completed: true, state: "completed" });
    await store.saveSettings({
      ...(await store.getSettings()),
      automations: { ...(await store.getSettings()).automations, reopenCommentsAndReopens: true },
    });
    const transition: CaseTransitionRecord = {
      caseKey: issue.cause, action: "reopen", at: AT, by: { kind: "person", userId: "rae@webflow.com" },
    };
    const runs = await afterTransition({ projectId, store, state, transition, providerFactory: () => fake });
    expect(runs[0].outcome).toBe("ran");
    expect(fake.tasks[0].completed).toBe(false);
    expect(fake.tasks[0].comments.join("\n")).toMatch(/Reopened in Page Watch/);
  });
});
