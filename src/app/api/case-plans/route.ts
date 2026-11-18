import { NextResponse } from "next/server";
import { recordCasePlan } from "@/lib/mutations";
import { CasePlanError, type CasePlanInput } from "@/lib/case-plans";
import { projectStore } from "@/lib/projects";
import { identityFromRequest } from "@/lib/identity";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Append one user-authored remediation plan, keyed on the case's cause. */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as CasePlanInput;
  try {
    const identity = await identityFromRequest(req);
    const state = await recordCasePlan(
      body,
      { kind: "person", userId: identity.email },
      await projectStore(req),
    );
    return NextResponse.json({ state });
  } catch (error) {
    if (error instanceof CasePlanError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
