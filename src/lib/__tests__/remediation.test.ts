import { describe, expect, it } from "vitest";
import { PRODUCTION_AUDIT_IDS, REMEDIATION_AUDIT_IDS, remediationFor } from "../remediation";
import {
  IssueCaseError,
  accept,
  fromRec,
  groupByCause,
  personActionsFor,
  type IssueCase,
} from "../issue-case";
import { issueCasesFrom } from "../issue-cases";
import type { CasePlanRecord, Rec } from "../types";
import { classifyWebflowPerformance } from "../webflowPerformance";

/**
 * The remediation library, and who wins when two plans are on offer.
 *
 * The properties that matter are stated as decisions: every finding the
 * production project gets has steps, a case with steps can be accepted, a case
 * without them can still be taken on, and a plan a person wrote overrides both.
 */

const AT = "2026-08-20T00:00:00.000Z";
const PERSON = { kind: "person", userId: "rae@webflow.com" } as const;

function makeRec(overrides: Partial<Rec> = {}): Rec {
  return {
    key: "home:unused-javascript",
    pageId: "home",
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

describe("the remediation library", () => {
  it("has steps and a success measure for every audit the production project holds", () => {
    for (const id of PRODUCTION_AUDIT_IDS) {
      const entry = remediationFor(id);
      expect(entry, `${id} has no library entry`).not.toBeNull();
      expect(entry!.steps.length, `${id} has no steps`).toBeGreaterThan(0);
      for (const step of entry!.steps) {
        expect(step.trim(), `${id} has a blank step`).not.toBe("");
      }
      expect(entry!.successCriteria.trim(), `${id} has no success measure`).not.toBe("");
    }
  });

  it("names the change rather than asking for an investigation", () => {
    for (const id of REMEDIATION_AUDIT_IDS) {
      const steps = remediationFor(id)!.steps.join(" ").toLowerCase();
      expect(steps, `${id} asks for an investigation instead of a change`).not.toMatch(/\binvestigat/);
    }
    // The one the brief names.
    expect(remediationFor("lcp-lazy-loaded")!.steps.join(" ")).toMatch(/Eager/);
    expect(remediationFor("lcp-lazy-loaded")!.steps.join(" ")).toMatch(/fetchpriority/);
  });

  it("finds its steps by the title a legacy record carries", () => {
    expect(remediationFor("not-an-audit-id", "Reduce unused JavaScript")).toBe(remediationFor("unused-javascript"));
    expect(remediationFor("not-an-audit-id", "Links do not have a discernible name")).toBe(remediationFor("link-name"));
    expect(remediationFor("not-an-audit-id", "Issue were never logged")).toBeNull();
  });

  it("answers null for an audit nobody has written steps for", () => {
    expect(remediationFor("brand-new-lighthouse-audit")).toBeNull();
    expect(remediationFor("brand-new-lighthouse-audit", "Some new insight")).toBeNull();
  });
});

describe("a Lighthouse case arrives with a plan", () => {
  const lighthouseCase = (overrides: Partial<Rec> = {}): IssueCase =>
    fromRec(makeRec(overrides), { at: AT });
  const withOptions = (
    overrides: Partial<Rec>,
    options: Parameters<typeof fromRec>[1],
  ): IssueCase => fromRec(makeRec(overrides), { at: AT, ...options });

  it("carries the library's steps and success measure", () => {
    const issue = lighthouseCase();
    expect(issue.remediation.steps).toEqual(remediationFor("unused-javascript")!.steps);
    expect(issue.successCriteria).toBe(remediationFor("unused-javascript")!.successCriteria);
  });

  it("passes the Accept guard, which is what fills the Fix queue", () => {
    const issue = lighthouseCase();
    expect(() => accept(issue, { by: PERSON, at: AT })).not.toThrow();
    expect(accept(issue, { by: PERSON, at: AT }).state).toBe("todo");
  });

  it("passes Accept for an accessibility audit the classifier called undocumented", () => {
    const issue = lighthouseCase({
      id: "link-name",
      title: "Links do not have a discernible name",
      webflow: classifyWebflowPerformance("link-name"),
    });
    expect(issue.remediation.steps.length).toBeGreaterThan(0);
    expect(issue.remediation.actionability).toBe("direct");
    expect(() => accept(issue, { by: PERSON, at: AT })).not.toThrow();
  });

  it("keeps the order: explicit steps, then the record's, then the library", () => {
    const explicit = withOptions({}, { remediationSteps: ["Do the one thing."] });
    expect(explicit.remediation.steps).toEqual(["Do the one thing."]);

    const recorded = lighthouseCase({
      agentIssue: {
        caseKey: "home:unused-javascript",
        title: "Reduce unused JavaScript",
        scope: "page",
        capturedAt: AT,
        remediation: ["Steps the record carries."],
        successCriteria: "The record's own measure.",
        verificationCheckIds: [],
      },
    });
    expect(recorded.remediation.steps).toEqual(["Steps the record carries."]);
    expect(recorded.successCriteria).toBe("The record's own measure.");

    // An empty array documented nothing, so the library is the next real answer.
    const empty = lighthouseCase({
      agentIssue: {
        caseKey: "home:unused-javascript",
        title: "Reduce unused JavaScript",
        scope: "page",
        capturedAt: AT,
        remediation: [],
        successCriteria: "",
        verificationCheckIds: [],
      },
    });
    expect(empty.remediation.steps).toEqual(remediationFor("unused-javascript")!.steps);
  });

  it("still offers Take on when the library has nothing", () => {
    const stepless = fromRec(makeRec({ id: "brand-new-audit", title: "Some new insight" }), { at: AT });
    expect(stepless.remediation.steps).toEqual([]);
    expect(() => accept(stepless, { by: PERSON, at: AT })).toThrow(IssueCaseError);
    // Take on is a legal move from New, so the case is not a dead end.
    expect(personActionsFor(stepless.state)).toContain("take_on");
  });

  it("lets a saved plan override the library", () => {
    const plan: CasePlanRecord = {
      caseKey: "unused-javascript",
      steps: ["The plan a person wrote."],
      at: AT,
      by: { kind: "person", userId: "rae@webflow.com" },
    };
    const cases = issueCasesFrom({ pages: [], recs: [makeRec()], casePlans: [plan] });
    const issue = groupByCause(cases, { at: AT })[0];
    expect(issue.remediation.steps).toEqual(["The plan a person wrote."]);
  });
});
