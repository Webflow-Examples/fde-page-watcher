import { NextResponse } from "next/server";
import { runNightly } from "@/lib/collector";
import { evaluateCronAccess } from "@/lib/access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 800;

/**
 * Nightly collection: priority pages first, both strategies, agent scan,
 * alerting, and due follow-ups (REQ-013). CRON_SECRET is mandatory outside
 * development and fails closed when deployment configuration is missing.
 * Wire a Webflow Cloud scheduled job (or GitHub Action) to POST here nightly.
 */
export async function POST(req: Request) {
  const access = evaluateCronAccess(req.headers.get("authorization"));
  if (!access.allowed) {
    return NextResponse.json({ error: access.message }, { status: access.status });
  }
  try {
    const result = await runNightly();
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
