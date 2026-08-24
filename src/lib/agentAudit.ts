/**
 * Provider-neutral external agent-audit evidence.
 *
 * This module is deliberately isolated from `AgentCheck`, `AgentReadinessSnapshot`,
 * `Night`, Kitesurf, Lighthouse, and CrUX. Page Watch's own scanner records a
 * boolean per page-level check; an external auditor reports pass/partial/failed/
 * not-applicable/unavailable per origin-level check, with applicability and
 * remediation attached. Forcing one model into the other would either lose the
 * provider's applicability evidence or silently rewrite historical local scores,
 * so the two stay side by side and are only reconciled at a higher layer.
 *
 * Nothing here participates in page status, collection completion, or any
 * arithmetic that mixes provider readings together.
 */

export type ExternalAgentProvider = "ora";

/**
 * `partial` is a real result and must never be collapsed into pass or fail.
 * `not-applicable` is provider-supplied evidence, distinct from a user's Ignore
 * policy decision. `unavailable` means the provider could not determine a result
 * — including a check that had not finished when the scan was read.
 */
export type ExternalAgentCheckResult =
  | "pass"
  | "partial"
  | "failed"
  | "not-applicable"
  | "unavailable";

export type ExternalAgentTier =
  | "essential"
  | "recommended"
  | "emerging"
  | "unclassified";

export type ExternalAgentAuditAvailability =
  | "available"
  | "pending"
  | "not-found"
  | "rate-limited"
  | "unavailable"
  | "error";

/** One normalized provider check reading. */
export interface ExternalAgentFinding {
  provider: ExternalAgentProvider;
  /** Stable provider check id. Route and dedupe on this, never on `name`. */
  providerCheckId: string;
  name: string;
  /** Provider grouping (Ora layer id), retained for attribution only. */
  category?: string;
  /**
   * The tier Page Watch reads. Ora carries two tiers per check — one in its
   * audit model and one in the essentials model — and documents that they
   * diverge by design, so the essentials tier wins when present and both
   * originals stay below.
   */
  tier: ExternalAgentTier;
  auditTier?: ExternalAgentTier;
  essentialsTier?: ExternalAgentTier;
  /** Upside-only in the provider's audit model: passing adds, failing never subtracts. */
  bonus?: boolean;
  /** Upside-only in the essentials model. Independent of `bonus`. */
  essentialsBonus?: boolean;
  result: ExternalAgentCheckResult;
  /** Raw provider status, so `pending` stays distinguishable from `error`. */
  providerStatus: string;
  details?: string;
  recommendation?: string;
  /** Provider's reason a check does not apply. Evidence, not a user policy. */
  applicability?: string;
  maturity?: string;
  specUrl?: string;
  /** Estimated uplift in the provider's own 0-100 score. */
  estScoreGain?: number;
  /** Estimated uplift in essentials points. NOT comparable with `estScoreGain`. */
  essentialsGain?: number;
  /** Essentials earned share of this check, 0-1. */
  fraction?: number;
  /** Page Watch issue family, set only where a clear semantic equivalent exists. */
  issueKey?: string;
}

export interface ExternalAgentScoreBucket {
  earned: number;
  available: number;
  passing: number;
  total: number;
}

/** The website-focused essentials reading of the same scan. */
export interface ExternalAgentEssentials {
  score: number | null;
  /** Provider-owned copy for the score band; render verbatim. */
  label: string;
  essential: ExternalAgentScoreBucket;
  recommended: ExternalAgentScoreBucket;
  bonusPoints: number;
  /** Provider-sorted actionable check ids. Render in order; do not re-rank. */
  issues: string[];
}

