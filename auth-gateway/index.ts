import { AuthenticationError, verifyAccessJwt } from "../src/lib/accessJwt";
import { createAuthHandoff, validLoginState } from "../src/lib/authHandoff";

const ACCESS_ASSERTION_HEADER = "cf-access-jwt-assertion";
const ACCESS_COOKIE = "CF_Authorization";
const HEALTH_PATH = "/__gateway/health";
const BROKER_PATH = "/__auth/broker";

export interface GatewayEnv {
  ORIGIN_URL: string;
  AUTH_CALLBACK_URL: string;
  AUTH_HANDOFF_SECRET: string;
  CF_ACCESS_TEAM_DOMAIN: string;
  CF_ACCESS_AUD: string;
}
type GatewayFetch = (request: Request) => Promise<Response>;

function configuredOrigin(value: string): URL | null {
  try {
    const origin = new URL(value);
    if (origin.protocol !== "https:" || origin.username || origin.password
      || origin.pathname !== "/" || origin.search || origin.hash) return null;
    return origin;
  } catch {
    return null;
  }
}

function withoutAccessCookie(value: string | null): string | null {
  if (!value) return null;
  const retained = value.split(";")
    .map((part) => part.trim())
    .filter((part) => {
      const separator = part.indexOf("=");
      const name = separator === -1 ? part : part.slice(0, separator);
      return part && name.toLowerCase() !== ACCESS_COOKIE.toLowerCase();
    });
  return retained.length ? retained.join("; ") : null;
}

function proxyHeaders(request: Request): Headers {
  const headers = new Headers(request.headers);
  const publicUrl = new URL(request.url);
  const cookies = withoutAccessCookie(headers.get("cookie"));

  if (cookies) headers.set("cookie", cookies);
  else headers.delete("cookie");

  headers.delete("host");
  headers.delete("x-forwarded-host");
  headers.delete("x-forwarded-proto");
  headers.set("x-forwarded-host", publicUrl.host);
  headers.set("x-forwarded-proto", publicUrl.protocol.slice(0, -1));
  headers.set("x-page-watch-auth-gateway", "cloudflare-access");
  return headers;
}

function rewriteLocation(headers: Headers, origin: URL, publicUrl: URL): void {
  const location = headers.get("location");
  if (!location) return;
  try {
    const resolved = new URL(location, origin);
    if (resolved.origin !== origin.origin) return;
    resolved.protocol = publicUrl.protocol;
    resolved.host = publicUrl.host;
    headers.set("location", resolved.toString());
  } catch {
    // Preserve malformed or non-URL Location values exactly as the origin sent them.
  }
}

function gatewayResponse(message: string, status: number, requestId: string | null): Response {
  return Response.json(
    { error: message, ...(requestId ? { requestId } : {}) },
    { status, headers: { "cache-control": "no-store" } },
  );
}

function configuredHttpsUrl(value: string): URL | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.hash) return null;
    return url;
  } catch {
    return null;
  }
}

async function brokerResponse(
  publicUrl: URL,
  assertion: string,
  env: GatewayEnv,
  fetcher: GatewayFetch,
  requestId: string | null,
): Promise<Response> {
  const state = publicUrl.searchParams.get("state") ?? "";
  if (!validLoginState(state)) return gatewayResponse("The login request is invalid or expired", 400, requestId);
  const callback = configuredHttpsUrl(env.AUTH_CALLBACK_URL);
  const teamDomain = configuredHttpsUrl(env.CF_ACCESS_TEAM_DOMAIN);
  const audiences = env.CF_ACCESS_AUD.split(",").map((value) => value.trim()).filter(Boolean);
  if (!callback || callback.pathname !== "/api/auth/callback" || callback.search || audiences.length === 0
    || !teamDomain || teamDomain.pathname !== "/" || teamDomain.search) {
    return gatewayResponse("Authentication gateway is not configured", 503, requestId);
  }

  try {
    const identity = await verifyAccessJwt(assertion, {
      teamDomain: teamDomain.origin,
      audiences,
      fetcher: (input, init) => fetcher(new Request(input, init)),
    });
    const token = await createAuthHandoff({
      audience: callback.origin,
      email: identity.email,
      state,
      ...(identity.subject ? { subject: identity.subject } : {}),
    }, env.AUTH_HANDOFF_SECRET);
    callback.searchParams.set("token", token);
    return new Response(null, {
      status: 303,
      headers: {
        location: callback.toString(),
        "cache-control": "no-store",
        pragma: "no-cache",
      },
    });
  } catch (error) {
    const status = error instanceof AuthenticationError ? error.status : 503;
    console.error(JSON.stringify({
      message: "Page Watch identity handoff failed",
      error: error instanceof Error ? error.message : "Unknown error",
      requestId,
    }));
    return gatewayResponse(
      status === 503 ? "Authentication is temporarily unavailable" : "Cloudflare Access authentication is invalid",
      status,
      requestId,
    );
  }
}

export async function handleGatewayRequest(
  request: Request,
  env: GatewayEnv,
  fetcher: GatewayFetch = fetch,
): Promise<Response> {
  const requestId = request.headers.get("cf-ray");
  const assertion = request.headers.get(ACCESS_ASSERTION_HEADER);
  if (!assertion) return gatewayResponse("Cloudflare Access authentication is required", 401, requestId);

  const publicUrl = new URL(request.url);
  if (publicUrl.pathname === BROKER_PATH && request.method === "GET") {
    return brokerResponse(publicUrl, assertion, env, fetcher, requestId);
  }

  const origin = configuredOrigin(env.ORIGIN_URL);
  if (!origin) return gatewayResponse("Authentication gateway is not configured", 503, requestId);

  if (publicUrl.pathname === HEALTH_PATH) {
    return Response.json(
      { ok: true, authenticated: true, origin: origin.host },
      { headers: { "cache-control": "no-store" } },
    );
  }

  const originUrl = new URL(`${publicUrl.pathname}${publicUrl.search}`, origin);
  const hasBody = request.method !== "GET" && request.method !== "HEAD";
  const originRequest = new Request(originUrl, {
    method: request.method,
    headers: proxyHeaders(request),
    body: hasBody ? request.body : null,
    redirect: "manual",
  });

  try {
    const originResponse = await fetcher(originRequest);
    const responseHeaders = new Headers(originResponse.headers);
    rewriteLocation(responseHeaders, origin, publicUrl);
    responseHeaders.set("x-page-watch-auth-gateway", "cloudflare-access");
    return new Response(originResponse.body, {
      status: originResponse.status,
      statusText: originResponse.statusText,
      headers: responseHeaders,
    });
  } catch (error) {
    console.error(JSON.stringify({
      message: "Page Watch origin request failed",
      error: error instanceof Error ? error.message : "Unknown error",
      method: request.method,
      path: publicUrl.pathname,
      requestId,
    }));
    return gatewayResponse("Page Watch is temporarily unavailable", 502, requestId);
  }
}

export default {
  fetch(request: Request, env: Env): Promise<Response> {
    return handleGatewayRequest(request, env);
  },
} satisfies ExportedHandler<Env>;
