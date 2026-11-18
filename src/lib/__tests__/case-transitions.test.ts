import { describe, expect, it } from "vitest";
import type { Caller } from "../caller";
import { caseTransitionFrom } from "../case-transitions";
import { remediationKey } from "../issue-case";
import { issueCasesFrom } from "../issue-cases";
import { buildSeedState } from "../seed";
import type { CaseDecisionRecord, CaseTransitionRecord } from "../types";

const PERSON: Caller = { kind: "person", userId: "rae@webflow.com" };
const AT = "2026-08-20T12:00:00.000Z";
const LATER = "2026-08-21T12:00:00.000Z";
const CAUSE = "render-blocking-resources";

function seed() {
  const state = buildSeedState();
  const issue = issueCasesFrom(state).find((item) => item.cause === CAUSE)!;
  const accept: CaseDecisionRecord[] = [{
    decision: "accept",
    remediationKey: remediationKey(issue),
    at: AT,
    by: PERSON,
  }];
  return { state, issue, accept };
}

function derive(
  state: ReturnType<typeof seed>["state"],
  accept: CaseDecisionRecord[],
  transitions: CaseTransitionRecord[],
) {
  return issueCasesFrom({ ...state, caseDecisions: accept, caseTransitions: transitions })
    .find((item) => item.cause === CAUSE)!;
}

function transition(action: "start" | "mark_fixed" | "reopen" | "resolve", at = AT) {
  return caseTransitionFrom({ caseKey: CAUSE, action }, { at, by: PERSON });
}

describe("the case transition log", () => {
  it("starts an accepted case and records the owner", () => {
    const { state, accept } = seed();
    const started = derive(state, accept, [transition("start")]);
    expect(started.state).toBe("in_progress");
    expect(started.owner).toBe("rae@webflow.com");
  });

  it("schedules every checkpoint when the case is marked fixed", () => {
    const { state, accept } = seed();
    const fixed = derive(state, accept, [transition("start"), transition("mark_fixed", LATER)]);
    expect(fixed.state).toBe("fixed");
    expect(fixed.checkpoints.map((checkpoint) => checkpoint.interval)).toEqual(["2d", "7d", "30d"]);
    expect(fixed.checkpoints.every((checkpoint) => checkpoint.result === "scheduled")).toBe(true);
  });

  it("refuses resolve until the resolving checkpoint agrees", () => {
    const { state, accept } = seed();
    const stuck = derive(state, accept, [
      transition("start"),
      transition("mark_fixed", LATER),
      transition("resolve", LATER),
    ]);
    expect(stuck.state).toBe("fixed");
  });

  it("reopens a fixed case", () => {
    const { state, accept } = seed();
    const reopened = derive(state, accept, [
      transition("start"),
      transition("mark_fixed", LATER),
      transition("reopen", LATER),
    ]);
    expect(reopened.state).toBe("reopened");
  });

  it("skips a transition the case has already moved past", () => {
    const { state, accept } = seed();
    const skipped = derive(state, accept, [transition("start"), transition("start", LATER)]);
    expect(skipped.state).toBe("in_progress");
  });

  it("never applies a transition to a case with another cause", () => {
    const { state, accept } = seed();
    const other = issueCasesFrom({ ...state, caseDecisions: accept, caseTransitions: [transition("start")] })
      .find((item) => item.cause === "unused-css-rules")!;
    expect(other.state).toBe("todo");
  });

  it("replays a second accept after a reopen", () => {
    const { state, accept } = seed();
    const secondAccept: CaseDecisionRecord = {
      ...accept[0],
      at: "2026-08-23T12:00:00.000Z",
    };
    const reopened = derive(state, [...accept, secondAccept], [
      transition("start"),
      transition("mark_fixed", LATER),
      transition("reopen", "2026-08-22T12:00:00.000Z"),
    ]);
    expect(reopened.state).toBe("todo");
  });

  it("refuses an entry without an action or a case key", () => {
    expect(() => caseTransitionFrom({ caseKey: CAUSE }, { at: AT, by: PERSON })).toThrow(/action/);
    expect(() => caseTransitionFrom({ action: "start" }, { at: AT, by: PERSON })).toThrow(/caseKey/);
  });
});
