import { collectionInstant, collectionLocalDateTime, collectionOffsets, normalizeCollectionSchedule } from "./collectionSchedule";
import { buildDigest, digestSiteOf, type Digest } from "./digest";
import { DEFAULT_DIGEST_CADENCE } from "./digestCadence";
import { issueCasesFrom } from "./issue-cases";
import { normalizePerformanceThresholds } from "./performanceThresholds";
import type { AppState, DailyAlertDigest } from "./types";
import { isPageActivelyMonitored } from "./watchCapacity";
import { buildDailyDigestWebhookPayload, postWebhook } from "./webhook";
import type { WebhookDelivery } from "./webhook";

const ACTIVE_JOB_STATES = new Set(["queued", "dispatching", "running", "waiting_for_evidence"]);
const CLAIM_WINDOW_MS = 5 * 60 * 1000;
const MAX_RETAINED_DIGESTS = 30;

interface DigestDataStore {
  getState(): Promise<AppState>;
  updateState(mutate: (state: AppState) => void | Promise<void>): Promise<AppState>;
}

/**
 * The digest for one settled cohort.
 *
 * Composed from the state the run left behind rather than accumulated as the run
 * goes, so a digest built twice for the same cohort says the same thing, and a
 * retry after a failed send does not report a different night. It is built
 * whether or not there is anything in it: a quiet run has a digest that says so,
 * which is the only reason an absent message can mean an absent run.
 */
export function digestFor(state: AppState, date: string, appUrl: string): Digest {
  return buildDigest({
    site: digestSiteOf(state),
    date,
    // The cadence the digest is actually sent on. S8 makes it a setting and
    // passes the stored value here; until it does, a persisted field would be a
    // slot with nothing writing to it, which rule 15 says is not a slot.
    cadence: DEFAULT_DIGEST_CADENCE,
    cases: issueCasesFrom(state),
    pages: state.pages,
    thresholds: normalizePerformanceThresholds(state.performanceThresholds),
    ...(state.collectionSchedule ? { schedule: state.collectionSchedule } : {}),
    appUrl,
  });
}

export function dailyDigestCohortId(state: AppState, now: Date): string {
  const schedule = normalizeCollectionSchedule(state.collectionSchedule);
  const local = collectionLocalDateTime(now, schedule.timeZone);
  const date = local?.dateKey ?? now.toISOString().slice(0, 10);
  return `nightly:${date}`;
}

