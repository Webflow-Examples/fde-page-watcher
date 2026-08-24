import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  AGENT_AUDIT_REPORT_PREFIX,
  ExternalAgentAuditStorageError,
  externalAgentAuditReportKey,
  MAX_AGENT_AUDIT_SUMMARY_BYTES,
  persistExternalAgentAudit,
  readExternalAgentAudits,
  recordExternalAgentAuditStatus,
} from "../ora";
import { handleDataPlaneRequest } from "../dataPlane";
import { parseOraAuditResponse } from "../../src/lib/ora";
import { externalAgentAuditSummary } from "../../src/lib/agentAudit";
import type { ExternalAgentAuditSnapshot } from "../../src/lib/agentAudit";

const TENANT = "brand-studio:live";
const ORIGIN = "https://example.com";

function fixture(name: string): unknown {
  return JSON.parse(readFileSync(
    path.join(__dirname, "..", "..", "src", "lib", "__tests__", "fixtures", `ora-audit-${name}.json`),
    "utf8",
  )) as unknown;
}

function snapshotFrom(name: string, rawReportKey = "agent-audits/k.json"): ExternalAgentAuditSnapshot {
  return parseOraAuditResponse(fixture(name), {
    origin: ORIGIN,
    rawReportKey,
    fetchedAt: "2026-08-24T06:00:00.000Z",
  });
}

interface Statement {
  sql: string;
  values: unknown[];
}

function bindings(rows: {
  snapshots?: Record<string, unknown>[];
  statuses?: Record<string, unknown>[];
} = {}) {
  const statements: Statement[] = [];
  const order: string[] = [];
  const puts: Array<{ key: string; value: string; options?: Record<string, unknown> }> = [];

  const prepare = (sql: string) => {
    const build = (values: unknown[]): Statement & {
      first: () => Promise<null>;
      all: () => Promise<{ results: unknown[] }>;
      run: () => Promise<{ success: boolean; meta: { rows_written: number } }>;
    } => ({
      sql,
      values,
      first: async () => null,
      all: async () => ({
        results: sql.includes("FROM agent_audit_snapshots")
          ? rows.snapshots ?? []
          : sql.includes("FROM agent_audit_status")
            ? rows.statuses ?? []
            : [],
      }),
      run: async () => {
        statements.push({ sql, values });
        order.push("d1");
        return { success: true, meta: { rows_written: 1 } };
      },
    });
    return { bind: (...values: unknown[]) => build(values), ...build([]) };
  };

  const DB = {
    prepare,
    batch: async (batch: Statement[]) => {
      statements.push(...batch.map((statement) => ({ sql: statement.sql, values: statement.values })));
      order.push("d1");
      return batch.map(() => ({ success: true, meta: { rows_written: 1 } }));
    },
  };
  const REPORTS = {
    put: async (key: string, value: string, options?: Record<string, unknown>) => {
      puts.push({ key, value, options });
      order.push("r2");
      return {};
    },
    get: async () => null,
    delete: async () => undefined,
  };
  return { env: { DB, REPORTS } as never, statements, puts, order };
}

function statementFor(statements: Statement[], fragment: string): Statement {
  const match = statements.find((statement) => statement.sql.includes(fragment));
  if (!match) throw new Error(`no statement containing ${fragment}`);
  return match;
}

describe("external agent audit report keys", () => {
  it("scopes the raw payload by tenant, provider, origin hash, and scan time", async () => {
    const key = await externalAgentAuditReportKey(
      TENANT,
      "ora",
      ORIGIN,
      "2026-08-24T04:12:09.482Z",
    );
    expect(key).toMatch(
      new RegExp(`^${AGENT_AUDIT_REPORT_PREFIX}/brand-studio:live/ora/[0-9a-f]{32}/2026-08-24T04-12-09-482Z\\.json$`),
    );
    // Two origins never collide, and one origin is stable across calls.
    expect(await externalAgentAuditReportKey(TENANT, "ora", ORIGIN, "2026-08-24T04:12:09.482Z"))
      .toBe(key);
    expect(await externalAgentAuditReportKey(TENANT, "ora", "https://other.test", "2026-08-24T04:12:09.482Z"))
      .not.toBe(key);
  });
});

