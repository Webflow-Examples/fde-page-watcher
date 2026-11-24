import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import type { AppState, Rec, ScoreByCategory, WatchPage } from "@/lib/types";
import type { DataStore } from "@/lib/store";
import { AuthorizationError } from "@/lib/authorization";
import { createMemoryIntegrationStore, type IntegrationStore } from "@/lib/integrations/store";
import { createFakeProvider, type FakeProvider } from "@/lib/integrations/fake";
import { connectionAad, openSecret } from "@/lib/integrations/crypto";
import { createOAuthState } from "@/lib/integrations/oauth";
import type { IntegrationConnectionRecord } from "@/lib/integrations/types";
import { remediationKey } from "@/lib/issue-case";
import { issueCasesFrom } from "@/lib/issue-cases";
import { fakeAsanaServer } from "@/lib/integrations/__tests__/fake-servers";

const KEY = "test-secret-that-is-long-enough-1234";

const hoisted = vi.hoisted(() => ({
  mode: "admin" as "admin" | "viewer" | "none",
  provider: null as unknown,
  store: null as unknown,
  state: null as unknown,
}));

vi.mock("@/lib/projects", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/projects")>();
  return {
    ...actual,
    authorizedProjectForRequest: vi.fn(async () => {
      if (hoisted.mode === "none") throw new AuthorizationError("Project administrator access is required");
      return { id: "brand-studio", name: "Brand Studio", tenant: "brand-studio:live" };
    }),
    projectForRequest: vi.fn(async () => ({ id: "brand-studio", name: "Brand Studio", tenant: "brand-studio:live" })),
    projectStoreForTenant: vi.fn(async () => dataStore()),
  };
});

vi.mock("@/lib/authorization", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/authorization")>();
  return {
    ...actual,
    requireProjectAccess: vi.fn(async () => {
      if (hoisted.mode === "none") throw new AuthorizationError("Project administrator access is required");
      return { email: "rae@webflow.com", isAppAdmin: false, projectRoles: { "brand-studio": "project_admin" } };
    }),
  };
});

vi.mock("@/lib/identity", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/identity")>();
  return { ...actual, identityFromRequest: vi.fn(async () => ({ email: "rae@webflow.com", source: "development" })) };
});

vi.mock("@/lib/integrations/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/integrations/server")>();
  return {
    ...actual,
    getIntegrationStore: () => hoisted.store as IntegrationStore,
    providerForConnection: () => hoisted.provider,
    integrationSecret: () => KEY,
    oauthClient: () => ({ clientId: "asana-client", clientSecret: "asana-secret" }),
    newConnectionId: () => "conn-1",
  };
});

/* ── Fixtures ───────────────────────────────────────────────────────────── */

const ZERO: ScoreByCategory = { perf: 0, a11y: 0, bp: 0, seo: 0 };

function page(id: string): WatchPage {
  return {
    id,
    title: id,
    url: `/${id}`,
    flag: "watching",
    status: "stable",
    current: { mobile: ZERO, desktop: ZERO },
    history: [],
    markers: [],
    agent: [],
    lastRunAt: "2026-11-01T06:00:00.000Z",
  };
}

function rec(key: string, pageId: string, id: string, steps?: string[]): Rec {
  return {
    key,
    pageId,
    pageTitle: pageId,
    url: `/${pageId}`,
    id,
    source: "lighthouse",
    title: `Fix ${id}`,
    category: "Performance",
    savings: "1 s",
    estTime: "1 day",
    status: "inbox",
    taskStatus: "todo",
    added: "2026-10-30",
    doneDate: null,
    ...(steps
      ? {
        agentIssue: {
          caseKey: `agent:${id}`,
          title: `Fix ${id}`,
          scope: "page",
          capturedAt: "2026-11-01T00:00:00.000Z",
          remediation: steps,
          successCriteria: "done",
          verificationCheckIds: [],
        },
        webflow: {
          version: 1, metric: "LCP", metricWeight: 25, culprit: "global-javascript", culpritLabel: "Global JavaScript",
          remediation: "available", remediationLabel: "Available", guidance: "",
          actionability: "direct", source: "published-page-performance",
        },
      }
      : {}),
  };
}

