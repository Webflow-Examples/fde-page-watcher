import { NextResponse } from "next/server";
import { authorizedProjectForRequest } from "@/lib/projects";
import { getIntegrationStore } from "@/lib/integrations/server";
import { connectionFor, integrationErrorResponse, providerFor } from "@/lib/integrations/http";
import { isTaskProviderKind, publicConnection } from "@/lib/integrations/types";
import { IntegrationRequestError } from "@/lib/integrations/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Choose the one default destination a project creates tasks in (v1).
 *
 * One per project, not one per case: a case that names no destination uses the
 * default, and there is no rule engine to decide otherwise. The provider is
 * asked for its own list first, so a destination id that no longer exists
 * cannot be stored.
 */
export async function POST(req: Request, { params }: { params: Promise<{ provider: string }> }) {
  const { provider } = await params;
  if (!isTaskProviderKind(provider)) return NextResponse.json({ error: "Unknown task tool" }, { status: 404 });
  try {
    const project = await authorizedProjectForRequest(req, "admin");
    const body = (await req.json().catch(() => ({}))) as { destinationId?: unknown };
    if (typeof body.destinationId !== "string" || !body.destinationId.trim()) {
      throw new IntegrationRequestError("destinationId is required");
    }
    const store = getIntegrationStore(project.id);
    const connection = await connectionFor(store, provider);
    const taskProvider = await providerFor(connection);
    const destination = (await taskProvider.listDestinations()).find((candidate) => candidate.id === body.destinationId);
    if (!destination) throw new IntegrationRequestError("that destination is not available to this connection", 404);
    const saved = await store.saveConnection({
      ...connection,
      workspaceId: destination.workspaceId,
      workspaceName: destination.workspaceName,
      defaultDestinationId: destination.id,
      defaultDestinationName: destination.name,
      status: "connected",
      lastError: undefined,
    });
    return NextResponse.json({ connection: publicConnection(saved) });
  } catch (error) {
    return integrationErrorResponse(error);
  }
}
