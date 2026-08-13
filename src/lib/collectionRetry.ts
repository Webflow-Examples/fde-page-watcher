import type { CollectionJob } from "./types";

export const COLLECTION_JOB_STALE_AFTER_MS = 30 * 60 * 1000;
export const EVIDENCE_RETRY_INTERVAL_HOURS = 3;
export const EVIDENCE_RETRY_DELAY = `${EVIDENCE_RETRY_INTERVAL_HOURS} hours`;
export const EVIDENCE_RETRY_INTERVAL_MS = EVIDENCE_RETRY_INTERVAL_HOURS * 60 * 60 * 1000;
export const EVIDENCE_RETRY_MAX_CYCLES = 8;
export const EVIDENCE_RETRY_GRACE_MS = 2 * 60 * 60 * 1000;
/** Prevent a manual watchlist run from starting every PSI Workflow at once. */
export const BATCH_COLLECTION_STAGGER_MINUTES = 2;
/** PSI attempts inside one Workflow are deliberately paced to avoid burst amplification. */
export const PSI_ATTEMPT_SPACING = "2 minutes";

/** A sleeping Workflow stays authoritative until its scheduled retry plus a recovery grace period. */
export function collectionJobIsStale(job: CollectionJob, now = new Date()): boolean {
  const updatedAt = Date.parse(job.updatedAt);
  if (!Number.isFinite(updatedAt)) return true;
  if (job.state !== "waiting_for_evidence") {
    return now.getTime() - updatedAt > COLLECTION_JOB_STALE_AFTER_MS;
  }

  const nextRetryAt = job.nextRetryAt ? Date.parse(job.nextRetryAt) : Number.NaN;
  const retryDeadline = Number.isFinite(nextRetryAt)
    ? nextRetryAt + EVIDENCE_RETRY_GRACE_MS
    : updatedAt + EVIDENCE_RETRY_INTERVAL_MS + EVIDENCE_RETRY_GRACE_MS;
  return now.getTime() > retryDeadline;
}

export function evidenceRetryAt(now = new Date()): string {
  return new Date(now.getTime() + EVIDENCE_RETRY_INTERVAL_MS).toISOString();
}
