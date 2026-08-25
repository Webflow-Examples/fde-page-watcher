import { redirect } from "next/navigation";
import { getEnv } from "@/lib/env";
import { normalizeBasePath, withBasePath } from "@/lib/paths";
import { DESTINATION_PATH } from "@/lib/vocabulary";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default function Home() {
  // Straight to the first destination. This used to point at a route that is
  // now itself a redirect, which cost every visit to the root an extra hop.
  redirect(withBasePath(normalizeBasePath(getEnv("BASE_URL")), DESTINATION_PATH.issues));
}
