import { describe, expect, it } from "vitest";
import { createAuthHandoff, generateLoginState, verifyAuthHandoff } from "../authHandoff";

const secret = "test-handoff-secret-that-is-longer-than-thirty-two-characters";
const audience = "https://page-watcher.webflow.io";

describe("authentication handoff", () => {
  it("signs a normalized identity bound to the browser state and audience", async () => {
    const state = generateLoginState();
    const token = await createAuthHandoff({
      audience,
      email: " Customer@Example.com ",
      state,
      subject: "access-user-123",
      now: 1_900_000_000,
      nonce: "nonce-123",
    }, secret);

    await expect(verifyAuthHandoff(token, {
      secret,
      audience,
      state,
      now: 1_900_000_030,
    })).resolves.toEqual({
      v: 1,
      aud: audience,
      email: "customer@example.com",
      state,
      nonce: "nonce-123",
      iat: 1_900_000_000,
      exp: 1_900_000_060,
      sub: "access-user-123",
    });
  });

  it("rejects tampering, expiration, and a mismatched browser state", async () => {
    const state = generateLoginState();
    const token = await createAuthHandoff({ audience, email: "customer@example.com", state, now: 1_900_000_000 }, secret);
    const [payload, signature] = token.split(".");

    await expect(verifyAuthHandoff(`${payload}x.${signature}`, { secret, audience, state, now: 1_900_000_010 })).rejects.toThrow();
    await expect(verifyAuthHandoff(token, { secret, audience, state: generateLoginState(), now: 1_900_000_010 })).rejects.toThrow();
    await expect(verifyAuthHandoff(token, { secret, audience, state, now: 1_900_000_061 })).rejects.toThrow("expired");
  });
});
