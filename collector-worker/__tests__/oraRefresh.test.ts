import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { refreshExternalAgentAudits } from "../oraRefresh";
import { handleDataPlaneRequest } from "../dataPlane";

const TENANT = "brand-studio:live";

function fixture(name: string): Record<string, unknown> {
  return JSON.parse(readFileSync(
    path.join(__dirname, "..", "..", "src", "lib", "__tests__", "fixtures", `ora-audit-${name}.json`),
    "utf8",
  )) as Record<string, unknown>;
}

/** A complete audit body whose domain matches the requested host. */
function auditFor(domain: string, scannedAt = "2026-08-24T04:00:00.000Z"): Record<string, unknown> {
  return { ...fixture("complete"), domain, scannedAt };
}

interface Statement {
  sql: string;
  values: unknown[];
}

function page(id: string, url: string) {
  return {
    id,
    title: id,
    url,
    flag: "watching",
    status: "pending",
    current: {
      mobile: { perf: 0, a11y: 0, bp: 0, seo: 0 },
      desktop: { perf: 0, a11y: 0, bp: 0, seo: 0 },
    },
    history: [],
    markers: [],
    agent: [],
  };
}

function environment(options: {
  pages?: ReturnType<typeof page>[];
  enabled?: boolean;
  archived?: boolean;
  statuses?: Record<string, unknown>[];
  snapshots?: Record<string, unknown>[];
  scanEnabled?: boolean;
  apiKey?: string;
} = {}) {
  const statements: Statement[] = [];
  const puts: Array<{ key: string; value: string }> = [];
  const state = {
    pages: options.pages ?? [page("page-one", "https://example.com/pricing")],
    recs: [],
    jobs: [],
    followUps: [],
    externalAgentAuditEnabled: options.enabled !== false,
    ...(options.archived ? { projectArchivedAt: "2026-08-01T00:00:00.000Z" } : {}),
  };

  const prepare = (sql: string) => {
    const build = (values: unknown[]) => ({
      sql,
      values,
      first: async () => sql.startsWith("SELECT json, version, updated_at FROM state")
        ? { json: JSON.stringify(state), version: 1, updated_at: "2026-08-24T00:00:00.000Z" }
        : null,
      all: async () => ({
        results: sql.includes("FROM agent_audit_snapshots")
          ? options.snapshots ?? []
          : sql.includes("FROM agent_audit_status")
            ? options.statuses ?? []
            : [],
      }),
      run: async () => {
        statements.push({ sql, values });
        return { success: true, meta: { rows_written: 1 } };
      },
    });
    return { bind: (...values: unknown[]) => build(values), ...build([]) };
  };

  const env = {
    DB: {
      prepare,
      batch: async (batch: Statement[]) => {
        statements.push(...batch.map((s) => ({ sql: s.sql, values: s.values })));
        return batch.map(() => ({ success: true, meta: { rows_written: 1 } }));
      },
    },
    REPORTS: {
      put: async (key: string, value: string) => {
        puts.push({ key, value });
        return {};
      },
      get: async () => null,
      delete: async () => undefined,
    },
    ORA_SCAN_ENABLED: options.scanEnabled === false ? "false" : "true",
    ...(options.apiKey ? { ORA_SCAN_API_KEY: options.apiKey } : {}),
  };
  return { env: env as never, statements, puts };
}

function fetcher(handler: (url: string, init?: RequestInit) => Response) {
  const calls: string[] = [];
  const fetchFn = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push(String(input));
    return handler(String(input), init);
  }) as unknown as typeof fetch;
  return { fetchFn, calls };
}

const noSleep = async () => undefined;
const NOW = new Date("2026-08-24T06:00:00.000Z");

