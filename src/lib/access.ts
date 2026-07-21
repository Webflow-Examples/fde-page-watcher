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
