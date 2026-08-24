/**
 * Structured telemetry for external agent-audit operations.
 *
 * One event per provider operation, carrying only fields that are safe to keep
 * indefinitely: a bare hostname, an outcome, counts, and timings. Query
 * strings, credentials, authorization headers, and provider response bodies are
 * never accepted by the event builder, so they cannot reach a log by accident.
 *
 * Counters are split by lifetime. Origin coverage describes stored state and is
 * derived on demand; run counters accumulate within a single refresh or
 * verification and describe what that run spent.
 */

/** The provider operations worth distinguishing in an operator log. */
export type OraOperation =
  | "cached-read"
  | "full-scan"
  | "poll"
  | "selective-checks"
  | "persist";

export interface OraOperationEvent {
  operation: OraOperation;
  tenant: string;
  /** Bare hostname. Never a full URL. */
  host: string;
  /** Outcome classification, e.g. "result", "rate-limited", "provider-error". */
  status: string;
  httpStatus?: number;
  /** True when the provider answered from its own freshness window. */
  servedFromCache?: boolean;
  resultAgeSeconds?: number;
  /** Checks scanned or re-verified, depending on the operation. */
  checkCount?: number;
  durationMs?: number;
  retryAfterSeconds?: number;
  providerErrorCode?: string;
}

/** Reduce any target to a bare hostname, discarding path, query, and credentials. */
export function safeOraHost(target: string): string {
  try {
    return new URL(target).hostname || "unknown";
  } catch {
    return "unknown";
  }
}

const URL_PATTERN = /https?:\/\/\S+/gi;

function safeText(value: string, maxLength = 120): string {
  return value.replace(URL_PATTERN, "[url]").slice(0, maxLength);
}

/**
 * Serialize one provider operation as a structured log line.
 *
 * Every string field is stripped of anything URL-shaped before it is written,
 * because provider error prose routinely embeds the scanned URL.
 */
export function oraOperationLogEvent(event: OraOperationEvent): string {
  return JSON.stringify({
    message: "External agent audit provider operation",
    provider: "ora",
    operation: event.operation,
    tenant: safeText(event.tenant, 160),
    host: safeOraHost(`https://${event.host.replace(/^https?:\/\//, "")}`),
    status: safeText(event.status, 60),
    ...(event.httpStatus === undefined ? {} : { httpStatus: event.httpStatus }),
    ...(event.servedFromCache === undefined ? {} : { servedFromCache: event.servedFromCache }),
    ...(event.resultAgeSeconds === undefined ? {} : { resultAgeSeconds: event.resultAgeSeconds }),
    ...(event.checkCount === undefined ? {} : { checkCount: event.checkCount }),
    ...(event.durationMs === undefined ? {} : { durationMs: Math.round(event.durationMs) }),
    ...(event.retryAfterSeconds === undefined ? {} : { retryAfterSeconds: event.retryAfterSeconds }),
    ...(event.providerErrorCode ? { providerErrorCode: safeText(event.providerErrorCode, 80) } : {}),
  });
}

/** What one refresh or verification run spent and produced. */
export interface OraRunCounters {
  cachedReads: number;
  /** Cached reads that returned a usable stored result. */
  cacheHits: number;
  scansAttempted: number;
  scansSucceeded: number;
  scansRateLimited: number;
  verificationsResolved: number;
  verificationsReturned: number;
  /** Verifications the provider could not confirm either way. */
  verificationsUnconfirmed: number;
  /** Payloads that were not the documented audit envelope. */
  contractFailures: number;
}

export function emptyOraRunCounters(): OraRunCounters {
  return {
    cachedReads: 0,
    cacheHits: 0,
    scansAttempted: 0,
    scansSucceeded: 0,
    scansRateLimited: 0,
    verificationsResolved: 0,
    verificationsReturned: 0,
    verificationsUnconfirmed: 0,
    contractFailures: 0,
  };
}

/**
 * Share of cached reads that avoided a live scan. Null rather than zero when no
 * read happened, so an idle run does not look like a total cache miss.
 */
export function oraCacheHitRatio(counters: OraRunCounters): number | null {
  if (counters.cachedReads === 0) return null;
  return Math.round((counters.cacheHits / counters.cachedReads) * 100) / 100;
}

/** Operator summary for one run. Counts only; nothing provider-authored. */
export function oraRunLogEvent(
  tenant: string,
  counters: OraRunCounters,
  extra: { operation: "refresh" | "verify"; origins?: number } = { operation: "refresh" },
): string {
  return JSON.stringify({
    message: "External agent audit run counters",
    provider: "ora",
    operation: extra.operation,
    tenant: safeText(tenant, 160),
    ...(extra.origins === undefined ? {} : { origins: extra.origins }),
    ...counters,
    cacheHitRatio: oraCacheHitRatio(counters),
  });
}