function buildState(): AppState {
  return {
    pages: [page("home"), page("pricing"), page("docs")],
    recs: [
      rec("home:alpha", "home", "alpha", ["Remove the bundle.", "Re-publish."]),
      rec("pricing:beta", "pricing", "beta", ["Remove the bundle.", "Re-publish."]),
      rec("docs:noplan", "docs", "noplan"),
    ],
    caseDecisions: [],
    caseTransitions: [],
    casePlans: [],
  } as unknown as AppState;
}

function dataStore(): DataStore {
  const state = hoisted.state as AppState;
  return {
    tenant: "brand-studio:live",
    getState: async () => state,
    updateState: async (mutate: (draft: AppState) => void | Promise<void>) => {
      await mutate(state);
      return state;
    },
    getCruxEvidence: async () => [],
    getExternalAgentAudits: async () => [],
  } as unknown as DataStore;
}

function connection(): IntegrationConnectionRecord {
  return {
    id: "conn-1", projectId: "brand-studio", provider: "asana", workspaceId: "ws-1", workspaceName: "Brand Studio",
    defaultDestinationId: "dest-engineering", defaultDestinationName: "Engineering",
    encryptedToken: "not-used", tokenNonce: "not-used", scopes: [], installedBy: "rae@webflow.com",
    installedAt: "2026-11-01T00:00:00.000Z", status: "connected",
  };
}

function request(url: string, init: { method?: string; body?: unknown; headers?: Record<string, string> } = {}): Request {
  return new Request(url, {
    method: init.method ?? "GET",
    ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
    headers: { "Content-Type": "application/json", ...(init.headers ?? {}) },
  });
}

let fake: FakeProvider;

