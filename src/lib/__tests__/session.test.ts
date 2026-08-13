import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSessionToken, verifySessionToken } from "../session";

describe("native authentication sessions", () => {
  beforeEach(() => {
    vi.stubEnv("AUTH_SESSION_SECRET", "test-session-secret-with-at-least-32-characters");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("signs and verifies a normalized, expiring identity", async () => {
    const token = await createSessionToken(" Customer@Example.com ", {
      now: 1_900_000_000,
      ttlSeconds: 600,
      sid: "session-123",
    });
    await expect(verifySessionToken(token, 1_900_000_300)).resolves.toEqual({
      v: 1,
      email: "customer@example.com",
      sid: "session-123",
      iat: 1_900_000_000,
      exp: 1_900_000_600,
    });
  });

  it("rejects tampered and expired sessions", async () => {
    const token = await createSessionToken("customer@example.com", {
      now: 1_900_000_000,
      ttlSeconds: 60,
    });
    const [payload, signature] = token.split(".");
    await expect(verifySessionToken(`${payload}x.${signature}`, 1_900_000_010)).rejects.toThrow();
    await expect(verifySessionToken(token, 1_900_000_061)).rejects.toThrow("expired");
  });

  it("requires a strong server-side signing secret", async () => {
    vi.stubEnv("AUTH_SESSION_SECRET", "short");
    await expect(createSessionToken("customer@example.com")).rejects.toThrow("at least 32 characters");
  });
});
