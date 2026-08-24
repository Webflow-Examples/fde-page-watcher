import { relayAgentAuditResponse, requestAgentAuditRefresh } from "@/lib/agentAuditServer";
import { authorizedProjectForRequest } from "@/lib/projects";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Trigger one external audit refresh. The collector re-validates the target
 * against the project's watched pages and checks the project's consent record,
 * so this route only carries intent.
 */
export async function POST(request: Request): Promise<Response> {
  const body = (await request.json().catch(() => ({}))) as {
    pageId?: unknown;
    origin?: unknown;
    force?: unknown;
  };
  if (
    (body.pageId !== undefined && typeof body.pageId !== "string")
    || (body.origin !== undefined && typeof body.origin !== "string")
    || (body.force !== undefined && typeof body.force !== "boolean")
  ) {
    return Response.json({ error: "invalid refresh request" }, { status: 400 });
  }
  try {
    const project = await authorizedProjectForRequest(request, "admin");
    return relayAgentAuditResponse(await requestAgentAuditRefresh(project.tenant, {
      ...(typeof body.pageId === "string" ? { pageId: body.pageId } : {}),
      ...(typeof body.origin === "string" ? { origin: body.origin } : {}),
      ...(body.force === true ? { force: true } : {}),
    }));
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "External agent audit refresh is unavailable" },
      { status: 503 },
    );
  }
}
