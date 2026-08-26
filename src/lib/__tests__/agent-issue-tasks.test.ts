import { describe, expect, it } from "vitest";
import {
  agentIssueRec,
  agentIssueRecId,
  agentTasksAwaitingVerification,
  applyAgentVerificationResults,
  beginAgentVerification,
  promoteAgentIssueToTask,
  recordAgentVerificationFailure,
  reconcileAgentIssueRecsInState,
  reopenReturnedAgentTask,
  verificationTargetsFor,
} from "../agentIssueTasks";
import type { AgentIssueCase } from "../agentIssueCases";
import type { AgentIssueVerificationResult, AppState, Rec, WatchPage } from "../types";

const NOW = new Date("2026-08-24T06:00:00.000Z");

function page(id = "home"): WatchPage {
  return {
    id,
    title: "Homepage",
    url: "https://example.com",
    flag: "watching",
    status: "pending",
    current: {
      mobile: { perf: 0, a11y: 0, bp: 0, seo: 0 },
      desktop: { perf: 0, a11y: 0, bp: 0, seo: 0 },
    },
    history: [],
    markers: [],
    agent: [],
  } as unknown as WatchPage;
}

function issue(overrides: Partial<AgentIssueCase> = {}): AgentIssueCase {
  return {
    key: "agent-api:openapi",
    title: "Agents cannot reliably discover machine-readable API documentation",
    consequence: "Without a published contract an agent has to infer endpoints.",
    scope: "origin",
    half: "comprehension",
    status: "failed",
    tier: "essential",
    confidence: "corroborated",
    sources: [
      { system: "page-watch", label: "API Catalog", result: "failed", scope: "page", observedAt: "2026-08-24T05:40:00.000Z" },
      { system: "ora", label: "OpenAPI spec published", result: "failed", scope: "origin", observedAt: "2026-08-24T04:00:00.000Z", providerCheckId: "openapi-spec" },
    ],
    remediation: ["Publish an OpenAPI document.", "Link it from the API catalog."],
    successCriteria: "An OpenAPI document is reachable.",
    verificationCheckIds: ["openapi-spec", "api-catalog-rfc9727"],
    ...overrides,
  };
}

function state(recs: Rec[] = [], pages: WatchPage[] = [page()]): AppState {
  return { pages, recs, jobs: [], followUps: [] };
}

function casesFor(cases: AgentIssueCase[], pageId = "home") {
  return new Map([[pageId, { cases, origin: "https://example.com" }]]);
}

function result(
  checkId: string,
  value: AgentIssueVerificationResult["result"],
): AgentIssueVerificationResult {
  return { checkId, result: value, observedAt: "2026-08-24T07:00:00.000Z" };
}

describe("creating a task from an issue case", () => {
  it("retains the identifiers a later verification needs", () => {
    const rec = agentIssueRec(page(), issue(), NOW, "https://example.com");
    expect(rec.id).toBe(agentIssueRecId("agent-api:openapi"));
    expect(rec.source).toBe("agent-readiness");
    expect(rec.category).toBe("Agent access");
    expect(rec.agentIssue).toMatchObject({
      caseKey: "agent-api:openapi",
      scope: "origin",
      origin: "https://example.com",
      successCriteria: "An OpenAPI document is reachable.",
      verificationCheckIds: ["openapi-spec", "api-catalog-rfc9727"],
      // The newest source timestamp, kept as the audit trail.
      capturedAt: "2026-08-24T05:40:00.000Z",
    });
    // Page Watch's own steps travel with the task.
    expect(rec.agentIssue?.remediation).toEqual([
      "Publish an OpenAPI document.",
      "Link it from the API catalog.",
    ]);
  });

  it("summarizes the consequence and how many sources agree", () => {
    expect(agentIssueRec(page(), issue(), NOW).aiSummary)
      .toBe("Without a published contract an agent has to infer endpoints. Reported independently by 2 sources.");
    const single = issue({
      sources: [{ system: "ora", label: "OpenAPI", result: "failed", scope: "origin", providerCheckId: "openapi-spec" }],
    });
    expect(agentIssueRec(page(), single, NOW).aiSummary).toContain("Reported by one source.");
  });

  it("promotes any issue on request, as a task rather than an inbox item", () => {
    const draft = state();
    const rec = promoteAgentIssueToTask(draft, "home", issue({ tier: "recommended" }), NOW);
    expect(rec.status).toBe("task");
    expect(draft.recs).toHaveLength(1);
  });

  it("does not duplicate a task when promoted twice", () => {
    const draft = state();
    promoteAgentIssueToTask(draft, "home", issue(), NOW);
    promoteAgentIssueToTask(draft, "home", issue(), NOW);
    expect(draft.recs).toHaveLength(1);
  });

  it("preserves verification state when re-promoted", () => {
    const draft = state();
    const rec = promoteAgentIssueToTask(draft, "home", issue(), NOW);
    beginAgentVerification(rec, NOW);
    promoteAgentIssueToTask(draft, "home", issue(), NOW);
    expect(draft.recs[0].agentIssue?.verification?.status).toBe("verifying");
  });
});

