/**
 * User-triggered external agent-audit refresh.
 *
 * Coordinates three things that stay separate elsewhere: the project's consent
 * record, Ora's network client, and the audit store. Nothing here runs on a
 * schedule and nothing here participates in a normal collection — a refresh is
 * always an explicit request.
 *
 * Four properties this module is responsible for:
 *   1. No outbound request happens unless the project has explicitly consented.
 *   2. Only origins already configured as watched pages can be submitted, so a
 *      caller cannot use the endpoint to scan an arbitrary domain.
 *   3. Work is deduplicated by origin, so a second watched page on the same
 *      origin reuses one reading instead of scanning twice.
 *   4. A quota or provider failure records the failure and leaves the last
 *      successful audit in place.
 */

import { isPageActivelyMonitored } from "../src/lib/watchCapacity";
import {
  normalizeOraTarget,
  oraAvailabilityFromOutcome,
  OraTargetError,
  ORA_DEFAULT_MAX_AGE_SECONDS,
  parseOraAuditResponse,
  type OraResponseOutcome,
} from "../src/lib/ora";
import type {
  ExternalAgentAuditAvailability,
  ExternalAgentAuditStatus,
} from "../src/lib/agentAudit";
import { createFdeStore, type FdeStoreBindings } from "./dataStore";
import {
  externalAgentAuditReportKey,
  persistExternalAgentAudit,
  readExternalAgentAudits,
  recordExternalAgentAuditStatus,
} from "./ora";
import {
  getCachedOraAudit,
  OraTransportError,
  scanOraOrigin,
  type OraClientOptions,
} from "./oraClient";

/** Public scan quota is shared per Worker egress IP, so stay conservative. */
const MAX_CONCURRENCY = 2;

/**
 * How long a `pending` status blocks a fresh attempt on the same origin. Long
 * enough to cover a scan plus its polling budget, short enough that a Worker
 * that died mid-scan does not wedge the origin.
 */
export const ORA_IN_FLIGHT_WINDOW_MS = 5 * 60 * 1000;

export type RefreshSkipReason =
  | "not-consented"
  | "project-archived"
  | "no-watched-origins"
  | "origin-not-watched"
  | "page-not-found"
  | "unsupported-target"
  | "in-progress"
  | "cooling-down";

export interface OriginRefreshOutcome {
  origin: string;
  status: ExternalAgentAuditAvailability | "skipped";
  /** Why the origin was skipped, when it was. */
  reason?: RefreshSkipReason;
  scannedAt?: string;
  /** True when Ora answered from its own freshness window, consuming no quota. */
  servedFromCache?: boolean;
  /** True when a live scan was requested. */
  scanned?: boolean;
  errorCode?: string;
}

export interface ExternalAgentAuditRefreshResult {
  ok: boolean;
  tenant: string;
  consented: boolean;
  origins: number;
  available: number;
  pending: number;
  rateLimited: number;
  errors: number;
  skipped: number;
  results: OriginRefreshOutcome[];
  /** Set when the whole request was refused rather than attempted per origin. */
  refusedReason?: RefreshSkipReason;
}

/** `now` is a `Date` here, while the client takes a clock function. */
export interface ExternalAgentAuditRefreshOptions
  extends Pick<OraClientOptions, "fetchFn" | "sleep"> {
  /** Refresh only the origin behind this watched page. */
  pageId?: string;
  /** Refresh only this origin. Must already be a watched origin. */
  origin?: string;
  force?: boolean;
  maxAgeSeconds?: number;
  now?: Date;
}

function emptyResult(
  tenant: string,
  consented: boolean,
  refusedReason?: RefreshSkipReason,
): ExternalAgentAuditRefreshResult {
  return {
    ok: !refusedReason,
    tenant,
    consented,
    origins: 0,
    available: 0,
    pending: 0,
    rateLimited: 0,
    errors: 0,
    skipped: 0,
    results: [],
    ...(refusedReason ? { refusedReason } : {}),
  };
}

function safeError(error: unknown): { code: string; message: string } {
  if (error instanceof OraTargetError) {
    return { code: error.code.toUpperCase().replace(/-/g, "_"), message: error.message };
  }
  if (error instanceof OraTransportError) {
    return { code: "TRANSPORT", message: error.message.slice(0, 300) };
  }
  return {
    code: error instanceof Error ? error.name : "UNKNOWN",
    // Provider prose can carry URLs; keep it short and never log a raw body.
    message: (error instanceof Error ? error.message : String(error)).slice(0, 300),
  };
}

