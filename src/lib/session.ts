import { getEnv } from "./env";

export const PRODUCTION_SESSION_COOKIE = "__Host-page-watch-session";
export const DEVELOPMENT_SESSION_COOKIE = "page-watch-session";
export const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;

interface SessionPayload {
  v: 1;
  email: string;
  sid: string;
  iat: number;
  exp: number;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

function validEmail(value: string): boolean {
  const email = normalizeEmail(value);
  return email.length <= 254 && EMAIL.test(email);
}

function sessionSecret(): string {
  const secret = getEnv("AUTH_SESSION_SECRET")?.trim();
  if (!secret || secret.length < 32) throw new Error("AUTH_SESSION_SECRET must contain at least 32 characters");
  return secret;
}

function base64url(value: string | ArrayBuffer): string {
  return Buffer.from(typeof value === "string" ? value : new Uint8Array(value)).toString("base64url");
}

function decodeBase64url(value: string): ArrayBuffer {
  const source = Buffer.from(value, "base64url");
  const result = new ArrayBuffer(source.length);
  new Uint8Array(result).set(source);
  return result;
}

async function hmacKey(): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(sessionSecret()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

export function sessionCookieName(): string {
  return process.env.NODE_ENV === "production" ? PRODUCTION_SESSION_COOKIE : DEVELOPMENT_SESSION_COOKIE;
}

export async function createSessionToken(
  emailInput: string,
  options: { now?: number; ttlSeconds?: number; sid?: string } = {},
): Promise<string> {
  const email = normalizeEmail(emailInput);
  if (!validEmail(email)) throw new Error("A valid email is required for the session");
  const now = options.now ?? Math.floor(Date.now() / 1000);
  const payload: SessionPayload = {
    v: 1,
    email,
    sid: options.sid ?? crypto.randomUUID(),
    iat: now,
    exp: now + (options.ttlSeconds ?? SESSION_TTL_SECONDS),
  };
  const encoded = base64url(JSON.stringify(payload));
  const signature = await crypto.subtle.sign("HMAC", await hmacKey(), new TextEncoder().encode(encoded));
  return `${encoded}.${base64url(signature)}`;
}

export async function verifySessionToken(token: string, now = Math.floor(Date.now() / 1000)): Promise<SessionPayload> {
  const [encoded, signature, ...extra] = token.split(".");
  if (!encoded || !signature || extra.length) throw new Error("Session is malformed");
  let payload: SessionPayload;
  try {
    payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as SessionPayload;
  } catch {
    throw new Error("Session is malformed");
  }
  const verified = await crypto.subtle.verify(
    "HMAC",
    await hmacKey(),
    decodeBase64url(signature),
    new TextEncoder().encode(encoded),
  );
  if (!verified) throw new Error("Session signature is invalid");
  if (payload.v !== 1 || !validEmail(payload.email) || typeof payload.sid !== "string" || !payload.sid
    || !Number.isInteger(payload.iat) || !Number.isInteger(payload.exp)
    || payload.iat > now + 60 || payload.exp <= now || payload.exp - payload.iat > SESSION_TTL_SECONDS) {
    throw new Error("Session is invalid or expired");
  }
  return { ...payload, email: normalizeEmail(payload.email) };
}

export function sessionCookieOptions(): {
  httpOnly: true;
  secure: boolean;
  sameSite: "lax";
  path: "/";
  maxAge: number;
} {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  };
}
