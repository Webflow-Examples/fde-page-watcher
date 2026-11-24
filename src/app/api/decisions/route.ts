import { NextResponse } from "next/server";
import { recordCaseDecision } from "@/lib/mutations";
import { CaseDecisionError, caseDecisionFrom, type CaseDecisionInput } from "@/lib/case-decisions";
import { authorizedProjectForRequest, projectStoreForTenant } from "@/lib/projects";
import { identityFromRequest } from "@/lib/identity";
import { getIntegrationStore } from "@/lib/integrations/server";
import { afterDecision } from "@/lib/integrations/automations";
import { decisionEvent, emitProjectEvent } from "@/lib/integrations/events";
import { requestOrigin } from "@/lib/integrations/http";

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
 *
 * After the log write, the integration automations for this decision run (if a
 * project admin switched them on) and the signed event is sent. Neither can
 * fail the request: the decision is already stored, and an unreachable task
 * tool must not turn a person's Accept into an error they think did nothing.
 */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as CaseDecisionInput;
  try {
    const project = await authorizedProjectForRequest(req, "admin");
    const identity = await identityFromRequest(req);
    const by = { kind: "person" as const, userId: identity.email };
    // Validate and stamp before the write, so the automation's idempotency key
    // is the same stamp the log holds.
    const at = new Date();
    const decision = caseDecisionFrom(body, { at: at.toISOString(), by });
    const state = await recordCaseDecision(body, by, await projectStoreForTenant(project.tenant), at);

    const store = getIntegrationStore(project.id);
    try {
      await afterDecision({
        projectId: project.id,
        store,
        state,
        decision,
        now: at,
        appUrl: requestOrigin(req),
      });
      await emitProjectEvent({ store, projectId: project.id, event: decisionEvent(project.id, decision) });
    } catch (error) {
      console.error(JSON.stringify({ message: "decision automation failed", projectId: project.id, error: String(error).slice(0, 500) }));
    }
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
