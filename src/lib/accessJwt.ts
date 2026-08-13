export interface AccessIdentity {
  email: string;
  subject?: string;
  source: "cloudflare-access";
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
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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

function decodeSegment<T>(segment: string): T {
  try {
    const normalized = segment.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
    const binary = atob(padded);
    return JSON.parse(new TextDecoder().decode(Uint8Array.from(binary, (character) => character.charCodeAt(0)))) as T;
  } catch {
    throw new AuthenticationError("Cloudflare Access token is malformed");
  }
}

function audienceMatches(actual: string | string[] | undefined, expected: string[]): boolean {
  const values = Array.isArray(actual) ? actual : actual ? [actual] : [];
  return values.some((value) => expected.includes(value));
}

export async function verifyAccessJwt(
  token: string,
  options: { teamDomain: string; audiences: string[]; now?: number; fetcher?: typeof fetch },
): Promise<AccessIdentity> {
  const [encodedHeader, encodedPayload, encodedSignature, ...extra] = token.split(".");
  if (!encodedHeader || !encodedPayload || !encodedSignature || extra.length) {
    throw new AuthenticationError("Cloudflare Access token is malformed");
  }
  const header = decodeSegment<AccessHeader>(encodedHeader);
  const payload = decodeSegment<AccessPayload>(encodedPayload);
  if (header.alg !== "RS256" || !header.kid) {
    throw new AuthenticationError("Cloudflare Access token uses an unsupported signature");
  }

  const teamDomain = options.teamDomain.replace(/\/$/, "");
  // Workers only supports `no-store` and `no-cache`; browser-oriented modes
  // such as `force-cache` throw before this subrequest is sent.
  const response = await (options.fetcher ?? fetch)(`${teamDomain}/cdn-cgi/access/certs`);
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
  const normalizedSignature = encodedSignature.replace(/-/g, "+").replace(/_/g, "/");
  const binarySignature = atob(normalizedSignature.padEnd(Math.ceil(normalizedSignature.length / 4) * 4, "="));
  const signatureBytes = Uint8Array.from(binarySignature, (character) => character.charCodeAt(0));
  const signature = new Uint8Array(signatureBytes.length);
  signature.set(signatureBytes);
  const valid = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    cryptoKey,
    signature.buffer,
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
  if (!audienceMatches(payload.aud, options.audiences)) {
    throw new AuthenticationError("Cloudflare Access token audience is invalid");
  }
  const email = normalizeEmail(payload.email ?? "");
  if (!validEmail(email)) throw new AuthenticationError("Cloudflare Access token has no valid email");
  return { email, ...(payload.sub ? { subject: payload.sub } : {}), source: "cloudflare-access" };
}
