import { NextResponse } from "next/server";
import { authorizedProjectForRequest } from "@/lib/projects";
import { getIntegrationStore } from "@/lib/integrations/server";
import { integrationErrorResponse } from "@/lib/integrations/http";
import { isTaskProviderKind } from "@/lib/integrations/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Disconnect a task tool.
 *
 * The stored token goes with the connection, and the links go with it: a link
 * is a pointer this app can no longer read, and keeping it would show a task
 * whose state the app cannot refresh as though it were current. The tasks
 * themselves are untouched — they belong to the team, and unlinking is not
 * deleting work.
 */
export async function POST(req: Request, { params }: { params: Promise<{ provider: string }> }) {
  const { provider } = await params;
  if (!isTaskProviderKind(provider)) return NextResponse.json({ error: "Unknown task tool" }, { status: 404 });
  try {
    const project = await authorizedProjectForRequest(req, "admin");
    const store = getIntegrationStore(project.id);
    const links = await store.listLinks();
    for (const link of links.filter((candidate) => candidate.provider === provider)) {
      await store.deleteLink(link.provider, link.remediationKey);
    }
    await store.deleteConnection(provider);
    return NextResponse.json({ ok: true, provider });
  } catch (error) {
    return integrationErrorResponse(error);
  }
}
