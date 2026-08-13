export const LOGIN_STATE_COOKIE_PRODUCTION = "__Host-page-watch-login-state";
export const LOGIN_STATE_COOKIE_DEVELOPMENT = "page-watch-login-state";
export const LOGIN_STATE_TTL_SECONDS = 10 * 60;
export const HANDOFF_TTL_SECONDS = 60;

export interface AuthHandoffPayload {
  v: 1;
  aud: string;
  email: string;
  state: string;
  nonce: string;
  iat: number;
  exp: number;
  sub?: string;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const STATE = /^[A-Za-z0-9_-]{40,128}$/;

function base64urlEncode(value: Uint8Array): string {
  let binary = "";
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64urlDecode(value: string): ArrayBuffer {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "="));
  const source = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  const result = new Uint8Array(source.length);
  result.set(source);
  return result.buffer;
}

function secretKey(secret: string): Promise<CryptoKey> {
  if (secret.trim().length < 32) throw new Error("AUTH_HANDOFF_SECRET must contain at least 32 characters");
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

export function validLoginState(value: string): boolean {
  return STATE.test(value);
}

export function generateLoginState(): string {
  return base64urlEncode(crypto.getRandomValues(new Uint8Array(32)));
}

export function loginStateCookieName(): string {
  const nodeEnv = (globalThis as unknown as { process?: { env?: { NODE_ENV?: string } } }).process?.env?.NODE_ENV;
  return nodeEnv === "production" ? LOGIN_STATE_COOKIE_PRODUCTION : LOGIN_STATE_COOKIE_DEVELOPMENT;
}

export function loginStateCookieOptions(): {
  httpOnly: true;
  secure: boolean;
  sameSite: "lax";
  path: "/";
  maxAge: number;
} {
  return {
    httpOnly: true,
    secure: (globalThis as unknown as { process?: { env?: { NODE_ENV?: string } } }).process?.env?.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: LOGIN_STATE_TTL_SECONDS,
  };
}

export async function createAuthHandoff(input: {
  audience: string;
  email: string;
  state: string;
  subject?: string;
  now?: number;
  nonce?: string;
}, secret: string): Promise<string> {
  const email = normalizeEmail(input.email);
  if (!EMAIL.test(email) || email.length > 254) throw new Error("A valid email is required for the handoff");
  if (!validLoginState(input.state)) throw new Error("A valid login state is required for the handoff");
  const now = input.now ?? Math.floor(Date.now() / 1000);
  const payload: AuthHandoffPayload = {
    v: 1,
    aud: input.audience,
    email,
    state: input.state,
    nonce: input.nonce ?? crypto.randomUUID(),
    iat: now,
    exp: now + HANDOFF_TTL_SECONDS,
    ...(input.subject ? { sub: input.subject } : {}),
  };
  const encoded = base64urlEncode(new TextEncoder().encode(JSON.stringify(payload)));
  const signature = await crypto.subtle.sign("HMAC", await secretKey(secret), new TextEncoder().encode(encoded));
  return `${encoded}.${base64urlEncode(new Uint8Array(signature))}`;
}

export async function verifyAuthHandoff(token: string, options: {
  secret: string;
  audience: string;
  state: string;
  now?: number;
}): Promise<AuthHandoffPayload> {
  const [encoded, signature, ...extra] = token.split(".");
  if (!encoded || !signature || extra.length) throw new Error("Authentication handoff is malformed");
  const verified = await crypto.subtle.verify(
    "HMAC",
    await secretKey(options.secret),
    base64urlDecode(signature),
    new TextEncoder().encode(encoded),
  );
  if (!verified) throw new Error("Authentication handoff signature is invalid");
  let payload: AuthHandoffPayload;
  try {
    payload = JSON.parse(new TextDecoder().decode(base64urlDecode(encoded))) as AuthHandoffPayload;
  } catch {
    throw new Error("Authentication handoff is malformed");
  }
  const now = options.now ?? Math.floor(Date.now() / 1000);
  const email = normalizeEmail(payload.email ?? "");
  if (payload.v !== 1 || payload.aud !== options.audience || payload.state !== options.state
    || !validLoginState(payload.state) || !EMAIL.test(email) || email.length > 254
    || typeof payload.nonce !== "string" || !payload.nonce
    || !Number.isInteger(payload.iat) || !Number.isInteger(payload.exp)
    || payload.iat > now + 30 || payload.exp <= now || payload.exp - payload.iat !== HANDOFF_TTL_SECONDS) {
    throw new Error("Authentication handoff is invalid or expired");
  }
  return { ...payload, email };
}
