import { describe, expect, it } from "vitest";
import {
  actionableAgentIssueCases,
  AGENT_ISSUE_FAMILIES,
  assembleAgentIssueCases,
  determinedAgentIssueCases,
  disputedAgentIssueCases,
  essentialAgentBlockers,
  familyForLocalCheck,
  familyForOraCheck,
  type AgentIssueCase,
} from "../agentIssueCases";
import { ORA_CHECK_ISSUE_KEYS } from "../ora";
import { ALL_AGENT_CHECKS } from "../agentChecks";
import type { ExternalAgentFinding, ExternalAgentOriginAudit } from "../agentAudit";
import type { AgentCheck } from "../types";
import { EVIDENCE_SOURCE_LABEL } from "../vocabulary";

function check(name: string, pass: boolean, extra: Partial<AgentCheck> = {}): AgentCheck {
  const known = ALL_AGENT_CHECKS.find((item) => item.name === name);
  return { name, group: known?.group ?? "Discoverability", pass, ...extra };
}

function finding(
  providerCheckId: string,
  result: ExternalAgentFinding["result"],
  extra: Partial<ExternalAgentFinding> = {},
): ExternalAgentFinding {
  return {
    provider: "ora",
    providerCheckId,
    name: providerCheckId,
    tier: "essential",
    result,
    providerStatus: result,
    ...extra,
  };
}

function audit(findings: ExternalAgentFinding[]): ExternalAgentOriginAudit {
  return {
    provider: "ora",
    origin: "https://example.com",
    status: {
      provider: "ora",
      origin: "https://example.com",
      status: "available",
      lastAttemptedAt: "2026-08-24T06:00:00.000Z",
    },
    snapshots: [{
      schemaVersion: 1,
      provider: "ora",
      origin: "https://example.com",
      target: "https://example.com",
      status: "available",
      scannedAt: "2026-08-24T04:00:00.000Z",
      fetchedAt: "2026-08-24T04:05:00.000Z",
      score: 61,
      findings,
      rawReportKey: "k",
    }],
  };
}

function caseFor(cases: AgentIssueCase[], key: string): AgentIssueCase {
  const match = cases.find((item) => item.key === key);
  if (!match) throw new Error(`no case for ${key}; got ${cases.map((c) => c.key).join(", ")}`);
  return match;
}

describe("crosswalk integrity", () => {
  it("agrees with the Phase 1 parser crosswalk", () => {
    // Two maps that disagree would route a fix to the wrong issue.
    for (const [providerCheckId, family] of Object.entries(ORA_CHECK_ISSUE_KEYS)) {
      expect(familyForOraCheck(providerCheckId)).toBe(family);
    }
  });

  it("maps only real Page Watch check names", () => {
    const known = new Set(ALL_AGENT_CHECKS.map((item) => item.name));
    for (const [key, family] of Object.entries(AGENT_ISSUE_FAMILIES)) {
      for (const name of family.localChecks ?? []) {
        expect(known, `${key} references unknown local check ${name}`).toContain(name);
      }
    }
  });

  it("assigns each check to at most one family", () => {
    const localSeen = new Set<string>();
    const oraSeen = new Set<string>();
    for (const family of Object.values(AGENT_ISSUE_FAMILIES)) {
      for (const name of family.localChecks ?? []) {
        expect(localSeen.has(name), `${name} mapped twice`).toBe(false);
        localSeen.add(name);
      }
      for (const id of family.oraChecks ?? []) {
        expect(oraSeen.has(id), `${id} mapped twice`).toBe(false);
        oraSeen.add(id);
      }
    }
  });

  it("resolves a local check name to its family", () => {
    expect(familyForLocalCheck("robots.txt")).toBe("agent-discoverability:robots");
    expect(familyForLocalCheck("API Catalog")).toBe("agent-api:openapi");
    expect(familyForLocalCheck("Not a check")).toBeUndefined();
  });
});

