import { NextResponse } from "next/server";
import { authorizedProjectForRequest } from "@/lib/projects";
import { ASANA_OAUTH_AUTHORIZE, ASANA_SCOPES } from "@/lib/integrations/asana";
import { LINEAR_OAUTH_AUTHORIZE, LINEAR_SCOPES } from "@/lib/integrations/linear";
import { OAUTH_STATE_COOKIE, createOAuthState } from "@/lib/integrations/oauth";
import { isTaskProviderKind } from "@/lib/integrations/types";
import {
  IntegrationRequestError,
  callbackUrl,
  integrationErrorResponse,
} from "@/lib/integrations/http";
import { oauthClient, integrationSecret } from "@/lib/integrations/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Node's env is read inside the handler, never at module load. */
function stateCookie(value: string, maxAge: number): string {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${OAUTH_STATE_COOKIE}=${encodeURIComponent(value)}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}

/**
 * Begin an OAuth connection.
 *
 * Project admins only, because connecting a task tool is a write to the
 * project's configuration. The state is random, signed and short-lived, and the
 * same value is stored in an HttpOnly cookie for the callback to compare.
 */
export async function GET(req: Request, { params }: { params: Promise<{ provider: string }> }) {
  const { provider } = await params;
  if (!isTaskProviderKind(provider)) {
    return NextResponse.json({ error: "Unknown task tool" }, { status: 404 });
  }
  try {
    // A viewer is told to ask an admin; this is the same gate as every other
    // project mutation.
    const project = await authorizedProjectForRequest(req, "admin");
    let clientId: string;
    try {
      clientId = oauthClient(provider).clientId;
    } catch (error) {
      throw new IntegrationRequestError(String(error instanceof Error ? error.message : error), 503);
    }
    const state = createOAuthState({
      projectId: project.id,
      provider,
      secret: integrationSecret(),
    });
    const authorizeUrl = provider === "asana" ? ASANA_OAUTH_AUTHORIZE : LINEAR_OAUTH_AUTHORIZE;
    const url = new URL(authorizeUrl);
    url.searchParams.set("client_id", clientId);
    url.searchParams.set("redirect_uri", callbackUrl(req, provider));
    url.searchParams.set("response_type", "code");
    url.searchParams.set("state", state);
    url.searchParams.set("scope", provider === "asana" ? ASANA_SCOPES.join(",") : LINEAR_SCOPES.join(" "));
    const response = NextResponse.redirect(url.toString(), { status: 302 });
    response.headers.append("Set-Cookie", stateCookie(state, 600));
    return response;
  } catch (error) {
    return integrationErrorResponse(error);
  }
}