describe("auto-filing essential blockers", () => {
  it("files a failing essential issue into the inbox", () => {
    const draft = state();
    const counts = reconcileAgentIssueRecsInState(draft, casesFor([issue()]), NOW);
    expect(counts.created).toBe(1);
    expect(draft.recs[0].status).toBe("inbox");
    expect(draft.recs[0].agentIssue?.caseKey).toBe("agent-api:openapi");
  });

  it("leaves non-essential and non-failing issues for the user to promote", () => {
    const draft = state();
    reconcileAgentIssueRecsInState(draft, casesFor([
      issue({ key: "agent-api:rate-limits", tier: "recommended" }),
      issue({ key: "agent-content:no-js", status: "partial" }),
      issue({ key: "agent-mcp:resources", status: "not-applicable" }),
      issue({ key: "agent-discoverability:dns", status: "ignored" }),
    ]), NOW);
    expect(draft.recs).toEqual([]);
  });

  it("files each blocker once, however often reconciliation runs", () => {
    const draft = state();
    reconcileAgentIssueRecsInState(draft, casesFor([issue()]), NOW);
    const second = reconcileAgentIssueRecsInState(draft, casesFor([issue()]), NOW);
    expect(second.created).toBe(0);
    expect(draft.recs).toHaveLength(1);
  });

  it("never reopens work the user already triaged", () => {
    const draft = state();
    reconcileAgentIssueRecsInState(draft, casesFor([issue()]), NOW);
    draft.recs[0].status = "ignored";
    reconcileAgentIssueRecsInState(draft, casesFor([issue()]), NOW);
    expect(draft.recs).toHaveLength(1);
    expect(draft.recs[0].status).toBe("ignored");
  });

  it("refreshes evidence on an existing task without disturbing its status", () => {
    const draft = state();
    reconcileAgentIssueRecsInState(draft, casesFor([issue()]), NOW);
    draft.recs[0].status = "task";
    draft.recs[0].taskStatus = "in-progress";
    const counts = reconcileAgentIssueRecsInState(draft, casesFor([
      issue({ verificationCheckIds: ["openapi-spec"] }),
    ]), NOW);
    expect(counts.updated).toBe(1);
    expect(draft.recs[0].agentIssue?.verificationCheckIds).toEqual(["openapi-spec"]);
    expect(draft.recs[0].status).toBe("task");
    expect(draft.recs[0].taskStatus).toBe("in-progress");
  });

  it("ignores pages with no assembled cases", () => {
    const draft = state();
    expect(reconcileAgentIssueRecsInState(draft, new Map(), NOW)).toEqual({ created: 0, updated: 0 });
  });
});

