import { describe, expect, it } from "vitest";
import {
  actionableExternalAgentFindings,
  EXTERNAL_AGENT_AUDIT_READ_LIMIT,
  EXTERNAL_AGENT_AUDIT_RETENTION_SNAPSHOTS,
  externalAgentAuditSummary,
  externalAgentAuditsFromRows,
  latestExternalAgentSnapshot,
  type ExternalAgentAuditSnapshot,
  type ExternalAgentAuditSnapshotRow,
  type ExternalAgentAuditStatusRow,
} from "../agentAudit";

function snapshot(overrides: Partial<ExternalAgentAuditSnapshot> = {}): ExternalAgentAuditSnapshot {
  return {
    schemaVersion: 1,
    contractVersion: "1.20.1",
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
      issues: ["content-no-js"],
    },
    findings: [
      {
        provider: "ora",
        providerCheckId: "content-no-js",
        name: "Content without JavaScript",
        tier: "essential",
        result: "failed",
        providerStatus: "fail",
        issueKey: "agent-content:no-js",
      },
      {
        provider: "ora",
        providerCheckId: "sitemap",
        name: "Sitemap exists",
        tier: "recommended",
        result: "pass",
        providerStatus: "pass",
      },
      {
        provider: "ora",
        providerCheckId: "markdown-negotiation-vary",
        name: "Markdown content negotiation",
        tier: "essential",
        result: "partial",
        providerStatus: "warning",
      },
      {
        provider: "ora",
        providerCheckId: "pricing-info",
        name: "Pricing info accessible",
        tier: "essential",
        result: "not-applicable",
        providerStatus: "na",
        applicability: "No commercial offering",
      },
      {
        provider: "ora",
        providerCheckId: "function-calling-compat",
        name: "Function calling compatibility",
        tier: "recommended",
        result: "unavailable",
        providerStatus: "error",
      },
    ],
    reportUrl: "https://ora.ai/score/example.com",
    rawReportKey: "agent-audits/t/ora/abc/2026-08-24T04-00-00-000Z.json",
    ...overrides,
  };
}

function snapshotRow(
  overrides: Partial<ExternalAgentAuditSnapshotRow> = {},
): ExternalAgentAuditSnapshotRow {
  const value = snapshot();
  return {
    provider: "ora",
    origin: value.origin,
    scanned_at: value.scannedAt,
    fetched_at: value.fetchedAt,
    contract_version: value.contractVersion ?? null,
    score: value.score,
    essentials_score: value.essentials?.score ?? null,
    summary_json: JSON.stringify(externalAgentAuditSummary(value)),
    raw_report_key: value.rawReportKey,
    ...overrides,
  };
}

function statusRow(
  overrides: Partial<ExternalAgentAuditStatusRow> = {},
): ExternalAgentAuditStatusRow {
  return {
    provider: "ora",
    origin: "https://example.com",
    status: "available",
    latest_scanned_at: "2026-08-24T04:00:00.000Z",
    last_attempted_at: "2026-08-24T04:05:00.000Z",
    last_succeeded_at: "2026-08-24T04:05:00.000Z",
    next_eligible_at: null,
    error_code: null,
    error_message: null,
    ...overrides,
  };
}

