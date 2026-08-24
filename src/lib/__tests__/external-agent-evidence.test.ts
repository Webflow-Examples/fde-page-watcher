import { describe, expect, it } from "vitest";
import type {
  ExternalAgentAuditSnapshot,
  ExternalAgentFinding,
  ExternalAgentOriginAudit,
} from "../agentAudit";
import {
  EXTERNAL_AGENT_FRESH_WINDOW_MS,
  externalAgentCounts,
  externalAgentResultIsDetermined,
  externalAgentResultLabel,
  externalAgentSourceReading,
  externalAgentStatusLabel,
  externalAuditAgeLabel,
  externalAuditForPage,
  externalAuditFreshness,
  orderedExternalFindings,
  pageSupportsExternalAudit,
} from "../externalAgentEvidence";

const NOW = Date.parse("2026-08-24T06:00:00.000Z");

function finding(
  providerCheckId: string,
  result: ExternalAgentFinding["result"],
  overrides: Partial<ExternalAgentFinding> = {},
): ExternalAgentFinding {
  return {
    provider: "ora",
    providerCheckId,
    name: providerCheckId,
    tier: "essential",
    result,
    providerStatus: result,
    ...overrides,
  };
}

function snapshot(overrides: Partial<ExternalAgentAuditSnapshot> = {}): ExternalAgentAuditSnapshot {
  return {
    schemaVersion: 1,
    contractVersion: "1.21.0",
    provider: "ora",
    origin: "https://example.com",
    target: "https://example.com",
    status: "available",
    scannedAt: "2026-08-24T04:00:00.000Z",
    fetchedAt: "2026-08-24T04:05:00.000Z",
    score: 61,
    grade: "C",
    essentials: {
      score: 63,
      label: "Needs attention",
      essential: { earned: 50, available: 80, passing: 5, total: 8 },
      recommended: { earned: 13, available: 20, passing: 2, total: 3 },
      bonusPoints: 1.5,
      issues: ["content-no-js", "openapi-spec"],
    },
    findings: [
      finding("sitemap", "pass"),
      finding("openapi-spec", "failed"),
      finding("pricing-info", "not-applicable"),
      finding("content-no-js", "failed"),
      finding("markdown-negotiation-vary", "partial"),
      finding("function-calling-compat", "unavailable"),
    ],
    reportUrl: "https://ora.ai/score/example.com",
    rawReportKey: "agent-audits/k.json",
    ...overrides,
  };
}

function audit(overrides: Partial<ExternalAgentOriginAudit> = {}): ExternalAgentOriginAudit {
  return {
    provider: "ora",
    origin: "https://example.com",
    status: {
      provider: "ora",
      origin: "https://example.com",
      status: "available",
      lastAttemptedAt: "2026-08-24T04:05:00.000Z",
    },
    snapshots: [snapshot()],
    ...overrides,
  };
}

describe("matching a page to its origin audit", () => {
  it("matches any page path on the audited origin", () => {
    const audits = [audit()];
    expect(externalAuditForPage(audits, "https://example.com/pricing")?.origin)
      .toBe("https://example.com");
    expect(externalAuditForPage(audits, "https://example.com/blog?utm=1#x")?.origin)
      .toBe("https://example.com");
  });

  it("does not match a different origin or scheme", () => {
    const audits = [audit()];
    expect(externalAuditForPage(audits, "https://other.test/")).toBeNull();
    // The scheme is part of the origin.
    expect(externalAuditForPage(audits, "http://example.com/")).toBeNull();
  });

  it("returns null for a page that cannot be audited at all", () => {
    expect(externalAuditForPage([audit()], "https://client.webflow.io/home")).toBeNull();
    expect(pageSupportsExternalAudit("https://client.webflow.io/home")).toBe(false);
    expect(pageSupportsExternalAudit("https://example.com/pricing")).toBe(true);
  });
});

