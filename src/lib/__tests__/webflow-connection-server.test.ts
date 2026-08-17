import { afterEach, describe, expect, it, vi } from "vitest";
import { relayWebflowCollector, requestWebflowCollector } from "../webflowConnectionServer";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("Webflow collector proxy", () => {
  it("keeps collector authentication server-side and requires an explicit tenant scope", async () => {
    vi.stubEnv("FDE_DATA_URL", "https://collector.example.test/");
    vi.stubEnv("CRON_SECRET", "internal-only-secret");
    vi.stubEnv("DATASET_MODE", "live");
    const fetchFn = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      expect(String(input)).toBe(
        "https://collector.example.test/data/brand-studio%3Alive/webflow/connection",
      );
      const headers = new Headers(init?.headers);
      expect(headers.get("authorization")).toBe("Bearer internal-only-secret");
      expect(init?.cache).toBe("no-store");
      return Response.json({ connected: false });
    }) as typeof fetch;

    const response = await requestWebflowCollector("connection", "brand-studio:live", {}, fetchFn);
    await expect(response.json()).resolves.toEqual({ connected: false });
  });

  it("relays only bounded JSON and strips upstream headers", async () => {
    const response = await relayWebflowCollector(new Response(
      JSON.stringify({ connected: true, siteId: "site" }),
      { status: 201, headers: { "x-upstream-secret": "do-not-forward" } },
    ));
    expect(response.status).toBe(201);
    expect(response.headers.get("x-upstream-secret")).toBeNull();
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({ connected: true, siteId: "site" });
  });
});
