const ACCESS_ASSERTION_HEADER = "cf-access-jwt-assertion";
const ACCESS_COOKIE = "CF_Authorization";
const HEALTH_PATH = "/__gateway/health";

type GatewayEnv = Pick<Env, "ORIGIN_URL">;
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

export async function handleGatewayRequest(
  request: Request,
  env: GatewayEnv,
  fetcher: GatewayFetch = fetch,
): Promise<Response> {
  const requestId = request.headers.get("cf-ray");
  const assertion = request.headers.get(ACCESS_ASSERTION_HEADER);
  if (!assertion) return gatewayResponse("Cloudflare Access authentication is required", 401, requestId);

  const origin = configuredOrigin(env.ORIGIN_URL);
  if (!origin) return gatewayResponse("Authentication gateway is not configured", 503, requestId);

  const publicUrl = new URL(request.url);
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