describe("verification lifecycle", () => {
  function taskAwaitingVerification(): { draft: AppState; rec: Rec } {
    const draft = state();
    const rec = promoteAgentIssueToTask(draft, "home", issue(), NOW);
    rec.taskStatus = "done";
    rec.doneDate = "Aug 24";
    beginAgentVerification(rec, NOW);
    return { draft, rec };
  }

  it("lists only completed agent tasks that a provider can actually confirm", () => {
    const { draft, rec } = taskAwaitingVerification();
    expect(agentTasksAwaitingVerification(draft)).toEqual([rec]);

    // A task with no provider coverage is never left waiting forever.
    const uncovered = state();
    const bare = promoteAgentIssueToTask(uncovered, "home", issue({
      key: "agent-discoverability:dns",
      verificationCheckIds: [],
    }), NOW);
    bare.taskStatus = "done";
    expect(agentTasksAwaitingVerification(uncovered)).toEqual([]);
  });

  it("resolves only when every selected check is clean", () => {
    const { rec } = taskAwaitingVerification();
    const verification = applyAgentVerificationResults(rec, [
      result("openapi-spec", "pass"),
      result("api-catalog-rfc9727", "pass"),
    ], NOW);
    expect(verification.status).toBe("resolved");
    expect(rec.agentIssue?.verification?.status).toBe("resolved");
  });

  it("accepts a correctly not-applicable check as resolved", () => {
    const { rec } = taskAwaitingVerification();
    expect(applyAgentVerificationResults(rec, [
      result("openapi-spec", "pass"),
      result("api-catalog-rfc9727", "not-applicable"),
    ], NOW).status).toBe("resolved");
  });

  it("returns the issue when any selected check is still failing or partial", () => {
    for (const outcome of ["failed", "partial"] as const) {
      const { rec } = taskAwaitingVerification();
      expect(applyAgentVerificationResults(rec, [
        result("openapi-spec", "pass"),
        result("api-catalog-rfc9727", outcome),
      ], NOW).status).toBe("returned");
    }
  });

  it("stays verifying when the provider answered for only some targets", () => {
    const { rec } = taskAwaitingVerification();
    // A clean partial answer is not enough to declare the fix proven.
    expect(applyAgentVerificationResults(rec, [result("openapi-spec", "pass")], NOW).status)
      .toBe("verifying");
  });

  it("leaves the issue verifying when the provider could not answer", () => {
    const { rec } = taskAwaitingVerification();
    const verification = applyAgentVerificationResults(rec, [
      result("openapi-spec", "unavailable"),
      result("api-catalog-rfc9727", "unavailable"),
    ], NOW);
    // Provider silence is never evidence that a remediation failed.
    expect(verification.status).toBe("verifying");
  });

  it("ignores results for checks this task never targeted", () => {
    const { rec } = taskAwaitingVerification();
    const verification = applyAgentVerificationResults(rec, [
      result("openapi-spec", "pass"),
      result("api-catalog-rfc9727", "pass"),
      result("something-else", "failed"),
    ], NOW);
    expect(verification.status).toBe("resolved");
    expect(verification.results?.map((item) => item.checkId))
      .toEqual(["openapi-spec", "api-catalog-rfc9727"]);
  });

  it("keeps a provider failure retryable and clears it on the next answer", () => {
    const { rec } = taskAwaitingVerification();
    recordAgentVerificationFailure(rec, { code: "RATE_LIMITED", message: "Daily limit" }, NOW);
    expect(rec.agentIssue?.verification).toMatchObject({
      status: "verifying",
      errorCode: "RATE_LIMITED",
    });
    applyAgentVerificationResults(rec, [
      result("openapi-spec", "pass"),
      result("api-catalog-rfc9727", "pass"),
    ], NOW);
    expect(rec.agentIssue?.verification?.status).toBe("resolved");
    expect(rec.agentIssue?.verification?.errorCode).toBeUndefined();
  });

  it("reopens a returned task so it comes back into open work", () => {
    const { rec } = taskAwaitingVerification();
    applyAgentVerificationResults(rec, [result("openapi-spec", "failed")], NOW);
    expect(rec.agentIssue?.verification?.status).toBe("returned");
    expect(reopenReturnedAgentTask(rec)).toBe(true);
    expect(rec.taskStatus).toBe("in-progress");
    expect(rec.doneDate).toBeNull();
  });

  it("does not reopen a resolved or still-verifying task", () => {
    const { rec } = taskAwaitingVerification();
    applyAgentVerificationResults(rec, [
      result("openapi-spec", "pass"),
      result("api-catalog-rfc9727", "pass"),
    ], NOW);
    expect(reopenReturnedAgentTask(rec)).toBe(false);
    expect(rec.taskStatus).toBe("done");
  });

  it("deduplicates verification targets", () => {
    const rec = agentIssueRec(page(), issue({
      verificationCheckIds: ["openapi-spec", "openapi-spec", "api-catalog-rfc9727"],
    }), NOW);
    expect(verificationTargetsFor(rec)).toEqual(["openapi-spec", "api-catalog-rfc9727"]);
  });
});
