import { NextResponse } from "next/server";
import { getEnv } from "@/lib/env";
import { getStoreDiagnostics } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const storage = getStoreDiagnostics();
  const dispatchConfigured = !!getEnv("COLLECTOR_URL");
  const authConfigured = !!getEnv("CRON_SECRET");
  const collectorConfigured = dispatchConfigured && authConfigured;
  const ok = storage.driver !== "unavailable" && (process.env.NODE_ENV !== "production" || collectorConfigured);
  return NextResponse.json(
    {
      ok,
      build: getEnv("WEBFLOW_DEPLOYMENT_ID") ?? getEnv("CF_VERSION_METADATA") ?? "unknown",
      dataset: getEnv("DATASET_MODE") === "live" ? "live" : "demo",
      storage,
      collector: {
        configured: collectorConfigured,
        dispatchConfigured,
        authConfigured,
        resultTransport: "polling",
      },
    },
    { status: ok ? 200 : 503 },
  );
}
