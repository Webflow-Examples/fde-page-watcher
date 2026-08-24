/**
 * Storage for external agent-readiness audit evidence.
 *
 * Mirrors the CrUX collector's split: the untruncated provider payload goes to
 * R2, a compact indexed summary goes to D1, retention is bounded, and provider
 * operation state is written separately from the reading itself.
 *
 * Phase 1 deliberately contains no network, scheduling, or scan-triggering code.
 * Nothing in this module runs during a normal collection, and nothing it writes
 * can change a page's status, a Lighthouse or CrUX reading, or whether a
 * collection is considered complete.
 */

import {
  EXTERNAL_AGENT_AUDIT_RETENTION_SNAPSHOTS,
  EXTERNAL_AGENT_AUDIT_SNAPSHOT_QUERY,
  EXTERNAL_AGENT_AUDIT_STATUS_QUERY,
  externalAgentAuditSummary,
  externalAgentAuditsFromRows,
  type ExternalAgentAuditAvailability,
  type ExternalAgentAuditSnapshot,
  type ExternalAgentAuditSnapshotRow,
  type ExternalAgentAuditStatusRow,
  type ExternalAgentOriginAudit,
} from "../src/lib/agentAudit";
import { oraOriginKeyFragment } from "../src/lib/ora";

export interface ExternalAgentAuditBindings {
  DB: D1Database;
  REPORTS: R2Bucket;
}

/**
 * Ceiling on one compact D1 summary. Provider prose is already truncated per
 * field; this is the backstop that fails loudly rather than writing an
 * unbounded row if a future contract adds far more checks.
 */
export const MAX_AGENT_AUDIT_SUMMARY_BYTES = 256 * 1024;

/** R2 prefix for raw external audit payloads. */
export const AGENT_AUDIT_REPORT_PREFIX = "agent-audits";

export class ExternalAgentAuditStorageError extends Error {
  constructor(readonly code: "summary-too-large", message: string) {
    super(message);
    this.name = "ExternalAgentAuditStorageError";
  }
}

/** `agent-audits/{tenant}/ora/{origin-hash}/{scanned-at}.json` */
export async function externalAgentAuditReportKey(
  tenant: string,
  provider: "ora",
  origin: string,
  scannedAt: string,
): Promise<string> {
  const fragment = await oraOriginKeyFragment(origin);
  const stamp = scannedAt.replace(/[:.]/g, "-");
  return `${AGENT_AUDIT_REPORT_PREFIX}/${tenant}/${provider}/${fragment}/${stamp}.json`;
}

/**
 * Serialize the compact summary, refusing anything unbounded. Called before the
 * R2 write so a rejected reading leaves no orphaned raw payload behind.
 */
function serializedSummary(snapshot: ExternalAgentAuditSnapshot): string {
  const summary = JSON.stringify(externalAgentAuditSummary(snapshot));
  const bytes = new TextEncoder().encode(summary).byteLength;
  if (bytes > MAX_AGENT_AUDIT_SUMMARY_BYTES) {
    throw new ExternalAgentAuditStorageError(
      "summary-too-large",
      `External agent audit summary is ${bytes} bytes, above the ${MAX_AGENT_AUDIT_SUMMARY_BYTES} byte limit`,
    );
  }
  return summary;
}

function snapshotStatement(
  DB: D1Database,
  tenant: string,
  snapshot: ExternalAgentAuditSnapshot,
  summary: string,
): D1PreparedStatement {
  return DB.prepare(
    "INSERT INTO agent_audit_snapshots (" +
      "tenant, provider, origin, scanned_at, fetched_at, contract_version, score, " +
      "essentials_score, summary_json, raw_report_key" +
    ") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) " +
    "ON CONFLICT(tenant, provider, origin, scanned_at) DO UPDATE SET " +
      "fetched_at = excluded.fetched_at, contract_version = excluded.contract_version, " +
      "score = excluded.score, essentials_score = excluded.essentials_score, " +
      "summary_json = excluded.summary_json, raw_report_key = excluded.raw_report_key",
  ).bind(
    tenant,
    snapshot.provider,
    snapshot.origin,
    snapshot.scannedAt,
    snapshot.fetchedAt,
    snapshot.contractVersion ?? null,
    snapshot.score,
    snapshot.essentials?.score ?? null,
    summary,
    snapshot.rawReportKey,
  );
}

export interface ExternalAgentAuditStatusInput {
  tenant: string;
  provider: "ora";
  origin: string;
  status: ExternalAgentAuditAvailability;
  attemptedAt: string;
  latestScannedAt?: string;
  succeededAt?: string;
  nextEligibleAt?: string;
  errorCode?: string;
  errorMessage?: string;
}

/**
 * Upsert provider operation state. `latest_scanned_at` and `last_succeeded_at`
 * are coalesced so a failed attempt records the failure without erasing the
 * last successful audit — a quota or transport error must leave the previous
 * reading intact.
 */