/** One origin-scoped audit reading, compact enough to index in D1. */
export interface ExternalAgentAuditSnapshot {
  schemaVersion: 1;
  /** Provider contract version this reading was parsed against. */
  contractVersion?: string;
  provider: "ora";
  /** Page Watch's normalized origin. The storage key. */
  origin: string;
  /** The target actually submitted to the provider. */
  target: string;
  /** `partial` means the provider had not resolved every check yet. */
  status: "available" | "partial";
  scannedAt: string;
  fetchedAt: string;
  /** Null when the provider could not evaluate the target at all. */
  score: number | null;
  grade?: string;
  essentials?: ExternalAgentEssentials;
  findings: ExternalAgentFinding[];
  /** Provider report deep link. Authenticated surfaces only. */
  reportUrl?: string;
  /** R2 key for the untruncated provider payload. */
  rawReportKey: string;
  /** Provider check ids still resolving when this reading was taken. */
  pendingChecks?: string[];
  /** True when the provider served a stored result instead of a live scan. */
  servedFromCache?: boolean;
  resultAgeSeconds?: number;
}

/** Provider-operation state for one origin, separate from any site verdict. */
export interface ExternalAgentAuditStatus {
  provider: "ora";
  origin: string;
  status: ExternalAgentAuditAvailability;
  latestScannedAt?: string;
  lastAttemptedAt: string;
  lastSucceededAt?: string;
  nextEligibleAt?: string;
  errorCode?: string;
  errorMessage?: string;
}

/** Read model: one entry per provider/origin pair. */
export interface ExternalAgentOriginAudit {
  provider: ExternalAgentProvider;
  origin: string;
  status: ExternalAgentAuditStatus | null;
  /** Oldest first, matching the CrUX evidence reader. */
  snapshots: ExternalAgentAuditSnapshot[];
}

/**
 * Compact snapshots retained per origin. Matches the order of magnitude of
 * `CRUX_RETENTION_PERIODS`; raw R2 reports follow the bucket lifecycle policy.
 */
export const EXTERNAL_AGENT_AUDIT_RETENTION_SNAPSHOTS = 60;

/** Snapshots returned per origin by the read model. */
export const EXTERNAL_AGENT_AUDIT_READ_LIMIT = 12;

/**
 * Read queries shared by every storage adapter, so the column list and order
 * cannot drift between the collector, the Workers store, and the data plane.
 * Both take a single `tenant` binding.
 */
export const EXTERNAL_AGENT_AUDIT_SNAPSHOT_QUERY =
  "SELECT provider, origin, scanned_at, fetched_at, contract_version, score, " +
  "essentials_score, summary_json, raw_report_key FROM agent_audit_snapshots " +
  "WHERE tenant = ? ORDER BY provider, origin, scanned_at DESC";

export const EXTERNAL_AGENT_AUDIT_STATUS_QUERY =
  "SELECT provider, origin, status, latest_scanned_at, last_attempted_at, " +
  "last_succeeded_at, next_eligible_at, error_code, error_message FROM agent_audit_status " +
  "WHERE tenant = ? ORDER BY provider, origin";

export interface ExternalAgentAuditSnapshotRow {
  provider: ExternalAgentProvider;
  origin: string;
  scanned_at: string;
  fetched_at: string;
  contract_version: string | null;
  score: number | null;
  essentials_score: number | null;
  summary_json: string;
  raw_report_key: string;
}

export interface ExternalAgentAuditStatusRow {
  provider: ExternalAgentProvider;
  origin: string;
  status: ExternalAgentAuditAvailability;
  latest_scanned_at: string | null;
  last_attempted_at: string;
  last_succeeded_at: string | null;
  next_eligible_at: string | null;
  error_code: string | null;
  error_message: string | null;
}

/**
 * The part of a snapshot persisted as `summary_json`. `origin`, `scannedAt`,
 * and the two scores live in their own indexed columns, so they are not
 * duplicated here.
 */
export type ExternalAgentAuditSummary = Omit<
  ExternalAgentAuditSnapshot,
  "origin" | "scannedAt" | "fetchedAt" | "contractVersion" | "score" | "rawReportKey"
>;

/**
 * Project a snapshot down to what `summary_json` stores. Built field by field
 * so adding a snapshot field is a deliberate decision about whether it belongs
 * in the compact row; the read-model round-trip test fails if one is dropped.
 */
