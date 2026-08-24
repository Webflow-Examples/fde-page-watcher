import { createFdeStore, type FdeStoreBindings } from "./dataStore";
import type { AppState } from "../src/lib/types";
import {
  connectWebflowSite,
  disconnectWebflowSite,
  getWebflowConnectionStatus,
  syncWebflowActivity,
  WebflowIntegrationError,
  type WebflowBindings,
} from "./webflow";
import { refreshExternalAgentAudits } from "./oraRefresh";
import { verifyAgentIssueTask } from "./oraVerify";

type DataRoute =
  | { kind: "state"; tenant: string }
  | { kind: "crux"; tenant: string }
  | { kind: "agent-audits"; tenant: string }
  | { kind: "agent-audits-refresh"; tenant: string }
  | { kind: "agent-audits-verify"; tenant: string }
  | { kind: "report"; tenant: string; pageId: string; key: string }
  | { kind: "webflow-connection"; tenant: string }
  | { kind: "webflow-sync"; tenant: string };

type DataPlaneBindings = FdeStoreBindings & WebflowBindings & {
  /** Deployment gate for outbound external scans. "true" enables refresh. */
  ORA_SCAN_ENABLED?: string;
  /** Optional partner key. Absent means keyless, public-quota operation. */
  ORA_SCAN_API_KEY?: string;
};

function decode(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

function safeIdentifier(value: string | null, allowColon = false): value is string {
  if (!value || value.length > 160) return false;
  return (allowColon ? /^[A-Za-z0-9:._-]+$/ : /^[A-Za-z0-9._-]+$/).test(value);
}

function route(pathname: string): DataRoute | null {
  const state = pathname.match(/^\/data\/([^/]+)\/state$/);
  if (state) {
    const tenant = decode(state[1]);
    return safeIdentifier(tenant, true) ? { kind: "state", tenant } : null;
  }
  const crux = pathname.match(/^\/data\/([^/]+)\/crux$/);
  if (crux) {
    const tenant = decode(crux[1]);
    return safeIdentifier(tenant, true) ? { kind: "crux", tenant } : null;
  }
  const agentAuditVerify = pathname.match(/^\/data\/([^/]+)\/agent-audits\/ora\/verify$/);
  if (agentAuditVerify) {
    const tenant = decode(agentAuditVerify[1]);
    return safeIdentifier(tenant, true) ? { kind: "agent-audits-verify", tenant } : null;
  }
  const agentAuditRefresh = pathname.match(/^\/data\/([^/]+)\/agent-audits\/ora\/refresh$/);
  if (agentAuditRefresh) {
    const tenant = decode(agentAuditRefresh[1]);
    return safeIdentifier(tenant, true) ? { kind: "agent-audits-refresh", tenant } : null;
  }
  const agentAudits = pathname.match(/^\/data\/([^/]+)\/agent-audits$/);
  if (agentAudits) {
    const tenant = decode(agentAudits[1]);
    return safeIdentifier(tenant, true) ? { kind: "agent-audits", tenant } : null;
  }
  const webflow = pathname.match(/^\/data\/([^/]+)\/webflow\/(connection|sync)$/);
  if (webflow) {
    const tenant = decode(webflow[1]);
    if (!safeIdentifier(tenant, true)) return null;
    return webflow[2] === "connection"
      ? { kind: "webflow-connection", tenant }
      : { kind: "webflow-sync", tenant };
  }
  const report = pathname.match(/^\/data\/([^/]+)\/reports\/([^/]+)\/([^/]+)$/);
  if (!report) return null;
  const tenant = decode(report[1]);
  const pageId = decode(report[2]);
  const key = decode(report[3]);
  return safeIdentifier(tenant, true) && safeIdentifier(pageId) && safeIdentifier(key)
    ? { kind: "report", tenant, pageId, key }
    : null;
}

function isAppState(value: unknown): value is AppState {
  if (!value || typeof value !== "object") return false;
  const state = value as Partial<AppState>;
  return Array.isArray(state.pages)
    && Array.isArray(state.recs)
    && (state.jobs === undefined || Array.isArray(state.jobs))
    && (state.followUps === undefined || Array.isArray(state.followUps));
}

function noStore(response: Response): Response {
  response.headers.set("cache-control", "no-store");
  return response;
}

async function boundedJson(request: Request, maxBytes = 8 * 1024 * 1024): Promise<unknown> {
  const length = Number(request.headers.get("content-length"));
  if (Number.isFinite(length) && length > maxBytes) throw new RangeError("request body too large");
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > maxBytes) throw new RangeError("request body too large");
  return JSON.parse(text);
}

