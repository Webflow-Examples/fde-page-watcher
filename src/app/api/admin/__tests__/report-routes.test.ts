import { beforeEach, describe, expect, it } from "vitest";
import { vi } from "vitest";
import { buildInitialState } from "@/lib/seed";
import { nativeElementScan } from "@/lib/nativeElements";
import { classifyWebflowPerformance } from "@/lib/webflowPerformance";
import type { AggregatedLighthouseFinding, AppState, Night } from "@/lib/types";
import type { DataStore } from "@/lib/store";
import type { Project } from "@/lib/projects";

const { requireAppAdmin, adminProjectStores } = vi.hoisted(() => ({
  requireAppAdmin: vi.fn(),
  adminProjectStores: vi.fn(),
}));

// Only `requireAppAdmin` and `adminProjectStores` are swapped; the real
// `AuthorizationError` / `isAccessError` / `accessErrorStatus` implementations
// stay in place so the route's own error-to-status mapping is exercised, not
// a re-implementation of it in the mock.
vi.mock("@/lib/authorization", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/authorization")>();
  return { ...actual, requireAppAdmin };
});
vi.mock("@/lib/projects", () => ({ adminProjectStores }));

const score = { m: 80, lo: 78, hi: 82 };
const scores = {
  mobile: { perf: score, a11y: score, bp: score, seo: score },
  desktop: { perf: score, a11y: score, bp: score, seo: score },
};

function finding(id: string, title: string): AggregatedLighthouseFinding {
  return {
    id,
    title,
    category: "Performance",
    savingsMs: 400,
    savingsBytes: 0,
    actionable: true,
    observedRuns: 3,
    totalObservedRuns: 3,
    eligibleRuns: 3,
    successfulRuns: 3,
    quorum: 2,
    frequency: 1,
    promoted: true,
    confidence: "high",
    savingsLowMs: 350,
    savingsHighMs: 450,
    savingsLowBytes: 0,
    savingsHighBytes: 0,
    webflow: classifyWebflowPerformance(id, title),
  };
}

function store(state: AppState | null): DataStore {
  return {
    getState: async () => {
      if (!state) throw new Error("storage unavailable");
      return state;
    },
  } as DataStore;
}

function project(id: string): Project {
  return { id, name: id };
}

beforeEach(() => {
  requireAppAdmin.mockReset();
  adminProjectStores.mockReset();
});

describe("admin report routes", () => {
  it.each([
    ["known-issues", () => import("../known-issues/route")],
    ["unmapped-findings", () => import("../unmapped-findings/route")],
  ])("rejects a non-admin caller with the authorization error's status (%s)", async (_name, loadRoute) => {
    const { AuthorizationError } = await import("@/lib/authorization");
    requireAppAdmin.mockRejectedValue(new AuthorizationError("App administrator access is required"));
    const { GET } = await loadRoute();

    const response = await GET(new Request("https://example.test/api/admin/route"));

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "App administrator access is required" });
    expect(adminProjectStores).not.toHaveBeenCalled();
  });

  it("reports known Webflow issue signals and lists projects whose storage failed", async () => {
    requireAppAdmin.mockResolvedValue({ email: "admin@webflow.com", isAppAdmin: true, projectRoles: {} });
    const renderBlocking = finding("render-blocking-resources", "Eliminate render-blocking resources");
    const night: Night = {
      i: 1,
      date: "Aug 10",
      iso: "2026-08-10T12:00:00.000Z",
      scores,
      nativeElements: nativeElementScan(`<html data-wf-site="private" data-wf-page="private"><body></body></html>`),
      diagnostics: { mobile: [renderBlocking] },
      culpritEvidence: {
        mobile: [{ auditId: renderBlocking.id, title: renderBlocking.title, facts: [], sources: [{ host: "cdn.prod.website-files.com" }], sampleRuns: 3 }],
      },
    };
    const healthyState = buildInitialState("live");
    healthyState.pages = [{ ...healthyState.pages[0], id: "home", history: [night] }];
    adminProjectStores.mockResolvedValue([
      { project: project("healthy"), dataStore: store(healthyState) },
      { project: project("broken"), dataStore: store(null) },
    ]);

    const { GET } = await import("../known-issues/route");
    const response = await GET(new Request("https://example.test/api/admin/known-issues"));
    const body = await response.json() as { days: number; issues: Array<{ key: string }>; unavailableProjects: string[] };

    expect(response.status).toBe(200);
    expect(body.days).toBe(30);
    expect(body.issues).toEqual(expect.arrayContaining([expect.objectContaining({ key: "render-blocking-resources" })]));
    expect(body.unavailableProjects).toEqual(["broken"]);
  });

  it("reports unmapped Lighthouse audit IDs and lists projects whose storage failed", async () => {
    requireAppAdmin.mockResolvedValue({ email: "admin@webflow.com", isAppAdmin: true, projectRoles: {} });
    const novel = finding("brand-new-lighthouse-audit", "Some brand-new Lighthouse insight");
    const night: Night = {
      i: 1,
      date: "Aug 10",
      iso: "2026-08-10T12:00:00.000Z",
      scores,
      diagnostics: { mobile: [novel] },
    };
    const liveState = buildInitialState("live");
    liveState.pages = [{ ...liveState.pages[0], id: "home", history: [night] }];
    adminProjectStores.mockResolvedValue([
      { project: project("healthy"), dataStore: store(liveState) },
      { project: project("broken"), dataStore: store(null) },
    ]);

    const { GET } = await import("../unmapped-findings/route");
    const response = await GET(new Request("https://example.test/api/admin/unmapped-findings"));
    const body = await response.json() as { days: number; findings: Array<{ key: string }>; unavailableProjects: string[] };

    expect(response.status).toBe(200);
    expect(body.days).toBe(30);
    expect(body.findings).toEqual(expect.arrayContaining([expect.objectContaining({ key: "brand-new-lighthouse-audit" })]));
    expect(body.unavailableProjects).toEqual(["broken"]);
  });
});