describe("external agent audit persistence", () => {
  it("writes the raw payload to R2 before any D1 summary", async () => {
    const { env, order, puts } = bindings();
    await persistExternalAgentAudit(env, TENANT, snapshotFrom("complete"), {
      rawResponse: fixture("complete"),
      request: { url: ORIGIN, maxAgeSeconds: 86_400 },
    });
    expect(order[0]).toBe("r2");
    expect(order).toEqual(["r2", "d1"]);
    expect(puts).toHaveLength(1);

    const envelope = JSON.parse(puts[0].value) as Record<string, unknown>;
    expect(envelope.tenant).toBe(TENANT);
    expect(envelope.provider).toBe("ora");
    expect(envelope.origin).toBe(ORIGIN);
    expect(envelope.contractVersion).toBe("1.21.0");
    // The untruncated provider body is retained exactly as received.
    expect(envelope.response).toEqual(fixture("complete"));
    expect(envelope.request).toEqual({ url: ORIGIN, maxAgeSeconds: 86_400 });
    expect(puts[0].options?.customMetadata).toEqual({
      tenant: TENANT,
      provider: "ora",
      origin: ORIGIN,
      scannedAt: "2026-08-24T04:12:09.482Z",
      status: "available",
    });
  });

  it("indexes the compact summary and both scores in their own columns", async () => {
    const { env, statements } = bindings();
    const snapshot = snapshotFrom("complete", "agent-audits/raw-key.json");
    await persistExternalAgentAudit(env, TENANT, snapshot, { rawResponse: fixture("complete") });

    const insert = statementFor(statements, "INSERT INTO agent_audit_snapshots");
    expect(insert.values.slice(0, 8)).toEqual([
      TENANT,
      "ora",
      ORIGIN,
      "2026-08-24T04:12:09.482Z",
      "2026-08-24T06:00:00.000Z",
      "1.21.0",
      61,
      63,
    ]);
    expect(insert.values[9]).toBe("agent-audits/raw-key.json");
    expect(JSON.parse(String(insert.values[8]))).toEqual(externalAgentAuditSummary(snapshot));
    // Upsert, so a re-read of the same scan replaces rather than duplicates.
    expect(insert.sql).toContain("ON CONFLICT(tenant, provider, origin, scanned_at) DO UPDATE SET");
  });

  it("bounds retention to the newest snapshots per origin", async () => {
    const { env, statements } = bindings();
    await persistExternalAgentAudit(env, TENANT, snapshotFrom("complete"), {
      rawResponse: fixture("complete"),
    });
    const retention = statementFor(statements, "DELETE FROM agent_audit_snapshots");
    expect(retention.values).toEqual([TENANT, "ora", ORIGIN, TENANT, "ora", ORIGIN, 60]);
    expect(retention.sql).toContain("ORDER BY scanned_at DESC LIMIT ?");
  });

  it("records a completed audit as available and a partial one as pending", async () => {
    const complete = bindings();
    const available = await persistExternalAgentAudit(
      complete.env,
      TENANT,
      snapshotFrom("complete"),
      { rawResponse: fixture("complete") },
    );
    expect(available.status).toBe("available");
    expect(statementFor(complete.statements, "INSERT INTO agent_audit_status").values.slice(0, 4))
      .toEqual([TENANT, "ora", ORIGIN, "available"]);

    const partial = bindings();
    const pending = await persistExternalAgentAudit(
      partial.env,
      TENANT,
      snapshotFrom("partial"),
      { rawResponse: fixture("partial") },
    );
    // A partial reading is real evidence, but the audit is not finished.
    expect(pending.status).toBe("pending");
    const status = statementFor(partial.statements, "INSERT INTO agent_audit_status");
    expect(status.values[3]).toBe("pending");
    expect(status.values[4]).toBe("2026-08-24T05:01:00.000Z");
  });

  it("keeps a withheld score null in D1 rather than writing a real zero", async () => {
    const { env, statements } = bindings();
    await persistExternalAgentAudit(env, TENANT, snapshotFrom("mcp-auth-required"), {
      rawResponse: fixture("mcp-auth-required"),
    });
    const insert = statementFor(statements, "INSERT INTO agent_audit_snapshots");
    expect(insert.values[6]).toBeNull();
    expect(insert.values[7]).toBeNull();
  });

  it("refuses an unbounded summary instead of writing an oversized row", async () => {
    const { env, statements, puts } = bindings();
    const snapshot = snapshotFrom("complete");
    const bloated: ExternalAgentAuditSnapshot = {
      ...snapshot,
      findings: Array.from({ length: 400 }, (_value, index) => ({
        ...snapshot.findings[0],
        providerCheckId: `check-${index}`,
        details: "d".repeat(400),
        recommendation: "r".repeat(400),
      })),
    };
    await expect(persistExternalAgentAudit(env, TENANT, bloated, { rawResponse: {} }))
      .rejects.toBeInstanceOf(ExternalAgentAuditStorageError);
    // Rejected before either write, so no orphaned R2 object and no D1 row.
    expect(puts).toEqual([]);
    expect(statements).toEqual([]);
    expect(MAX_AGENT_AUDIT_SUMMARY_BYTES).toBe(256 * 1024);
  });
});

