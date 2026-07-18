import { TENANT, type Tenant } from "../types";
import { createFsStore, type DataStore } from "./fsStore";

export type { DataStore } from "./fsStore";

/**
 * Return the single tenant-scoped data-access layer (REQ-001). Rejects an empty
 * scope (REQ-031). In v1 the tenant is a hardcoded brand-studio constant
 * (REQ-003); swapping to a session-supplied value later is a one-line change here.
 */
export function getStore(tenant: Tenant = TENANT): DataStore {
  if (!tenant) throw new Error("getStore: a tenant scope is required");
  return createFsStore(tenant);
}

/** Convenience accessor bound to the v1 hardcoded tenant. */
export function store(): DataStore {
  return getStore(TENANT);
}
