import { describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import {
  IntegrationCryptoError,
  connectionAad,
  hashToken,
  openSecret,
  sealSecret,
  secretPrefix,
  signHmac,
  tokenKeyMaterial,
  tokenMatches,
  verifyHmac,
} from "../crypto";

const KEY = randomBytes(32).toString("base64");
const AAD = connectionAad("brand-studio", "asana");

describe("integration token encryption", () => {
  it("round-trips a token through AES-256-GCM", () => {
    const sealed = sealSecret("asana-token-123", KEY, AAD);
    expect(sealed.ciphertext).not.toContain("asana-token-123");
    expect(openSecret(sealed, KEY, AAD)).toBe("asana-token-123");
  });

  it("uses a fresh nonce per write, so one token has many ciphertexts", () => {
    const a = sealSecret("same", KEY, AAD);
    const b = sealSecret("same", KEY, AAD);
    expect(a.nonce).not.toBe(b.nonce);
    expect(a.ciphertext).not.toBe(b.ciphertext);
  });

  it("refuses a ciphertext written for another project or provider", () => {
    const sealed = sealSecret("token", KEY, AAD);
    expect(() => openSecret(sealed, KEY, connectionAad("other-project", "asana"))).toThrow(IntegrationCryptoError);
    expect(() => openSecret(sealed, KEY, connectionAad("brand-studio", "linear"))).toThrow(IntegrationCryptoError);
  });

  it("refuses the wrong key", () => {
    const sealed = sealSecret("token", KEY, AAD);
    const wrong = randomBytes(32).toString("base64");
    expect(() => openSecret(sealed, wrong, AAD)).toThrow(IntegrationCryptoError);
  });

  it("accepts base64, hex and passphrase forms, and rejects a short one", () => {
    expect(tokenKeyMaterial(randomBytes(32).toString("base64"))).toHaveLength(32);
    expect(tokenKeyMaterial(randomBytes(32).toString("hex"))).toHaveLength(32);
    expect(tokenKeyMaterial("x".repeat(32))).toHaveLength(32);
    expect(() => tokenKeyMaterial("short")).toThrow(/INTEGRATION_TOKEN_KEY/);
    expect(() => tokenKeyMaterial(undefined)).toThrow(/INTEGRATION_TOKEN_KEY/);
  });

  it("hashes API tokens and compares them without a plaintext copy", () => {
    const token = "pw_abc123";
    const hash = hashToken(token);
    expect(hash).not.toContain(token);
    expect(tokenMatches(token, hash)).toBe(true);
    expect(tokenMatches("pw_wrong", hash)).toBe(false);
    expect(secretPrefix(token)).toBe("pw_abc");
  });

  it("signs and verifies a payload with HMAC, and rejects a tampered one", () => {
    const signature = signHmac("payload", KEY);
    expect(verifyHmac("payload", `sha256=${signature}`, KEY)).toBe(true);
    expect(verifyHmac("payload!", `sha256=${signature}`, KEY)).toBe(false);
    expect(verifyHmac("payload", "sha256=00", KEY)).toBe(false);
  });
});
