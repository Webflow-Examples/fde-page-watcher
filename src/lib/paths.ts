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
 * list links here, the digest links here, and a link sent three weeks ago
 * resolves here. Two spellings of it would be two places for a route change to
 * be missed, and the digest is the reader least able to notice — a broken link
 * in an email is discovered by the person who followed it.
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

/**
 * The same address from outside the app, where a relative link is no use.
 *
 * `normalizeBasePath` deliberately reduces an absolute URL to its pathname,
 * which is right for a link rendered inside a document already served from that
 * origin and wrong for one in an email. This keeps the origin when there is one
 * and degrades to a root-relative path when there is not, so a deployment that
 * has not been told its own public URL sends links that are wrong in a visible
 * way rather than links that silently point at the mail client.
 */
export function absoluteUrl(appUrl: string, path: string): string {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  const base = appUrl.trim().replace(/\/+$/, "");
  if (!base) return normalizedPath;
  return `${base}${normalizedPath}`;
}
