import { NextResponse } from "next/server";
import { authorizedProjectForRequest } from "@/lib/projects";
import { identityFromRequest } from "@/lib/identity";
import { getIntegrationStore } from "@/lib/integrations/server";
import { integrationErrorResponse } from "@/lib/integrations/http";
import { issueApiToken } from "@/lib/integrations/api-token";
import { publicSettings } from "@/lib/integrations/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Issue or revoke the project-scoped API token for external automation.
 *
 * The token is returned once, in this response, and never again: only its hash
 * is stored. POST issues (rotating any previous token), DELETE revokes.
 */
export async function POST(req: Request) {
  try {
    const project = await authorizedProjectForRequest(req, "admin");
    const identity = await identityFromRequest(req);
    const store = getIntegrationStore(project.id);
    const current = await store.getSettings();
    const issued = issueApiToken();
    const at = new Date().toISOString();
    const settings = await store.saveSettings({
      ...current,
      apiTokenHash: issued.hash,
      apiTokenPrefix: issued.prefix,
      apiTokenIssuedAt: at,
      apiTokenIssuedBy: identity.email,
      updatedAt: at,
    });
    return NextResponse.json({ token: issued.token, prefix: issued.prefix, settings: publicSettings(settings) });
  } catch (error) {
    return integrationErrorResponse(error);
  }
}

export async function DELETE(req: Request) {
  try {
    const project = await authorizedProjectForRequest(req, "admin");
    const store = getIntegrationStore(project.id);
    const current = await store.getSettings();
    const settings = await store.saveSettings({
      ...current,
      apiTokenHash: undefined,
      apiTokenPrefix: undefined,
      apiTokenIssuedAt: undefined,
      apiTokenIssuedBy: undefined,
      updatedAt: new Date().toISOString(),
    });
    return NextResponse.json({ settings: publicSettings(settings) });
  } catch (error) {
    return integrationErrorResponse(error);
  }
}
