import { describe, expect, it } from "vitest";
import { CULPRIT_EVIDENCE_AUDIT_IDS, CULPRIT_EVIDENCE_PRIMARY_FACT_AUDIT_IDS } from "../culpritEvidence";
import { DOCUMENTED_WEBFLOW_AUDIT_IDS } from "../webflowPerformance";

// `culpritEvidence.ts` and `webflowPerformance.ts` each maintain their own
// hand-written list of Lighthouse audit IDs for unrelated reasons (structured
// evidence extraction vs. customer remediation guidance). Nothing at the
// type level keeps them in sync, so this guards against silent drift: any ID
// culpritEvidence.ts knows how to extract evidence for should also be a
// documented, customer-facing audit in the remediation catalog.
describe("culprit evidence / Webflow performance catalog parity", () => {
  it("keeps every culprit-evidence audit ID inside the documented remediation catalog", () => {
    const documented = new Set(DOCUMENTED_WEBFLOW_AUDIT_IDS);
    const undocumented = CULPRIT_EVIDENCE_AUDIT_IDS.filter((id) => !documented.has(id));
    expect(undocumented).toEqual([]);
  });

  it("keeps every primary-fact audit ID inside the culprit-evidence title catalog", () => {
    const titled = new Set(CULPRIT_EVIDENCE_AUDIT_IDS);
    const untitled = CULPRIT_EVIDENCE_PRIMARY_FACT_AUDIT_IDS.filter((id) => !titled.has(id));
    expect(untitled).toEqual([]);
  });
});