describe("external agent audit provider status", () => {
  it("preserves the last successful audit when an attempt fails", async () => {
    const { env, statements } = bindings();
    await recordExternalAgentAuditStatus(env, {
      tenant: TENANT,
      provider: "ora",
      origin: ORIGIN,
      status: "rate-limited",
      attemptedAt: "2026-08-24T07:00:00.000Z",
      nextEligibleAt: "2026-08-24T11:00:00.000Z",
      errorCode: "RATE_LIMITED",
      errorMessage: "Daily scan limit reached",
    });
    const status = statementFor(statements, "INSERT INTO agent_audit_status");
    expect(status.values).toEqual([
      TENANT,
      "ora",
      ORIGIN,
      "rate-limited",
      null,
      "2026-08-24T07:00:00.000Z",
      null,
      "2026-08-24T11:00:00.000Z",
      "RATE_LIMITED",
      "Daily scan limit reached",
    ]);
    // The prior success markers are coalesced, never overwritten with null.
    expect(status.sql).toContain(
      "latest_scanned_at = COALESCE(excluded.latest_scanned_at, agent_audit_status.latest_scanned_at)",
    );
    expect(status.sql).toContain(
      "last_succeeded_at = COALESCE(excluded.last_succeeded_at, agent_audit_status.last_succeeded_at)",
    );
    // A failed attempt never deletes stored snapshots.
    expect(statements.some((statement) => statement.sql.includes("DELETE"))).toBe(false);
  });
});

describe("external agent audit reads", () => {
  it("builds the read model from both tables for one tenant", async () => {
    const snapshot = snapshotFrom("complete");
    const { env, statements } = bindings({
      snapshots: [{
        provider: "ora",
        origin: ORIGIN,
        scanned_at: snapshot.scannedAt,
        fetched_at: snapshot.fetchedAt,
        contract_version: "1.21.0",
        score: 61,
        essentials_score: 63,
        summary_json: JSON.stringify(externalAgentAuditSummary(snapshot)),
        raw_report_key: snapshot.rawReportKey,
      }],
      statuses: [{
        provider: "ora",
        origin: ORIGIN,
        status: "available",
        latest_scanned_at: snapshot.scannedAt,
        last_attempted_at: snapshot.fetchedAt,
        last_succeeded_at: snapshot.fetchedAt,
        next_eligible_at: null,
        error_code: null,
        error_message: null,
      }],
    });
    const audits = await readExternalAgentAudits(env.DB, TENANT);
    expect(audits).toHaveLength(1);
    expect(audits[0].snapshots[0]).toEqual(snapshot);
    expect(audits[0].status?.status).toBe("available");
    // Reads never touch the raw payloads.
    expect(statements).toEqual([]);
  });

  it("returns nothing for a tenant with no external evidence", async () => {
    const { env } = bindings();
    await expect(readExternalAgentAudits(env.DB, TENANT)).resolves.toEqual([]);
  });
});

describe("agent audit data plane", () => {
  function request(pathname: string, method = "GET"): Request {
    return new Request(`https://collector.example.test${pathname}`, { method });
  }

  it("serves the compact read model over the authenticated collector route", async () => {
    const snapshot = snapshotFrom("complete");
    const { env } = bindings({
      snapshots: [{
        provider: "ora",
        origin: ORIGIN,
        scanned_at: snapshot.scannedAt,
        fetched_at: snapshot.fetchedAt,
        contract_version: "1.21.0",
        score: 61,
        essentials_score: 63,
        summary_json: JSON.stringify(externalAgentAuditSummary(snapshot)),
        raw_report_key: snapshot.rawReportKey,
      }],
      statuses: [],
    });
    const response = await handleDataPlaneRequest(
      request("/data/brand-studio%3Alive/agent-audits"),
      env,
    );
    expect(response?.status).toBe(200);
    expect(response?.headers.get("cache-control")).toBe("no-store");
    const body = await response!.json() as { audits: Array<Record<string, unknown>> };
    expect(body.audits).toHaveLength(1);
    expect(body.audits[0].origin).toBe(ORIGIN);
    // The response carries the summary, never the raw provider payload.
    expect(JSON.stringify(body)).not.toContain("agenticSummary");
  });

  it("is read-only", async () => {
    const { env } = bindings();
    for (const method of ["POST", "PUT", "DELETE", "PATCH"]) {
      const response = await handleDataPlaneRequest(
        request("/data/brand-studio%3Alive/agent-audits", method),
        env,
      );
      expect(response?.status).toBe(405);
    }
  });

  it("rejects an unsafe tenant segment before touching storage", async () => {
    const { env, statements } = bindings();
    await expect(handleDataPlaneRequest(request("/data/..%2Fetc/agent-audits"), env))
      .resolves.toBeNull();
    expect(statements).toEqual([]);
  });

  it("leaves the existing CrUX route untouched", async () => {
    const { env } = bindings();
    const response = await handleDataPlaneRequest(request("/data/brand-studio%3Alive/crux"), env);
    expect(response?.status).toBe(200);
    expect(Object.keys(await response!.json() as object)).toEqual(["evidence"]);
  });
});
