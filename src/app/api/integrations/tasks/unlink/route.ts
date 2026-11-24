import { NextResponse } from "next/server";
import { authorizedProjectForRequest } from "@/lib/projects";
import { getIntegrationStore } from "@/lib/integrations/server";
import { integrationErrorResponse } from "@/lib/integrations/http";
import { unlinkTask } from "@/lib/integrations/tasks";
import { IntegrationRequestError } from "@/lib/integrations/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Unlink one task from its remediation.
 *
 * Unlinking is not dismissing and not deleting: the task keeps its state in the
 * tool it belongs to, and the case keeps its lifecycle. It only stops Page
 * Watch refreshing a task it can no longer speak for, so the same fix can be
 * linked to a different task later.
 */
export async function POST(req: Request) {
  try {
    const project = await authorizedProjectForRequest(req, "admin");
    const body = (await req.json().catch(() => ({}))) as { remediationKey?: unknown; provider?: unknown };
    if (typeof body.remediationKey !== "string" || !body.remediationKey.trim()) {
      throw new IntegrationRequestError("remediationKey is required");
    }
    const store = getIntegrationStore(project.id);
    const links = await store.listLinks();
    const link = typeof body.provider === "string"
      ? links.find((candidate) => candidate.remediationKey === body.remediationKey && candidate.provider === body.provider)
      : links.find((candidate) => candidate.remediationKey === body.remediationKey);
    if (!link) throw new IntegrationRequestError("that case has no linked task", 404);
    await unlinkTask(store, link.provider, link.remediationKey);
    return NextResponse.json({ ok: true, provider: link.provider });
  } catch (error) {
    return integrationErrorResponse(error);
  }
}
