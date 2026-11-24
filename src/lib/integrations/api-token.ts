import { randomBytes } from "node:crypto";
import { hashToken, tokenMatches } from "./crypto";
import type { IntegrationStore } from "./store";

/**
 * A project-scoped API token for external automation.
 *
 * Read-only in v1: it lets a Zapier/Make/n8n flow list this project's task
 * links, which is what an automation needs to reconcile its own records. It
 * deliberately cannot create, close or comment — those writes stay behind the
 * project-admin session, so a leaked automation token cannot change the work.
 *
 * The token is shown once, at issue time. Only its SHA-256 hash is stored, and
 * the settings card shows a six-character prefix so an operator can tell which
 * token is installed without seeing it again.
 */

export const API_TOKEN_PREFIX = "pw_";

export function issueApiToken(): { token: string; hash: string; prefix: string } {
  const token = `${API_TOKEN_PREFIX}${randomBytes(32).toString("base64url")}`;
  return { token, hash: hashToken(token), prefix: token.slice(0, 9) };
}

export function bearerToken(request: Request): string | null {
  const header = request.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match ? match[1].trim() : null;
}

/**
 * Verify a bearer token against the stored hash.
 *
 * `null` means "not this project's token". The comparison is constant-time
 * because an equality check that returns early leaks the length of the shared
 * prefix, which is the one thing a token hash comparison must not do.
 */
export async function tokenAuthorizesProject(
  request: Request,
  store: IntegrationStore,
): Promise<boolean> {
  const token = bearerToken(request);
  if (!token || !token.startsWith(API_TOKEN_PREFIX)) return false;
  const settings = await store.getSettings();
  if (!settings.apiTokenHash) return false;
  return tokenMatches(token, settings.apiTokenHash);
}