describe("freshness", () => {
  it("treats an audit under a day old as fresh", () => {
    expect(externalAuditFreshness(snapshot(), NOW)).toEqual({ ageMs: 7_200_000, stale: false });
    const old = snapshot({ scannedAt: "2026-08-21T04:00:00.000Z" });
    expect(externalAuditFreshness(old, NOW).stale).toBe(true);
    expect(EXTERNAL_AGENT_FRESH_WINDOW_MS).toBe(86_400_000);
  });

  it("treats a missing or unparseable timestamp as stale, never fresh", () => {
    expect(externalAuditFreshness(null, NOW)).toEqual({ ageMs: null, stale: true });
    expect(externalAuditFreshness(snapshot({ scannedAt: "nonsense" }), NOW).stale).toBe(true);
  });

  it("never reports a negative age from clock skew", () => {
    const future = snapshot({ scannedAt: "2026-08-24T07:00:00.000Z" });
    expect(externalAuditFreshness(future, NOW).ageMs).toBe(0);
  });

  it("labels the age in the largest sensible unit", () => {
    expect(externalAuditAgeLabel(null, NOW)).toBe("never scanned");
    expect(externalAuditAgeLabel(snapshot({ scannedAt: "2026-08-24T05:59:40.000Z" }), NOW))
      .toBe("scanned just now");
    expect(externalAuditAgeLabel(snapshot({ scannedAt: "2026-08-24T05:59:00.000Z" }), NOW))
      .toBe("scanned 1 minute ago");
    expect(externalAuditAgeLabel(snapshot({ scannedAt: "2026-08-24T05:30:00.000Z" }), NOW))
      .toBe("scanned 30 minutes ago");
    expect(externalAuditAgeLabel(snapshot({ scannedAt: "2026-08-24T05:00:00.000Z" }), NOW))
      .toBe("scanned 1 hour ago");
    expect(externalAuditAgeLabel(snapshot(), NOW)).toBe("scanned 2 hours ago");
    expect(externalAuditAgeLabel(snapshot({ scannedAt: "2026-08-21T04:00:00.000Z" }), NOW))
      .toBe("scanned 3 days ago");
  });
});

describe("provider status and result copy", () => {
  it("describes the provider, never the site", () => {
    // A quota or transport problem must not read as a failing check.
    expect(externalAgentStatusLabel("rate-limited"))
      .toBe("Provider limit reached — the last audit is still shown");
    expect(externalAgentStatusLabel("unavailable"))
      .toBe("Provider unavailable — the last audit is still shown");
    expect(externalAgentStatusLabel("pending")).toBe("Audit still running");
    expect(externalAgentStatusLabel("not-found")).toBe("No audit stored yet");
    expect(externalAgentStatusLabel("available")).toBe("Audit complete");
    expect(externalAgentStatusLabel("error")).toBe("Request rejected");
  });

  it("keeps every result state visibly distinct", () => {
    const labels = (["pass", "partial", "failed", "not-applicable", "unavailable"] as const)
      .map(externalAgentResultLabel);
    expect(labels).toEqual(["Passing", "Partial", "Failing", "Not applicable", "Not determined"]);
    // No two states share copy, so partial can never read as pass or fail.
    expect(new Set(labels).size).toBe(labels.length);
  });

  it("separates a real determination from a provider non-answer", () => {
    expect(externalAgentResultIsDetermined("partial")).toBe(true);
    expect(externalAgentResultIsDetermined("not-applicable")).toBe(true);
    expect(externalAgentResultIsDetermined("unavailable")).toBe(false);
  });
});

