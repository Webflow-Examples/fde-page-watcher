import { NextResponse } from "next/server";
import { projectStore } from "@/lib/projects";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Read the stored raw report object for one night (REQ-006): every PSI run's
 * payload per strategy plus the agent scan recorded that night. The History
 * "Report" modal reads this instead of fabricating a payload (audit: audit
 * trail).
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string; key: string }> }) {
  const { id, key } = await params;
  const payload = await projectStore(req).getReport(id, decodeURIComponent(key));
  if (payload == null) {
    return NextResponse.json({ error: "no stored report for this night" }, { status: 404 });
  }
  return NextResponse.json({ report: payload });
}