beforeEach(() => {
  hoisted.mode = "admin";
  hoisted.state = buildState();
  fake = createFakeProvider();
  hoisted.provider = fake;
  hoisted.store = createMemoryIntegrationStore("brand-studio", { connections: [connection()] });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/* ── State ──────────────────────────────────────────────────────────────── */

describe("GET /api/integrations/state", () => {
  it("lets a viewer read links, and never returns a token or a secret", async () => {
    hoisted.mode = "viewer";
    const { GET } = await import("@/app/api/integrations/state/route");
    const response = await GET(request("https://app.example.test/api/integrations/state?project=brand-studio"));
    expect(response.status).toBe(200);
    const payload = await response.json() as { connections: Array<Record<string, unknown>> };
    expect(payload.connections[0].provider).toBe("asana");
    expect(payload.connections[0].encryptedToken).toBeUndefined();
    expect(payload.connections[0].tokenNonce).toBeUndefined();
    expect(JSON.stringify(payload)).not.toContain("not-used");
  });

  it("refuses a caller with no project access", async () => {
    hoisted.mode = "none";
    const { GET } = await import("@/app/api/integrations/state/route");
    const response = await GET(request("https://app.example.test/api/integrations/state"));
    expect(response.status).toBe(403);
  });
});

/* ── OAuth ──────────────────────────────────────────────────────────────── */

describe("OAuth routes", () => {
  it("starts an Asana connection for an admin, with a signed state in a cookie", async () => {
    const { GET } = await import("@/app/api/integrations/[provider]/oauth/start/route");
    const response = await GET(
      request("https://app.example.test/api/integrations/asana/oauth/start?project=brand-studio"),
      { params: Promise.resolve({ provider: "asana" }) },
    );
    expect(response.status).toBe(302);
    const location = new URL(response.headers.get("location")!);
    expect(location.origin + location.pathname).toBe("https://app.asana.com/-/oauth_authorize");
    expect(location.searchParams.get("client_id")).toBe("asana-client");
    expect(location.searchParams.get("redirect_uri")).toBe("https://app.example.test/api/integrations/asana/oauth/callback");
    expect(location.searchParams.get("state")).toBeTruthy();
    expect(response.headers.get("set-cookie")).toContain("page-watch-integration-oauth=");
    expect(response.headers.get("set-cookie")).toContain("HttpOnly");
  });

  it("refuses to start for a viewer", async () => {
    hoisted.mode = "none";
    const { GET } = await import("@/app/api/integrations/[provider]/oauth/start/route");
    const response = await GET(
      request("https://app.example.test/api/integrations/asana/oauth/start"),
      { params: Promise.resolve({ provider: "asana" }) },
    );
    expect(response.status).toBe(403);
  });

  it("rejects an unknown provider", async () => {
    const { GET } = await import("@/app/api/integrations/[provider]/oauth/start/route");
    const response = await GET(
      request("https://app.example.test/api/integrations/jira/oauth/start"),
      { params: Promise.resolve({ provider: "jira" }) },
    );
    expect(response.status).toBe(404);
  });

  it("rejects a callback whose state cookie is missing", async () => {
    const state = createOAuthState({ projectId: "brand-studio", provider: "asana", secret: KEY });
    const { GET } = await import("@/app/api/integrations/[provider]/oauth/callback/route");
    const response = await GET(
      request(`https://app.example.test/api/integrations/asana/oauth/callback?code=abc&state=${encodeURIComponent(state)}`),
      { params: Promise.resolve({ provider: "asana" }) },
    );
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toContain("task-tool=error");
  });

  it("exchanges the code, encrypts the token and stores the connection", async () => {
    const asana = fakeAsanaServer();
    const fetchImpl = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const url = String(input);
      if (url === "https://app.asana.com/-/oauth_token") {
        return new Response(JSON.stringify({ access_token: "live-looking-token", scope: "tasks:write" }), { status: 200 });
      }
      return asana.fetch(input, init);
    }) as typeof fetch;
    vi.stubGlobal("fetch", fetchImpl);

    const state = createOAuthState({ projectId: "brand-studio", provider: "asana", secret: KEY });
    const { GET } = await import("@/app/api/integrations/[provider]/oauth/callback/route");
    const response = await GET(
      request(`https://app.example.test/api/integrations/asana/oauth/callback?code=abc&state=${encodeURIComponent(state)}`, {
        headers: { cookie: `page-watch-integration-oauth=${encodeURIComponent(state)}` },
      }),
      { params: Promise.resolve({ provider: "asana" }) },
    );
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toContain("task-tool=connected");

    const store = hoisted.store as IntegrationStore;
    const saved = await store.getConnection("asana");
    expect(saved?.encryptedToken).not.toContain("live-looking-token");
    expect(saved?.defaultDestinationId).toBe("proj-1");
    const token = openSecret(
      { ciphertext: saved!.encryptedToken, nonce: saved!.tokenNonce },
      KEY,
      connectionAad("brand-studio", "asana"),
    );
    expect(token).toBe("live-looking-token");
  });
});

/* ── Create, link, unlink ───────────────────────────────────────────────── */