describe("merging overlapping evidence", () => {
  it("produces one case when Page Watch and Ora both cover an issue", () => {
    const cases = assembleAgentIssueCases({
      checks: [check("API Catalog", false)],
      checksObservedAt: "2026-08-24T05:42:00.000Z",
      audit: audit([finding("openapi-spec", "failed"), finding("api-catalog-rfc9727", "failed")]),
    });
    const item = caseFor(cases, "agent-api:openapi");
    // One issue, three readings beneath it.
    expect(cases.filter((c) => c.key === "agent-api:openapi")).toHaveLength(1);
    expect(item.sources).toHaveLength(3);
    expect(item.sources.map((s) => s.system)).toEqual(["page-watch", "ora", "ora"]);
    expect(item.status).toBe("failed");
    expect(item.confidence).toBe("corroborated");
    expect(item.verificationCheckIds).toEqual(["openapi-spec", "api-catalog-rfc9727"]);
  });

  it.each([
    ["markdown", "Markdown negotiation", ["markdown-negotiation", "markdown-negotiation-vary"], "agent-content:markdown"],
    ["robots", "robots.txt", ["robots-ai-policy-quality", "robots-agent-user-policy"], "agent-discoverability:robots"],
    ["MCP", "MCP Server Card", ["mcp-server", "mcp-well-known-discovery"], "agent-mcp:discovery"],
  ])("collapses overlapping %s findings into one issue", (_label, localName, oraIds, family) => {
    const cases = assembleAgentIssueCases({
      checks: [check(localName, false)],
      audit: audit(oraIds.map((id) => finding(id, "failed"))),
    });
    expect(cases.filter((item) => item.key === family)).toHaveLength(1);
    expect(caseFor(cases, family).sources).toHaveLength(1 + oraIds.length);
  });

  it("keeps a provider-only check visible and attributed to the provider", () => {
    const cases = assembleAgentIssueCases({
      checks: [],
      audit: audit([finding("graphql-pagination-pattern", "failed", {
        name: "GraphQL pagination pattern",
        recommendation: "Adopt cursor pagination.",
      })]),
    });
    const item = caseFor(cases, "ora:graphql-pagination-pattern");
    expect(item.title).toBe("GraphQL pagination pattern");
    expect(item.sources).toEqual([expect.objectContaining({ system: "ora" })]);
    expect(item.confidence).toBe("single-source");
    // Provider prose is attributed, never presented as Page Watch's own guidance.
    expect(item.remediation).toEqual(["Ora suggests: Adopt cursor pagination."]);
  });

  it("never presents provider prose as a guaranteed impact", () => {
    const cases = assembleAgentIssueCases({
      checks: [],
      audit: audit([
        finding("openapi-spec", "failed", { recommendation: "Publish OpenAPI and your score will rise." }),
        finding("graphql-batch-mutations", "failed", { recommendation: "Add batch mutations." }),
      ]),
    });
    // A mapped family uses Page Watch's own steps, not the provider's sentence.
    const mapped = caseFor(cases, "agent-api:openapi");
    expect(mapped.remediation).toEqual(AGENT_ISSUE_FAMILIES["agent-api:openapi"].remediation);
    expect(mapped.remediation.join(" ")).not.toContain("score will rise");
    // An unmapped one is quoted with clear attribution.
    expect(caseFor(cases, "ora:graphql-batch-mutations").remediation[0]).toMatch(/^Ora suggests: /);
  });
});

