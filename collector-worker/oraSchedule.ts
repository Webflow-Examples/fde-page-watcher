/**
 * Scheduled external agent-audit refresh.
 *
 * Runs weekly, origin-scoped, and strictly bounded. Page Watch operates
 * keyless by default, drawing on a public scan quota that is shared per Worker
 * egress IP with every user-triggered refresh — so a scheduled run takes a
 * deliberately small slice and yields the rest to people who are actually
 * waiting on an answer.
 *
 * Two invariants this module exists to hold:
 *   1. A scheduled refresh never blocks, delays, or changes the outcome of the
 *      normal Page Watch collection workflow. It is a separate cron with its
 *      own status record, exactly like the weekly CrUX job.
 *   2. Nothing runs without both the deployment gate and the project's own
 *      consent, which `refreshExternalAgentAudits` re-checks per tenant.
 */

import { refreshExternalAgentAudits, type ExternalAgentAuditRefreshResult } from "./oraRefresh";
import type { FdeStoreBindings } from "./dataStore";

export const ORA_REFRESH_CRON = "45 6 * * 3";
export const ORA_SCHEDULER_STATUS_KEY = "scheduler/ora-latest.json";

/**
 * Origins one scheduled run may refresh across all tenants.
 *
 * Ora's keyless public budget is 30 scans per rolling 24h per IP. A weekly run
 * capped at 8 leaves the large majority of the budget for user-triggered
 * refreshes and verifications on the same day. Raise this only alongside a
 * partner key, which lifts the limit entirely.
 */
export const ORA_SCHEDULED_ORIGIN_CAP = 8;

export interface OraScheduleEnvironment extends FdeStoreBindings {
  ORA_SCAN_ENABLED?: string;
  ORA_SCAN_API_KEY?: string;
}

export interface OraScheduleTenantResult {
  tenant: string;
  origins: number;
  available: number;
  pending: number;
  rateLimited: number;
  errors: number;
  skipped: number;
  refusedReason?: string;
}

export interface OraScheduleResult {
  ok: boolean;
  trigger: "scheduled" | "manual";
  observedAt: string;
  enabled: boolean;
  /** Origins refreshed across every tenant in this run. */
  originsRefreshed: number;
  /** Origins left for a later run because the cap was reached. */
  originsDeferred: number;
  cap: number;
  keyed: boolean;
  tenants: OraScheduleTenantResult[];
}

function summarize(
  tenant: string,
  result: ExternalAgentAuditRefreshResult,
): OraScheduleTenantResult {
  return {
    tenant,
    origins: result.origins,
    available: result.available,
    pending: result.pending,
    rateLimited: result.rateLimited,
    errors: result.errors,
    skipped: result.skipped,
    ...(result.refusedReason ? { refusedReason: result.refusedReason } : {}),
  };
}

/**
 * Refresh external audits across tenants, stopping at the origin cap.
 *
 * Tenants are processed in the order given and a partially-served tenant is
 * reported honestly through `originsDeferred` rather than appearing complete.
 */
export async function runScheduledOraRefresh(
  env: OraScheduleEnvironment,
  tenants: string[],
  options: {
    fetchFn?: typeof fetch;
    sleep?: (milliseconds: number) => Promise<void>;
    now?: Date;
    trigger?: "scheduled" | "manual";
    cap?: number;
  } = {},
): Promise<OraScheduleResult> {
  const now = options.now ?? new Date();
  const observedAt = now.toISOString();
  const cap = options.cap ?? ORA_SCHEDULED_ORIGIN_CAP;
  const base: OraScheduleResult = {
    ok: true,
    trigger: options.trigger ?? "scheduled",
    observedAt,
    enabled: env.ORA_SCAN_ENABLED === "true",
    originsRefreshed: 0,
    originsDeferred: 0,
    cap,
    keyed: !!env.ORA_SCAN_API_KEY,
    tenants: [],
  };
  // The deployment gate is checked once, before any tenant state is read.
  if (!base.enabled) return base;

  const results: OraScheduleTenantResult[] = [];
  let refreshed = 0;
  let deferred = 0;

  for (const tenant of tenants) {
    if (refreshed >= cap) {
      deferred += 1;
      continue;
    }
    const result = await refreshExternalAgentAudits(env, tenant, {
      ...(options.fetchFn ? { fetchFn: options.fetchFn } : {}),
      ...(options.sleep ? { sleep: options.sleep } : {}),
      now,
    });
    // Only origins that actually reached the provider count against the cap;
    // a deferred or skipped origin spent no quota.
    const spent = result.results.filter((item) => item.status !== "skipped").length;
    refreshed += spent;
    if (refreshed > cap) deferred += refreshed - cap;
    results.push(summarize(tenant, result));
  }

  return {
    ...base,
    ok: results.every((item) => item.errors === 0),
    originsRefreshed: Math.min(refreshed, cap),
    originsDeferred: deferred,
    tenants: results,
  };
}

/**
 * One structured operator event per scheduled run. Carries counts and safe
 * hostnames only — never a query string, credential, provider body, or
 * authorization header.
 */
export function oraScheduleLogEvent(result: OraScheduleResult): string {
  const totals = result.tenants.reduce(
    (sum, tenant) => ({
      origins: sum.origins + tenant.origins,
      available: sum.available + tenant.available,
      pending: sum.pending + tenant.pending,
      rateLimited: sum.rateLimited + tenant.rateLimited,
      errors: sum.errors + tenant.errors,
      skipped: sum.skipped + tenant.skipped,
    }),
    { origins: 0, available: 0, pending: 0, rateLimited: 0, errors: 0, skipped: 0 },
  );
  return JSON.stringify({
    message: "External agent audit scheduled refresh",
    operation: "scheduled-refresh",
    trigger: result.trigger,
    provider: "ora",
    observedAt: result.observedAt,
    enabled: result.enabled,
    keyed: result.keyed,
    cap: result.cap,
    tenants: result.tenants.length,
    originsRefreshed: result.originsRefreshed,
    originsDeferred: result.originsDeferred,
    ...totals,
  });
}

export interface OraOperatorCounters {
  originsCurrent: number;
  originsStale: number;
  originsMissing: number;
  rateLimited: number;
  errors: number;
}

/**
 * Operator view of external audit coverage. Counts origins, not pages, because
 * an audit is origin-scoped.
 */
export function oraOperatorCounters(
  audits: Array<{ status: { status: string; latestScannedAt?: string } | null }>,
  now: number,
  freshWindowMs = 7 * 24 * 60 * 60 * 1000,
): OraOperatorCounters {
  const counters: OraOperatorCounters = {
    originsCurrent: 0,
    originsStale: 0,
    originsMissing: 0,
    rateLimited: 0,
    errors: 0,
  };
  for (const audit of audits) {
    const status = audit.status;
    if (status?.status === "rate-limited") counters.rateLimited += 1;
    if (status?.status === "unavailable" || status?.status === "error") counters.errors += 1;
    const scanned = status?.latestScannedAt ? Date.parse(status.latestScannedAt) : Number.NaN;
    if (!Number.isFinite(scanned)) counters.originsMissing += 1;
    else if (now - scanned <= freshWindowMs) counters.originsCurrent += 1;
    else counters.originsStale += 1;
  }
  return counters;
}