/** Auth is handled by the parent Worker before this route is called. */
export async function handleDataPlaneRequest(
  request: Request,
  bindings: DataPlaneBindings,
): Promise<Response | null> {
  const url = new URL(request.url);
  const matched = route(url.pathname);
  if (!matched) return null;

  if (matched.kind === "webflow-connection") {
    try {
      if (request.method === "GET") {
        return noStore(Response.json(await getWebflowConnectionStatus(bindings, matched.tenant)));
      }
      if (request.method === "DELETE") {
        await disconnectWebflowSite(bindings, matched.tenant);
        return noStore(Response.json({ connected: false }));
      }
      if (request.method !== "POST") {
        return Response.json({ error: "method not allowed" }, { status: 405 });
      }
      let body: unknown;
      try {
        body = await boundedJson(request, 16 * 1024);
      } catch (error) {
        return Response.json(
          { error: error instanceof RangeError ? error.message : "invalid JSON" },
          { status: 400 },
        );
      }
      const input = body as { siteId?: unknown; token?: unknown };
      if (typeof input?.siteId !== "string" || typeof input?.token !== "string") {
        return Response.json({ error: "siteId and token are required" }, { status: 400 });
      }
      return noStore(Response.json(await connectWebflowSite(bindings, matched.tenant, {
        siteId: input.siteId,
        token: input.token,
      }), { status: 201 }));
    } catch (error) {
      if (error instanceof WebflowIntegrationError) {
        return noStore(Response.json(
          { error: error.message, code: error.code },
          { status: error.status },
        ));
      }
      throw error;
    }
  }

  if (matched.kind === "webflow-sync") {
    if (request.method !== "POST") {
      return Response.json({ error: "method not allowed" }, { status: 405 });
    }
    try {
      return noStore(Response.json(await syncWebflowActivity(bindings, matched.tenant)));
    } catch (error) {
      if (error instanceof WebflowIntegrationError) {
        return noStore(Response.json(
          { error: error.message, code: error.code },
          { status: error.status },
        ));
      }
      throw error;
    }
  }

  const store = createFdeStore(matched.tenant, bindings);
  if (matched.kind === "crux") {
    if (request.method !== "GET") return Response.json({ error: "method not allowed" }, { status: 405 });
    return noStore(Response.json({ evidence: await store.getCruxEvidence() }));
  }
  if (matched.kind === "agent-audits") {
    if (request.method !== "GET") return Response.json({ error: "method not allowed" }, { status: 405 });
    return noStore(Response.json({ audits: await store.getExternalAgentAudits() }));
  }
  if (matched.kind === "agent-audits-verify") {
    if (request.method !== "POST") {
      return Response.json({ error: "method not allowed" }, { status: 405 });
    }
    if (bindings.ORA_SCAN_ENABLED !== "true") {
      return noStore(Response.json({
        error: "external agent scanning is disabled for this deployment",
        code: "ORA_SCAN_DISABLED",
      }, { status: 503 }));
    }
    let body: unknown;
    try {
      body = await boundedJson(request, 4 * 1024);
    } catch (error) {
      return Response.json(
        { error: error instanceof RangeError ? error.message : "invalid JSON" },
        { status: 400 },
      );
    }
    const input = (body ?? {}) as { recKey?: unknown };
    // Only a task key is accepted. Check ids are resolved server-side from
    // stored state, so an arbitrary check set can never be submitted.
    if (typeof input.recKey !== "string" || !input.recKey || input.recKey.length > 400) {
      return Response.json({ error: "recKey is required" }, { status: 400 });
    }
    const result = await verifyAgentIssueTask(bindings, matched.tenant, input.recKey);
    const status = result.refusedReason
      ? (result.refusedReason === "not-consented" ? 409
        : result.refusedReason === "task-not-found" ? 404 : 400)
      : 200;
    return noStore(Response.json(result, { status }));
  }
  if (matched.kind === "agent-audits-refresh") {
    if (request.method !== "POST") {
      return Response.json({ error: "method not allowed" }, { status: 405 });
    }
    // Deployment-level kill switch, independent of the project's consent record.
    if (bindings.ORA_SCAN_ENABLED !== "true") {
      return noStore(Response.json({
        error: "external agent scanning is disabled for this deployment",
        code: "ORA_SCAN_DISABLED",
      }, { status: 503 }));
    }
    let body: unknown = {};
    if (request.headers.get("content-length") || request.headers.get("content-type")) {
      try {
        body = await boundedJson(request, 4 * 1024);
      } catch (error) {
        return Response.json(
          { error: error instanceof RangeError ? error.message : "invalid JSON" },
          { status: 400 },
        );
      }
    }
    const input = (body ?? {}) as { pageId?: unknown; origin?: unknown; force?: unknown };
    if (
      (input.pageId !== undefined && typeof input.pageId !== "string")
      || (input.origin !== undefined && typeof input.origin !== "string")
      || (input.force !== undefined && typeof input.force !== "boolean")
    ) {
      return Response.json({ error: "invalid refresh request" }, { status: 400 });
    }
    const result = await refreshExternalAgentAudits(bindings, matched.tenant, {
      ...(typeof input.pageId === "string" ? { pageId: input.pageId } : {}),
      ...(typeof input.origin === "string" ? { origin: input.origin } : {}),
      ...(input.force === true ? { force: true } : {}),
    });
    // A refused request is a client-visible precondition, not a server fault.
    const status = result.refusedReason
      ? (result.refusedReason === "not-consented" ? 409 : 400)
      : 200;
    return noStore(Response.json(result, { status }));
  }
  if (matched.kind === "state") {
    if (request.method === "GET") {
      const seed = url.searchParams.get("seed") !== "false";
      const value = await store.readVersionedState(seed);
      if (!value) return noStore(Response.json({ error: "state not found" }, { status: 404 }));
      return noStore(Response.json(value));
    }
    if (request.method !== "PUT") return Response.json({ error: "method not allowed" }, { status: 405 });
    let body: unknown;
    try {
      body = await boundedJson(request);
    } catch (error) {
      return Response.json({ error: error instanceof RangeError ? error.message : "invalid JSON" }, { status: 400 });
    }
    const input = body as { state?: unknown; expectedVersion?: unknown };
    const expected = input?.expectedVersion;
    if (!isAppState(input?.state) || !(expected === null || (Number.isInteger(expected) && Number(expected) >= 0))) {
      return Response.json({ error: "invalid state write" }, { status: 400 });
    }
    const result = await store.writeVersionedState(input.state, expected as number | null);
    if (!result.value) {
      return noStore(Response.json({
        error: "state version conflict",
        currentVersion: result.conflict?.version ?? null,
      }, { status: 409 }));
    }
    return noStore(Response.json(result.value));
  }

  if (request.method === "GET") {
    const payload = await store.getReport(matched.pageId, matched.key);
    return payload === null
      ? noStore(Response.json({ error: "report not found" }, { status: 404 }))
      : noStore(Response.json({ payload }));
  }
  if (request.method === "DELETE") {
    await store.deleteReport(matched.pageId, matched.key);
    return noStore(Response.json({ ok: true }));
  }
  if (request.method === "PUT") {
    let body: unknown;
    try {
      body = await boundedJson(request, 16 * 1024 * 1024);
    } catch (error) {
      return Response.json({ error: error instanceof RangeError ? error.message : "invalid JSON" }, { status: 400 });
    }
    if (!body || typeof body !== "object" || !("payload" in body)) {
      return Response.json({ error: "invalid report write" }, { status: 400 });
    }
    await store.putReport(matched.pageId, matched.key, (body as { payload: unknown }).payload);
    return noStore(Response.json({ ok: true }));
  }
  return Response.json({ error: "method not allowed" }, { status: 405 });
}
