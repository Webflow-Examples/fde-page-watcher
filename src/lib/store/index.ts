import { getCloudflareContext } from "@opennextjs/cloudflare";
import { TENANT, type Tenant } from "../types";
import { createFsStore, type DataStore } from "./fsStore";
import { createCfStore } from "./cfStore";
import { getEnv } from "../env";

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
function deploymentTenant(): Tenant {
  // Keep the existing sample state at the legacy tenant key. Live mode gets an
  // isolated key, so changing DATASET_MODE is a reversible demo/live switch.
  return getEnv("DATASET_MODE") === "live" ? `${TENANT}:live` : TENANT;
}

export function getStore(tenant: Tenant = deploymentTenant()): DataStore {
  if (!tenant) throw new Error("getStore: a tenant scope is required");
  if (getEnv("STORAGE_DRIVER") !== "fs") {
    try {
      const { env } = getCloudflareContext();
      if (env?.DB && env?.REPORTS) return createCfStore(tenant);
    } catch {
      // Not running on Cloudflare Workers.
    }
  }
  if (process.env.NODE_ENV === "production") {
    throw new Error("Production storage is unavailable: both DB and REPORTS bindings are required");
  }
  return createFsStore(tenant, getEnv("FS_STORE_ROOT"));
}

export interface StoreDiagnostics {
  driver: "cloudflare" | "filesystem" | "unavailable";
  db: boolean;
  reports: boolean;
}

/** Read-only deployment diagnostic; never exposes binding values or secrets. */
export function getStoreDiagnostics(): StoreDiagnostics {
  if (getEnv("STORAGE_DRIVER") === "fs") {
    return { driver: process.env.NODE_ENV === "production" ? "unavailable" : "filesystem", db: false, reports: false };
  }
  try {
    const { env } = getCloudflareContext();
    const db = !!env?.DB;
    const reports = !!env?.REPORTS;
    return { driver: db && reports ? "cloudflare" : "unavailable", db, reports };
  } catch {
    return { driver: process.env.NODE_ENV === "production" ? "unavailable" : "filesystem", db: false, reports: false };
  }
}

/** Convenience accessor bound to the v1 hardcoded tenant. */
export function store(): DataStore {
  return getStore();
}