async function mapConcurrent<T, R>(
  values: T[],
  limit: number,
  callback: (value: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(values.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, values.length) }, async () => {
    while (cursor < values.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await callback(values[index]);
    }
  });
  await Promise.all(workers);
  return results;
}

/** True when an existing reading is new enough that a live scan is unnecessary. */
function isFresh(scannedAt: string, now: number, maxAgeSeconds: number): boolean {
  const parsed = Date.parse(scannedAt);
  return Number.isFinite(parsed) && now - parsed < maxAgeSeconds * 1000;
}

/**
 * A prior status can defer a new attempt: a scan already running on this origin,
 * or a provider cooldown we were explicitly told to respect.
 */
function deferralFor(
  status: ExternalAgentAuditStatus | null,
  now: number,
  force: boolean,
): RefreshSkipReason | null {
  if (!status || force) return null;
  if (status.nextEligibleAt) {
    const eligible = Date.parse(status.nextEligibleAt);
    if (Number.isFinite(eligible) && eligible > now) return "cooling-down";
  }
  if (status.status === "pending") {
    const attempted = Date.parse(status.lastAttemptedAt);
    if (Number.isFinite(attempted) && now - attempted < ORA_IN_FLIGHT_WINDOW_MS) return "in-progress";
  }
  return null;
}

function cooldownIso(outcome: OraResponseOutcome, now: number): string | undefined {
  if (outcome.kind !== "rate-limited" || outcome.retryAfterSeconds === undefined) return undefined;
  return new Date(now + outcome.retryAfterSeconds * 1000).toISOString();
}

