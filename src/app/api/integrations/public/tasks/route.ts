import { NextResponse } from "next/server";
import { projectForRequest } from "@/lib/projects";
import { getIntegrationStore } from "@/lib/integrations/server";
import { tokenAuthorizesProject } from "@/lib/integrations/api-token";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The read half of the project-scoped API token.
 *
 * For an external automation (Zapier, Make, n8n) that needs to reconcile its
 * own records with what Page Watch has linked. It is read-only on purpose: a
 * leaked automation token can read task links, and cannot create, close or
 * comment. Every write stays behind a project-admin session.
 */
export async function GET(req: Request) {
  try {
    const project = await projectForRequest(req);
    const store = getIntegrationStore(project.id);
    if (!(await tokenAuthorizesProject(req, store))) {
      return NextResponse.json({ error: "A valid project API token is required" }, { status: 401 });
    }
    const links = await store.listLinks();
    return NextResponse.json({
      projectId: project.id,
      links: links.map((link) => ({
        remediationKey: link.remediationKey,
        provider: link.provider,
        externalId: link.externalId,
        externalUrl: link.externalUrl,
        externalState: link.externalState,
        assignee: link.assignee,
        lastSyncedAt: link.lastSyncedAt,
      })),
    });
  } catch (error) {
    return NextResponse.json({ error: String(error).slice(0, 300) }, { status: 404 });
  }
}
