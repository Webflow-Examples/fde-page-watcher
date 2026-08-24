import { describe, expect, it } from "vitest";
import { verifyAgentIssueTask } from "../oraVerify";
import {
  oraOperatorCounters,
  oraScheduleLogEvent,
  ORA_SCHEDULED_ORIGIN_CAP,
  runScheduledOraRefresh,
} from "../oraSchedule";
import { handleDataPlaneRequest } from "../dataPlane";
import type { AppState, Rec } from "../../src/lib/types";

const TENANT = "brand-studio:live";
const NOW = new Date("2026-08-24T08:00:00.000Z");

function page(id = "home", url = "https://example.com/pricing") {
  return {
    id,
    title: "Homepage",
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

function agentTask(overrides: Partial<Rec> = {}): Rec {
  return {
    key: "home:agent-issue:agent-api:openapi",
    pageId: "home",
    pageTitle: "Homepage",
    url: "https://example.com/pricing",
    id: "agent-issue:agent-api:openapi",
    source: "agent-readiness",
    title: "Agents cannot discover API documentation",
    category: "Agent access",
    savings: "Essential",
    estTime: "2 days",
    status: "task",
    taskStatus: "done",
    added: "Aug 20",
    doneDate: "Aug 24",
    agentIssue: {
      caseKey: "agent-api:openapi",
      title: "Agents cannot discover API documentation",
      scope: "origin",
      origin: "https://example.com",
      capturedAt: "2026-08-24T04:00:00.000Z",
      remediation: ["Publish an OpenAPI document."],
      successCriteria: "An OpenAPI document is reachable.",
      verificationCheckIds: ["openapi-spec", "api-catalog-rfc9727"],
    },
    ...overrides,
  } as Rec;
}

function environment(options: {
  recs?: Rec[];
  enabled?: boolean;
  archived?: boolean;
  pages?: ReturnType<typeof page>[];
  scanEnabled?: boolean;
  apiKey?: string;
} = {}) {
  const state: AppState = {
    pages: (options.pages ?? [page()]) as unknown as AppState["pages"],
    recs: options.recs ?? [agentTask()],
    jobs: [],
    followUps: [],
    externalAgentAuditEnabled: options.enabled !== false,
    ...(options.archived ? { projectArchivedAt: "2026-08-01T00:00:00.000Z" } : {}),
  };
  const written: AppState[] = [];
  let version = 1;

  const prepare = (sql: string) => {
    const build = (values: unknown[]) => ({
      sql,
      values,
      first: async () => sql.startsWith("SELECT json, version, updated_at FROM state")
        ? { json: JSON.stringify(state), version, updated_at: "2026-08-24T00:00:00.000Z" }
        : null,
      all: async () => ({ results: [] }),
      run: async () => {
        if (sql.startsWith("UPDATE state SET json")) {
          const next = JSON.parse(String(values[0])) as AppState;
          Object.assign(state, next);
          written.push(next);
          version += 1;
        }
        return { success: true, meta: { rows_written: 1 } };
      },
    });
    return { bind: (...values: unknown[]) => build(values), ...build([]) };
  };

  const env = {
    DB: {
      prepare,
      batch: async (batch: unknown[]) => batch.map(() => ({ success: true, meta: { rows_written: 1 } })),
    },
    REPORTS: {
      put: async () => ({}),
      get: async () => null,
      delete: async () => undefined,
    },
    ORA_SCAN_ENABLED: options.scanEnabled === false ? "false" : "true",
    ...(options.apiKey ? { ORA_SCAN_API_KEY: options.apiKey } : {}),
  };
  return { env: env as never, state, written };
}

function fetcher(handler: (url: string, body: unknown) => Response) {
  const calls: Array<{ url: string; body: unknown }> = [];
  const fetchFn = (async (input: string | URL | Request, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(String(init.body)) as unknown : undefined;
    calls.push({ url: String(input), body });
    return handler(String(input), body);
  }) as unknown as typeof fetch;
  return { fetchFn, calls };
}

function checksResponse(results: Array<{ id: string; status: string }>) {
  return Response.json({ contractVersion: "1.20.1", domain: "example.com", results });
}

describe("selective re-check", () => {
  it("runs only the check ids the task recorded, resolved server-side", async () => {
    const { env, state } = environment();
    const { fetchFn, calls } = fetcher(() => checksResponse([
      { id: "openapi-spec", status: "pass" },
      { id: "api-catalog-rfc9727", status: "pass" },
    ]));
    const result = await verifyAgentIssueTask(env, TENANT, agentTask().key, { fetchFn, now: NOW });
    expect(result.status).toBe("resolved");
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://ora.ai/api/scan/checks?format=audit");
    expect(calls[0].body).toEqual({
      url: "example.com",
      checkIds: ["openapi-spec", "api-catalog-rfc9727"],
    });
    expect(state.recs[0].agentIssue?.verification?.status).toBe("resolved");
  });

  it("returns the issue and reopens it when a check still fails", async () => {
    const { env, state } = environment();
    const { fetchFn } = fetcher(() => checksResponse([
      { id: "openapi-spec", status: "pass" },
      { id: "api-catalog-rfc9727", status: "fail" },
    ]));
    const result = await verifyAgentIssueTask(env, TENANT, agentTask().key, { fetchFn, now: NOW });
    expect(result.status).toBe("returned");
    expect(result.reopened).toBe(true);
    expect(state.recs[0].taskStatus).toBe("in-progress");
    expect(state.recs[0].doneDate).toBeNull();
  });

  it("returns the issue on a partial result rather than accepting it", async () => {
    const { env } = environment();
    const { fetchFn } = fetcher(() => checksResponse([
      { id: "openapi-spec", status: "pass" },
      { id: "api-catalog-rfc9727", status: "warning" },
    ]));
    expect((await verifyAgentIssueTask(env, TENANT, agentTask().key, { fetchFn, now: NOW })).status)
      .toBe("returned");
  });

  it("accepts a correctly not-applicable check as resolved", async () => {
    const { env } = environment();
    const { fetchFn } = fetcher(() => checksResponse([
      { id: "openapi-spec", status: "pass" },
      { id: "api-catalog-rfc9727", status: "na" },
    ]));
    expect((await verifyAgentIssueTask(env, TENANT, agentTask().key, { fetchFn, now: NOW })).status)
      .toBe("resolved");
  });

  it("leaves the task verifying and retryable when the provider fails", async () => {
    for (const response of [
      () => Response.json({ error: "Rate limited", retry_after_ms: 60_000 }, { status: 429 }),
      () => Response.json({ error: "boom" }, { status: 500 }),
      () => Response.json({ unexpected: true }),
    ]) {
      const { env, state } = environment();
      const { fetchFn } = fetcher(response);
      const result = await verifyAgentIssueTask(env, TENANT, agentTask().key, { fetchFn, now: NOW });
      expect(result.status).toBe("verifying");
      expect(result.ok).toBe(false);
      // Provider silence is never evidence that the remediation failed.
      expect(state.recs[0].taskStatus).toBe("done");
      expect(state.recs[0].agentIssue?.verification?.status).toBe("verifying");
      expect(state.recs[0].agentIssue?.verification?.errorCode).toBeTruthy();
    }
  });

  it("refuses without project consent, before any request", async () => {
    const { env } = environment({ enabled: false });
    const { fetchFn, calls } = fetcher(() => checksResponse([]));
    const result = await verifyAgentIssueTask(env, TENANT, agentTask().key, { fetchFn, now: NOW });
    expect(result.refusedReason).toBe("not-consented");
    expect(calls).toEqual([]);
  });

  it("refuses for an archived project", async () => {
    const { env } = environment({ archived: true });
    const { fetchFn, calls } = fetcher(() => checksResponse([]));
    expect((await verifyAgentIssueTask(env, TENANT, agentTask().key, { fetchFn, now: NOW })).refusedReason)
      .toBe("project-archived");
    expect(calls).toEqual([]);
  });

  it("refuses an unknown task and a task with no verification target", async () => {
    const missing = environment();
    expect((await verifyAgentIssueTask(missing.env, TENANT, "nope", { now: NOW })).refusedReason)
      .toBe("task-not-found");

    const bare = environment({
      recs: [agentTask({
        agentIssue: { ...agentTask().agentIssue!, verificationCheckIds: [] },
      })],
    });
    const { fetchFn, calls } = fetcher(() => checksResponse([]));
    expect((await verifyAgentIssueTask(bare.env, TENANT, agentTask().key, { fetchFn, now: NOW })).refusedReason)
      .toBe("no-verification-target");
    expect(calls).toEqual([]);
  });

  it("refuses a task whose origin cannot be audited", async () => {
    const { env } = environment({
      recs: [agentTask({
        url: "https://client.webflow.io/home",
        agentIssue: { ...agentTask().agentIssue!, origin: "https://client.webflow.io" },
      })],
    });
    const { fetchFn, calls } = fetcher(() => checksResponse([]));
    expect((await verifyAgentIssueTask(env, TENANT, agentTask().key, { fetchFn, now: NOW })).refusedReason)
      .toBe("unsupported-target");
    expect(calls).toEqual([]);
  });

  it("ignores provider results for checks the task never targeted", async () => {
    const { env, state } = environment();
    const { fetchFn } = fetcher(() => checksResponse([
      { id: "openapi-spec", status: "pass" },
      { id: "api-catalog-rfc9727", status: "pass" },
      { id: "some-other-check", status: "fail" },
    ]));
    expect((await verifyAgentIssueTask(env, TENANT, agentTask().key, { fetchFn, now: NOW })).status)
      .toBe("resolved");
    expect(state.recs[0].agentIssue?.verification?.results?.map((r) => r.checkId))
      .toEqual(["openapi-spec", "api-catalog-rfc9727"]);
  });

  it("sends a partner key only when configured", async () => {
    const headers: Array<string | null> = [];
    const fetchFn = (async (_input: unknown, init?: RequestInit) => {
      headers.push(new Headers(init?.headers).get("authorization"));
      return checksResponse([{ id: "openapi-spec", status: "pass" }]);
    }) as unknown as typeof fetch;
    await verifyAgentIssueTask(environment({ apiKey: "partner" }).env, TENANT, agentTask().key, { fetchFn, now: NOW });
    expect(headers[0]).toBe("Bearer partner");
    headers.length = 0;
    await verifyAgentIssueTask(environment().env, TENANT, agentTask().key, { fetchFn, now: NOW });
    expect(headers[0]).toBeNull();
  });
});

describe("verify route", () => {
  function request(body?: unknown, method = "POST"): Request {
    return new Request("https://collector.example.test/data/brand-studio%3Alive/agent-audits/ora/verify", {
      method,
      ...(body === undefined ? {} : {
        body: JSON.stringify(body),
        headers: { "content-type": "application/json" },
      }),
    });
  }

  it("never uses a caller-supplied check list", async () => {
    // This task records no verification target. Supplying check ids in the
    // request must not give it one, so the call is refused without ever
    // reaching the provider.
    const { env } = environment({
      recs: [agentTask({
        agentIssue: { ...agentTask().agentIssue!, verificationCheckIds: [] },
      })],
    });
    const response = await handleDataPlaneRequest(
      request({ recKey: agentTask().key, checkIds: ["openapi-spec"] }),
      env,
    );
    expect(response?.status).toBe(400);
    expect(await response!.json()).toMatchObject({ refusedReason: "no-verification-target" });
  });

  it("rejects a missing or malformed task key", async () => {
    const { env } = environment();
    for (const body of [{}, { recKey: 12 }, { recKey: "" }, { recKey: "x".repeat(500) }]) {
      expect((await handleDataPlaneRequest(request(body), env))?.status).toBe(400);
    }
  });

  it("honours the deployment gate", async () => {
    const { env } = environment({ scanEnabled: false });
    const response = await handleDataPlaneRequest(request({ recKey: agentTask().key }), env);
    expect(response?.status).toBe(503);
    expect(await response!.json()).toMatchObject({ code: "ORA_SCAN_DISABLED" });
  });

  it("answers 409 without project consent and 404 for an unknown task", async () => {
    expect((await handleDataPlaneRequest(
      request({ recKey: agentTask().key }),
      environment({ enabled: false }).env,
    ))?.status).toBe(409);
    expect((await handleDataPlaneRequest(
      request({ recKey: "missing" }),
      environment().env,
    ))?.status).toBe(404);
  });

  it("is POST only", async () => {
    const { env } = environment();
    for (const method of ["GET", "PUT", "DELETE"]) {
      expect((await handleDataPlaneRequest(request(undefined, method), env))?.status).toBe(405);
    }
  });
});

describe("scheduled refresh", () => {
  const noSleep = async () => undefined;

  it("does nothing while the deployment gate is closed", async () => {
    const { env } = environment({ scanEnabled: false });
    const { fetchFn, calls } = fetcher(() => checksResponse([]));
    const result = await runScheduledOraRefresh(env, [TENANT], { fetchFn, sleep: noSleep, now: NOW });
    expect(result.enabled).toBe(false);
    expect(result.tenants).toEqual([]);
    expect(calls).toEqual([]);
  });

  it("caps how much of the shared public quota one run may spend", async () => {
    const tenants = Array.from({ length: 12 }, (_value, index) => `tenant-${index}`);
    const { env } = environment();
    const { fetchFn } = fetcher(() => Response.json(
      { error: "none", code: "DOMAIN_NOT_SCANNED", domain: "example.com" },
      { status: 404 },
    ));
    const result = await runScheduledOraRefresh(env, tenants, { fetchFn, sleep: noSleep, now: NOW, cap: 3 });
    expect(result.cap).toBe(3);
    expect(result.originsRefreshed).toBeLessThanOrEqual(3);
    // Deferred work is reported rather than silently dropped.
    expect(result.originsDeferred).toBeGreaterThan(0);
    expect(result.tenants.length).toBeLessThan(tenants.length);
  });

  it("defaults to a small slice of the keyless daily budget", () => {
    // Ora's keyless budget is 30 scans per rolling 24h per egress IP.
    expect(ORA_SCHEDULED_ORIGIN_CAP).toBe(8);
    expect(ORA_SCHEDULED_ORIGIN_CAP).toBeLessThan(30 / 2);
  });

  it("reports whether a partner key was in use", async () => {
    const keyed = await runScheduledOraRefresh(
      environment({ apiKey: "partner" }).env,
      [],
      { now: NOW },
    );
    expect(keyed.keyed).toBe(true);
    expect((await runScheduledOraRefresh(environment().env, [], { now: NOW })).keyed).toBe(false);
  });

  it("logs counts and safe fields only", async () => {
    const { env } = environment();
    const { fetchFn } = fetcher(() => Response.json(
      { error: "none", code: "DOMAIN_NOT_SCANNED", domain: "example.com" },
      { status: 404 },
    ));
    const event = oraScheduleLogEvent(
      await runScheduledOraRefresh(env, [TENANT], { fetchFn, sleep: noSleep, now: NOW }),
    );
    const parsed = JSON.parse(event) as Record<string, unknown>;
    expect(parsed.operation).toBe("scheduled-refresh");
    expect(parsed.provider).toBe("ora");
    expect(typeof parsed.originsRefreshed).toBe("number");
    // No URL, credential, provider body, or authorization header.
    expect(event).not.toMatch(/https?:\/\//);
    expect(event.toLowerCase()).not.toContain("bearer");
    expect(event.toLowerCase()).not.toContain("authorization");
  });
});

describe("operator counters", () => {
  it("classifies origin coverage by freshness and provider state", () => {
    const counters = oraOperatorCounters([
      { status: { status: "available", latestScannedAt: "2026-08-23T00:00:00.000Z" } },
      { status: { status: "available", latestScannedAt: "2026-08-01T00:00:00.000Z" } },
      { status: { status: "not-found" } },
      { status: { status: "rate-limited", latestScannedAt: "2026-08-23T00:00:00.000Z" } },
      { status: { status: "unavailable", latestScannedAt: "2026-08-23T00:00:00.000Z" } },
      { status: null },
    ], NOW.getTime());
    expect(counters).toEqual({
      originsCurrent: 3,
      originsStale: 1,
      originsMissing: 2,
      rateLimited: 1,
      errors: 1,
    });
  });
});