/** Refresh the external audit for one or more watched origins. */
export async function refreshExternalAgentAudits(
  env: FdeStoreBindings & { ORA_SCAN_API_KEY?: string },
  tenant: string,
  options: ExternalAgentAuditRefreshOptions = {},
): Promise<ExternalAgentAuditRefreshResult> {
  const attemptedAtDate = options.now ?? new Date();
  const attemptedAt = attemptedAtDate.toISOString();
  const nowMs = attemptedAtDate.getTime();
  const maxAgeSeconds = options.maxAgeSeconds ?? ORA_DEFAULT_MAX_AGE_SECONDS;
  const force = options.force === true;

  const state = await createFdeStore(tenant, env).getState();
  if (state.projectArchivedAt) return emptyResult(tenant, false, "project-archived");
  // The consent gate is checked before any origin is resolved, so a project
  // that has not opted in cannot cause an outbound request under any input.
  if (state.externalAgentAuditEnabled !== true) {
    return emptyResult(tenant, false, "not-consented");
  }

  const monitored = state.pages.filter(isPageActivelyMonitored);
  if (options.pageId && !monitored.some((page) => page.id === options.pageId)) {
    return emptyResult(tenant, true, "page-not-found");
  }

  // Only origins behind actively monitored pages are eligible. A caller-supplied
  // origin is matched against this set rather than trusted.
  const watched = new Map<string, string>();
  const unsupported = new Set<string>();
  for (const page of monitored) {
    if (options.pageId && page.id !== options.pageId) continue;
    try {
      const { origin } = normalizeOraTarget(page.url);
      watched.set(origin, origin);
    } catch (error) {
      if (error instanceof OraTargetError) unsupported.add(page.url);
    }
  }

  let origins = [...watched.keys()];
  if (options.origin) {
    let requested: string;
    try {
      requested = normalizeOraTarget(options.origin).origin;
    } catch {
      return emptyResult(tenant, true, "unsupported-target");
    }
    if (!watched.has(requested)) return emptyResult(tenant, true, "origin-not-watched");
    origins = [requested];
  }

  if (origins.length === 0) {
    const reason: RefreshSkipReason = unsupported.size > 0 && !options.pageId
      ? "unsupported-target"
      : "no-watched-origins";
    return emptyResult(tenant, true, reason);
  }

  const existing = new Map(
    (await readExternalAgentAudits(env.DB, tenant)).map((audit) => [audit.origin, audit]),
  );
  const client: OraClientOptions = {
    ...(env.ORA_SCAN_API_KEY ? { apiKey: env.ORA_SCAN_API_KEY } : {}),
    ...(options.fetchFn ? { fetchFn: options.fetchFn } : {}),
    ...(options.sleep ? { sleep: options.sleep } : {}),
    ...(options.now ? { now: () => nowMs } : {}),
  };

  const results = await mapConcurrent(origins, MAX_CONCURRENCY, async (origin) => {
    const audit = existing.get(origin) ?? null;
    const deferral = deferralFor(audit?.status ?? null, nowMs, force);
    if (deferral) {
      return { origin, status: "skipped", reason: deferral } satisfies OriginRefreshOutcome;
    }

    try {
      // Read Ora's stored score first: a cached read consumes no scan quota.
      const cached = await getCachedOraAudit(origin, client);
      let outcome = cached;
      let scanned = false;
      const cachedIsUsable = cached.kind === "result"
        && cached.complete
        && !force
        && usableScannedAt(cached.body, nowMs, maxAgeSeconds);

      if (!cachedIsUsable) {
        const scan = await scanOraOrigin(origin, {
          ...client,
          maxAgeSeconds,
          ...(force ? { force: true } : {}),
        });
        outcome = scan.outcome;
        scanned = true;
        // A failed scan must not discard a usable cached reading.
        if (outcome.kind !== "result" && cached.kind === "result") {
          outcome = cached;
          scanned = false;
        }
      }

      if (outcome.kind !== "result") {
        const status = oraAvailabilityFromOutcome(outcome);
        const detail = outcome.kind === "not-scanned"
          ? { code: "DOMAIN_NOT_SCANNED", message: "Ora holds no stored audit for this origin" }
          : {
            code: ("code" in outcome && outcome.code) || `HTTP_${"status" in outcome ? outcome.status : "429"}`,
            message: ("message" in outcome && outcome.message) || "Ora could not complete the audit",
          };
        await recordExternalAgentAuditStatus(env, {
          tenant,
          provider: "ora",
          origin,
          status,
          attemptedAt,
          ...(cooldownIso(outcome, nowMs) ? { nextEligibleAt: cooldownIso(outcome, nowMs) } : {}),
          errorCode: detail.code,
          errorMessage: detail.message.slice(0, 300),
        });
        return {
          origin,
          status,
          scanned,
          errorCode: detail.code,
        } satisfies OriginRefreshOutcome;
      }

      const rawReportKeyBase = parseOraAuditResponse(outcome.body, {
        origin,
        rawReportKey: "pending",
        fetchedAt: attemptedAt,
        ...(outcome.complete ? {} : { forcePartial: true }),
      });
      const rawReportKey = await externalAgentAuditReportKey(
        tenant,
        "ora",
        origin,
        rawReportKeyBase.scannedAt,
      );
      const snapshot = { ...rawReportKeyBase, rawReportKey };
      const persisted = await persistExternalAgentAudit(env, tenant, snapshot, {
        rawResponse: outcome.body,
        request: { origin, maxAgeSeconds, force, servedFromCache: !scanned },
        attemptedAt,
      });
      return {
        origin,
        status: persisted.status,
        scannedAt: snapshot.scannedAt,
        servedFromCache: snapshot.servedFromCache === true || !scanned,
        scanned,
      } satisfies OriginRefreshOutcome;
    } catch (error) {
      const safe = safeError(error);
      const status: ExternalAgentAuditAvailability =
        error instanceof OraTargetError ? "error" : "unavailable";
      await recordExternalAgentAuditStatus(env, {
        tenant,
        provider: "ora",
        origin,
        status,
        attemptedAt,
        errorCode: safe.code,
        errorMessage: safe.message,
      });
      console.error(JSON.stringify({
        message: "External agent audit refresh failed",
        tenant,
        provider: "ora",
        // Hostname only: never the full URL, query string, or provider body.
        host: safeHost(origin),
        errorCode: safe.code,
      }));
      return { origin, status, errorCode: safe.code } satisfies OriginRefreshOutcome;
    }
  });

  const count = (status: OriginRefreshOutcome["status"]) =>
    results.filter((result) => result.status === status).length;
  return {
    ok: count("error") === 0 && count("unavailable") === 0,
    tenant,
    consented: true,
    origins: origins.length,
    available: count("available"),
    pending: count("pending"),
    rateLimited: count("rate-limited"),
    errors: count("error") + count("unavailable") + count("not-found"),
    skipped: count("skipped"),
    results,
  };
}

function safeHost(origin: string): string {
  try {
    return new URL(origin).hostname;
  } catch {
    return "invalid";
  }
}

/** Whether a cached provider body is recent enough to skip a live scan. */
function usableScannedAt(body: unknown, now: number, maxAgeSeconds: number): boolean {
  const value = body && typeof body === "object" && !Array.isArray(body)
    ? (body as { scannedAt?: unknown }).scannedAt
    : undefined;
  return typeof value === "string" && isFresh(value, now, maxAgeSeconds);
}