describe("result vocabulary stays distinct", () => {
  it("keeps ignored, not-applicable, unavailable, partial, and failed apart", () => {
    const cases = assembleAgentIssueCases({
      checks: [
        check("robots.txt", false),
        check("Sitemap", true, { unavailable: true }),
        check("WebMCP", false),
      ],
      ignores: { checks: [], groups: ["API / Auth / MCP"] },
      audit: audit([
        finding("markdown-negotiation-vary", "partial"),
        finding("x402-support", "not-applicable", { applicability: "No commerce surface" }),
      ]),
    });
    expect(caseFor(cases, "agent-discoverability:robots").status).toBe("failed");
    expect(caseFor(cases, "agent-discoverability:sitemap").status).toBe("unavailable");
    expect(caseFor(cases, "agent-mcp:webmcp").status).toBe("ignored");
    expect(caseFor(cases, "agent-content:markdown").status).toBe("partial");
    expect(caseFor(cases, "agent-commerce:protocols").status).toBe("not-applicable");
    // Five inputs, five distinct outcomes.
    expect(new Set(cases.map((item) => item.status)).size).toBe(5);
  });

  it("does not let a user ignore silence independent provider evidence", () => {
    const cases = assembleAgentIssueCases({
      checks: [check("Markdown negotiation", false)],
      ignores: { checks: [], groups: ["Content Accessibility"] },
      audit: audit([finding("markdown-negotiation-vary", "failed")]),
    });
    const item = caseFor(cases, "agent-content:markdown");
    // Ignore is a Page Watch policy decision, not a claim about the site.
    expect(item.sources.find((s) => s.system === "page-watch")?.result).toBe("ignored");
    expect(item.status).toBe("failed");
  });

  it("does not let a provider not-applicable override an observed local failure", () => {
    const cases = assembleAgentIssueCases({
      checks: [check("Sitemap", false)],
      audit: audit([finding("sitemap", "not-applicable", { applicability: "Single-page product" })]),
    });
    expect(caseFor(cases, "agent-discoverability:sitemap").status).toBe("failed");
  });

  it("reports disagreement instead of averaging it away", () => {
    const cases = assembleAgentIssueCases({
      checks: [check("Sitemap", true)],
      audit: audit([finding("sitemap", "failed")]),
    });
    const item = caseFor(cases, "agent-discoverability:sitemap");
    expect(item.confidence).toBe("conflicting");
    // Named from the registry's evidence ledger, not from literals here. Rule
    // 21: two copies of a name agreeing proves neither is the decided one, and
    // this assertion used to hold a third spelling — "Page Watch HTTP" — that
    // the ledger never named. Now a relabel in `vocabulary.json` moves the
    // sentence and this check together, and a drift between them fails.
    expect(item.conflict).toContain(EVIDENCE_SOURCE_LABEL.ora);
    expect(item.conflict).toContain(EVIDENCE_SOURCE_LABEL["agent-readiness"]);
    // Both readings survive so a user can judge for themselves.
    expect(item.sources.map((s) => s.result).sort()).toEqual(["failed", "pass"]);
  });

  it("marks a case insufficient when nothing could be determined", () => {
    const cases = assembleAgentIssueCases({
      checks: [check("Sitemap", true, { unavailable: true })],
      audit: audit([finding("sitemap", "unavailable")]),
    });
    expect(caseFor(cases, "agent-discoverability:sitemap").confidence).toBe("insufficient");
  });
});

describe("scope and tier", () => {
  it("records the scope of each reading and of the issue", () => {
    const cases = assembleAgentIssueCases({
      checks: [check("Sitemap", false)],
      audit: audit([finding("sitemap", "failed")]),
    });
    const item = caseFor(cases, "agent-discoverability:sitemap");
    expect(item.scope).toBe("origin");
    expect(item.sources.find((s) => s.system === "page-watch")?.scope).toBe("page");
    expect(item.sources.find((s) => s.system === "ora")?.scope).toBe("origin");
  });

  it("takes the most severe provider tier backing the family", () => {
    const cases = assembleAgentIssueCases({
      checks: [],
      audit: audit([
        finding("mcp-server", "failed", { tier: "recommended" }),
        finding("mcp-well-known-discovery", "failed", { tier: "essential" }),
      ]),
    });
    expect(caseFor(cases, "agent-mcp:discovery").tier).toBe("essential");
  });

  it("leaves a family with no provider coverage unclassified", () => {
    const cases = assembleAgentIssueCases({ checks: [check("DNS for AI Discovery (DNS-AID)", false)] });
    expect(caseFor(cases, "agent-discoverability:dns").tier).toBe("unclassified");
    expect(caseFor(cases, "agent-discoverability:dns").verificationCheckIds).toEqual([]);
  });
});

/**
 * The origin verdict itself lives in `agent-access.ts` and is tested in
 * `agent-access.test.ts`. What this file still owns is the two questions the
 * verdict asks of the cases: did anything determine a result, and do the
 * systems that did agree with each other.
 */
describe("what the cases can support", () => {
  it("never counts an ignored or not-applicable case as an issue", () => {
    const cases = assembleAgentIssueCases({
      checks: [check("WebMCP", false)],
      ignores: { checks: [], groups: ["API / Auth / MCP"] },
      audit: audit([finding("x402-support", "not-applicable")]),
    });
    expect(actionableAgentIssueCases(cases)).toEqual([]);
    expect(determinedAgentIssueCases(cases)).toEqual([]);
  });

  it("determines nothing from an unavailable reading", () => {
    // Rule 18: an absent measurement is not a small measurement.
    const cases = assembleAgentIssueCases({
      checks: [check("Sitemap", true, { unavailable: true })],
    });
    expect(cases).toHaveLength(1);
    expect(determinedAgentIssueCases(cases)).toEqual([]);
  });

  it("reports a case as disputed when two systems contradict each other", () => {
    const cases = assembleAgentIssueCases({
      checks: [check("Sitemap", true)],
      audit: audit([finding("sitemap", "failed")]),
    });
    expect(disputedAgentIssueCases(cases).map((item) => item.key))
      .toEqual(["agent-discoverability:sitemap"]);
    // And it is still determined: two systems read it, they just disagreed.
    expect(determinedAgentIssueCases(cases)).toHaveLength(1);
  });

  it("reports no dispute when the systems agree", () => {
    const cases = assembleAgentIssueCases({
      checks: [check("Sitemap", false)],
      audit: audit([finding("sitemap", "failed")]),
    });
    expect(disputedAgentIssueCases(cases)).toEqual([]);
  });
});

