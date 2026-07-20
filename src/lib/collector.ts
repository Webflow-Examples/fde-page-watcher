import { getStore } from "./store";
import type { DataStore } from "./store";
import { collect } from "./psi";
import { scan } from "./agentReadiness";
import { costBand } from "./cost";
import { postAlert, postFollowup } from "./slack";
import type { SlackDelivery } from "./slack";
import { mediansOf, DROP_THRESHOLD } from "./scoring";
import { parseMarkerDate, shortDate } from "./ui";
import { CATEGORIES, STRATEGIES } from "./types";
import type { AppState, FollowUp, Night, Rec, Strategy, StrategyScores, WatchPage } from "./types";
import { markRunFinished, requestPageRun } from "./mutations";

type CollectFn = typeof collect;
type ScanFn = typeof scan;

export interface CollectorDependencies {
  dataStore?: DataStore;
  collectFn?: CollectFn;
  scanFn?: ScanFn;
  alertFn?: typeof postAlert;
  followupFn?: typeof postFollowup;
  now?: () => Date;
  nightlyConcurrency?: number;
  runIdFactory?: () => string;
}

function deps(options: CollectorDependencies) {
  return {
    dataStore: options.dataStore ?? getStore(),
    collectFn: options.collectFn ?? collect,
    scanFn: options.scanFn ?? scan,
    alertFn: options.alertFn ?? postAlert,
    followupFn: options.followupFn ?? postFollowup,
    now: options.now ?? (() => new Date()),
  };
}

/**
 * Execute a previously-reserved run. Network collection completes before the
 * atomic append re-reads authoritative state, assigns the history index/report
 * key, and settles the matching run id.
 */
export async function executePageRun(pageId: string, runId: string, options: CollectorDependencies = {}): Promise<AppState> {
  const d = deps(options);
  const snapshot = await d.dataStore.getState();
  const page = snapshot.pages.find((item) => item.id === pageId);
  if (!page) throw new Error(`executePageRun: page ${pageId} not found`);
  if (page.runState !== "running" || page.runId !== runId) return snapshot;

  const [stratResults, freshAgent] = await Promise.all([
    Promise.all(STRATEGIES.map(async (strategy) => ({ strategy, result: await d.collectFn(page.url, strategy) }))),
    d.scanFn(page.url),
  ]);

  const scores = {} as StrategyScores;
  const samples: Partial<Record<Strategy, number>> = {};
  const reportStrategies: Record<string, unknown> = {};
  let opportunities: { id: string; title: string; savingsMs: number }[] = [];
  for (const { strategy, result } of stratResults) {
    scores[strategy] = result.scores;
    samples[strategy] = result.sampleSize;
    reportStrategies[strategy] = { sampleSize: result.sampleSize, scores: result.scores, runs: result.raws };
    if (strategy === "mobile") opportunities = result.opportunities;
  }
  const sampleSize = Math.min(...STRATEGIES.map((strategy) => samples[strategy] ?? 0));
  const completedAt = d.now();
  const input: Omit<Night, "i" | "runId" | "rawReportKey"> = {
    date: shortDate(completedAt),
    iso: completedAt.toISOString(),
    scores,
    samples,
    sampleSize,
    agent: freshAgent,
  };

  const appended = await d.dataStore.appendNight(pageId, runId, input, { strategies: reportStrategies });
  const committedPage = appended.state.pages.find((item) => item.id === pageId);
  if (!committedPage?.history.some((night) => night.runId === runId)) return appended.state;

  // Recommendation insertion is its own short atomic commit. Re-running this
  // after a crash is safe because keys/titles are deduplicated authoritatively.
  const next = await insertRecommendations(d.dataStore, pageId, opportunities, completedAt);
  const finalPage = next.pages.find((item) => item.id === pageId);
  if (finalPage) await maybeAlert(finalPage, d.alertFn);
  return next;
}

/** Reserve and synchronously execute one run (used by nightly and tests). */
export async function runPage(pageId: string, options: CollectorDependencies = {}): Promise<AppState> {
  const d = deps(options);
  const request = await requestPageRun(pageId, {
    dataStore: d.dataStore,
    runId: options.runIdFactory?.(),
    now: d.now(),
  });
  if (!request.queued) return request.state;
  try {
    return await executePageRun(pageId, request.runId, options);
  } catch (error) {
    await markRunFinished(pageId, request.runId, errorText(error), d.dataStore);
    throw error;
  }
}

