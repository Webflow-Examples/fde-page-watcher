import { describe, expect, it, vi } from "vitest";
import { handleGatewayRequest } from "../index";
import { verifyAuthHandoff } from "../../src/lib/authHandoff";

const HANDOFF_SECRET = "test-handoff-secret-that-is-longer-than-thirty-two-characters";
const env = {
  ORIGIN_URL: "https://page-watcher.webflow.io",
  AUTH_CALLBACK_URL: "https://page-watcher.webflow.io/api/auth/callback",
  AUTH_HANDOFF_SECRET: HANDOFF_SECRET,
  CF_ACCESS_TEAM_DOMAIN: "https://example.cloudflareaccess.com",
  CF_ACCESS_AUD: "page-watch-aud",
};

function base64url(value: string | Uint8Array): string {
  return Buffer.from(value).toString("base64url");
}

async function signedAccessToken() {
  const keys = await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["sign", "verify"],
  );
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: "RS256", kid: "test-key" }));
  const payload = base64url(JSON.stringify({
    iss: env.CF_ACCESS_TEAM_DOMAIN,
    aud: [env.CF_ACCESS_AUD],
    email: "Customer@Example.com",
    sub: "user-123",
    type: "app",
    exp: now + 600,
    nbf: now - 60,
  }));
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", keys.privateKey, new TextEncoder().encode(`${header}.${payload}`));
  const jwk = await crypto.subtle.exportKey("jwk", keys.publicKey) as JsonWebKey & { kid?: string };
  jwk.kid = "test-key";
  return { token: `${header}.${payload}.${base64url(new Uint8Array(signature))}`, jwk };
}

describe("authentication gateway", () => {
  it("fails closed when Cloudflare Access did not provide an assertion", async () => {
    const fetcher = vi.fn();
    const response = await handleGatewayRequest(new Request("https://gateway.example.com/dashboard"), env, fetcher);

    expect(response.status).toBe(401);
    expect(fetcher).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({ error: "Cloudflare Access authentication is required" });
  });

  it("streams authenticated requests to the fixed Webflow origin", async () => {
    const fetcher = vi.fn(async (request: Request) => {
      expect(request.url).toBe("https://page-watcher.webflow.io/dashboard?range=7d");
      expect(request.headers.get("cf-access-jwt-assertion")).toBe("signed.assertion.value");
      expect(request.headers.get("cookie")).toBe("theme=dark; project=brand-studio");
      expect(request.headers.get("x-forwarded-host")).toBe("gateway.example.com");
      expect(request.headers.get("x-forwarded-proto")).toBe("https");
      return new Response("redirecting", {
        status: 307,
        headers: { location: "https://page-watcher.webflow.io/pages" },
      });
    });
    const request = new Request("https://gateway.example.com/dashboard?range=7d", {
      headers: {
        "cf-access-jwt-assertion": "signed.assertion.value",
        cookie: "theme=dark; CF_Authorization=browser-secret; project=brand-studio",
      },
    });

    const response = await handleGatewayRequest(request, env, fetcher);

    expect(fetcher).toHaveBeenCalledOnce();
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("https://gateway.example.com/pages");
    expect(response.headers.get("x-page-watch-auth-gateway")).toBe("cloudflare-access");
  });

  it("returns an authenticated health response without contacting the origin", async () => {
    const fetcher = vi.fn();
    const response = await handleGatewayRequest(new Request("https://gateway.example.com/__gateway/health", {
      headers: { "cf-access-jwt-assertion": "signed.assertion.value" },
    }), env, fetcher);

    expect(response.status).toBe(200);
    expect(fetcher).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({
      ok: true,
      authenticated: true,
      origin: "page-watcher.webflow.io",
    });
  });

  it("validates Access and returns a short-lived, state-bound handoff to the fixed origin", async () => {
    const state = "a".repeat(43);
    const { token: accessToken, jwk } = await signedAccessToken();
    const fetcher = vi.fn(async (request: Request) => {
      expect(request.url).toBe(`${env.CF_ACCESS_TEAM_DOMAIN}/cdn-cgi/access/certs`);
      return Response.json({ keys: [jwk] });
    });
    const response = await handleGatewayRequest(new Request(`https://gateway.example.com/__auth/broker?state=${state}`, {
      headers: { "cf-access-jwt-assertion": accessToken },
    }), env, fetcher);

    expect(response.status).toBe(303);
    const location = new URL(response.headers.get("location") ?? "");
    expect(location.origin + location.pathname).toBe(env.AUTH_CALLBACK_URL);
    const handoff = await verifyAuthHandoff(location.searchParams.get("token") ?? "", {
      secret: HANDOFF_SECRET,
      audience: "https://page-watcher.webflow.io",
      state,
    });
    expect(handoff).toMatchObject({ email: "customer@example.com", sub: "user-123", state });
  });

  it("rejects invalid broker state before issuing a handoff", async () => {
    const response = await handleGatewayRequest(new Request("https://gateway.example.com/__auth/broker?state=short", {
      headers: { "cf-access-jwt-assertion": "signed.assertion.value" },
    }), env, vi.fn());

    expect(response.status).toBe(400);
  });

  it("rejects an unsafe origin configuration", async () => {
    const fetcher = vi.fn();
    const response = await handleGatewayRequest(new Request("https://gateway.example.com/dashboard", {
      headers: { "cf-access-jwt-assertion": "signed.assertion.value" },
    }), { ...env, ORIGIN_URL: "http://page-watcher.webflow.io/path" }, fetcher);

    expect(response.status).toBe(503);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("returns a controlled response when the origin cannot be reached", async () => {
    const response = await handleGatewayRequest(new Request("https://gateway.example.com/dashboard", {
      headers: { "cf-access-jwt-assertion": "signed.assertion.value", "cf-ray": "test-ray" },
    }), env, async () => {
      throw new Error("connection refused");
    });

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({
      error: "Page Watch is temporarily unavailable",
      requestId: "test-ray",
    });
  });
});
