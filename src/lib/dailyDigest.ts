import { collectionInstant, collectionLocalDateTime, collectionOffsets, normalizeCollectionSchedule } from "./collectionSchedule";
import { effectivePerformanceThresholds } from "./performanceThresholds";
import { mediansOf, pageHasPersistentRegression } from "./scoring";
import { CATEGORIES } from "./types";
import type { AppState, DailyAlertDigest, PerformanceThresholds, Strategy, WatchPage } from "./types";
import { isPageActivelyMonitored } from "./watchCapacity";
import { buildDailyDigestWebhookPayload, postWebhook } from "./webhook";
import type { DigestWebhookPage, WebhookDelivery } from "./webhook";

const ACTIVE_JOB_STATES = new Set(["queued", "dispatching", "running", "waiting_for_evidence"]);
const CLAIM_WINDOW_MS = 5 * 60 * 1000;
const MAX_RETAINED_DIGESTS = 30;

interface DigestDataStore {
  getState(): Promise<AppState>;
  updateState(mutate: (state: AppState) => void | Promise<void>): Promise<AppState>;
}

function alertStrategies(page: WatchPage, thresholds: PerformanceThresholds): Strategy[] {
  const candidates: Strategy[] = thresholds.devicePolicy === "preferred"
    ? ["mobile"]
    : ["mobile", "desktop"];
  const regressing = candidates.filter((strategy) => pageHasPersistentRegression(page, strategy, thresholds));
  if (thresholds.devicePolicy === "both") return regressing.length === candidates.length ? candidates : [];
  return regressing;
}

function affectedCategories(
  page: WatchPage,
  strategies: Strategy[],
  thresholds: PerformanceThresholds,
): string[] {
  if (!page.baseline) return [];
  return CATEGORIES.flatMap((category) => {
    const affected = strategies.some((strategy) => {
      const baseline = mediansOf(page.baseline![strategy]);
      const current = page.current[strategy][category.key];
      return baseline[category.key] - current >= thresholds.regression
        && current < thresholds.regressionFloor;
    });
    return affected ? [category.label] : [];
  });
}

export function digestAttentionPages(state: AppState): DigestWebhookPage[] {
  return state.pages.flatMap((page) => {
    if (!isPageActivelyMonitored(page) || !page.baseline) return [];
    const thresholds = effectivePerformanceThresholds(state.performanceThresholds, page);
    const devices = alertStrategies(page, thresholds);
    const categories = affectedCategories(page, devices, thresholds);
    if (!categories.length) return [];
    return [{
      title: page.title,
      url: page.url,
      status: "regressing" as const,
      categories,
      devices,
    }];
  }).sort((left, right) => left.title.localeCompare(right.title));
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

/** Claim and deliver every ready scheduled digest; failed sends remain retryable. */
export async function processDailyDigests(
  dataStore: DigestDataStore,
  now = new Date(),
  alertFn: typeof postWebhook = postWebhook,
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
      buildDailyDigestWebhookPayload(digestAttentionPages(snapshot), claimed.cohortId),
    );
    await finishDailyDigest(dataStore, claimed, delivery, now);
    processed += 1;
    if (!delivery.sent) return processed;
  }
}