async function insertRecommendations(
  dataStore: DataStore,
  pageId: string,
  opportunities: { id: string; title: string; savingsMs: number }[],
  now: Date,
): Promise<AppState> {
  return dataStore.updateState((state) => {
    const page = state.pages.find((item) => item.id === pageId);
    if (!page) return;
    const added = shortDate(now);
    for (const opportunity of opportunities.slice(0, 6)) {
      const key = `${pageId}:${opportunity.id}`;
      const title = opportunity.title.trim().toLowerCase();
      if (state.recs.some((rec) => rec.key === key || (rec.pageId === pageId && rec.title.trim().toLowerCase() === title))) continue;
      const rec: Rec = {
        key,
        pageId,
        pageTitle: page.title,
        url: page.url,
        id: opportunity.id,
        title: opportunity.title,
        category: "Performance",
        savings: `${(opportunity.savingsMs / 1000).toFixed(1)} s`,
        estTime: costBand(`${opportunity.id} ${opportunity.title}`),
        status: "inbox",
        taskStatus: "todo",
        added,
        doneDate: null,
      };
      state.recs.push(rec);
    }
  });
}

async function maybeAlert(page: WatchPage, alertFn: typeof postAlert): Promise<void> {
  if (page.status !== "degraded" || !page.baseline) return;
  const base = mediansOf(page.baseline.mobile);
  const affected = CATEGORIES.filter((category) => base[category.key] - page.current.mobile[category.key] >= DROP_THRESHOLD).map((category) => category.label);
  if (affected.length) await alertFn(page.title, page.url, affected);
}

/** Capture a real baseline, then atomically apply it to the current page. */
export async function captureBaseline(pageId: string, options: CollectorDependencies = {}): Promise<AppState> {
  const d = deps(options);
  const snapshot = await d.dataStore.getState();
  const page = snapshot.pages.find((item) => item.id === pageId);
  if (!page) throw new Error(`captureBaseline: page ${pageId} not found`);

  const baseline = {} as StrategyScores;
  const results = await Promise.all(STRATEGIES.map(async (strategy) => ({ strategy, result: await d.collectFn(page.url, strategy) })));
  for (const { strategy, result } of results) baseline[strategy] = result.scores;
  const capturedAt = d.now().toISOString();
  return d.dataStore.updateState((state) => {
    const authoritative = state.pages.find((item) => item.id === pageId);
    if (!authoritative) throw new Error(`captureBaseline: page ${pageId} was removed during collection`);
    authoritative.baseline = baseline;
    authoritative.baselineCapturedAt = capturedAt;
    authoritative.current = {
      mobile: mediansOf(baseline.mobile),
      desktop: mediansOf(baseline.desktop),
    };
    // The newly captured snapshot is the comparison anchor. Classification of
    // later ordinary runs is enabled from this point forward.
    authoritative.status = "healthy";
  });
}

/** Nightly job with bounded page concurrency and priority-first start order. */
export async function runNightly(options: CollectorDependencies = {}): Promise<{ ran: number; failed: string[]; coalesced: string[] }> {
  const d = deps(options);
  const snapshot = await d.dataStore.getState();
  const ordered = [...snapshot.pages].sort((a, b) => (a.flag === "priority" ? 0 : 1) - (b.flag === "priority" ? 0 : 1));
  const configured = options.nightlyConcurrency ?? Number(process.env.NIGHTLY_PAGE_CONCURRENCY ?? 2);
  const concurrency = Math.max(1, Math.min(4, Number.isFinite(configured) ? Math.floor(configured) : 2));
  const failed: string[] = [];
  const coalesced: string[] = [];
  let cursor = 0;
  let ran = 0;

  const worker = async () => {
    while (true) {
      const index = cursor++;
      const page = ordered[index];
      if (!page) return;
      try {
        const requested = await requestPageRun(page.id, {
          dataStore: d.dataStore,
          runId: options.runIdFactory?.(),
          now: d.now(),
        });
        if (!requested.queued) {
          coalesced.push(page.id);
          continue;
        }
        await executePageRun(page.id, requested.runId, options);
        ran += 1;
      } catch (error) {
        console.error(`[collector] ${page.id} failed`, error);
        const state = await d.dataStore.getState();
        const active = state.pages.find((item) => item.id === page.id);
        if (active?.runState === "running" && active.runId) {
          await markRunFinished(page.id, active.runId, errorText(error), d.dataStore);
        }
        failed.push(page.id);
      }
    }
  };

  await Promise.all(Array.from({ length: Math.min(concurrency, ordered.length) }, () => worker()));
  await processFollowUps(options);
  return { ran, failed, coalesced };
}

