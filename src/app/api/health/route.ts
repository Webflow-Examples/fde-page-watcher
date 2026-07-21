import { NextResponse } from "next/server";
import { getEnv } from "@/lib/env";
import { getStoreDiagnostics } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const storage = getStoreDiagnostics();
  const collectorConfigured = !!getEnv("COLLECTOR_URL") && !!(getEnv("COLLECTOR_CALLBACK_URL") ?? getEnv("ASSETS_PREFIX")) && !!(getEnv("COLLECTOR_SECRET") ?? getEnv("CRON_SECRET"));
  const ok = storage.driver !== "unavailable" && (process.env.NODE_ENV !== "production" || collectorConfigured);
  return NextResponse.json(
    {
      ok,
      build: getEnv("WEBFLOW_DEPLOYMENT_ID") ?? getEnv("CF_VERSION_METADATA") ?? "unknown",
      dataset: getEnv("DATASET_MODE") === "live" ? "live" : "demo",
      storage,
      collector: { configured: collectorConfigured },
    },
    { status: ok ? 200 : 503 },
  );
}