describe("finding order", () => {
  it("renders the provider's own issue order first, unranked by Page Watch", () => {
    const ordered = orderedExternalFindings(snapshot());
    expect(ordered.slice(0, 2).map((item) => item.providerCheckId))
      .toEqual(["content-no-js", "openapi-spec"]);
  });

  it("groups the remainder by result without reordering within a group", () => {
    const ordered = orderedExternalFindings(snapshot()).map((item) => item.providerCheckId);
    expect(ordered).toEqual([
      "content-no-js",
      "openapi-spec",
      "markdown-negotiation-vary",
      "function-calling-compat",
      "sitemap",
      "pricing-info",
    ]);
  });

  it("includes every finding exactly once", () => {
    const value = snapshot();
    const ordered = orderedExternalFindings(value);
    expect(ordered).toHaveLength(value.findings.length);
    expect(new Set(ordered).size).toBe(value.findings.length);
  });

  it("keeps both readings of a check id repeated across MCP surfaces", () => {
    const value = snapshot({
      essentials: undefined,
      findings: [
        finding("mcp-resource-listing", "pass"),
        finding("mcp-resource-listing", "partial"),
      ],
    });
    expect(orderedExternalFindings(value)).toHaveLength(2);
  });

  it("works with no essentials block at all", () => {
    const value = snapshot({ essentials: undefined });
    expect(orderedExternalFindings(value).map((item) => item.result))
      .toEqual(["failed", "failed", "partial", "unavailable", "pass", "not-applicable"]);
  });

  it("counts each result state separately", () => {
    expect(externalAgentCounts(snapshot())).toEqual({
      failed: 2,
      partial: 1,
      pass: 1,
      notApplicable: 1,
      unavailable: 1,
    });
  });
});

describe("source card reading", () => {
  it("keeps the essentials and provider scores on separate fields", () => {
    const reading = externalAgentSourceReading(audit(), NOW);
    expect(reading).toMatchObject({
      essentialsScore: 63,
      essentialsLabel: "Needs attention",
      providerScore: 61,
      providerGrade: "C",
      ageLabel: "scanned 2 hours ago",
      stale: false,
      partial: false,
      reportUrl: "https://ora.ai/score/example.com",
      contractVersion: "1.21.0",
    });
    // Nothing in the reading is a composite of the two.
    expect(reading?.essentialsScore).not.toBe(reading?.providerScore);
  });

  it("reports an unscoreable essentials reading as null, not zero", () => {
    const reading = externalAgentSourceReading(audit({
      snapshots: [snapshot({
        essentials: { ...snapshot().essentials!, score: null },
      })],
    }), NOW);
    expect(reading?.essentialsScore).toBeNull();
  });

  it("reports a withheld provider score as null, not zero", () => {
    const reading = externalAgentSourceReading(audit({
      snapshots: [snapshot({ score: null, essentials: undefined, grade: undefined })],
    }), NOW);
    expect(reading?.providerScore).toBeNull();
    expect(reading?.providerGrade).toBeNull();
    expect(reading?.essentialsScore).toBeNull();
  });

  it("flags a partial audit so it is not read as finished", () => {
    const reading = externalAgentSourceReading(audit({
      snapshots: [snapshot({ status: "partial" })],
    }), NOW);
    expect(reading?.partial).toBe(true);
  });

  it("uses the newest snapshot when several are stored", () => {
    const reading = externalAgentSourceReading(audit({
      snapshots: [
        snapshot({ scannedAt: "2026-08-22T04:00:00.000Z", score: 40 }),
        snapshot({ scannedAt: "2026-08-24T04:00:00.000Z", score: 61 }),
        snapshot({ scannedAt: "2026-08-23T04:00:00.000Z", score: 55 }),
      ],
    }), NOW);
    expect(reading?.providerScore).toBe(61);
  });

  it("describes a status-only audit without inventing a score", () => {
    const reading = externalAgentSourceReading(audit({ snapshots: [] }), NOW);
    expect(reading).toEqual({
      essentialsScore: null,
      essentialsLabel: null,
      providerScore: null,
      providerGrade: null,
      ageLabel: "never scanned",
      stale: true,
      partial: false,
      reportUrl: null,
      contractVersion: null,
      counts: null,
    });
  });

  it("returns null when no audit exists", () => {
    expect(externalAgentSourceReading(null, NOW)).toBeNull();
  });
});
