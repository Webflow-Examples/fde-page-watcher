import { NextResponse } from "next/server";
import { getEnv } from "@/lib/env";
import { getStoreDiagnostics } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const storage = getStoreDiagnostics();
  const dispatchConfigured = !!getEnv("COLLECTOR_URL");
  const authConfigured = !!getEnv("CRON_SECRET");
  const explicitCallbackConfigured = !!getEnv("COLLECTOR_CALLBACK_URL");
  const webflowCallbackConfigured = !!getEnv("ASSETS_PREFIX");
  const callbackConfigured = explicitCallbackConfigured || webflowCallbackConfigured;
  const collectorConfigured = dispatchConfigured && authConfigured && callbackConfigured;
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
        callbackConfigured,
        callbackSource: explicitCallbackConfigured ? "explicit" : webflowCallbackConfigured ? "webflow" : "missing",
      },
    },
    { status: ok ? 200 : 503 },
  );
}
