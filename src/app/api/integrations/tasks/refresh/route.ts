import { NextResponse } from "next/server";
import { authorizedProjectForRequest } from "@/lib/projects";
import { getIntegrationStore } from "@/lib/integrations/server";
import { connectionFor, integrationErrorResponse, providerFor } from "@/lib/integrations/http";
import { refreshTaskLink, recordTaskNote } from "@/lib/integrations/tasks";
import { emitProjectEvent, taskEndingEvent } from "@/lib/integrations/events";
import { IntegrationRequestError } from "@/lib/integrations/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Read one linked task now.
 *
 * The only status sync in v1, and it is outbound: Page Watch asks the task tool
 * what happened. A completed task adds a note and reports `offerMarkFixed`; a
 * canceled one reports `offerDismiss`. Neither changes the case — the reader
 * presses Mark fixed or Dismiss if they agree, and the checkpoints still decide
 * Resolved.
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

    const connection = await connectionFor(store, link.provider);
    const provider = await providerFor(connection);
    const refreshed = await refreshTaskLink({ store, provider, link });
    const settings = await store.getSettings();
    const automated = settings.automations.taskCompletionOffersMarkFixed;
    let noted = false;
    if (automated && refreshed.note && (refreshed.completed || refreshed.canceled)) {
      noted = await recordTaskNote({
        store,
        link: refreshed.link,
        kind: refreshed.completed ? "completed" : "canceled",
        text: refreshed.note,
      });
      await emitProjectEvent({
        store,
        projectId: project.id,
        event: taskEndingEvent(project.id, refreshed.link, new Date().toISOString(), refreshed.completed ? "completed" : "canceled"),
      });
    }
    return NextResponse.json({
      link: refreshed.link,
      completed: refreshed.completed,
      canceled: refreshed.canceled,
      ...(refreshed.note ? { note: refreshed.note } : {}),
      noted,
      offerMarkFixed: automated && refreshed.completed,
      offerDismiss: automated && refreshed.canceled,
    });
  } catch (error) {
    return integrationErrorResponse(error);
  }
}
