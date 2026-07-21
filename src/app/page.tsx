import { redirect } from "next/navigation";
import { getEnv } from "@/lib/env";
import { normalizeBasePath, withBasePath } from "@/lib/paths";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default function Home() {
  redirect(withBasePath(normalizeBasePath(getEnv("BASE_URL")), "/dashboard"));
}
