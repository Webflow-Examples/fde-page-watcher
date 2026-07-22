import { createFdeStore, type FdeStoreBindings } from "./dataStore";
import type { AppState } from "../src/lib/types";

type DataRoute =
  | { kind: "state"; tenant: string }
  | { kind: "report"; tenant: string; pageId: string; key: string };

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
  bindings: FdeStoreBindings,
): Promise<Response | null> {
  const url = new URL(request.url);
  const matched = route(url.pathname);
  if (!matched) return null;
  const store = createFdeStore(matched.tenant, bindings);

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