function statusStatement(
  DB: D1Database,
  input: ExternalAgentAuditStatusInput,
): D1PreparedStatement {
  return DB.prepare(
    "INSERT INTO agent_audit_status (" +
      "tenant, provider, origin, status, latest_scanned_at, last_attempted_at, " +
      "last_succeeded_at, next_eligible_at, error_code, error_message" +
    ") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) " +
    "ON CONFLICT(tenant, provider, origin) DO UPDATE SET " +
      "status = excluded.status, " +
      "latest_scanned_at = COALESCE(excluded.latest_scanned_at, agent_audit_status.latest_scanned_at), " +
      "last_attempted_at = excluded.last_attempted_at, " +
      "last_succeeded_at = COALESCE(excluded.last_succeeded_at, agent_audit_status.last_succeeded_at), " +
      "next_eligible_at = excluded.next_eligible_at, " +
      "error_code = excluded.error_code, error_message = excluded.error_message",
  ).bind(
    input.tenant,
    input.provider,
    input.origin,
    input.status,
    input.latestScannedAt ?? null,
    input.attemptedAt,
    input.succeededAt ?? null,
    input.nextEligibleAt ?? null,
    input.errorCode ?? null,
    input.errorMessage ?? null,
  );
}

/** Keep only the newest `EXTERNAL_AGENT_AUDIT_RETENTION_SNAPSHOTS` per origin. */
function retentionStatement(
  DB: D1Database,
  tenant: string,
  provider: "ora",
  origin: string,
): D1PreparedStatement {
  return DB.prepare(
    "DELETE FROM agent_audit_snapshots WHERE tenant = ? AND provider = ? AND origin = ? " +
    "AND scanned_at NOT IN (" +
      "SELECT scanned_at FROM agent_audit_snapshots " +
      "WHERE tenant = ? AND provider = ? AND origin = ? " +
      "ORDER BY scanned_at DESC LIMIT ?" +
    ")",
  ).bind(
    tenant,
    provider,
    origin,
    tenant,
    provider,
    origin,
    EXTERNAL_AGENT_AUDIT_RETENTION_SNAPSHOTS,
  );
}

/** Record a provider attempt that produced no usable reading. */
export async function recordExternalAgentAuditStatus(
  bindings: ExternalAgentAuditBindings,
  input: ExternalAgentAuditStatusInput,
): Promise<void> {
  await statusStatement(bindings.DB, input).run();
}

export interface PersistExternalAgentAuditOptions {
  /** The exact provider payload, stored untruncated in R2. */
  rawResponse: unknown;
  /** What Page Watch asked for, retained beside the response for audit trails. */
  request?: unknown;
  attemptedAt?: string;
  nextEligibleAt?: string;
}

/**
 * Write one audit reading: raw payload to R2 first, then the compact summary,
 * provider status, and retention pass to D1 in one batch. R2 leads so a D1
 * failure can never leave a summary pointing at a missing report.
 */
export async function persistExternalAgentAudit(
  bindings: ExternalAgentAuditBindings,
  tenant: string,
  snapshot: ExternalAgentAuditSnapshot,
  options: PersistExternalAgentAuditOptions,
): Promise<{ rawReportKey: string; status: ExternalAgentAuditAvailability }> {
  const attemptedAt = options.attemptedAt ?? snapshot.fetchedAt;
  const summary = serializedSummary(snapshot);
  await bindings.REPORTS.put(snapshot.rawReportKey, JSON.stringify({
    schemaVersion: 1,
    tenant,
    provider: snapshot.provider,
    origin: snapshot.origin,
    target: snapshot.target,
    contractVersion: snapshot.contractVersion,
    scannedAt: snapshot.scannedAt,
    fetchedAt: snapshot.fetchedAt,
    request: options.request,
    response: options.rawResponse,
  }), {
    httpMetadata: { contentType: "application/json" },
    customMetadata: {
      tenant,
      provider: snapshot.provider,
      origin: snapshot.origin,
      scannedAt: snapshot.scannedAt,
      status: snapshot.status,
    },
  });

  // A partial reading is a real result, but it is not a completed audit, so the
  // provider status stays `pending` until every check has resolved.
  const status: ExternalAgentAuditAvailability = snapshot.status === "available"
    ? "available"
    : "pending";

  await bindings.DB.batch([
    snapshotStatement(bindings.DB, tenant, snapshot, summary),
    statusStatement(bindings.DB, {
      tenant,
      provider: snapshot.provider,
      origin: snapshot.origin,
      status,
      attemptedAt,
      latestScannedAt: snapshot.scannedAt,
      succeededAt: attemptedAt,
      ...(options.nextEligibleAt ? { nextEligibleAt: options.nextEligibleAt } : {}),
    }),
    retentionStatement(bindings.DB, tenant, snapshot.provider, snapshot.origin),
  ]);

  return { rawReportKey: snapshot.rawReportKey, status };
}

/** Tenant-scoped read model for the data plane. Never returns raw payloads. */
export async function readExternalAgentAudits(
  DB: D1Database,
  tenant: string,
): Promise<ExternalAgentOriginAudit[]> {
  const [snapshots, statuses] = await Promise.all([
    DB.prepare(EXTERNAL_AGENT_AUDIT_SNAPSHOT_QUERY)
      .bind(tenant).all<ExternalAgentAuditSnapshotRow>(),
    DB.prepare(EXTERNAL_AGENT_AUDIT_STATUS_QUERY)
      .bind(tenant).all<ExternalAgentAuditStatusRow>(),
  ]);
  return externalAgentAuditsFromRows(snapshots.results, statuses.results);
}