describe("the two halves of agent access", () => {
  it("gives every family a half", () => {
    // Required by the type; asserted here so the two values stay the only two.
    for (const [key, family] of Object.entries(AGENT_ISSUE_FAMILIES)) {
      expect(["reach", "comprehension"], `${key} has half ${family.half}`).toContain(family.half);
    }
  });

  it("puts admission and discovery on the reach side", () => {
    const halves = Object.fromEntries(
      Object.entries(AGENT_ISSUE_FAMILIES).map(([key, family]) => [key, family.half]),
    );
    expect(halves["agent-access:reachability"]).toBe("reach");
    expect(halves["agent-discoverability:robots"]).toBe("reach");
    expect(halves["agent-auth:bot-auth"]).toBe("reach");
    // And everything read out of a response that did arrive on the other.
    expect(halves["agent-content:no-js"]).toBe("comprehension");
    expect(halves["agent-api:openapi"]).toBe("comprehension");
  });

  it("treats a provider-only finding as comprehension", () => {
    // The provider reached the origin — that is the only way it had anything to
    // report — so whatever it found wrong is past the response.
    const cases = assembleAgentIssueCases({
      checks: [],
      audit: audit([finding("pricing-info", "failed")]),
    });
    expect(caseFor(cases, "ora:pricing-info").half).toBe("comprehension");
  });
});

describe("the rendered-page probe", () => {
  const probe = (
    status: "available" | "unavailable",
    httpStatus?: number,
  ) => ({
    schemaVersion: 1 as const,
    engine: "kitesurf" as const,
    status,
    capturedAt: "2026-08-24T02:00:00.000Z",
    ...(httpStatus === undefined ? {} : { httpStatus }),
  });

  it("reads reachability, in its own words", () => {
    const cases = assembleAgentIssueCases({ checks: [], kitesurf: probe("available", 200) });
    const source = caseFor(cases, "agent-access:reachability").sources[0];
    expect(source.system).toBe("kitesurf");
    expect(source.result).toBe("pass");
    expect(source.detail).toBe("HTTP 200");
    expect(source.observedAt).toBe("2026-08-24T02:00:00.000Z");
  });

  it("fails on a status the origin refused with", () => {
    const cases = assembleAgentIssueCases({ checks: [], kitesurf: probe("available", 403) });
    expect(caseFor(cases, "agent-access:reachability").sources[0].result).toBe("failed");
  });

  it("is unavailable rather than failing when the probe itself could not run", () => {
    const cases = assembleAgentIssueCases({ checks: [], kitesurf: probe("unavailable") });
    expect(caseFor(cases, "agent-access:reachability").sources[0].result).toBe("unavailable");
    expect(determinedAgentIssueCases(cases)).toEqual([]);
  });

  it("can contradict the provider about reachability", () => {
    const cases = assembleAgentIssueCases({
      checks: [],
      kitesurf: probe("available", 200),
      audit: audit([finding("bot-detection", "failed")]),
    });
    expect(disputedAgentIssueCases(cases).map((item) => item.key))
      .toEqual(["agent-access:reachability"]);
  });
});

describe("essential blockers", () => {
  it("selects only failing essential-tier issues", () => {
    const cases = assembleAgentIssueCases({
      checks: [],
      audit: audit([
        finding("openapi-spec", "failed", { tier: "essential" }),
        finding("content-no-js", "partial", { tier: "essential" }),
        finding("rate-limit-headers", "failed", { tier: "recommended" }),
      ]),
    });
    expect(essentialAgentBlockers(cases).map((item) => item.key))
      .toEqual(["agent-api:openapi"]);
  });

  it("orders failing issues before partial and passing ones", () => {
    const cases = assembleAgentIssueCases({
      checks: [],
      audit: audit([
        finding("sitemap", "pass"),
        finding("rate-limit-headers", "partial"),
        finding("openapi-spec", "failed"),
      ]),
    });
    expect(cases.map((item) => item.status)).toEqual(["failed", "partial", "pass"]);
  });
});
