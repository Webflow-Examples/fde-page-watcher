/**
 * Presentation helpers for external agent-audit evidence.
 *
 * Pure and provider-neutral. Two rules this module exists to enforce:
 *
 *   1. Provider readings are never composited. The essentials score and the
 *      provider's own score are separate numbers on separate scales, and
 *      neither is combined with Page Watch's local pass percentage.
 *   2. Provider ordering is preserved. Ora pre-sorts its actionable checks
 *      (critical access first, then required, then worst) and documents that
 *      the list should be rendered in order, so nothing here re-ranks it.
 */

import type {
  ExternalAgentAuditAvailability,
  ExternalAgentAuditSnapshot,
  ExternalAgentCheckResult,
  ExternalAgentFinding,
  ExternalAgentOriginAudit,
} from "./agentAudit";
import { latestExternalAgentSnapshot } from "./agentAudit";
import { isAuditableOraTarget, normalizeOraTarget } from "./ora";

/** An audit is stale for monitoring purposes once it passes a day old. */
export const EXTERNAL_AGENT_FRESH_WINDOW_MS = 24 * 60 * 60 * 1000;

/** The origin-scoped audit covering a watched page, if one has been stored. */
export function externalAuditForPage(
  audits: ExternalAgentOriginAudit[],
  pageUrl: string,
): ExternalAgentOriginAudit | null {
  let origin: string;
  try {
    origin = normalizeOraTarget(pageUrl).origin;
  } catch {
    return null;
  }
  return audits.find((audit) => audit.origin === origin) ?? null;
}

/** True when this page's origin can be audited externally at all. */
export function pageSupportsExternalAudit(pageUrl: string): boolean {
  return isAuditableOraTarget(pageUrl);
}

export interface ExternalAuditFreshness {
  /** Milliseconds since the provider scanned, or null when never scanned. */
  ageMs: number | null;
  stale: boolean;
}

export function externalAuditFreshness(
  snapshot: ExternalAgentAuditSnapshot | null,
  now: number = Date.now(),
): ExternalAuditFreshness {
  if (!snapshot) return { ageMs: null, stale: true };
  const scanned = Date.parse(snapshot.scannedAt);
  if (!Number.isFinite(scanned)) return { ageMs: null, stale: true };
  const ageMs = Math.max(0, now - scanned);
  return { ageMs, stale: ageMs > EXTERNAL_AGENT_FRESH_WINDOW_MS };
}

