export interface AccessDecision {
  allowed: boolean;
  status?: 401 | 503;
  message?: string;
}

function sameValue(left: string, right: string): boolean {
  const length = Math.max(left.length, right.length);
  let difference = left.length ^ right.length;
  for (let index = 0; index < length; index += 1) {
    difference |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0);
  }
  return difference === 0;
}

/** Webflow Cloud mount paths are public, so production uses an app-owned
 * HTTP Basic boundary. Credentials stay server-side in secret env vars. */
export function evaluateAppAccess(
  authorization: string | null,
  config: { nodeEnv?: string; username?: string; password?: string } = {},
): AccessDecision {
  const nodeEnv = config.nodeEnv ?? process.env.NODE_ENV;
  if (nodeEnv !== "production") return { allowed: true };

  const username = config.username ?? process.env.FDE_ACCESS_USERNAME;
  const password = config.password ?? process.env.FDE_ACCESS_PASSWORD;
  if (!username || !password) {
    return { allowed: false, status: 503, message: "Production access protection is not configured" };
  }
  if (!authorization?.startsWith("Basic ")) return { allowed: false, status: 401, message: "Authentication required" };
  try {
    const decoded = atob(authorization.slice(6));
    const separator = decoded.indexOf(":");
    const suppliedUser = separator >= 0 ? decoded.slice(0, separator) : decoded;
    const suppliedPassword = separator >= 0 ? decoded.slice(separator + 1) : "";
    if (sameValue(suppliedUser, username) && sameValue(suppliedPassword, password)) return { allowed: true };
  } catch {
    // Malformed Basic credentials are handled as an ordinary denial.
  }
  return { allowed: false, status: 401, message: "Invalid credentials" };
}

export function evaluateCronAccess(
  authorization: string | null,
  config: { nodeEnv?: string; secret?: string } = {},
): AccessDecision {
  const nodeEnv = config.nodeEnv ?? process.env.NODE_ENV;
  const secret = config.secret ?? process.env.CRON_SECRET;
  if (!secret) {
    return nodeEnv === "development"
      ? { allowed: true }
      : { allowed: false, status: 503, message: "CRON_SECRET is required outside development" };
  }
  return sameValue(authorization ?? "", `Bearer ${secret}`)
    ? { allowed: true }
    : { allowed: false, status: 401, message: "Unauthorized" };
}
