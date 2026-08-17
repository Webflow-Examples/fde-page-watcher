import type { AppState, ManagedProjectRecord } from "../src/lib/types";
import { createFdeStore, type FdeStoreBindings } from "./dataStore";

export const ADMIN_REGISTRY_TENANT = "page-watch-admin-registry:live";
const DEFAULT_TENANT = "brand-studio:live";
const SAFE_TENANT = /^[A-Za-z0-9:._-]+$/;

export interface TenantRegistryEnvironment extends FdeStoreBindings {
  NIGHTLY_TENANT: string;
}

export type TenantTaskResult<T> =
  | { tenant: string; status: "succeeded"; value: T }
  | { tenant: string; status: "failed"; error: string };

function validRegistryRecord(value: unknown): value is ManagedProjectRecord {
  if (!value || typeof value !== "object") return false;
  const record = value as Partial<ManagedProjectRecord>;
  return typeof record.id === "string"
    && !!record.id
    && typeof record.name === "string"
    && !!record.name.trim()
    && typeof record.tenant === "string"
    && record.tenant.length > 0
    && record.tenant.length <= 160
    && SAFE_TENANT.test(record.tenant)
    && typeof record.createdAt === "string"
    && (record.archivedAt === undefined || Number.isFinite(Date.parse(record.archivedAt)));
}

/** Resolve every active project scope from the same registry used by the app. */
export function activeProjectTenantsFromState(defaultTenant: string, registry: AppState): string[] {
  if (!defaultTenant || defaultTenant.length > 160 || !SAFE_TENANT.test(defaultTenant)) {
    throw new Error("NIGHTLY_TENANT is invalid");
  }
  const records = (registry.managedProjects ?? []).filter(validRegistryRecord);
  const archivedTenants = new Set(records.filter((record) => record.archivedAt).map((record) => record.tenant));
  const candidates = [defaultTenant, ...records.filter((record) => !record.archivedAt).map((record) => record.tenant)];
  return [...new Set(candidates)].filter((tenant) => !archivedTenants.has(tenant));
}

export async function activeProjectTenants(env: TenantRegistryEnvironment): Promise<string[]> {
  const registry = await createFdeStore(ADMIN_REGISTRY_TENANT, env).getState();
  const tenants = activeProjectTenantsFromState(env.NIGHTLY_TENANT || DEFAULT_TENANT, registry);
  if (tenants.length === 0) throw new Error("No active project tenants are configured");
  return tenants;
}

/** Execute tenant work sequentially so provider traffic stays bounded and one project cannot block the rest. */
export async function runTenantTasks<T>(
  tenants: readonly string[],
  task: (tenant: string) => Promise<T>,
): Promise<Array<TenantTaskResult<T>>> {
  const results: Array<TenantTaskResult<T>> = [];
  for (const tenant of tenants) {
    try {
      results.push({ tenant, status: "succeeded", value: await task(tenant) });
    } catch (error) {
      const message = (error instanceof Error ? error.message : String(error)).slice(0, 500);
      console.error(JSON.stringify({ message: "tenant background task failed", tenant, error: message }));
      results.push({ tenant, status: "failed", error: message });
    }
  }
  return results;
}

export function tenantSchedulerStatusKey(tenant: string, kind: "nightly" | "crux" | "audit"): string {
  return `${tenant}/scheduler/${kind}-latest.json`;
}

export function tenantAllowed(tenant: string, activeTenants: readonly string[]): boolean {
  return tenant.length <= 160 && SAFE_TENANT.test(tenant) && activeTenants.includes(tenant);
}