describe("external agent audit consent gate", () => {
  it("makes no outbound request when the project has not consented", async () => {
    const { env, statements, puts } = environment({ enabled: false });
    const { fetchFn, calls } = fetcher(() => Response.json(auditFor("example.com")));
    const result = await refreshExternalAgentAudits(env, TENANT, { fetchFn, sleep: noSleep, now: NOW });
    expect(result).toMatchObject({ ok: false, consented: false, refusedReason: "not-consented" });
    // The decisive assertion: nothing left the Worker.
    expect(calls).toEqual([]);
    expect(puts).toEqual([]);
    expect(statements).toEqual([]);
  });

  it("makes no outbound request for an archived project", async () => {
    const { env } = environment({ archived: true });
    const { fetchFn, calls } = fetcher(() => Response.json(auditFor("example.com")));
    const result = await refreshExternalAgentAudits(env, TENANT, { fetchFn, sleep: noSleep, now: NOW });
    expect(result.refusedReason).toBe("project-archived");
    expect(calls).toEqual([]);
  });
});

describe("external agent audit target resolution", () => {
  it("refuses an origin that is not behind a watched page", async () => {
    const { env } = environment();
    const { fetchFn, calls } = fetcher(() => Response.json(auditFor("attacker.test")));
    const result = await refreshExternalAgentAudits(env, TENANT, {
      origin: "https://attacker.test",
      fetchFn,
      sleep: noSleep,
      now: NOW,
    });
    expect(result.refusedReason).toBe("origin-not-watched");
    expect(calls).toEqual([]);
  });

  it("refuses a private or credential-bearing origin before any request", async () => {
    const { env } = environment();
    const { fetchFn, calls } = fetcher(() => Response.json(auditFor("example.com")));
    for (const origin of ["http://127.0.0.1", "https://user:pass@example.com", "ftp://example.com"]) {
      const result = await refreshExternalAgentAudits(env, TENANT, {
        origin,
        fetchFn,
        sleep: noSleep,
        now: NOW,
      });
      expect(result.refusedReason).toMatch(/unsupported-target|origin-not-watched/);
    }
    expect(calls).toEqual([]);
  });

  it("skips a watched page whose domain cannot be audited externally", async () => {
    const { env } = environment({ pages: [page("staging", "https://client.webflow.io/home")] });
    const { fetchFn, calls } = fetcher(() => Response.json(auditFor("webflow.io")));
    const result = await refreshExternalAgentAudits(env, TENANT, { fetchFn, sleep: noSleep, now: NOW });
    expect(result.origins).toBe(0);
    expect(result.refusedReason).toBe("unsupported-target");
    // A staging hostname never reaches the provider.
    expect(calls).toEqual([]);
  });

  it("refuses an unknown page id", async () => {
    const { env } = environment();
    const { fetchFn, calls } = fetcher(() => Response.json(auditFor("example.com")));
    const result = await refreshExternalAgentAudits(env, TENANT, {
      pageId: "missing",
      fetchFn,
      sleep: noSleep,
      now: NOW,
    });
    expect(result.refusedReason).toBe("page-not-found");
    expect(calls).toEqual([]);
  });

  it("deduplicates by origin so two pages on one origin scan once", async () => {
    const { env, puts } = environment({
      pages: [
        page("one", "https://example.com/pricing"),
        page("two", "https://example.com/blog"),
        page("three", "https://other.test/"),
      ],
    });
    const { fetchFn, calls } = fetcher((url) =>
      Response.json(auditFor(url.includes("other.test") ? "other.test" : "example.com")));
    const result = await refreshExternalAgentAudits(env, TENANT, { fetchFn, sleep: noSleep, now: NOW });
    expect(result.origins).toBe(2);
    expect(result.results.map((item) => item.origin).sort())
      .toEqual(["https://example.com", "https://other.test"]);
    // One cached read per unique origin, not per page.
    expect(calls.filter((url) => url.includes("/api/score/"))).toHaveLength(2);
    expect(puts).toHaveLength(2);
  });

  it("scopes a page-targeted refresh to that page's origin only", async () => {
    const { env } = environment({
      pages: [page("one", "https://example.com/pricing"), page("two", "https://other.test/")],
    });
    const { fetchFn, calls } = fetcher(() => Response.json(auditFor("example.com")));
    const result = await refreshExternalAgentAudits(env, TENANT, {
      pageId: "one",
      fetchFn,
      sleep: noSleep,
      now: NOW,
    });
    expect(result.origins).toBe(1);
    expect(calls.every((url) => url.includes("example.com"))).toBe(true);
  });
});

