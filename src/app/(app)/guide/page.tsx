import { redirect } from "next/navigation";
import { getEnv } from "@/lib/env";
import { normalizeBasePath, withBasePath } from "@/lib/paths";
import { DESTINATION_PATH } from "@/lib/vocabulary";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Retired destination. The glossary is gone: a term a reader has to look up is
 * a term the copy should have explained where they met it, and most of this
 * product's copy is read outside the app — in digests, tickets and screenshots,
 * where no glossary is reachable.
 *
 * This lands on the issues list, alongside the other retired destinations,
 * rather than on the Settings section the glossary's replacement was once
 * expected to become. There is no `#reference` section and there will not be
 * one: the operational lines this route used to explain now sit beside the
 * Settings controls they describe, so there is no single anchor to send an old
 * link to, and the issues list is where every other retired route goes.
 */
export default function RedirectToIssues() {
  redirect(withBasePath(normalizeBasePath(getEnv("BASE_URL")), DESTINATION_PATH.issues));
}
