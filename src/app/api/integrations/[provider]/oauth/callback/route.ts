import { NextResponse } from "next/server";
import { requireProjectAccess } from "@/lib/authorization";
import { getIntegrationStore } from "@/lib/integrations/server";
import { ASANA_OAUTH_TOKEN, createAsanaProvider } from "@/lib/integrations/asana";
import { LINEAR_OAUTH_TOKEN, createLinearProvider } from "@/lib/integrations/linear";
import {
  OAUTH_STATE_COOKIE,
  exchangeOAuthCode,
  verifyOAuthState,
} from "@/lib/integrations/oauth";
import { connectionAad, sealSecret } from "@/lib/integrations/crypto";
import { newConnectionId, oauthClient, integrationSecret } from "@/lib/integrations/server";
import { isTaskProviderKind, type TaskProviderKind } from "@/lib/integrations/types";
import type { Destination } from "@/lib/integrations/provider";
import { integrationErrorResponse } from "@/lib/integrations/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function cookieValue(headers: Headers, name: string): string | undefined {
  const entry = headers.get("cookie")?.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${name}=`));
  if (!entry) return undefined;
  try {
    return decodeURIComponent(entry.slice(name.length + 1));
  } catch {
    return undefined;
  }
}

/** Where the browser lands after a connection attempt: Settings, at the card. */
function settingsUrl(req: Request, query: Record<string, string>): string {
  const url = new URL(req.url);
  url.search = "";
  url.hash = "";
  url.pathname = url.pathname.replace(/\/api\/integrations\/[^/]+\/oauth\/callback\/?$/, "/settings");
  if (!url.pathname.endsWith("/settings")) url.pathname = "/settings";
  for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
  url.hash = "settings-systems";
  return url.toString();
}

/**
 * Finish an OAuth connection.
 *
 * The state is verified against its signature, its expiry, its provider and the
 * HttpOnly cookie set by the start route. Only then is the code exchanged. The
 * access is re-checked for the project named in the state — the callback URL
 * carries no `?project=`, and trusting the state's project without a fresh
 * permission check would let a demoted admin finish a connection they may no
 * longer change.
 */
export async function GET(req: Request, { params }: { params: Promise<{ provider: string }> }) {
  const { provider } = await params;
  if (!isTaskProviderKind(provider)) {
    return NextResponse.json({ error: "Unknown task tool" }, { status: 404 });
  }
  const url = new URL(req.url);
  const state = url.searchParams.get("state");
  const code = url.searchParams.get("code");
  const providerError = url.searchParams.get("error");

  let secret: string;
  try {
    secret = integrationSecret();
  } catch (error) {
    return integrationErrorResponse(error);
  }

  const verified = verifyOAuthState({
    state,
    cookie: cookieValue(req.headers, OAUTH_STATE_COOKIE),
    secret,
    provider,
  });
  if (!verified.ok) {
    return NextResponse.redirect(settingsUrl(req, { "task-tool": "error", message: `OAuth state ${verified.reason}` }), { status: 302 });
  }

  let access;
  try {
    access = await requireProjectAccess(req, verified.payload.projectId, "admin");
  } catch (error) {
    return integrationErrorResponse(error);
  }
  if (providerError) {
    return NextResponse.redirect(settingsUrl(req, { "task-tool": "error", message: providerError.slice(0, 120) }), { status: 302 });
  }
  if (!code) {
    return NextResponse.redirect(settingsUrl(req, { "task-tool": "error", message: "missing code" }), { status: 302 });
  }

  const projectId = verified.payload.projectId;
  try {
    const client = oauthClient(provider);
    const token = await exchangeOAuthCode({
      provider,
      tokenUrl: provider === "asana" ? ASANA_OAUTH_TOKEN : LINEAR_OAUTH_TOKEN,
      code,
      redirectUri: `${url.origin}${url.pathname}`,
      clientId: client.clientId,
      clientSecret: client.clientSecret,
    });

    let destinations: Destination[] = [];
    let lastError: string | undefined;
    const taskProvider = provider === "asana"
      ? createAsanaProvider({ token: token.accessToken })
      : createLinearProvider({ token: token.accessToken });
    try {
      destinations = await taskProvider.listDestinations();
    } catch (error) {
      // A token with no projects is still a connection; keep it and say what
      // happened rather than discarding a credential the person granted.
      lastError = `Connected, but destinations could not be listed: ${String(error).slice(0, 200)}`;
    }

    const store = getIntegrationStore(projectId);
    const existing = await store.getConnection(provider);
    const first = destinations[0];
    const sealed = sealSecret(token.accessToken, secret, connectionAad(projectId, provider));
    const keepDefault = existing?.defaultDestinationId
      ? destinations.find((destination) => destination.id === existing.defaultDestinationId)
      : undefined;
    const destination = keepDefault ?? first;
    await store.saveConnection({
      id: existing?.id ?? newConnectionId(),
      projectId,
      provider: provider as TaskProviderKind,
      workspaceId: destination?.workspaceId ?? token.workspaceId ?? existing?.workspaceId,
      workspaceName: destination?.workspaceName ?? token.workspaceName ?? existing?.workspaceName,
      ...(destination ? { defaultDestinationId: destination.id, defaultDestinationName: destination.name } : existing?.defaultDestinationId
        ? { defaultDestinationId: existing.defaultDestinationId, defaultDestinationName: existing.defaultDestinationName }
        : {}),
      encryptedToken: sealed.ciphertext,
      tokenNonce: sealed.nonce,
      scopes: token.scopes.length > 0 ? token.scopes : existing?.scopes ?? [],
      installedBy: access.email,
      installedAt: new Date().toISOString(),
      status: lastError ? "error" : "connected",
      ...(lastError ? { lastError } : {}),
    });
    const response = NextResponse.redirect(settingsUrl(req, { "task-tool": "connected" }), { status: 302 });
    response.headers.append("Set-Cookie", `${OAUTH_STATE_COOKIE}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0`);
    return response;
  } catch (error) {
    return NextResponse.redirect(
      settingsUrl(req, { "task-tool": "error", message: String(error).slice(0, 160) }),
      { status: 302 },
    );
  }
}