describe("POST /api/integrations/tasks", () => {
  it("creates one task, links siblings to it and refuses a duplicate", async () => {
    const state = hoisted.state as AppState;
    const [first, second] = issueCasesFrom(state);
    const { POST } = await import("@/app/api/integrations/tasks/route");

    const created = await POST(request("https://app.example.test/api/integrations/tasks", {
      method: "POST", body: { caseId: first.id },
    }));
    expect(created.status).toBe(200);
    const firstPayload = await created.json() as { status: string; link: { externalId: string; remediationKey: string } };
    expect(firstPayload.status).toBe("created");
    expect(fake.tasks).toHaveLength(1);

    const sibling = await POST(request("https://app.example.test/api/integrations/tasks", {
      method: "POST", body: { caseId: second.id },
    }));
    const siblingPayload = await sibling.json() as { status: string; link: { externalId: string } };
    expect(siblingPayload.status).toBe("already_linked");
    expect(siblingPayload.link.externalId).toBe(firstPayload.link.externalId);
    expect(remediationKey(first)).toBe(remediationKey(second));
  });

  it("accepts and creates in one request without replacing Accept", async () => {
    const state = hoisted.state as AppState;
    const issue = issueCasesFrom(state)[0];
    const { POST } = await import("@/app/api/integrations/tasks/route");
    await POST(request("https://app.example.test/api/integrations/tasks", {
      method: "POST", body: { caseId: issue.id, accept: true },
    }));
    // The decision log holds the acceptance, with the verified caller.
    expect((hoisted.state as AppState).caseDecisions).toHaveLength(1);
    expect((hoisted.state as AppState).caseDecisions![0].decision).toBe("accept");
    expect((hoisted.state as AppState).caseDecisions![0].by).toEqual({ kind: "person", userId: "rae@webflow.com" });
    // The fix on the app branch carries the case's cause on every new decision,
    // so an entry survives the remediation key moving.
    expect((hoisted.state as AppState).caseDecisions![0].cause).toBe(issue.cause);
    expect(fake.tasks).toHaveLength(1);
  });

  it("refuses a viewer", async () => {
    hoisted.mode = "none";
    const issue = issueCasesFrom(hoisted.state as AppState)[0];
    const { POST } = await import("@/app/api/integrations/tasks/route");
    const response = await POST(request("https://app.example.test/api/integrations/tasks", {
      method: "POST", body: { caseId: issue.id },
    }));
    expect(response.status).toBe(403);
    expect(fake.tasks).toHaveLength(0);
  });

  it("skips a case with no plan and says why", async () => {
    const state = hoisted.state as AppState;
    const noPlan = issueCasesFrom(state).find((issue) => issue.remediation.steps.length === 0)!;
    const { POST } = await import("@/app/api/integrations/tasks/route");
    const response = await POST(request("https://app.example.test/api/integrations/tasks", {
      method: "POST", body: { caseId: noPlan.id },
    }));
    const payload = await response.json() as { status: string; reason: string };
    expect(payload.status).toBe("skipped");
    expect(payload.reason).toMatch(/no plan/);
  });
});

describe("POST /api/integrations/tasks/unlink", () => {
  it("unlinks a task without deleting it", async () => {
    const state = hoisted.state as AppState;
    const issue = issueCasesFrom(state)[0];
    const { POST: create } = await import("@/app/api/integrations/tasks/route");
    await create(request("https://app.example.test/api/integrations/tasks", { method: "POST", body: { caseId: issue.id } }));

    const { POST: unlink } = await import("@/app/api/integrations/tasks/unlink/route");
    const response = await unlink(request("https://app.example.test/api/integrations/tasks/unlink", {
      method: "POST", body: { remediationKey: remediationKey(issue) },
    }));
    expect(response.status).toBe(200);
    expect(await (hoisted.store as IntegrationStore).getLink("asana", remediationKey(issue))).toBeNull();
    expect(fake.tasks).toHaveLength(1);
  });
});

/* ── Bulk ───────────────────────────────────────────────────────────────── */

describe("POST /api/integrations/tasks/bulk", () => {
  it("counts, deduplicates and reports each case", async () => {
    const state = hoisted.state as AppState;
    const cases = issueCasesFrom(state);
    const { POST } = await import("@/app/api/integrations/tasks/bulk/route");
    const response = await POST(request("https://app.example.test/api/integrations/tasks/bulk", {
      method: "POST", body: { caseIds: cases.map((issue) => issue.id) },
    }));
    expect(response.status).toBe(200);
    const payload = await response.json() as { results: Array<{ status: string }>; preview: { tasks: number; withoutPlan: number; duplicates: number }; ok: boolean };
    expect(payload.preview.tasks).toBe(1);
    expect(payload.preview.withoutPlan).toBe(1);
    expect(payload.preview.duplicates).toBe(1);
    expect(payload.results.filter((item) => item.status === "created")).toHaveLength(1);
    expect(fake.tasks).toHaveLength(1);
  });

  it("accepts and creates in one request", async () => {
    const state = hoisted.state as AppState;
    const cases = issueCasesFrom(state);
    const { POST } = await import("@/app/api/integrations/tasks/bulk/route");
    const response = await POST(request("https://app.example.test/api/integrations/tasks/bulk", {
      method: "POST", body: { caseIds: cases.map((issue) => issue.id), accept: true },
    }));
    const payload = await response.json() as { accepted: string[] };
    // One distinct planned remediation was accepted; the plan-less case was not.
    expect(payload.accepted).toHaveLength(1);
    expect((hoisted.state as AppState).caseDecisions).toHaveLength(1);
  });

  it("caps a batch at 25 and refuses a viewer", async () => {
    const { POST } = await import("@/app/api/integrations/tasks/bulk/route");
    const tooMany = await POST(request("https://app.example.test/api/integrations/tasks/bulk", {
      method: "POST", body: { caseIds: Array.from({ length: 26 }, (_, index) => `case-${index}`) },
    }));
    expect(tooMany.status).toBe(400);

    hoisted.mode = "none";
    const refused = await POST(request("https://app.example.test/api/integrations/tasks/bulk", {
      method: "POST", body: { caseIds: ["a"] },
    }));
    expect(refused.status).toBe(403);
  });
});