function errorText(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 500);
}

function nightDate(night: Night): number | null {
  const value = night.iso ?? night.date;
  return parseMarkerDate(value)?.getTime() ?? null;
}

export function beforeMarkerNight(history: Night[], markerDate: string): { night: Night | null; substituted: boolean } {
  const markerAt = parseMarkerDate(markerDate)?.getTime();
  if (markerAt === undefined) return { night: null, substituted: false };
  const expected = markerAt - 24 * 60 * 60 * 1000;
  const earlier = history
    .map((night) => ({ night, at: nightDate(night) }))
    .filter((item): item is { night: Night; at: number } => item.at !== null && item.at < markerAt)
    .sort((a, b) => b.at - a.at || b.night.i - a.night.i);
  const exact = earlier.find((item) => new Date(item.at).toISOString().slice(0, 10) === new Date(expected).toISOString().slice(0, 10));
  if (exact) return { night: exact.night, substituted: false };
  return { night: earlier[0]?.night ?? null, substituted: earlier.length > 0 };
}

const FOLLOW_UP_CLAIM_WINDOW_MS = 5 * 60 * 1000;

async function claimFollowUp(dataStore: DataStore, id: string, now: Date): Promise<FollowUp | null> {
  let claimed: FollowUp | null = null;
  await dataStore.updateState((state) => {
    const item = (state.followUps ?? []).find((followUp) => followUp.id === id);
    if (!item || item.sent || Date.parse(item.dueISO) > now.getTime()) return;
    if (item.retryAfterISO && Date.parse(item.retryAfterISO) > now.getTime()) return;
    if (item.lastAttemptISO && now.getTime() - Date.parse(item.lastAttemptISO) < FOLLOW_UP_CLAIM_WINDOW_MS) return;
    item.attempts = (item.attempts ?? 0) + 1;
    item.lastAttemptISO = now.toISOString();
    claimed = structuredClone(item);
  });
  return claimed;
}

async function finishFollowUp(dataStore: DataStore, id: string, delivery: SlackDelivery, attemptedAt: Date): Promise<void> {
  await dataStore.updateState((state) => {
    const item = (state.followUps ?? []).find((followUp) => followUp.id === id);
    if (!item || item.sent || item.lastAttemptISO !== attemptedAt.toISOString()) return;
    item.lastHttpStatus = delivery.status;
    item.lastError = delivery.sent ? undefined : errorText(delivery.error ?? "Slack delivery failed");
    item.retryAfterISO = delivery.retryAfterSeconds === undefined
      ? undefined
      : new Date(attemptedAt.getTime() + delivery.retryAfterSeconds * 1000).toISOString();
    if (delivery.sent) item.sent = true;
  });
}

/** Fire due follow-ups without holding the atomic state lock across Slack I/O. */
export async function processFollowUps(options: CollectorDependencies = {}): Promise<void> {
  const d = deps(options);
  const now = d.now();
  const snapshot = await d.dataStore.getState();
  for (const candidate of snapshot.followUps ?? []) {
    if (candidate.sent || Date.parse(candidate.dueISO) > now.getTime()) continue;
    const claimed = await claimFollowUp(d.dataStore, candidate.id, now);
    if (!claimed) continue;

    const current = await d.dataStore.getState();
    const page = current.pages.find((item) => item.id === claimed.pageId);
    if (!page) {
      await finishFollowUp(d.dataStore, claimed.id, { sent: true }, now);
      continue;
    }
    const marker = page.markers.find((item) => item.id === claimed.markerId);
    const comparison = beforeMarkerNight(page.history, marker?.date ?? claimed.markerDate);
    if (!comparison.night) {
      await finishFollowUp(d.dataStore, claimed.id, { sent: false, error: "No collection exists before the marker date" }, now);
      continue;
    }
    const lines = CATEGORIES.map((category) => {
      const before = comparison.night!.scores.mobile[category.key].m;
      const after = page.current.mobile[category.key];
      const delta = after - before;
      return `${category.label}: ${before} → ${after} (${delta >= 0 ? "+" : ""}${delta})`;
    });
    if (comparison.substituted) {
      lines.unshift(`Note: no score existed for the exact night before the marker; using nearest earlier collection (${comparison.night.date}).`);
    }
    const delivery = await d.followupFn(page.title, claimed.interval, lines);
    await finishFollowUp(d.dataStore, claimed.id, delivery, now);
  }
}
