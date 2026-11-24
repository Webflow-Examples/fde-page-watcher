import { NextResponse } from "next/server";
import { authorizedProjectForRequest } from "@/lib/projects";
import { getIntegrationStore } from "@/lib/integrations/server";
import { integrationErrorResponse } from "@/lib/integrations/http";
import { automationPatch, updateAutomations } from "@/lib/integrations/settings";
import { publicSettings } from "@/lib/integrations/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Read the four named automations (admin — this card is a control, not a view). */
export async function GET(req: Request) {
  try {
    const project = await authorizedProjectForRequest(req, "admin");
    const settings = await getIntegrationStore(project.id).getSettings();
    return NextResponse.json({ settings: publicSettings(settings) });
  } catch (error) {
    return integrationErrorResponse(error);
  }
}

/**
 * Flip one or more named automations.
 *
 * Four switches, not a rules engine: the body names a known boolean and
 * nothing else. An unknown key is a 400 rather than a stored setting nobody can
 * find, and a string is a 400 rather than truthy.
 */
export async function POST(req: Request) {
  try {
    const project = await authorizedProjectForRequest(req, "admin");
    const body = (await req.json().catch(() => ({}))) as { automations?: unknown };
    const patch = automationPatch(body.automations);
    const settings = await updateAutomations(getIntegrationStore(project.id), patch);
    return NextResponse.json({ settings: publicSettings(settings) });
  } catch (error) {
    return integrationErrorResponse(error);
  }
}
