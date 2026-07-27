import { describe, expect, it } from "vitest";
import {
  decryptWebflowToken,
  encryptWebflowToken,
  webflowChangeDensity,
  WebflowIntegrationError,
} from "../webflow";

const TENANT = "brand-studio:live";
const SITE_ID = "580e63e98c9a982ac9b8b741";
const KEY = Buffer.alloc(32, 7).toString("base64");

describe("Webflow site-token encryption", () => {
  it("round-trips a token without exposing plaintext in the envelope", async () => {
    const encrypted = await encryptWebflowToken("wf-secret-site-token", TENANT, SITE_ID, KEY);
    expect(encrypted.ciphertext).not.toContain("wf-secret-site-token");
    expect(encrypted.iv).not.toBe("");
    await expect(
      decryptWebflowToken(encrypted.ciphertext, encrypted.iv, TENANT, SITE_ID, KEY),
    ).resolves.toBe("wf-secret-site-token");
  });

  it("binds ciphertext to its tenant and site", async () => {
    const encrypted = await encryptWebflowToken("wf-secret-site-token", TENANT, SITE_ID, KEY);
    await expect(
      decryptWebflowToken(
        encrypted.ciphertext,
        encrypted.iv,
        "another-tenant",
        SITE_ID,
        KEY,
      ),
    ).rejects.toMatchObject<WebflowIntegrationError>({ code: "token_decryption_failed" });
  });

  it("rejects encryption keys that are not 32 bytes", async () => {
    await expect(
      encryptWebflowToken("wf-secret-site-token", TENANT, SITE_ID, Buffer.alloc(16).toString("base64")),
    ).rejects.toMatchObject<WebflowIntegrationError>({ code: "invalid_encryption_key" });
  });
});

describe("Webflow publish change density", () => {
  it("uses descriptive, deterministic activity bands", () => {
    expect(webflowChangeDensity(0)).toBe("small");
    expect(webflowChangeDensity(5)).toBe("small");
    expect(webflowChangeDensity(6)).toBe("moderate");
    expect(webflowChangeDensity(20)).toBe("moderate");
    expect(webflowChangeDensity(21)).toBe("high-change");
  });
});