describe("external agent audit refresh behavior", () => {
  it("reads the provider's stored score before spending scan quota", async () => {
    const { env, statements } = environment();
    // Fresh enough that no live scan is needed.
    const { fetchFn, calls } = fetcher(() => Response.json(auditFor("example.com", "2026-08-24T05:30:00.000Z")));
    const result = await refreshExternalAgentAudits(env, TENANT, { fetchFn, sleep: noSleep, now: NOW });
    expect(result.available).toBe(1);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain("/api/score/example.com");
    expect(calls.some((url) => url.includes("/api/scan"))).toBe(false);
    expect(result.results[0].servedFromCache).toBe(true);
    expect(statements.some((s) => s.sql.includes("INSERT INTO agent_audit_snapshots"))).toBe(true);
  });

  it("scans when the stored score is too old", async () => {
    const { env } = environment();
    const { fetchFn, calls } = fetcher((url) => url.includes("/api/scan")
      ? Response.json(auditFor("example.com", "2026-08-24T05:59:00.000Z"))
      // Two days stale.
      : Response.json(auditFor("example.com", "2026-08-22T04:00:00.000Z")));
    const result = await refreshExternalAgentAudits(env, TENANT, { fetchFn, sleep: noSleep, now: NOW });
    expect(calls[0]).toContain("/api/score/");
    expect(calls[1]).toContain("/api/scan");
    expect(result.available).toBe(1);
    expect(result.results[0].scanned).toBe(true);
  });

  it("scans when the provider holds no stored score", async () => {
    const { env } = environment();
    const { fetchFn, calls } = fetcher((url) => url.includes("/api/scan")
      ? Response.json(auditFor("example.com", "2026-08-24T05:59:00.000Z"))
      : Response.json({ error: "none", code: "DOMAIN_NOT_SCANNED", domain: "example.com" }, { status: 404 }));
    const result = await refreshExternalAgentAudits(env, TENANT, { fetchFn, sleep: noSleep, now: NOW });
    expect(calls[1]).toContain("/api/scan");
    expect(result.available).toBe(1);
  });

  it("forces a live scan past a fresh stored score", async () => {
    const { env } = environment();
    const { fetchFn, calls } = fetcher(() => Response.json(auditFor("example.com", "2026-08-24T05:59:00.000Z")));
    await refreshExternalAgentAudits(env, TENANT, { force: true, fetchFn, sleep: noSleep, now: NOW });
    expect(calls.some((url) => url.includes("/api/scan"))).toBe(true);
  });

  it("records a partial analysis as pending without inventing a complete audit", async () => {
    const { env, statements } = environment();
    const { fetchFn } = fetcher((url) => url.includes("/api/scan")
      ? Response.json({ ...fixture("partial"), scannedAt: "2026-08-24T05:59:00.000Z" }, { status: 202 })
      : Response.json({ error: "none", code: "DOMAIN_NOT_SCANNED", domain: "example.com" }, { status: 404 }));
    const result = await refreshExternalAgentAudits(env, TENANT, { fetchFn, sleep: noSleep, now: NOW });
    expect(result.pending).toBe(1);
    const status = statements.find((s) => s.sql.includes("INSERT INTO agent_audit_status"));
    expect(status?.values[3]).toBe("pending");
  });

  it("preserves the last successful audit when the provider hits its quota", async () => {
    const { env, statements, puts } = environment();
    const { fetchFn } = fetcher(() => Response.json(
      { error: "Daily scan limit reached (30 per day).", retry_after_ms: 14_400_000 },
      { status: 429, headers: { "retry-after": "14400" } },
    ));
    const result = await refreshExternalAgentAudits(env, TENANT, { fetchFn, sleep: noSleep, now: NOW });
    expect(result.rateLimited).toBe(1);
    // Only a status row is written: no snapshot is replaced and nothing deleted.
    expect(statements.map((s) => s.sql.split(" ").slice(0, 3).join(" ")))
      .toEqual(["INSERT INTO agent_audit_status"]);
    expect(puts).toEqual([]);
    const status = statements[0];
    expect(status.values[3]).toBe("rate-limited");
    expect(status.values[7]).toBe("2026-08-24T10:00:00.000Z");
    // Success markers are coalesced, so a prior audit survives.
    expect(status.sql).toContain("COALESCE(excluded.last_succeeded_at");
  });

  it("keeps a usable stored score when the live scan fails", async () => {
    const { env, statements } = environment();
    const { fetchFn } = fetcher((url) => url.includes("/api/scan")
      ? Response.json({ error: "Scan failed" }, { status: 500 })
      // Stale, so a scan is attempted, but still real evidence.
      : Response.json(auditFor("example.com", "2026-08-22T04:00:00.000Z")));
    const result = await refreshExternalAgentAudits(env, TENANT, { fetchFn, sleep: noSleep, now: NOW });
    // The stale-but-real cached reading is persisted rather than discarded.
    expect(result.available).toBe(1);
    expect(result.results[0].scanned).toBe(false);
    expect(statements.some((s) => s.sql.includes("INSERT INTO agent_audit_snapshots"))).toBe(true);
  });

  it("records a provider failure without a stored score as unavailable", async () => {
    const { env, statements } = environment();
    const { fetchFn } = fetcher(() => Response.json({ error: "boom" }, { status: 503 }));
    const result = await refreshExternalAgentAudits(env, TENANT, { fetchFn, sleep: noSleep, now: NOW });
    expect(result.ok).toBe(false);
    expect(result.errors).toBe(1);
    expect(statements[0].values[3]).toBe("unavailable");
  });

  it("defers while another scan on the same origin is still running", async () => {
    const { env } = environment({
      statuses: [{
        provider: "ora",
        origin: "https://example.com",
        status: "pending",
        latest_scanned_at: null,
        last_attempted_at: "2026-08-24T05:58:00.000Z",
        last_succeeded_at: null,
        next_eligible_at: null,
        error_code: null,
        error_message: null,
      }],
    });
    const { fetchFn, calls } = fetcher(() => Response.json(auditFor("example.com")));
    const result = await refreshExternalAgentAudits(env, TENANT, { fetchFn, sleep: noSleep, now: NOW });
    expect(result.skipped).toBe(1);
    expect(result.results[0].reason).toBe("in-progress");
    expect(calls).toEqual([]);
  });

  it("respects a provider cooldown the provider gave us", async () => {
    const { env } = environment({
      statuses: [{
        provider: "ora",
        origin: "https://example.com",
        status: "rate-limited",
        latest_scanned_at: "2026-08-23T04:00:00.000Z",
        last_attempted_at: "2026-08-24T05:00:00.000Z",
        last_succeeded_at: "2026-08-23T04:05:00.000Z",
        next_eligible_at: "2026-08-24T09:00:00.000Z",
        error_code: "RATE_LIMITED",
        error_message: "Daily scan limit reached",
      }],
    });
    const { fetchFn, calls } = fetcher(() => Response.json(auditFor("example.com")));
    const result = await refreshExternalAgentAudits(env, TENANT, { fetchFn, sleep: noSleep, now: NOW });
    expect(result.results[0].reason).toBe("cooling-down");
    expect(calls).toEqual([]);

    // An explicit force overrides the cooldown.
    const forced = await refreshExternalAgentAudits(env, TENANT, {
      force: true,
      fetchFn,
      sleep: noSleep,
      now: NOW,
    });
    expect(forced.results[0].reason).toBeUndefined();
  });

  it("rejects a provider body describing a different domain", async () => {
    const { env, statements } = environment();
    const { fetchFn } = fetcher(() => Response.json(auditFor("attacker.test", "2026-08-24T05:59:00.000Z")));
    const result = await refreshExternalAgentAudits(env, TENANT, { fetchFn, sleep: noSleep, now: NOW });
    expect(result.ok).toBe(false);
    expect(statements[0].values[3]).toBe("unavailable");
    expect(String(statements[0].values[8])).toBe("OraContractError");
  });

  it("forwards a partner key only when one is configured", async () => {
    const withKey = environment({ apiKey: "partner-key" });
    const headers: Array<string | null> = [];
    const fetchFn = (async (_input: unknown, init?: RequestInit) => {
      headers.push(new Headers(init?.headers).get("authorization"));
      return Response.json(auditFor("example.com", "2026-08-24T05:59:00.000Z"));
    }) as unknown as typeof fetch;
    await refreshExternalAgentAudits(withKey.env, TENANT, { fetchFn, sleep: noSleep, now: NOW });
    expect(headers[0]).toBe("Bearer partner-key");

    const keyless = environment();
    headers.length = 0;
    await refreshExternalAgentAudits(keyless.env, TENANT, { fetchFn, sleep: noSleep, now: NOW });
    expect(headers[0]).toBeNull();
  });
});

