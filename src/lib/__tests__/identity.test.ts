import { describe, expect, it } from "vitest";
import { BOOTSTRAP_APP_ADMINS, isBootstrapAppAdmin, normalizeEmail, verifyAccessJwt } from "../identity";

function base64url(value: string | Uint8Array): string {
  return Buffer.from(value).toString("base64url");
}

async function signedToken(payloadPatch: Record<string, unknown> = {}) {
  const keys = await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["sign", "verify"],
  );
  const header = base64url(JSON.stringify({ alg: "RS256", kid: "test-key" }));
  const payload = base64url(JSON.stringify({
    iss: "https://example.cloudflareaccess.com",
    aud: ["page-watch-aud"],
    email: "Customer@Example.com",
    sub: "user-123",
    type: "app",
    exp: 2_000_000_000,
    nbf: 1_900_000_000,
    ...payloadPatch,
  }));
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", keys.privateKey, new TextEncoder().encode(`${header}.${payload}`));
  const jwk = await crypto.subtle.exportKey("jwk", keys.publicKey) as JsonWebKey & { kid?: string };
  jwk.kid = "test-key";
  return { token: `${header}.${payload}.${base64url(new Uint8Array(signature))}`, jwk };
}

describe("Cloudflare Access identity", () => {
  it("verifies the Access signature, issuer, audience, dates, and normalized email", async () => {
    const { token, jwk } = await signedToken();
    const identity = await verifyAccessJwt(token, {
      teamDomain: "https://example.cloudflareaccess.com",
      audiences: ["page-watch-aud"],
      now: 1_950_000_000,
      fetcher: async () => Response.json({ keys: [jwk] }),
    });
    expect(identity).toEqual({ email: "customer@example.com", subject: "user-123", source: "cloudflare-access" });
  });

  it("rejects a token for another Access application", async () => {
    const { token, jwk } = await signedToken();
    await expect(verifyAccessJwt(token, {
      teamDomain: "https://example.cloudflareaccess.com",
      audiences: ["another-aud"],
      now: 1_950_000_000,
      fetcher: async () => Response.json({ keys: [jwk] }),
    })).rejects.toThrow("audience is invalid");
  });

  it("keeps the three bootstrap administrators immutable in code", () => {
    expect(BOOTSTRAP_APP_ADMINS).toEqual(["matthew@webflow.com", "ben@webflow.com", "diego.rangel@webflow.com"]);
    expect(isBootstrapAppAdmin(" MATTHEW@WEBFLOW.COM ")).toBe(true);
    expect(isBootstrapAppAdmin(normalizeEmail("customer@example.com"))).toBe(false);
  });
});
