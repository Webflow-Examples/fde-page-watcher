import { getEnv } from "./env";
import { buildSeedWebflowConnectionStatus } from "./seed";

function collectorBaseUrl(): string {
  const configured = getEnv("FDE_DATA_URL") ?? getEnv("COLLECTOR_URL");
  if (!configured) {
    throw new Error("Webflow connection requires FDE_DATA_URL or COLLECTOR_URL");
  }
  return configured.replace(/\/jobs\/?$/, "").replace(/\/$/, "");
}

function collectorSecret(): string {
  const value = getEnv("CRON_SECRET");
  if (!value) throw new Error("Webflow connection requires CRON_SECRET");
  return value;
}

export async function requestWebflowCollector(
  action: "connection" | "sync",
  tenant: string,
  init: RequestInit = {},
  fetchFn: typeof fetch = fetch,
): Promise<Response> {
  const configured = getEnv("FDE_DATA_URL") ?? getEnv("COLLECTOR_URL");
  if (!configured && getEnv("DATASET_MODE") !== "live") {
    const method = (init.method ?? "GET").toUpperCase();
    if (action === "sync") {
      return Response.json({ ok: true, fetched: 24, inserted: 3, pages: 6, syncedAt: new Date().toISOString() });
    }
    if (method === "DELETE") return Response.json({ connected: false });
    return Response.json(buildSeedWebflowConnectionStatus());
  }
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${collectorSecret()}`);
  if (init.body !== undefined) headers.set("content-type", "application/json");
  return fetchFn(
    `${collectorBaseUrl()}/data/${encodeURIComponent(tenant)}/webflow/${action}`,
    {
      ...init,
      headers,
      cache: "no-store",
      signal: init.signal ?? AbortSignal.timeout(30_000),
    },
  );
}

export async function relayWebflowCollector(response: Response): Promise<Response> {
  const body = await response.text();
  if (new TextEncoder().encode(body).byteLength > 64 * 1024) {
    return Response.json({ error: "Collector returned an unexpectedly large response" }, { status: 502 });
  }
  try {
    return Response.json(JSON.parse(body), {
      status: response.status,
      headers: { "cache-control": "no-store" },
    });
  } catch {
    return Response.json({ error: "Collector returned invalid JSON" }, { status: 502 });
  }
}