function shiftDateKey(value: string, days: number): string {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

/** Snapshot the latest cohort only after its configured page-collection window has closed. */
export async function ensureScheduledDailyDigest(dataStore: DigestDataStore, now = new Date()): Promise<boolean> {
  let ensured = false;
  await dataStore.updateState((state) => {
    const activePages = state.pages.filter(isPageActivelyMonitored);
    if (!activePages.length) return;
    const schedule = normalizeCollectionSchedule(state.collectionSchedule);
    const localDate = collectionLocalDateTime(now, schedule.timeZone)?.dateKey ?? now.toISOString().slice(0, 10);
    const maxOffset = Math.max(...collectionOffsets(state.pages).values(), 0);
    const todayWindowEnd = collectionInstant(schedule, localDate, maxOffset);
    const cohortDate = now.getTime() >= todayWindowEnd.getTime()
      ? localDate
      : shiftDateKey(localDate, -1);
    const cohortWindowEnd = collectionInstant(schedule, cohortDate, maxOffset);
    if (now.getTime() < cohortWindowEnd.getTime()) return;
    ensureDailyDigest(state, `nightly:${cohortDate}`, activePages.map((page) => page.id), now);
    ensured = true;
  });
  return ensured;
}

export function ensureDailyDigest(
  state: AppState,
  cohortId: string,
  expectedPageIds: string[],
  now: Date,
): DailyAlertDigest {
  state.alertDigests = state.alertDigests ?? [];
  const existing = state.alertDigests.find((digest) => digest.cohortId === cohortId);
  if (existing) return existing;
  const digest: DailyAlertDigest = {
    cohortId,
    date: cohortId.startsWith("nightly:") ? cohortId.slice("nightly:".length) : now.toISOString().slice(0, 10),
    expectedPageIds: [...new Set(expectedPageIds)],
    createdAt: now.toISOString(),
    attempts: 0,
  };
  state.alertDigests.push(digest);
  state.alertDigests = state.alertDigests.slice(-MAX_RETAINED_DIGESTS);
  return digest;
}

function digestReady(state: AppState, digest: DailyAlertDigest): boolean {
  if (digest.completedAt) return false;
  const cohortJobs = (state.jobs ?? []).filter((job) => job.cohortId === digest.cohortId);
  if (cohortJobs.some((job) => ACTIVE_JOB_STATES.has(job.state))) return false;
  return digest.expectedPageIds.every((pageId) => {
    const page = state.pages.find((candidate) => candidate.id === pageId);
    if (!page || !isPageActivelyMonitored(page)) return true;
    return cohortJobs.some((job) => job.pageId === pageId && !ACTIVE_JOB_STATES.has(job.state));
  });
}

async function claimDailyDigest(dataStore: DigestDataStore, now: Date): Promise<DailyAlertDigest | null> {
  let claimed: DailyAlertDigest | null = null;
  await dataStore.updateState((state) => {
    const candidates = [...(state.alertDigests ?? [])].sort((left, right) => left.date.localeCompare(right.date));
    for (const digest of candidates) {
      if (!digestReady(state, digest)) continue;
      if (digest.retryAfterISO && Date.parse(digest.retryAfterISO) > now.getTime()) continue;
      if (digest.claimedAt && now.getTime() - Date.parse(digest.claimedAt) <= CLAIM_WINDOW_MS) continue;
      digest.claimedAt = now.toISOString();
      digest.lastAttemptAt = now.toISOString();
      digest.attempts += 1;
      claimed = structuredClone(digest);
      break;
    }
  });
  return claimed;
}

function configuredWebhookUrl(state: AppState): string | null | undefined {
  return state.alertWebhookUrl;
}

async function finishDailyDigest(
  dataStore: DigestDataStore,
  claimed: DailyAlertDigest,
  delivery: WebhookDelivery | null,
  now: Date,
): Promise<void> {
  await dataStore.updateState((state) => {
    const digest = (state.alertDigests ?? []).find((candidate) => candidate.cohortId === claimed.cohortId);
    if (!digest || digest.completedAt || digest.claimedAt !== claimed.claimedAt) return;
    delete digest.claimedAt;
    digest.lastHttpStatus = delivery?.status;
    digest.lastError = delivery && !delivery.sent ? delivery.error ?? "Webhook delivery failed" : undefined;
    digest.retryAfterISO = delivery?.retryAfterSeconds === undefined
      ? undefined
      : new Date(now.getTime() + delivery.retryAfterSeconds * 1000).toISOString();
    if (delivery === null || delivery.sent) {
      digest.completedAt = now.toISOString();
      if (delivery?.sent) digest.sentAt = now.toISOString();
      delete digest.lastError;
      delete digest.retryAfterISO;
    }
  });
}

export interface ProcessDigestOptions {
  /**
   * The app's public URL, so the links in the message work from a mail client.
   *
   * Absent produces root-relative links, which is visibly broken rather than
   * quietly wrong. See `DigestInput.appUrl`.
   */
  appUrl?: string;
}

/**
 * Claim and deliver every ready cohort digest; failed sends remain retryable.
 *
 * One message per settled cohort, whatever it found. There is no branch here on
 * whether the digest has anything in it, and that absence is the feature: a run
 * that found nothing sends a message saying so, which is what makes a missing
 * message mean a missing run rather than a quiet night.
 *
 * The single reason a claimed digest completes without a send is that no
 * delivery endpoint is configured — nothing to send it to. It is still built and
 * still marked covered, so the record of what the run found does not depend on
 * whether anyone was told.
 */
export async function processDailyDigests(
  dataStore: DigestDataStore,
  now = new Date(),
  alertFn: typeof postWebhook = postWebhook,
  options: ProcessDigestOptions = {},
): Promise<number> {
  let processed = 0;
  while (true) {
    const claimed = await claimDailyDigest(dataStore, now);
    if (!claimed) return processed;
    const snapshot = await dataStore.getState();
    const webhookUrl = configuredWebhookUrl(snapshot);
    if (!webhookUrl) {
      await finishDailyDigest(dataStore, claimed, null, now);
      processed += 1;
      continue;
    }
    const delivery = await alertFn(
      webhookUrl,
      buildDailyDigestWebhookPayload(
        digestFor(snapshot, claimed.date, options.appUrl ?? ""),
        claimed.cohortId,
      ),
    );
    await finishDailyDigest(dataStore, claimed, delivery, now);
    processed += 1;
    if (!delivery.sent) return processed;
  }
}
