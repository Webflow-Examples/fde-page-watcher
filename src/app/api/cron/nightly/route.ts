import { NextResponse } from "next/server";
import { runNightly } from "@/lib/collector";
import { getEnv } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 800;

/**
 * Nightly collection: priority pages first, both strategies, agent scan,
 * alerting, and due follow-ups (REQ-013). Protected by CRON_SECRET when set.
 * Wire a Webflow Cloud scheduled job (or GitHub Action) to POST here nightly.
 */
export async function POST(req: Request) {
  const secret = getEnv("CRON_SECRET");
  if (secret && req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    const result = await runNightly();
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
