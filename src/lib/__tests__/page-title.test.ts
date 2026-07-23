import { describe, expect, it, vi } from "vitest";
import { discoverPageTitle, extractPageTitle } from "../pageTitle";

const resolvePublicHost = async () => ["93.184.216.34"];

describe("page title discovery", () => {
  it("extracts and normalizes a document title", () => {
    expect(extractPageTitle("<html><head><title>  Design &amp; Build &#8212; Webflow </title></head></html>"))
      .toBe("Design & Build — Webflow");
  });

  it("adds HTTPS for a bare URL and returns the fetched title", async () => {
    const fetchFn = vi.fn<typeof fetch>(async (input, init) => {
      expect(String(input)).toBe("https://example.com/product");
      expect(init?.redirect).toBe("manual");
      return new Response("<!doctype html><title>Product overview</title>", {
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    });

    await expect(discoverPageTitle("example.com/product", { fetchFn, resolveHost: resolvePublicHost }))
      .resolves.toEqual({ title: "Product overview", url: "https://example.com/product" });
    expect(fetchFn).toHaveBeenCalledOnce();
  });

  it("revalidates redirect targets and blocks private destinations", async () => {
    const fetchFn = vi.fn<typeof fetch>(async () =>
      new Response(null, {
        status: 302,
        headers: { location: "http://127.0.0.1/admin" },
      }),
    );

    await expect(discoverPageTitle("https://example.com", { fetchFn, resolveHost: resolvePublicHost }))
      .rejects.toMatchObject({ code: "blocked_url" });
    expect(fetchFn).toHaveBeenCalledOnce();
  });

  it("blocks hostnames that resolve to a private address before fetching", async () => {
    const fetchFn = vi.fn<typeof fetch>();

    await expect(discoverPageTitle("https://internal.example.com", {
      fetchFn,
      resolveHost: async () => ["10.0.0.4"],
    })).rejects.toMatchObject({ code: "blocked_url" });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("reports an unavailable title when the HTML has none", async () => {
    const fetchFn = vi.fn<typeof fetch>(async () =>
      new Response("<html><head></head><body>Untitled</body></html>", {
        headers: { "content-type": "text/html" },
      }),
    );

    await expect(discoverPageTitle("https://example.com", { fetchFn, resolveHost: resolvePublicHost }))
      .rejects.toMatchObject({ code: "title_not_found" });
  });
});
