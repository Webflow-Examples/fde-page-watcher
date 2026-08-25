import { DESTINATION_PATH } from "./vocabulary";

export function normalizeBasePath(value: string | undefined): string {
  let trimmed = value?.trim();
  if (!trimmed || trimmed === "/") return "";
  if (/^https?:\/\//i.test(trimmed)) {
    try {
      trimmed = new URL(trimmed).pathname;
    } catch {
      return "";
    }
  }
  return `/${trimmed.replace(/^\/+|\/+$/g, "")}`;
}

export function withBasePath(basePath: string, path: string): string {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${normalizeBasePath(basePath)}${normalizedPath}` || "/";
}

/* ── The case address ─────────────────────────────────────────── */

/**
 * Where one case lives, from the app root.
 *
 * The one statement of a case's address, which is what this function is for: the
 * list links here, the page detail links here, and a link sent three weeks ago
 * resolves here. Two spellings of it would be two places for a route change to
 * be missed.
 *
 * The address is the case's own id and nothing else. Not a queue: a queue is a
 * filter over states, and states change, so `/issues?queue=decide` sends the
 * reader to whatever is in Decide today, which on any day but the first is not
 * what the digest was about.
 */
export function casePath(caseId: string): string {
  return `${DESTINATION_PATH.issues}/${encodeURIComponent(caseId)}`;
}

/** The same address, inside the app, with the deployment's base path on it. */
export function caseHref(basePath: string, caseId: string): string {
  return withBasePath(basePath, casePath(caseId));
}
