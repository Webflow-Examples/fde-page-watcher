import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { getEnv } from "../env";

/**
 * Encryption for the few secrets an integration stores.
 *
 * One rule above all: a provider token must never reach the browser, and must
 * never sit in a table as plaintext. AES-256-GCM gives confidentiality and
 * integrity in one primitive, and the associated data ties a ciphertext to the
 * project and provider it was written for, so a row copied from one connection
 * into another does not decrypt.
 *
 * The key is `INTEGRATION_TOKEN_KEY`, a deployment secret. Accepted forms:
 *
 *   - 32 raw bytes, base64 (`openssl rand -base64 32`), or
 *   - 64 hex characters, or
 *   - any other string of at least 32 characters, hashed with SHA-256.
 *
 * The last form exists for deployments that paste a passphrase, and is
 * documented in `docs/task-integrations.md`. A missing or too-short key throws
 * rather than falling back to a default: a silent default would encrypt every
 * token with a key an attacker already has.
 */

export const TOKEN_KEY_ENV = "INTEGRATION_TOKEN_KEY";
const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12;
const MIN_PASSPHRASE = 32;

export class IntegrationCryptoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IntegrationCryptoError";
  }
}

/** Resolve the configured key material, or throw with the env name in the message. */
export function tokenKeyMaterial(secret: string | undefined = getEnv(TOKEN_KEY_ENV)): Buffer {
  const value = secret?.trim();
  if (!value) {
    throw new IntegrationCryptoError(`${TOKEN_KEY_ENV} is not set; a task-tool connection cannot store a token without it`);
  }
  if (/^[0-9a-fA-F]{64}$/.test(value)) return Buffer.from(value, "hex");
  const decoded = Buffer.from(value, "base64");
  if (decoded.length === 32 && decoded.toString("base64").replace(/=+$/, "") === value.replace(/=+$/, "")) {
    return decoded;
  }
  if (value.length < MIN_PASSPHRASE) {
    throw new IntegrationCryptoError(
      `${TOKEN_KEY_ENV} must be 32 raw bytes (base64), 64 hex characters, or at least ${MIN_PASSPHRASE} characters`,
    );
  }
  return createHash("sha256").update(value).digest();
}

/** The associated data that binds a ciphertext to one connection. */
export function connectionAad(projectId: string, provider: string): string {
  return `page-watch:integration:${projectId}:${provider}`;
}

export interface SealedSecret {
  ciphertext: string;
  nonce: string;
}

export function sealSecret(plaintext: string, secret: string, aad: string): SealedSecret {
  const key = tokenKeyMaterial(secret);
  const nonce = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, nonce);
  cipher.setAAD(Buffer.from(aad, "utf8"));
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    ciphertext: Buffer.concat([ciphertext, tag]).toString("base64"),
    nonce: nonce.toString("base64"),
  };
}

export function openSecret(sealed: SealedSecret, secret: string, aad: string): string {
  const key = tokenKeyMaterial(secret);
  const payload = Buffer.from(sealed.ciphertext, "base64");
  if (payload.length <= 16) throw new IntegrationCryptoError("stored secret is truncated");
  const ciphertext = payload.subarray(0, payload.length - 16);
  const tag = payload.subarray(payload.length - 16);
  try {
    const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(sealed.nonce, "base64"));
    decipher.setAAD(Buffer.from(aad, "utf8"));
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
  } catch {
    throw new IntegrationCryptoError("stored secret could not be decrypted with this key");
  }
}

/** A stable, non-reversible handle for a token, so the UI can name it without showing it. */
export function secretPrefix(plaintext: string): string {
  return plaintext.slice(0, 6);
}

export function hashToken(plaintext: string): string {
  return createHash("sha256").update(plaintext).digest("hex");
}

export function tokenMatches(plaintext: string, storedHash: string): boolean {
  const left = Buffer.from(hashToken(plaintext), "hex");
  let right: Buffer;
  try {
    right = Buffer.from(storedHash, "hex");
  } catch {
    return false;
  }
  return left.length === right.length && timingSafeEqual(left, right);
}

export function randomSecret(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

/** HMAC key for OAuth state and outbound webhook signatures. */
export function hmacKey(secret: string): Buffer {
  return tokenKeyMaterial(secret);
}

export function signHmac(payload: string, secret: string): string {
  return createHmac("sha256", hmacKey(secret)).update(payload).digest("hex");
}

export function verifyHmac(payload: string, signature: string, secret: string): boolean {
  const expected = Buffer.from(signHmac(payload, secret), "hex");
  let given: Buffer;
  try {
    given = Buffer.from(signature.replace(/^sha256=/, ""), "hex");
  } catch {
    return false;
  }
  return expected.length === given.length && timingSafeEqual(expected, given);
}
