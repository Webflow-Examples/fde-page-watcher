import { NextResponse } from "next/server";
import { recordCaseTransition } from "@/lib/mutations";
import { CaseTransitionError, caseTransitionFrom, type CaseTransitionInput } from "@/lib/case-transitions";
import { authorizedProjectForRequest, projectStoreForTenant } from "@/lib/projects";
import { identityFromRequest } from "@/lib/identity";
import { getIntegrationStore } from "@/lib/integrations/server";
import { afterTransition } from "@/lib/integrations/automations";
import { emitProjectEvent, transitionEvent } from "@/lib/integrations/events";
import { requestOrigin } from "@/lib/integrations/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Append one case-level lifecycle transition.
 *
 * Separate from `/api/decisions` because the grain is different. A decision
 * names a remediation and applies to every case sharing it; a transition names
 * a case, by its stable cause, and applies to that finding alone.
 *
 * Reopen's automation (comment on the task and reopen it) runs after the log
 * write, and the signed event is sent. Both are best-effort: the transition is
 * stored first and an integration failure never reports it as failed.
 */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as CaseTransitionInput;
  try {
    const project = await authorizedProjectForRequest(req, "admin");
    const identity = await identityFromRequest(req);
    const by = { kind: "person" as const, userId: identity.email };
    const at = new Date();
    const transition = caseTransitionFrom(body, { at: at.toISOString(), by });
    const state = await recordCaseTransition(body, by, await projectStoreForTenant(project.tenant), at);

    const store = getIntegrationStore(project.id);
    try {
      await afterTransition({
        projectId: project.id,
        store,
        state,
        transition,
        now: at,
        appUrl: requestOrigin(req),
      });
      await emitProjectEvent({ store, projectId: project.id, event: transitionEvent(project.id, transition) });
    } catch (error) {
      console.error(JSON.stringify({ message: "transition automation failed", projectId: project.id, error: String(error).slice(0, 500) }));
    }
    return NextResponse.json({ state });
  } catch (error) {
    if (error instanceof CaseTransitionError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
