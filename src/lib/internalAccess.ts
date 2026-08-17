import { evaluateCronAccess } from "./access";
import { getEnv } from "./env";
import { projectStoreForTenant } from "./projects";

/** Collector callbacks bypass the site's interactive SSO and use a shared secret. */
export function authorizeInternalRequest(request: Request) {
  return evaluateCronAccess(request.headers.get("authorization"), { secret: getEnv("CRON_SECRET") });
}

export async function internalProjectStore(request: Request) {
  const tenant = new URL(request.url).searchParams.get("tenant");
  if (!tenant) throw new Error("tenant query parameter is required");
  return projectStoreForTenant(tenant);
}
