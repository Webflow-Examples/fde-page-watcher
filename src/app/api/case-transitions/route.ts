import { NextResponse } from "next/server";
import { recordCaseTransition } from "@/lib/mutations";
import { CaseTransitionError, type CaseTransitionInput } from "@/lib/case-transitions";
import { projectStore } from "@/lib/projects";
import { identityFromRequest } from "@/lib/identity";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Append one case-level lifecycle transition.
 *
 * Separate from `/api/decisions` because the grain is different. A decision
 * names a remediation and applies to every case sharing it; a transition names
 * a case, by its stable cause, and applies to that finding alone.
 */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as CaseTransitionInput;
  try {
    const identity = await identityFromRequest(req);
    const state = await recordCaseTransition(
      body,
      { kind: "person", userId: identity.email },
      await projectStore(req),
    );
    return NextResponse.json({ state });
  } catch (error) {
    if (error instanceof CaseTransitionError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