export function externalAgentAuditSummary(
  snapshot: ExternalAgentAuditSnapshot,
): ExternalAgentAuditSummary {
  return {
    schemaVersion: snapshot.schemaVersion,
    provider: snapshot.provider,
    target: snapshot.target,
    status: snapshot.status,
    findings: snapshot.findings,
    ...(snapshot.grade === undefined ? {} : { grade: snapshot.grade }),
    ...(snapshot.essentials === undefined ? {} : { essentials: snapshot.essentials }),
    ...(snapshot.reportUrl === undefined ? {} : { reportUrl: snapshot.reportUrl }),
    ...(snapshot.pendingChecks === undefined ? {} : { pendingChecks: snapshot.pendingChecks }),
    ...(snapshot.servedFromCache === undefined ? {} : { servedFromCache: snapshot.servedFromCache }),
    ...(snapshot.resultAgeSeconds === undefined
      ? {}
      : { resultAgeSeconds: snapshot.resultAgeSeconds }),
  };
}

function parsedSummary(json: string): ExternalAgentAuditSummary | null {
  try {
    const value = JSON.parse(json) as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const summary = value as Partial<ExternalAgentAuditSummary>;
    return Array.isArray(summary.findings) ? summary as ExternalAgentAuditSummary : null;
  } catch {
    return null;
  }
}

/**
 * Convert storage rows into the tenant-safe read model. A snapshot whose
 * summary JSON is unreadable is skipped rather than surfaced half-built, so a
 * corrupt row can never present itself as a real provider reading.
 */
export function externalAgentAuditsFromRows(
  snapshotRows: ExternalAgentAuditSnapshotRow[],
  statusRows: ExternalAgentAuditStatusRow[],
  maxSnapshots = EXTERNAL_AGENT_AUDIT_READ_LIMIT,
): ExternalAgentOriginAudit[] {
  const audits = new Map<string, ExternalAgentOriginAudit>();
  const keyFor = (provider: string, origin: string) => `${provider}:${origin}`;

  for (const row of statusRows) {
    audits.set(keyFor(row.provider, row.origin), {
      provider: row.provider,
      origin: row.origin,
      status: {
        provider: "ora",
        origin: row.origin,
        status: row.status,
        ...(row.latest_scanned_at ? { latestScannedAt: row.latest_scanned_at } : {}),
        lastAttemptedAt: row.last_attempted_at,
        ...(row.last_succeeded_at ? { lastSucceededAt: row.last_succeeded_at } : {}),
        ...(row.next_eligible_at ? { nextEligibleAt: row.next_eligible_at } : {}),
        ...(row.error_code ? { errorCode: row.error_code } : {}),
        ...(row.error_message ? { errorMessage: row.error_message } : {}),
      },
      snapshots: [],
    });
  }

  for (const row of snapshotRows) {
    const key = keyFor(row.provider, row.origin);
    const item = audits.get(key) ?? {
      provider: row.provider,
      origin: row.origin,
      status: null,
      snapshots: [],
    };
    const summary = parsedSummary(row.summary_json);
    if (summary && item.snapshots.length < maxSnapshots) {
      item.snapshots.push({
        ...summary,
        schemaVersion: 1,
        provider: "ora",
        origin: row.origin,
        scannedAt: row.scanned_at,
        fetchedAt: row.fetched_at,
        ...(row.contract_version ? { contractVersion: row.contract_version } : {}),
        score: row.score,
        rawReportKey: row.raw_report_key,
      });
    }
    audits.set(key, item);
  }

  return [...audits.values()].map((item) => ({
    ...item,
    snapshots: [...item.snapshots].sort((a, b) => a.scannedAt.localeCompare(b.scannedAt)),
  }));
}

export function latestExternalAgentSnapshot(
  audit: ExternalAgentOriginAudit,
): ExternalAgentAuditSnapshot | null {
  return audit.snapshots.reduce<ExternalAgentAuditSnapshot | null>(
    (latest, snapshot) => !latest || snapshot.scannedAt > latest.scannedAt ? snapshot : latest,
    null,
  );
}

/** Findings a user could act on. Passing and not-applicable checks are excluded. */
export function actionableExternalAgentFindings(
  snapshot: ExternalAgentAuditSnapshot,
): ExternalAgentFinding[] {
  return snapshot.findings.filter((finding) =>
    finding.result === "failed" || finding.result === "partial");
}
