import { ProviderError } from "./provider";
import { signHmac, verifyHmac } from "./crypto";
import type { TaskProviderKind } from "./types";

/**
 * OAuth start/callback support.
 *
 * The state is signed, carries an expiry, names the project and provider, and
 * is also kept in an HttpOnly cookie. The callback checks all four: a signature
 * proves we issued it, the expiry bounds a replayed link, the provider stops a
 * state minted for Asana being redeemed at Linear, and the cookie stops a
 * callback being driven from another browser session.
 */

export interface ProviderOAuthConfig {
  authorizeUrl: string;
  tokenUrl: string;
  scopes: readonly string[];
}

export const OAUTH_STATE_COOKIE = "page-watch-integration-oauth";
export const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;

export interface OAuthStatePayload {
  v: 1;
  projectId: string;
  provider: TaskProviderKind;
  nonce: string;
  exp: number;
}

function encode(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}

function sign(payload: OAuthStatePayload, secret: string): string {
  const body = encode(JSON.stringify(payload));
  return `${body}.${signHmac(body, secret)}`;
}

export function createOAuthState(input: {
  projectId: string;
  provider: TaskProviderKind;
  secret: string;
  now?: number;
  ttlMs?: number;
  nonce?: string;
}): string {
  const now = input.now ?? Date.now();
  const nonce = input.nonce ?? encode(`${Math.random()}-${now}`);
  return sign({
    v: 1,
    projectId: input.projectId,
    provider: input.provider,
    nonce,
    exp: now + (input.ttlMs ?? OAUTH_STATE_TTL_MS),
  }, input.secret);
}

export type OAuthStateResult =
  | { ok: true; payload: OAuthStatePayload }
  | { ok: false; reason: "malformed" | "signature" | "expired" | "provider" | "missing-cookie" | "cookie-mismatch" };

export function verifyOAuthState(input: {
  state: string | null | undefined;
  cookie?: string | null;
  secret: string;
  provider: TaskProviderKind;
  now?: number;
}): OAuthStateResult {
  if (!input.state || typeof input.state !== "string") return { ok: false, reason: "malformed" };
  const [body, signature, extra] = input.state.split(".");
  if (!body || !signature || extra) return { ok: false, reason: "malformed" };
  if (!verifyHmac(body, signature, input.secret)) return { ok: false, reason: "signature" };

  let payload: OAuthStatePayload;
  try {
    payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as OAuthStatePayload;
  } catch {
    return { ok: false, reason: "malformed" };
  }
  if (!payload || payload.v !== 1 || typeof payload.projectId !== "string" || typeof payload.exp !== "number") {
    return { ok: false, reason: "malformed" };
  }
  if ((input.now ?? Date.now()) > payload.exp) return { ok: false, reason: "expired" };
  if (payload.provider !== input.provider) return { ok: false, reason: "provider" };
  if (!input.cookie) return { ok: false, reason: "missing-cookie" };
  if (input.cookie !== input.state) return { ok: false, reason: "cookie-mismatch" };
  return { ok: true, payload };
}

export interface TokenExchangeResult {
  accessToken: string;
  scopes: string[];
  workspaceId?: string;
  workspaceName?: string;
}

export class OAuthNotConfiguredError extends Error {
  constructor(provider: TaskProviderKind) {
    super(`${provider.toUpperCase()}_CLIENT_ID and ${provider.toUpperCase()}_CLIENT_SECRET are not configured`);
    this.name = "OAuthNotConfiguredError";
  }
}

function scopesOf(payload: Record<string, unknown>): string[] {
  const raw = payload.scope ?? payload.scopes;
  if (typeof raw === "string") return raw.split(/[,\s]+/).filter(Boolean);
  if (Array.isArray(raw)) return raw.filter((entry): entry is string => typeof entry === "string");
  return [];
}

/**
 * Exchange a one-time code for a token.
 *
 * No retry: an authorization code is single-use, and a second POST would be a
 * second failed request rather than a recovered one.
 */
export async function exchangeOAuthCode(input: {
  provider: TaskProviderKind;
  tokenUrl: string;
  code: string;
  redirectUri: string;
  clientId: string;
  clientSecret: string;
  fetchImpl?: typeof fetch;
}): Promise<TokenExchangeResult> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code: input.code,
    client_id: input.clientId,
    client_secret: input.clientSecret,
    redirect_uri: input.redirectUri,
  });
  const response = await (input.fetchImpl ?? fetch)(input.tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: body.toString(),
  });
  const text = await response.text();
  let payload: Record<string, unknown> = {};
  try {
    payload = text ? JSON.parse(text) as Record<string, unknown> : {};
  } catch {
    payload = {};
  }
  if (!response.ok || typeof payload.access_token !== "string" || !payload.access_token) {
    throw new ProviderError(`${input.provider} token exchange failed with ${response.status}`, {
      status: response.status,
      body: text.slice(0, 500),
    });
  }
  const data = (payload.data && typeof payload.data === "object" ? payload.data : {}) as Record<string, unknown>;
  return {
    accessToken: payload.access_token,
    scopes: scopesOf(payload),
    ...(typeof data.gid === "string" ? { workspaceId: data.gid } : {}),
    ...(typeof data.name === "string" ? { workspaceName: data.name } : {}),
  };
}
