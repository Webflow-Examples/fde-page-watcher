import { describe, expect, it, vi } from "vitest";
import { handleGatewayRequest } from "../index";

const env = { ORIGIN_URL: "https://page-watcher.webflow.io" };

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

  it("rejects an unsafe origin configuration", async () => {
    const fetcher = vi.fn();
    const response = await handleGatewayRequest(new Request("https://gateway.example.com/dashboard", {
      headers: { "cf-access-jwt-assertion": "signed.assertion.value" },
    }), { ORIGIN_URL: "http://page-watcher.webflow.io/path" }, fetcher);

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
