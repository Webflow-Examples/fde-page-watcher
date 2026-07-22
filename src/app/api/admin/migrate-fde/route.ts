import { NextResponse } from "next/server";
import { createCfStore, getLocalCloudflareBindings } from "@/lib/store/cfStore";
import { deploymentTenant } from "@/lib/store";
import { getEnv } from "@/lib/env";
import type { AppState } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

interface VersionedState {
  state: AppState;
  version: number;
  updatedAt: string;
}

interface ListedR2Object {
  key: string;
}

interface ListableR2Bucket extends R2Bucket {
  list(options: { prefix: string; cursor?: string; limit?: number }): Promise<{
    objects: ListedR2Object[];
    truncated: boolean;
    cursor?: string;
  }>;
}

function destinationBase(): string {
  const configured = getEnv("FDE_DATA_URL") ?? getEnv("COLLECTOR_URL");
  if (!configured) throw new Error("Missing FDE_DATA_URL or COLLECTOR_URL");
  return configured.replace(/\/jobs\/?$/, "").replace(/\/$/, "");
}

function headers(): HeadersInit {
  const secret = getEnv("CRON_SECRET");
  if (!secret) throw new Error("Missing CRON_SECRET");
  return { authorization: `Bearer ${secret}`, "content-type": "application/json" };
}

async function checksum(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function destinationState(url: string, tenant: string): Promise<VersionedState | null> {
  const response = await fetch(`${url}/data/${encodeURIComponent(tenant)}/state?seed=false`, {
    headers: headers(),
    cache: "no-store",
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`FDE state read ${response.status}: ${(await response.text()).slice(0, 300)}`);
  return response.json() as Promise<VersionedState>;
}

async function copyReports(url: string, tenant: string): Promise<number> {
  const { REPORTS: boundReports } = getLocalCloudflareBindings();
  const REPORTS = boundReports as unknown as ListableR2Bucket;
  let cursor: string | undefined;
  let copied = 0;
  do {
    const page = await REPORTS.list({ prefix: `${tenant}/`, cursor, limit: 1000 });
    for (let offset = 0; offset < page.objects.length; offset += 5) {
      await Promise.all(page.objects.slice(offset, offset + 5).map(async (entry) => {
        const suffix = entry.key.slice(tenant.length + 1);
        const match = suffix.match(/^([^/]+)\/(.+)\.json$/);
        if (!match) throw new Error(`Unsupported source report key: ${entry.key}`);
        const object = await REPORTS.get(entry.key);
        if (!object) throw new Error(`Source report disappeared: ${entry.key}`);
        const envelope = await object.json() as { tenant?: unknown; payload?: unknown };
        if (envelope.tenant !== tenant || !("payload" in envelope)) throw new Error(`Invalid source report: ${entry.key}`);
        const response = await fetch(
          `${url}/data/${encodeURIComponent(tenant)}/reports/${encodeURIComponent(match[1])}/${encodeURIComponent(match[2])}`,
          { method: "PUT", headers: headers(), body: JSON.stringify({ payload: envelope.payload }) },
        );
        if (!response.ok) throw new Error(`FDE report write ${response.status}: ${(await response.text()).slice(0, 300)}`);
        copied += 1;
      }));
    }
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  return copied;
}

/**
 * One-way, non-destructive copy from Webflow Cloud bindings to FDE D1/R2.
 * A differing destination is never overwritten unless `replace: true` is
 * supplied explicitly. The source bindings are never mutated or deleted.
 */
export async function POST(request: Request) {
  if (request.headers.get("x-page-watcher-migration") !== "copy-to-fde") {
    return NextResponse.json({ error: "missing migration confirmation header" }, { status: 400 });
  }
  const input = await request.json().catch(() => ({})) as { replace?: boolean };
  try {
    const tenant = deploymentTenant();
    const url = destinationBase();
    const source = await createCfStore(tenant).getState();
    const sourceChecksum = await checksum(source);
    const before = await destinationState(url, tenant);
    const beforeChecksum = before ? await checksum(before.state) : null;

    if (before && beforeChecksum !== sourceChecksum && input.replace !== true) {
      return NextResponse.json({
        error: "FDE destination already contains different state; no data was overwritten",
        tenant,
        sourceChecksum,
        destinationChecksum: beforeChecksum,
        destinationVersion: before.version,
      }, { status: 409 });
    }

    let stateVersion = before?.version ?? null;
    if (!before || beforeChecksum !== sourceChecksum) {
      const response = await fetch(`${url}/data/${encodeURIComponent(tenant)}/state`, {
        method: "PUT",
        headers: headers(),
        body: JSON.stringify({ state: source, expectedVersion: before?.version ?? null }),
      });
      if (!response.ok) throw new Error(`FDE state write ${response.status}: ${(await response.text()).slice(0, 300)}`);
      stateVersion = ((await response.json()) as VersionedState).version;
    }

    const reportsCopied = await copyReports(url, tenant);
    const sourceAfterCopy = await createCfStore(tenant).getState();
    const sourceAfterChecksum = await checksum(sourceAfterCopy);
    if (sourceAfterChecksum !== sourceChecksum) {
      return NextResponse.json({
        error: "Webflow source state changed during the copy; source is preserved, but the destination is not cutover-ready. Run the migration again with replace enabled.",
        tenant,
        sourceChecksum,
        sourceAfterChecksum,
        reportsCopied,
      }, { status: 409 });
    }
    const verified = await destinationState(url, tenant);
    const verifiedChecksum = verified ? await checksum(verified.state) : null;
    if (verifiedChecksum !== sourceChecksum) throw new Error("FDE state verification checksum did not match the source");

    return NextResponse.json({
      ok: true,
      sourcePreserved: true,
      tenant,
      stateVersion,
      sourceChecksum,
      destinationChecksum: verifiedChecksum,
      pages: source.pages.length,
      historyEntries: source.pages.reduce((sum, page) => sum + page.history.length, 0),
      markers: source.pages.reduce((sum, page) => sum + page.markers.length, 0),
      jobs: source.jobs?.length ?? 0,
      reportsCopied,
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
