import { NextResponse } from "next/server";
import { authorizedProjectForRequest } from "@/lib/projects";
import { getIntegrationStore } from "@/lib/integrations/server";
import { integrationErrorResponse } from "@/lib/integrations/http";
import { publicConnection, publicSettings } from "@/lib/integrations/types";
import { getEnv } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * What the browser may know about a project's task-tool integrations.
 *
 * Viewer access on purpose: a project viewer can see that a case is linked and
 * where, but every write route requires project admin. No token, no webhook
 * secret and no API-token hash is in this payload — only the public shapes.
 *
 * The `notes` are what a completed or canceled task contributed to the case,
 * read from the same idempotency rows that stopped the note being written twice.
 */
export async function GET(req: Request) {
  try {
    const project = await authorizedProjectForRequest(req, "viewer");
    const store = getIntegrationStore(project.id);
    const [connections, links, settings, events] = await Promise.all([
      store.listConnections(),
      store.listLinks(),
      store.getSettings(),
      store.listEvents(200),
    ]);
    const notes = events
      .filter((event) => event.type === "task.note")
      .map((event) => ({
        at: event.receivedAt,
        text: event.result ?? "",
        linkId: event.eventId.split(":")[1] ?? "",
        provider: event.provider,
        kind: event.eventId.split(":")[2] === "canceled" ? "canceled" : "completed",
      }));
    return NextResponse.json({
      connections: connections.map(publicConnection),
      links,
      settings: publicSettings(settings),
      notes,
      oauthConfigured: {
        asana: Boolean(getEnv("ASANA_CLIENT_ID") && getEnv("ASANA_CLIENT_SECRET")),
        linear: Boolean(getEnv("LINEAR_CLIENT_ID") && getEnv("LINEAR_CLIENT_SECRET")),
      },
      credentialReady: Boolean(getEnv("INTEGRATION_TOKEN_KEY")),
    });
  } catch (error) {
    return integrationErrorResponse(error);
  }
}
