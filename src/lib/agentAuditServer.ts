/**
 * Server-side relay to the collector's external agent-audit routes.
 *
 * The collector owns every outbound provider request, its quota accounting, and
 * the audit store. The app never calls Ora directly, so a browser can neither
 * choose the target nor see the provider key.
 *
 * Mirrors `webflowConnectionServer.ts`, including the no-collector development
 * fallback so local work does not require a deployed Worker.
 */

import { getEnv } from "./env";

function collectorBaseUrl(): string {
  const configured = getEnv("FDE_DATA_URL") ?? getEnv("COLLECTOR_URL");
  if (!configured) {
    throw new Error("External agent audits require FDE_DATA_URL or COLLECTOR_URL");
  }
  return configured.replace(/\/jobs\/?$/, "").replace(/\/$/, "");
}

function collectorSecret(): string {
  const value = getEnv("CRON_SECRET");
  if (!value) throw new Error("External agent audits require CRON_SECRET");
  return value;
}

export interface AgentAuditRefreshInput {
  pageId?: string;
  origin?: string;
  force?: boolean;
}

/**
 * Ask the collector to refresh the external audit for a watched origin. The
 * origin is resolved and re-validated server-side; a caller cannot widen the
 * target beyond the project's own watched pages.
 */
export async function requestAgentAuditRefresh(
  tenant: string,
  input: AgentAuditRefreshInput,
  fetchFn: typeof fetch = fetch,
): Promise<Response> {
  const configured = getEnv("FDE_DATA_URL") ?? getEnv("COLLECTOR_URL");
  if (!configured && getEnv("DATASET_MODE") !== "live") {
    // Local development without a collector: report the deployment gate rather
    // than pretending a public external scan happened.
    return Response.json({
      error: "external agent scanning is unavailable without a collector",
      code: "ORA_SCAN_DISABLED",
    }, { status: 503 });
  }
  return fetchFn(`${collectorBaseUrl()}/data/${encodeURIComponent(tenant)}/agent-audits/ora/refresh`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${collectorSecret()}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      ...(input.pageId ? { pageId: input.pageId } : {}),
      ...(input.origin ? { origin: input.origin } : {}),
      ...(input.force ? { force: true } : {}),
    }),
    cache: "no-store",
    // A refresh may poll a partial analysis, so allow more than a plain read.
    signal: AbortSignal.timeout(90_000),
  });
}

/** Relay a collector response with a bounded body and no caching. */
export async function relayAgentAuditResponse(response: Response): Promise<Response> {
  const body = await response.text();
  if (new TextEncoder().encode(body).byteLength > 256 * 1024) {
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
