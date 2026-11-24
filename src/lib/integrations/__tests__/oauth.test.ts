import { describe, expect, it } from "vitest";
import {
  OAUTH_STATE_TTL_MS,
  createOAuthState,
  exchangeOAuthCode,
  verifyOAuthState,
} from "../oauth";

const SECRET = "oauth-test-secret-that-is-at-least-32-chars";

describe("OAuth state", () => {
  it("accepts a state it issued, with the cookie from the start route", () => {
    const now = 1_000_000;
    const state = createOAuthState({ projectId: "brand-studio", provider: "asana", secret: SECRET, now, nonce: "n1" });
    const verified = verifyOAuthState({ state, cookie: state, secret: SECRET, provider: "asana", now });
    expect(verified.ok).toBe(true);
    if (verified.ok) {
      expect(verified.payload.projectId).toBe("brand-studio");
      expect(verified.payload.exp).toBe(now + OAUTH_STATE_TTL_MS);
    }
  });

  it("rejects an expired state", () => {
    const now = 1_000_000;
    const state = createOAuthState({ projectId: "brand-studio", provider: "asana", secret: SECRET, now, ttlMs: 10 });
    const verified = verifyOAuthState({ state, cookie: state, secret: SECRET, provider: "asana", now: now + 11 });
    expect(verified).toEqual({ ok: false, reason: "expired" });
  });

  it("rejects a tampered signature and a malformed state", () => {
    const state = createOAuthState({ projectId: "brand-studio", provider: "asana", secret: SECRET, nonce: "n1" });
    const [body, signature] = state.split(".");
    const flipped = signature.replace(/.$/, (char) => (char === "0" ? "1" : "0"));
    expect(verifyOAuthState({ state: `${body}.${flipped}`, cookie: `${body}.${flipped}`, secret: SECRET, provider: "asana" }))
      .toEqual({ ok: false, reason: "signature" });
    expect(verifyOAuthState({ state: "not-a-state", cookie: "not-a-state", secret: SECRET, provider: "asana" }))
      .toEqual({ ok: false, reason: "malformed" });
  });

  it("rejects a state minted for the other provider", () => {
    const state = createOAuthState({ projectId: "brand-studio", provider: "asana", secret: SECRET });
    expect(verifyOAuthState({ state, cookie: state, secret: SECRET, provider: "linear" }))
      .toEqual({ ok: false, reason: "provider" });
  });

  it("requires the cookie set by the start route", () => {
    const state = createOAuthState({ projectId: "brand-studio", provider: "asana", secret: SECRET });
    expect(verifyOAuthState({ state, secret: SECRET, provider: "asana" }))
      .toEqual({ ok: false, reason: "missing-cookie" });
    expect(verifyOAuthState({ state, cookie: "something-else", secret: SECRET, provider: "asana" }))
      .toEqual({ ok: false, reason: "cookie-mismatch" });
  });

  it("exchanges a code through the provider's token endpoint", async () => {
    const calls: Array<{ url: string; body: string }> = [];
    const fetchImpl = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
      calls.push({ url: String(input), body: String(init.body ?? "") });
      return new Response(JSON.stringify({ access_token: "tok", scope: "tasks:read tasks:write" }), { status: 200 });
    }) as typeof fetch;
    const result = await exchangeOAuthCode({
      provider: "asana",
      tokenUrl: "https://app.asana.com/-/oauth_token",
      code: "code-1",
      redirectUri: "https://app.example.test/api/integrations/asana/oauth/callback",
      clientId: "client",
      clientSecret: "secret",
      fetchImpl,
    });
    expect(result.accessToken).toBe("tok");
    expect(result.scopes).toEqual(["tasks:read", "tasks:write"]);
    expect(calls[0].url).toBe("https://app.asana.com/-/oauth_token");
    expect(calls[0].body).toContain("code=code-1");
    expect(calls[0].body).toContain("grant_type=authorization_code");
  });

  it("surfaces a refused exchange as a provider error", async () => {
    const fetchImpl = (async () => new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400 })) as typeof fetch;
    await expect(exchangeOAuthCode({
      provider: "linear",
      tokenUrl: "https://api.linear.app/oauth/token",
      code: "spent",
      redirectUri: "https://app.example.test/callback",
      clientId: "client",
      clientSecret: "secret",
      fetchImpl,
    })).rejects.toMatchObject({ status: 400 });
  });
});
