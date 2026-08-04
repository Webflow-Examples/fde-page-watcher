import { afterEach, describe, expect, it, vi } from "vitest";
import {
  alertWebhookUrlIsValid,
  buildDailyDigestWebhookPayload,
  postWebhook,
} from "../webhook";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("alert webhook", () => {
  it("accepts credential-free HTTPS URLs only", () => {
    expect(alertWebhookUrlIsValid("https://hooks.example.com/page-watch?token=secret")).toBe(true);
    expect(alertWebhookUrlIsValid("http://hooks.example.com/page-watch")).toBe(false);
    expect(alertWebhookUrlIsValid("https://user:pass@hooks.example.com/page-watch")).toBe(false);
    expect(alertWebhookUrlIsValid("not a URL")).toBe(false);
  });

  it("builds human-readable fields and a machine-readable page list", () => {
    const payload = buildDailyDigestWebhookPayload([
      {
        title: "Homepage",
        url: "https://example.com",
        status: "regressing",
        categories: ["Performance"],
        devices: ["mobile", "desktop"],
      },
      {
        title: "Pricing",
        url: "https://example.com/pricing",
        status: "regressing",
        categories: ["Performance", "Accessibility"],
        devices: ["mobile"],
      },
    ], "nightly:2026-08-04");

    expect(payload).toMatchObject({
      event: "page_watch.daily_digest",
      version: 1,
      id: "nightly:2026-08-04",
      date: "2026-08-04",
      title: "Page Watch daily digest: 2 pages need attention",
      summary: "2 monitored pages have confirmed regressions.",
    });
    expect(payload.text).toContain("- Homepage — Regressing — Performance — mobile, desktop");
    expect(payload.pages).toHaveLength(2);
  });

  it("does not attempt delivery without a configured URL", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const delivery = await postWebhook(undefined, buildDailyDigestWebhookPayload([], "nightly:1970-01-01"));
    expect(delivery).toEqual({ sent: false, error: "Alert webhook URL is not configured" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("posts JSON and accepts only a 2xx response", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 202 }));
    vi.stubGlobal("fetch", fetchMock);
    const payload = buildDailyDigestWebhookPayload([], "nightly:1970-01-01");
    expect(payload.text).toBe("No monitored pages need attention.");
    const delivery = await postWebhook("https://hooks.example.com/page-watch", payload);
    expect(delivery).toEqual({ sent: true, status: 202 });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://hooks.example.com/page-watch",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify(payload),
        headers: expect.objectContaining({ "idempotency-key": "nightly:1970-01-01" }),
      }),
    );
  });

  it("retains Retry-After without reading an unbounded error body", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("ignored", {
      status: 429,
      statusText: "Too Many Requests",
      headers: { "Retry-After": "120" },
    })));
    const delivery = await postWebhook(
      "https://hooks.example.com/page-watch",
      buildDailyDigestWebhookPayload([], "nightly:1970-01-01"),
    );
    expect(delivery).toMatchObject({
      sent: false,
      status: 429,
      error: "429 Too Many Requests",
      retryAfterSeconds: 120,
    });
  });
});
