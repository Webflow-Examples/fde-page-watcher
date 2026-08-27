import { NextResponse } from "next/server";
import { setExternalAgentAuditEnabled } from "@/lib/mutations";
import { projectStore } from "@/lib/projects";
import { identityFromRequest } from "@/lib/identity";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Record or withdraw project consent for public external agent audits. */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { enabled?: unknown };
  if (typeof body.enabled !== "boolean") {
    return NextResponse.json({ error: "enabled must be a boolean" }, { status: 400 });
  }
  try {
    // The verified account, not anything the body claims: the history records
    // WHO consented, which is the only thing that makes it a consent record.
    const identity = await identityFromRequest(req);
    return NextResponse.json({
      state: await setExternalAgentAuditEnabled(
        body.enabled,
        { kind: "person", userId: identity.email },
        await projectStore(req),
      ),
    });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
