import { NextResponse } from "next/server";
import { recordCaseDecision } from "@/lib/mutations";
import { CaseDecisionError, type CaseDecisionInput } from "@/lib/case-decisions";
import { projectStore } from "@/lib/projects";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Append one decision about a remediation.
 *
 * Not `/api/cases/...`, and not for want of a tidier URL: a case is a group
 * with no id of its own, so an endpoint addressed by one would be promising an
 * identity the derivation cannot keep. The body names the remediation, which is
 * the thing the decision is actually about.
 *
 * POST only. There is no PUT and no DELETE because there is nothing to replace
 * and nothing to remove — the log is append-only, and undoing a decision is
 * another decision, which is a POST like any other.
 */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as CaseDecisionInput;
  try {
    const state = await recordCaseDecision(body, await projectStore(req));
    return NextResponse.json({ state });
  } catch (error) {
    // A malformed decision is the caller's fault and says so; anything else is
    // ours, and is not dressed up as a validation failure.
    if (error instanceof CaseDecisionError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