/* ── Settings routes ────────────────────────────────────────────────────── */

describe("automation, webhook and API-token routes", () => {
  it("flips a named automation and rejects an unknown key", async () => {
    const { POST } = await import("@/app/api/integrations/automations/route");
    const ok = await POST(request("https://app.example.test/api/integrations/automations", {
      method: "POST", body: { automations: { acceptCreatesTask: true } },
    }));
    expect(ok.status).toBe(200);
    const payload = await ok.json() as { settings: { automations: { acceptCreatesTask: boolean } } };
    expect(payload.settings.automations.acceptCreatesTask).toBe(true);

    const bad = await POST(request("https://app.example.test/api/integrations/automations", {
      method: "POST", body: { automations: { someRule: true } },
    }));
    expect(bad.status).toBe(400);

    const stringy = await POST(request("https://app.example.test/api/integrations/automations", {
      method: "POST", body: { automations: { acceptCreatesTask: "yes" } },
    }));
    expect(stringy.status).toBe(400);
  });

  it("issues a webhook secret once and never returns it again", async () => {
    const { POST } = await import("@/app/api/integrations/webhook/route");
    const first = await POST(request("https://app.example.test/api/integrations/webhook", {
      method: "POST", body: { url: "https://hooks.example.test/pw" },
    }));
    const firstPayload = await first.json() as { secret: string; settings: Record<string, unknown> };
    expect(firstPayload.secret).toBeTruthy();
    expect(firstPayload.settings.webhookSecretEncrypted).toBeUndefined();
    expect(firstPayload.settings.webhookConfigured).toBe(true);

    const second = await POST(request("https://app.example.test/api/integrations/webhook", {
      method: "POST", body: { url: "https://hooks.example.test/pw" },
    }));
    const secondPayload = await second.json() as { secret?: string };
    expect(secondPayload.secret).toBeUndefined();
  });

  it("issues a project API token once, stores only its hash, and authorizes read access", async () => {
    const { POST } = await import("@/app/api/integrations/api-token/route");
    const issued = await POST(request("https://app.example.test/api/integrations/api-token", { method: "POST" }));
    const payload = await issued.json() as { token: string; settings: Record<string, unknown> };
    expect(payload.token.startsWith("pw_")).toBe(true);
    expect(payload.settings.apiTokenHash).toBeUndefined();

    const { GET } = await import("@/app/api/integrations/public/tasks/route");
    const listed = await GET(request("https://app.example.test/api/integrations/public/tasks?project=brand-studio", {
      headers: { authorization: `Bearer ${payload.token}` },
    }));
    expect(listed.status).toBe(200);

    const wrong = await GET(request("https://app.example.test/api/integrations/public/tasks?project=brand-studio", {
      headers: { authorization: "Bearer pw_wrong" },
    }));
    expect(wrong.status).toBe(401);
  });

  it("refuses settings writes for a viewer", async () => {
    hoisted.mode = "none";
    const { POST } = await import("@/app/api/integrations/automations/route");
    const response = await POST(request("https://app.example.test/api/integrations/automations", {
      method: "POST", body: { automations: { acceptCreatesTask: true } },
    }));
    expect(response.status).toBe(403);
  });
});