/** Short relative age, e.g. "scanned 3 hours ago". */
export function externalAuditAgeLabel(
  snapshot: ExternalAgentAuditSnapshot | null,
  now: number = Date.now(),
): string {
  const { ageMs } = externalAuditFreshness(snapshot, now);
  if (ageMs === null) return "never scanned";
  const minutes = Math.floor(ageMs / 60_000);
  if (minutes < 1) return "scanned just now";
  if (minutes < 60) return `scanned ${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `scanned ${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  return `scanned ${days} day${days === 1 ? "" : "s"} ago`;
}

/**
 * Plain-language provider state. Deliberately describes the provider, never the
 * site: a quota or transport problem must never read as a failing check.
 */
export function externalAgentStatusLabel(status: ExternalAgentAuditAvailability): string {
  switch (status) {
    case "available":
      return "Audit complete";
    case "pending":
      return "Audit still running";
    case "not-found":
      return "No audit stored yet";
    case "rate-limited":
      return "Provider limit reached — the last audit is still shown";
    case "unavailable":
      return "Provider unavailable — the last audit is still shown";
    default:
      return "Request rejected";
  }
}

/** Copy for one check result. Each state stays visibly distinct. */
export function externalAgentResultLabel(result: ExternalAgentCheckResult): string {
  switch (result) {
    case "pass":
      return "Passing";
    case "partial":
      return "Partial";
    case "failed":
      return "Failing";
    case "not-applicable":
      return "Not applicable";
    default:
      return "Not determined";
  }
}

/** Whether a result reflects the site at all, or only the provider's reach. */
export function externalAgentResultIsDetermined(result: ExternalAgentCheckResult): boolean {
  return result !== "unavailable";
}

/**
 * Findings in the provider's own priority order: everything the provider listed
 * as an issue first, in its order, then remaining actionable checks, then the
 * rest. Nothing is re-scored or re-sorted by Page Watch.
 */
export function orderedExternalFindings(
  snapshot: ExternalAgentAuditSnapshot,
): ExternalAgentFinding[] {
  const byId = new Map<string, ExternalAgentFinding[]>();
  for (const finding of snapshot.findings) {
    const bucket = byId.get(finding.providerCheckId);
    if (bucket) bucket.push(finding);
    else byId.set(finding.providerCheckId, [finding]);
  }
  const ordered: ExternalAgentFinding[] = [];
  const taken = new Set<ExternalAgentFinding>();
  for (const id of snapshot.essentials?.issues ?? []) {
    for (const finding of byId.get(id) ?? []) {
      ordered.push(finding);
      taken.add(finding);
    }
  }
  const rank: Record<ExternalAgentCheckResult, number> = {
    failed: 0,
    partial: 1,
    unavailable: 2,
    pass: 3,
    "not-applicable": 4,
  };
  const remaining = snapshot.findings.filter((finding) => !taken.has(finding));
  // Stable partition by result only; within a result the provider's order holds.
  for (const group of [0, 1, 2, 3, 4]) {
    for (const finding of remaining) {
      if (rank[finding.result] === group) ordered.push(finding);
    }
  }
  return ordered;
}

export interface ExternalAgentCounts {
  failed: number;
  partial: number;
  pass: number;
  notApplicable: number;
  unavailable: number;
}

export function externalAgentCounts(snapshot: ExternalAgentAuditSnapshot): ExternalAgentCounts {
  const counts: ExternalAgentCounts = {
    failed: 0,
    partial: 0,
    pass: 0,
    notApplicable: 0,
    unavailable: 0,
  };
  for (const finding of snapshot.findings) {
    if (finding.result === "failed") counts.failed += 1;
    else if (finding.result === "partial") counts.partial += 1;
    else if (finding.result === "pass") counts.pass += 1;
    else if (finding.result === "not-applicable") counts.notApplicable += 1;
    else counts.unavailable += 1;
  }
  return counts;
}

export interface ExternalAgentSourceReading {
  /** Present only when the provider could score the essentials model. */
  essentialsScore: number | null;
  /** Provider-owned band copy; render verbatim. */
  essentialsLabel: string | null;
  /** The provider's own 0-100 score. Advanced evidence only. */
  providerScore: number | null;
  providerGrade: string | null;
  ageLabel: string;
  stale: boolean;
  partial: boolean;
  reportUrl: string | null;
  contractVersion: string | null;
  counts: ExternalAgentCounts | null;
}

/**
 * Flatten one origin audit into the values a source card shows. Returns nulls
 * rather than zeros wherever the provider gave no reading, so "could not
 * evaluate" never renders as a real score.
 */
export function externalAgentSourceReading(
  audit: ExternalAgentOriginAudit | null,
  now: number = Date.now(),
): ExternalAgentSourceReading | null {
  if (!audit) return null;
  const snapshot = latestExternalAgentSnapshot(audit);
  if (!snapshot) {
    return {
      essentialsScore: null,
      essentialsLabel: null,
      providerScore: null,
      providerGrade: null,
      ageLabel: "never scanned",
      stale: true,
      partial: false,
      reportUrl: null,
      contractVersion: null,
      counts: null,
    };
  }
  const freshness = externalAuditFreshness(snapshot, now);
  return {
    essentialsScore: snapshot.essentials?.score ?? null,
    essentialsLabel: snapshot.essentials?.label ?? null,
    providerScore: snapshot.score,
    providerGrade: snapshot.grade ?? null,
    ageLabel: externalAuditAgeLabel(snapshot, now),
    stale: freshness.stale,
    partial: snapshot.status === "partial",
    reportUrl: snapshot.reportUrl ?? null,
    contractVersion: snapshot.contractVersion ?? null,
    counts: externalAgentCounts(snapshot),
  };
}
