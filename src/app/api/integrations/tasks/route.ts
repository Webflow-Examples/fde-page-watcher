import { NextResponse } from "next/server";
import { authorizedProjectForRequest, projectStoreForTenant } from "@/lib/projects";
import { identityFromRequest } from "@/lib/identity";
import { getIntegrationStore } from "@/lib/integrations/server";
import { IntegrationRequestError, connectionFor, integrationErrorResponse, providerFor, requestOrigin } from "@/lib/integrations/http";
import { caseForId, caseForRemediation, createTaskForCase } from "@/lib/integrations/tasks";
import { linkEvent, emitProjectEvent } from "@/lib/integrations/events";
import { remediationKey as remediationKeyOf } from "@/lib/issue-case";
import { acceptRemediation } from "@/lib/integrations/accept";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Create and link a task for one case.
 *
 * Addressed by case id or remediation key. The case's remediation is the unit,
 * so a sibling of a shared fix returns the same link rather than a second task.
 *
 * `accept: true` is the combined action: Accept is recorded first, through the
 * ordinary decision log, and the task is created after. It is not a new kind of
 * Accept — a failed provider call leaves the acceptance recorded, exactly as a
 * person would if they had pressed Accept and then found the tool unreachable.
 */
export async function POST(req: Request) {
  try {
    const project = await authorizedProjectForRequest(req, "admin");
    const identity = await identityFromRequest(req);
    const dataStore = await projectStoreForTenant(project.tenant);
    let state = await dataStore.getState();
    const body = (await req.json().catch(() => ({}))) as {
      caseId?: unknown;
      remediationKey?: unknown;
      accept?: unknown;
      destinationId?: unknown;
    };

    const issue = typeof body.caseId === "string"
      ? caseForId(state, body.caseId)
      : typeof body.remediationKey === "string"
        ? caseForRemediation(state, body.remediationKey)
        : undefined;
    if (!issue) throw new IntegrationRequestError("No case matches that id or remediation", 404);
    if (typeof body.remediationKey === "string" && remediationKeyOf(issue) !== body.remediationKey) {
      throw new IntegrationRequestError("That remediation key belongs to a different case");
    }
    const key = remediationKeyOf(issue);

    if (body.accept === true) {
      const accepted = await acceptRemediation({
        remediationKey: key,
        by: { kind: "person", userId: identity.email },
        dataStore,
        state,
      });
      if (accepted) state = accepted;
    }

    const store = getIntegrationStore(project.id);
    const connection = await connectionFor(store);
    const provider = await providerFor(connection);
    const outcome = await createTaskForCase({
      projectId: project.id,
      state,
      store,
      provider,
      connection,
      remediationKey: key,
      createdBy: identity.email,
      appUrl: requestOrigin(req),
      ...(typeof body.destinationId === "string" ? { destinationId: body.destinationId } : {}),
    });

    if (outcome.status === "created") {
      await emitProjectEvent({
        store,
        projectId: project.id,
        event: linkEvent(project.id, outcome.link, new Date().toISOString()),
      });
    }
    return NextResponse.json({ ...outcome, caseId: issue.id, remediationKey: key });
  } catch (error) {
    return integrationErrorResponse(error);
  }
}
