import { relayAgentAuditResponse, requestAgentAuditVerify } from "@/lib/agentAuditServer";
import { authorizedProjectForRequest } from "@/lib/projects";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Re-run the provider checks recorded on one implemented agent task.
 *
 * Only the task key travels. The collector resolves which checks to run from
 * stored state, so an arbitrary check set can never be submitted.
 */
export async function POST(request: Request): Promise<Response> {
  const body = (await request.json().catch(() => ({}))) as { recKey?: unknown };
  if (typeof body.recKey !== "string" || !body.recKey) {
    return Response.json({ error: "recKey is required" }, { status: 400 });
  }
  try {
    const project = await authorizedProjectForRequest(request, "admin");
    return relayAgentAuditResponse(await requestAgentAuditVerify(project.tenant, body.recKey));
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Verification is unavailable" },
      { status: 503 },
    );
  }
}
