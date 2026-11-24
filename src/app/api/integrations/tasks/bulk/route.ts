import { NextResponse } from "next/server";
import { authorizedProjectForRequest, projectStoreForTenant } from "@/lib/projects";
import { identityFromRequest } from "@/lib/identity";
import { getIntegrationStore } from "@/lib/integrations/server";
import { connectionFor, integrationErrorResponse, providerFor, requestOrigin } from "@/lib/integrations/http";
import { CASE_BATCH_LIMIT, bulkCreateTasks, caseForId } from "@/lib/integrations/tasks";
import { remediationKey as remediationKeyOf } from "@/lib/issue-case";
import { acceptRemediation } from "@/lib/integrations/accept";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Create tasks for a multi-selection, one per remediation.
 *
 * Not all-or-nothing: each case reports its own result, and one provider
 * failure does not roll back the tasks already created — they are the
 * provider's now, and pretending otherwise would leave links pointing at
 * nothing. The cap keeps one synchronous request bounded.
 *
 * `accept: true` is "Accept and create tasks": Accept is recorded for each
 * distinct remediation that is still in Decide and has a plan, before the
 * creates. The creates then see the accepted cases, and a case that is skipped
 * for having no plan was never accepted.
 */
export async function POST(req: Request) {
  try {
    const project = await authorizedProjectForRequest(req, "admin");
    const identity = await identityFromRequest(req);
    const dataStore = await projectStoreForTenant(project.tenant);
    let state = await dataStore.getState();
    const body = (await req.json().catch(() => ({}))) as { caseIds?: unknown; accept?: unknown };
    if (!Array.isArray(body.caseIds) || body.caseIds.some((id) => typeof id !== "string")) {
      return NextResponse.json({ error: "caseIds must be an array of case ids" }, { status: 400 });
    }
    const caseIds = [...new Set(body.caseIds as string[])];
    if (caseIds.length > CASE_BATCH_LIMIT) {
      return NextResponse.json(
        { error: `A batch is capped at ${CASE_BATCH_LIMIT} cases; split the selection.` },
        { status: 400 },
      );
    }

    const accepted: string[] = [];
    if (body.accept === true) {
      const by = { kind: "person" as const, userId: identity.email };
      const seen = new Set<string>();
      for (const caseId of caseIds) {
        const issue = caseForId(state, caseId);
        if (!issue) continue;
        const key = remediationKeyOf(issue);
        if (seen.has(key)) continue;
        seen.add(key);
        if ((issue.state === "new" || issue.state === "reopened") && issue.remediation.steps.length > 0) {
          const next = await acceptRemediation({
            remediationKey: key,
            by,
            dataStore,
            state,
          });
          if (next) {
            state = next;
            accepted.push(key);
          }
        }
      }
    }

    const store = getIntegrationStore(project.id);
    const connection = await connectionFor(store);
    const provider = await providerFor(connection);
    const result = await bulkCreateTasks({
      projectId: project.id,
      state,
      store,
      provider,
      connection,
      caseIds,
      createdBy: identity.email,
      appUrl: requestOrigin(req),
    });
    return NextResponse.json({ ...result, accepted });
  } catch (error) {
    return integrationErrorResponse(error);
  }
}