describe("external agent audit read model", () => {
  it("round-trips a snapshot through the compact summary and its own columns", () => {
    const [audit] = externalAgentAuditsFromRows([snapshotRow()], [statusRow()]);
    expect(audit.provider).toBe("ora");
    expect(audit.origin).toBe("https://example.com");
    expect(audit.snapshots).toHaveLength(1);
    expect(audit.snapshots[0]).toEqual(snapshot());
  });

  it("round-trips every optional snapshot field through the summary", () => {
    const full = snapshot({
      status: "partial",
      pendingChecks: ["openapi-spec", "mcp-server"],
      servedFromCache: true,
      resultAgeSeconds: 1_800,
    });
    const [audit] = externalAgentAuditsFromRows([snapshotRow({
      summary_json: JSON.stringify(externalAgentAuditSummary(full)),
    })], []);
    expect(audit.snapshots[0]).toEqual(full);
  });

  it("does not duplicate the indexed columns inside the summary", () => {
    const summary = externalAgentAuditSummary(snapshot()) as Record<string, unknown>;
    for (const field of ["origin", "scannedAt", "fetchedAt", "contractVersion", "score", "rawReportKey"]) {
      expect(summary).not.toHaveProperty(field);
    }
    expect(summary.findings).toHaveLength(5);
  });

  it("joins provider status onto the matching origin", () => {
    const [audit] = externalAgentAuditsFromRows([snapshotRow()], [statusRow({
      status: "rate-limited",
      next_eligible_at: "2026-08-24T08:00:00.000Z",
      error_code: "RATE_LIMITED",
      error_message: "Daily scan limit reached",
    })]);
    expect(audit.status).toEqual({
      provider: "ora",
      origin: "https://example.com",
      status: "rate-limited",
      latestScannedAt: "2026-08-24T04:00:00.000Z",
      lastAttemptedAt: "2026-08-24T04:05:00.000Z",
      lastSucceededAt: "2026-08-24T04:05:00.000Z",
      nextEligibleAt: "2026-08-24T08:00:00.000Z",
      errorCode: "RATE_LIMITED",
      errorMessage: "Daily scan limit reached",
    });
    // A rate-limited status still surfaces the last successful reading.
    expect(audit.snapshots).toHaveLength(1);
    expect(audit.snapshots[0].score).toBe(61);
  });

  it("returns snapshots oldest first regardless of query order", () => {
    const rows = [
      snapshotRow({ scanned_at: "2026-08-24T04:00:00.000Z" }),
      snapshotRow({ scanned_at: "2026-08-22T04:00:00.000Z" }),
      snapshotRow({ scanned_at: "2026-08-23T04:00:00.000Z" }),
    ];
    const [audit] = externalAgentAuditsFromRows(rows, []);
    expect(audit.snapshots.map((item) => item.scannedAt)).toEqual([
      "2026-08-22T04:00:00.000Z",
      "2026-08-23T04:00:00.000Z",
      "2026-08-24T04:00:00.000Z",
    ]);
    expect(latestExternalAgentSnapshot(audit)?.scannedAt).toBe("2026-08-24T04:00:00.000Z");
  });

  it("caps the snapshots returned per origin", () => {
    const rows = Array.from({ length: 40 }, (_value, index) =>
      snapshotRow({ scanned_at: `2026-07-${String(index + 1).padStart(2, "0")}T04:00:00.000Z` }));
    const [audit] = externalAgentAuditsFromRows(rows, []);
    expect(audit.snapshots).toHaveLength(EXTERNAL_AGENT_AUDIT_READ_LIMIT);
    expect(externalAgentAuditsFromRows(rows, [], 3)[0].snapshots).toHaveLength(3);
  });

  it("keeps each provider/origin pair separate", () => {
    const audits = externalAgentAuditsFromRows(
      [snapshotRow(), snapshotRow({ origin: "https://other.test" })],
      [statusRow(), statusRow({ origin: "https://other.test", status: "pending" })],
    );
    expect(audits.map((audit) => audit.origin))
      .toEqual(["https://example.com", "https://other.test"]);
    expect(audits[1].status?.status).toBe("pending");
  });

  it("skips a snapshot whose summary is unreadable rather than half-building it", () => {
    const audits = externalAgentAuditsFromRows(
      [snapshotRow({ summary_json: "{not json" }), snapshotRow({ scanned_at: "2026-08-25T04:00:00.000Z" })],
      [],
    );
    expect(audits[0].snapshots).toHaveLength(1);
    expect(audits[0].snapshots[0].scannedAt).toBe("2026-08-25T04:00:00.000Z");
  });

  it("skips a summary that is valid JSON but not a summary", () => {
    expect(externalAgentAuditsFromRows([snapshotRow({ summary_json: "[]" })], [])[0].snapshots)
      .toEqual([]);
    expect(externalAgentAuditsFromRows([snapshotRow({ summary_json: '{"a":1}' })], [])[0].snapshots)
      .toEqual([]);
  });

  it("surfaces a status with no stored snapshot yet", () => {
    const [audit] = externalAgentAuditsFromRows([], [statusRow({
      status: "not-found",
      latest_scanned_at: null,
      last_succeeded_at: null,
    })]);
    expect(audit.snapshots).toEqual([]);
    expect(audit.status?.status).toBe("not-found");
    expect(audit.status?.latestScannedAt).toBeUndefined();
  });

  it("surfaces a snapshot with no status row", () => {
    const [audit] = externalAgentAuditsFromRows([snapshotRow()], []);
    expect(audit.status).toBeNull();
    expect(audit.snapshots).toHaveLength(1);
  });

  it("returns nothing when the tenant has no external evidence", () => {
    expect(externalAgentAuditsFromRows([], [])).toEqual([]);
  });

  it("treats a null score as 'could not evaluate', not zero", () => {
    const [audit] = externalAgentAuditsFromRows([snapshotRow({ score: null })], []);
    expect(audit.snapshots[0].score).toBeNull();
  });

  it("counts only failed and partial findings as actionable", () => {
    const actionable = actionableExternalAgentFindings(snapshot());
    expect(actionable.map((finding) => finding.providerCheckId))
      .toEqual(["content-no-js", "markdown-negotiation-vary"]);
  });

  it("retains snapshots on the order of the CrUX history depth", () => {
    expect(EXTERNAL_AGENT_AUDIT_RETENTION_SNAPSHOTS).toBe(60);
  });
});
