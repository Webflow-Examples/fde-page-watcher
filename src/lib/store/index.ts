import { getCloudflareContext } from "@opennextjs/cloudflare";
import { TENANT, type Tenant } from "../types";
import { createFsStore, type DataStore } from "./fsStore";
import { createCfStore } from "./cfStore";

export type { DataStore } from "./fsStore";

/**
 * Return the single tenant-scoped data-access layer (REQ-001). Rejects an empty
 * scope (REQ-031). In v1 the tenant is a hardcoded brand-studio constant
 * (REQ-003); swapping to a session-supplied value later is a one-line change here.
 *
 * Selects the Cloudflare-backed adapter when running on Workers (D1 + R2
 * bindings present), otherwise falls back to the filesystem adapter used by
 * plain `next dev`. STORAGE_DRIVER=fs forces the fs adapter even on Workers.
 */
export function getStore(tenant: Tenant = TENANT): DataStore {
  if (!tenant) throw new Error("getStore: a tenant scope is required");
  if (process.env.STORAGE_DRIVER !== "fs") {
    try {
      const { env } = getCloudflareContext();
      if (env?.DB && env?.REPORTS) return createCfStore(tenant);
    } catch {
      // Not running on Cloudflare Workers.
    }
  }
  return createFsStore(tenant);
}

/** Convenience accessor bound to the v1 hardcoded tenant. */
export function store(): DataStore {
  return getStore(TENANT);
}
