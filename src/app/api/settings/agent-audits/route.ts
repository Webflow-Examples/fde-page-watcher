import { NextResponse } from "next/server";
import { setExternalAgentAuditEnabled } from "@/lib/mutations";
import { projectStore } from "@/lib/projects";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Record or withdraw project consent for public external agent audits. */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { enabled?: unknown };
  if (typeof body.enabled !== "boolean") {
    return NextResponse.json({ error: "enabled must be a boolean" }, { status: 400 });
  }
  try {
    return NextResponse.json({
      state: await setExternalAgentAuditEnabled(body.enabled, await projectStore(req)),
    });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
