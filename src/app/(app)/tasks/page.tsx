import { redirect } from "next/navigation";
import { getEnv } from "@/lib/env";
import { normalizeBasePath, withBasePath } from "@/lib/paths";
import { DESTINATION_PATH } from "@/lib/vocabulary";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Retired destination. What lived here is now the Fix queue on the issues
 * list; this route only exists to keep old links from 404ing.
 */
export default function RedirectToFixQueue() {
  redirect(withBasePath(normalizeBasePath(getEnv("BASE_URL")), `${DESTINATION_PATH.issues}?queue=fix`));
}
