import { redirect } from "next/navigation";
import { getEnv } from "@/lib/env";
import { normalizeBasePath, withBasePath } from "@/lib/paths";
import { DESTINATION_PATH } from "@/lib/vocabulary";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Retired destination. The reference material moves into Settings; this route
 * only exists to keep old links from 404ing.
 *
 * Note: the `#reference` section of Settings is not built yet, so this lands on
 * Settings without scrolling anywhere. That section arrives with the Settings
 * work, not with the app chrome.
 */
export default function RedirectToReference() {
  redirect(withBasePath(normalizeBasePath(getEnv("BASE_URL")), `${DESTINATION_PATH.settings}#reference`));
}
