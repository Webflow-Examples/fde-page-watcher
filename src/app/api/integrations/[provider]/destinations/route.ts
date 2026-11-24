import { NextResponse } from "next/server";
import { authorizedProjectForRequest } from "@/lib/projects";
import { getIntegrationStore } from "@/lib/integrations/server";
import { connectionFor, integrationErrorResponse, providerFor } from "@/lib/integrations/http";
import { isTaskProviderKind, publicConnection } from "@/lib/integrations/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The places a task can go, and the people it can be assigned to.
 *
 * Admin only, because the same call is what the Settings card uses to choose a
 * default destination; a viewer has no control to choose with.
 */
export async function GET(req: Request, { params }: { params: Promise<{ provider: string }> }) {
  const { provider } = await params;
  if (!isTaskProviderKind(provider)) return NextResponse.json({ error: "Unknown task tool" }, { status: 404 });
  try {
    const project = await authorizedProjectForRequest(req, "admin");
    const store = getIntegrationStore(project.id);
    const connection = await connectionFor(store, provider);
    const taskProvider = await providerFor(connection);
    const [destinations, users] = await Promise.all([
      taskProvider.listDestinations(),
      taskProvider.listUsers().catch(() => []),
    ]);
    return NextResponse.json({
      connection: publicConnection(connection),
      destinations,
      users: users.map((user) => ({ id: user.id, name: user.name, ...(user.email ? { email: user.email } : {}) })),
    });
  } catch (error) {
    return integrationErrorResponse(error);
  }
}