describe("external agent audit refresh route", () => {
  function request(body?: unknown, method = "POST"): Request {
    return new Request("https://collector.example.test/data/brand-studio%3Alive/agent-audits/ora/refresh", {
      method,
      ...(body === undefined ? {} : {
        body: JSON.stringify(body),
        headers: { "content-type": "application/json" },
      }),
    });
  }

  it("refuses when the deployment gate is off, before reading state", async () => {
    const { env, statements } = environment({ scanEnabled: false });
    const response = await handleDataPlaneRequest(request({}), env);
    expect(response?.status).toBe(503);
    expect(await response!.json()).toMatchObject({ code: "ORA_SCAN_DISABLED" });
    expect(statements).toEqual([]);
  });

  it("answers 409 when the project has not consented", async () => {
    const { env } = environment({ enabled: false });
    const response = await handleDataPlaneRequest(request({}), env);
    expect(response?.status).toBe(409);
    expect(await response!.json()).toMatchObject({ refusedReason: "not-consented", consented: false });
  });

  it("answers 400 for a target it will not accept", async () => {
    const { env } = environment();
    const response = await handleDataPlaneRequest(request({ origin: "https://attacker.test" }), env);
    expect(response?.status).toBe(400);
    expect(await response!.json()).toMatchObject({ refusedReason: "origin-not-watched" });
  });

  it("rejects a malformed body", async () => {
    const { env } = environment();
    for (const body of [{ pageId: 12 }, { force: "yes" }, { origin: [] }]) {
      const response = await handleDataPlaneRequest(request(body), env);
      expect(response?.status).toBe(400);
    }
  });

  it("is POST only", async () => {
    const { env } = environment();
    for (const method of ["GET", "PUT", "DELETE"]) {
      const response = await handleDataPlaneRequest(request(undefined, method), env);
      expect(response?.status).toBe(405);
    }
  });

  it("leaves the read-only collection route working", async () => {
    const { env } = environment();
    const response = await handleDataPlaneRequest(
      new Request("https://collector.example.test/data/brand-studio%3Alive/agent-audits"),
      env,
    );
    expect(response?.status).toBe(200);
    expect(Object.keys(await response!.json() as object)).toEqual(["audits"]);
  });
});
