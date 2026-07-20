import { afterEach, describe, expect, it, vi } from "vitest";
import { postFollowup } from "../slack";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Slack delivery", () => {
  it("reports a missing webhook as pending", async () => {
    vi.stubEnv("SLACK_WEBHOOK_URL", "");
    const delivery = await postFollowup("Page", "2d", ["Performance: 70 → 72 (+2)"]);
    expect(delivery).toEqual({ sent: false, error: "SLACK_WEBHOOK_URL is not configured" });
  });

  it("reports network rejection as pending", async () => {
    vi.stubEnv("SLACK_WEBHOOK_URL", "https://hooks.slack.test/example");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("connection reset")));
    const delivery = await postFollowup("Page", "2d", []);
    expect(delivery.sent).toBe(false);
    expect(delivery.error).toBe("connection reset");
  });

  it.each([400, 500])("does not accept HTTP %s as delivered", async (status) => {
    vi.stubEnv("SLACK_WEBHOOK_URL", "https://hooks.slack.test/example");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("rejected by Slack", { status })));
    const delivery = await postFollowup("Page", "2d", []);
    expect(delivery).toMatchObject({ sent: false, status, error: "rejected by Slack" });
  });

  it("retains Retry-After for HTTP 429", async () => {
    vi.stubEnv("SLACK_WEBHOOK_URL", "https://hooks.slack.test/example");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("rate_limited", { status: 429, headers: { "Retry-After": "120" } })));
    const delivery = await postFollowup("Page", "2d", []);
    expect(delivery).toMatchObject({ sent: false, status: 429, error: "rate_limited", retryAfterSeconds: 120 });
  });

  it("accepts only a 2xx response as delivered", async () => {
    vi.stubEnv("SLACK_WEBHOOK_URL", "https://hooks.slack.test/example");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("ok", { status: 200 })));
    const delivery = await postFollowup("Page", "2d", []);
    expect(delivery).toEqual({ sent: true, status: 200 });
  });
});
