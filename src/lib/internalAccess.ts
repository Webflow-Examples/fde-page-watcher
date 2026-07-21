import { evaluateCronAccess } from "./access";
import { getEnv } from "./env";

/** Collector callbacks bypass the site's interactive SSO and use a shared secret. */
export function authorizeInternalRequest(request: Request) {
  return evaluateCronAccess(request.headers.get("authorization"), { secret: getEnv("CRON_SECRET") });
}
