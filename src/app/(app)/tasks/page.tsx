import { redirect } from "next/navigation";
import { getEnv } from "@/lib/env";
import { normalizeBasePath, withBasePath } from "@/lib/paths";
import { DESTINATION_PATH } from "@/lib/vocabulary";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Retired destination. The app is organised around one object — the issue case
 * — so this route only exists to keep old links, bookmarks, and alert
 * notifications from 404ing.
 */
export default function RedirectToIssues() {
  redirect(withBasePath(normalizeBasePath(getEnv("BASE_URL")), DESTINATION_PATH.issues));
}
