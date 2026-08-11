import { getEnv } from "./env";

export const BOOTSTRAP_APP_ADMINS = [
  "matthew@webflow.com",
  "ben@webflow.com",
  "diego.rangel@webflow.com",
] as const;

const BOOTSTRAP_SET = new Set<string>(BOOTSTRAP_APP_ADMINS);
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface Identity {
  email: string;
  subject?: string;
  source: "cloudflare-access" | "development";
}

interface AccessPayload {
  aud?: string | string[];
  email?: string;
  exp?: number;
  iss?: string;
  nbf?: number;
  sub?: string;
  type?: string;
}

interface AccessHeader {
  alg?: string;
  kid?: string;
}

interface JwksResponse {
  keys?: Array<JsonWebKey & { kid?: string }>;
  public_certs?: Array<{ kid?: string; cert?: string }>;
}

export class AuthenticationError extends Error {
  readonly status: number;

  constructor(message: string, status = 401) {
    super(message);
    this.name = "AuthenticationError";
    this.status = status;
  }
}

export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

export function validEmail(value: string): boolean {
  const email = normalizeEmail(value);
  return email.length <= 254 && EMAIL.test(email);
}

export function isBootstrapAppAdmin(email: string): boolean {
  return BOOTSTRAP_SET.has(normalizeEmail(email));
}

function decodeSegment<T>(segment: string): T {
  try {
    const normalized = segment.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
    return JSON.parse(Buffer.from(padded, "base64").toString("utf8")) as T;
  } catch {
    throw new AuthenticationError("Cloudflare Access token is malformed");
  }
}

function accessTeamDomain(): string {
  const raw = getEnv("CF_ACCESS_TEAM_DOMAIN")?.trim();
  if (!raw) throw new AuthenticationError("CF_ACCESS_TEAM_DOMAIN is not configured", 503);
  const url = raw.includes("://") ? raw : `https://${raw}`;
  return url.replace(/\/$/, "");
}

function configuredAudiences(): string[] {
  const raw = getEnv("CF_ACCESS_AUD")?.trim();
  if (!raw) throw new AuthenticationError("CF_ACCESS_AUD is not configured", 503);
  return raw.split(",").map((value) => value.trim()).filter(Boolean);
}

function audienceMatches(actual: string | string[] | undefined, expected: string[]): boolean {
  const values = Array.isArray(actual) ? actual : actual ? [actual] : [];
  return values.some((value) => expected.includes(value));
}

export async function verifyAccessJwt(
  token: string,
  options: { teamDomain?: string; audiences?: string[]; now?: number; fetcher?: typeof fetch } = {},
): Promise<Identity> {
  const [encodedHeader, encodedPayload, encodedSignature, ...extra] = token.split(".");
  if (!encodedHeader || !encodedPayload || !encodedSignature || extra.length) {
    throw new AuthenticationError("Cloudflare Access token is malformed");
  }
  const header = decodeSegment<AccessHeader>(encodedHeader);
  const payload = decodeSegment<AccessPayload>(encodedPayload);
  if (header.alg !== "RS256" || !header.kid) {
    throw new AuthenticationError("Cloudflare Access token uses an unsupported signature");
  }

  const teamDomain = (options.teamDomain ?? accessTeamDomain()).replace(/\/$/, "");
  const fetcher = options.fetcher ?? fetch;
  const response = await fetcher(`${teamDomain}/cdn-cgi/access/certs`, { cache: "force-cache" });
  if (!response.ok) throw new AuthenticationError("Cloudflare Access signing keys are unavailable", 503);
  const jwks = await response.json() as JwksResponse;
  const key = jwks.keys?.find((candidate) => candidate.kid === header.kid);
  if (!key) throw new AuthenticationError("Cloudflare Access signing key was not found");
  const cryptoKey = await crypto.subtle.importKey(
    "jwk",
    key,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"],
  );
  const signature = Uint8Array.from(Buffer.from(encodedSignature.replace(/-/g, "+").replace(/_/g, "/"), "base64"));
  const valid = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    cryptoKey,
    signature,
    new TextEncoder().encode(`${encodedHeader}.${encodedPayload}`),
  );
  if (!valid) throw new AuthenticationError("Cloudflare Access token signature is invalid");

  const now = options.now ?? Math.floor(Date.now() / 1000);
  if (!payload.exp || payload.exp <= now || (payload.nbf !== undefined && payload.nbf > now + 60)) {
    throw new AuthenticationError("Cloudflare Access token has expired or is not active");
  }
  if (payload.type !== "app") throw new AuthenticationError("Cloudflare Access token type is invalid");
  if (payload.iss?.replace(/\/$/, "") !== teamDomain) {
    throw new AuthenticationError("Cloudflare Access token issuer is invalid");
  }
  const audiences = options.audiences ?? configuredAudiences();
  if (!audienceMatches(payload.aud, audiences)) {
    throw new AuthenticationError("Cloudflare Access token audience is invalid");
  }
  const email = normalizeEmail(payload.email ?? "");
  if (!validEmail(email)) throw new AuthenticationError("Cloudflare Access token has no valid email");
  return { email, ...(payload.sub ? { subject: payload.sub } : {}), source: "cloudflare-access" };
}

function cookieValue(headers: Headers, name: string): string | undefined {
  const entry = headers.get("cookie")?.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${name}=`));
  if (!entry) return undefined;
  try {
    return decodeURIComponent(entry.slice(name.length + 1));
  } catch {
    return undefined;
  }
}

export async function identityFromHeaders(headers: Headers): Promise<Identity> {
  if (process.env.NODE_ENV !== "production") {
    const candidate = cookieValue(headers, "page-watch-dev-email")
      ?? headers.get("x-page-watch-dev-email")
      ?? getEnv("DEV_USER_EMAIL")
      ?? BOOTSTRAP_APP_ADMINS[0];
    const email = normalizeEmail(candidate);
    if (!validEmail(email)) throw new AuthenticationError("Development user email is invalid");
    return { email, source: "development" };
  }

  if (headers.has("x-page-watch-dev-email") || cookieValue(headers, "page-watch-dev-email")) {
    throw new AuthenticationError("Development identity overrides are disabled");
  }
  const token = headers.get("cf-access-jwt-assertion");
  if (!token) throw new AuthenticationError("Sign in with Cloudflare Access");
  return verifyAccessJwt(token);
}

export function identityFromRequest(request: Request): Promise<Identity> {
  return identityFromHeaders(request.headers);
}
