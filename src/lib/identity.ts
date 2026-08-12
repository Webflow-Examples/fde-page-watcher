import { getEnv } from "./env";
import { DEVELOPMENT_SESSION_COOKIE, PRODUCTION_SESSION_COOKIE, verifySessionToken } from "./session";
import {
  AuthenticationError,
  normalizeEmail,
  validEmail,
  verifyAccessJwt as verifyAccessJwtWithOptions,
  type AccessIdentity,
} from "./accessJwt";

export { AuthenticationError, normalizeEmail, validEmail } from "./accessJwt";

export const BOOTSTRAP_APP_ADMINS = [
  "matthew@webflow.com",
  "ben@webflow.com",
  "diego.rangel@webflow.com",
] as const;

const BOOTSTRAP_SET = new Set<string>(BOOTSTRAP_APP_ADMINS);

export interface Identity {
  email: string;
  subject?: string;
  source: "cloudflare-access" | "session" | "development";
}

export function isBootstrapAppAdmin(email: string): boolean {
  return BOOTSTRAP_SET.has(normalizeEmail(email));
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

export async function verifyAccessJwt(
  token: string,
  options: { teamDomain?: string; audiences?: string[]; now?: number; fetcher?: typeof fetch } = {},
): Promise<AccessIdentity> {
  return verifyAccessJwtWithOptions(token, {
    teamDomain: options.teamDomain ?? accessTeamDomain(),
    audiences: options.audiences ?? configuredAudiences(),
    ...(options.now === undefined ? {} : { now: options.now }),
    ...(options.fetcher ? { fetcher: options.fetcher } : {}),
  });
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
  if (process.env.NODE_ENV !== "production" && getEnv("AUTH_MODE") !== "native") {
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
  const session = cookieValue(headers, PRODUCTION_SESSION_COOKIE) ?? cookieValue(headers, DEVELOPMENT_SESSION_COOKIE);
  if (session) {
    try {
      const payload = await verifySessionToken(session);
      return { email: payload.email, subject: payload.sid, source: "session" };
    } catch {
      throw new AuthenticationError("Your session is invalid or has expired");
    }
  }
  const token = headers.get("cf-access-jwt-assertion");
  if (!token) throw new AuthenticationError("Sign in to Page Watch");
  return verifyAccessJwt(token);
}

export function identityFromRequest(request: Request): Promise<Identity> {
  return identityFromHeaders(request.headers);
}
