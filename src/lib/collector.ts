import { getStore } from "./store";
import type { DataStore } from "./store";
import { collect } from "./psi";
import { scan, scanPageContent } from "./agentReadiness";
import { costBand } from "./cost";
import { postFollowup } from "./slack";
import type { SlackDelivery } from "./slack";
import { postWebhook } from "./webhook";
import { dailyDigestCohortId, ensureDailyDigest, processDailyDigests } from "./dailyDigest";
import { generateText } from "./anthropic";
import { buildWatcher } from "./watcher";
import { getEnv } from "./env";
import { mediansOf, pageRangeComparison, pageRangeTrend } from "./scoring";
import { effectivePerformanceThresholds, normalizePerformanceThresholds, recommendationMeetsEvidenceThresholds } from "./performanceThresholds";
import { parseMarkerDate, shortDate } from "./ui";
import { CATEGORIES, STRATEGIES } from "./types";
import type {
  AppState,
  FollowUp,
  LighthouseCollectionQuality,
  LighthouseOpportunity,
  Night,
  Rec,
  Strategy,
  StrategyScores,
  WatchPage,
  WebflowPerformanceClassification,
} from "./types";
import { markRunFinished, requestPageRun } from "./mutations";
import { isPageActivelyMonitored } from "./watchCapacity";
import { mergeStrategyOpportunities, promotedDiagnostics } from "./diagnostics";
import { summarizePsiMeasurements } from "./psiCore";
import { classificationForPage, customerActionabilityFor, formatDiagnosticImpact, recommendationIsCustomerActionable } from "./webflowPerformance";
import { isWebflowGenerated, nativeElementApplicability, nativeElementIsDismissed, nativeRecommendationOpportunities, unavailableNativeElementScan } from "./nativeElements";
import { summarizeCulpritEvidence } from "./culpritEvidence";
import { reconcileFieldOnlyRecommendations } from "./fieldOnlyRecommendations";

type CollectFn = typeof collect;
type ScanFn = typeof scan;
type PageScanFn = typeof scanPageContent;

export interface CollectorDependencies {
  dataStore?: DataStore;
  collectFn?: CollectFn;
  scanFn?: ScanFn;
  pageScanFn?: PageScanFn;
  alertFn?: typeof postWebhook;
  followupFn?: typeof postFollowup;
  now?: () => Date;
  nightlyConcurrency?: number;
  runIdFactory?: () => string;
}

function deps(options: CollectorDependencies) {
  return {
    dataStore: options.dataStore ?? getStore(),
    collectFn: options.collectFn ?? collect,
    pageScanFn: options.pageScanFn
      ?? (options.scanFn
        ? async (url: string) => ({
          agent: await options.scanFn!(url),
          nativeElements: unavailableNativeElementScan("native element scan not supplied"),
        })
        : scanPageContent),
    alertFn: options.alertFn ?? postWebhook,
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

  const [stratResults, pageScan] = await Promise.all([
    Promise.all(STRATEGIES.map(async (strategy) => ({ strategy, result: await d.collectFn(page.url, strategy) }))),
    d.pageScanFn(page.url),
  ]);
  const freshAgent = pageScan.agent;

  const scores = {} as StrategyScores;
  const samples: Partial<Record<Strategy, number>> = {};
  const collectionQuality: Partial<Record<Strategy, LighthouseCollectionQuality>> = {};
  const reportStrategies: Record<string, unknown> = {};
  const opportunitiesByStrategy: Partial<Record<Strategy, LighthouseOpportunity[]>> = {};
  const diagnostics: Night["diagnostics"] = {};
  const culpritEvidence: Night["culpritEvidence"] = {};
  const measurementContext: Night["measurementContext"] = {};
  for (const { strategy, result } of stratResults) {
    if (result.quality?.status && result.quality.status !== "reliable") {
      throw new Error(
        `${strategy} PSI evidence is ${result.quality.status}: `
        + `${result.quality.eligibleRuns}/${result.quality.requestedRuns} warning-free runs`,
      );
    }
    scores[strategy] = result.scores;
    samples[strategy] = result.sampleSize;
    if (result.quality) collectionQuality[strategy] = result.quality;
    reportStrategies[strategy] = result;
    opportunitiesByStrategy[strategy] = result.opportunities;
    diagnostics[strategy] = promotedDiagnostics(result.findings);
    culpritEvidence[strategy] = summarizeCulpritEvidence(result.raws);
    measurementContext[strategy] = summarizePsiMeasurements(result.raws);
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
    opportunities: opportunitiesByStrategy.mobile ?? [],
    opportunitiesByStrategy,
    diagnostics,
    culpritEvidence,
    nativeElements: pageScan.nativeElements,
    collectionQuality,
    measurementContext,
  };

  const appended = await d.dataStore.appendNight(pageId, runId, input, { strategies: reportStrategies });
  const committedPage = appended.state.pages.find((item) => item.id === pageId);
  if (!committedPage?.history.some((night) => night.runId === runId)) return appended.state;

  // Recommendation insertion is its own short atomic commit. Re-running this
  // after a crash is safe because keys/titles are deduplicated authoritatively.
  await insertRecommendations(
    d.dataStore,
    pageId,
    [
      ...mergeStrategyOpportunities(opportunitiesByStrategy, diagnostics),
      ...nativeRecommendationOpportunities(pageScan.nativeElements),
    ],
    completedAt,
    { webflowGenerated: isWebflowGenerated(pageScan.nativeElements) },
  );
  return reconcileFieldOnlyRecommendations(d.dataStore, pageId, completedAt, runId);
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

export async function insertRecommendations(
  dataStore: DataStore,
  pageId: string,
  opportunities: {
    id: string;
    title: string;
    category?: string;
    savingsMs: number;
    savingsBytes?: number;
    observedRuns?: number;
    strategies?: Strategy[];
    webflow?: WebflowPerformanceClassification;
  }[],
  now: Date,
  options: { summarize?: boolean; webflowGenerated?: boolean } = {},
): Promise<AppState> {
  const snapshot = await dataStore.getState();
  const page = snapshot.pages.find((item) => item.id === pageId);
  if (!page) return snapshot;
  const thresholds = effectivePerformanceThresholds(snapshot.performanceThresholds, page);
  const added = shortDate(now);
  const actionable = opportunities.filter((opportunity) =>
    recommendationMeetsEvidenceThresholds(opportunity, thresholds)
    && (opportunity.category !== "Native elements"
      || (nativeElementApplicability(page.nativeElementControls, opportunity.id) === "included"
        && !nativeElementIsDismissed(page.nativeElementControls, opportunity.id))));
  const taskCandidates = actionable.map((opportunity) => ({
    opportunity,
    classification: classificationForPage(opportunity, options.webflowGenerated === true),
  })).filter(({ opportunity, classification }) => recommendationIsCustomerActionable({
    ...opportunity,
    webflow: classification,
  }));
  const candidates = await Promise.all(taskCandidates.slice(0, 12).map(async ({ opportunity, classification }) => {
    const rec: Rec = {
      key: `${pageId}:${opportunity.id}`,
      pageId,
      pageTitle: page.title,
      url: page.url,
      id: opportunity.id,
      strategies: opportunity.strategies,
      title: opportunity.title,
      category: opportunity.category ?? "Performance",
      webflow: classification,
      savings: formatDiagnosticImpact(opportunity),
      estTime: costBand(`${opportunity.id} ${opportunity.title}`),
      status: "inbox",
      taskStatus: "todo",
      added,
      doneDate: null,
    };
    if (options.summarize !== false) {
      const summary = await summarizeRec(rec, page);
      if (summary) rec.aiSummary = summary;
    }
    return rec;
  }));

  return dataStore.updateState((state) => {
    if (!state.pages.some((item) => item.id === pageId)) return;
    state.recs = state.recs.filter((item) => {
      if (item.pageId !== pageId || item.source === "crux-field-only") return true;
      item.webflow = classificationForPage(item, options.webflowGenerated === true);
      return customerActionabilityFor(item) !== "none";
    });
    for (const rec of candidates) {
      const title = rec.title.trim().toLowerCase();
      const existing = state.recs.find((item) =>
        item.key === rec.key || (item.pageId === pageId && item.title.trim().toLowerCase() === title));
      if (existing) {
        existing.strategies = [...new Set([...(existing.strategies ?? []), ...(rec.strategies ?? [])])];
        existing.webflow = rec.webflow;
        continue;
      }
      state.recs.push(rec);
    }
  });
}

/** Plain-English, one/two-sentence explanation of a newly-created recommendation. */
async function summarizeRec(rec: Rec, page: WatchPage): Promise<string | null> {
  const prompt = `You are writing a plain-English explanation of a Lighthouse performance recommendation for a marketing team member, not a developer.

Page: "${page.title}" (${page.url})
Recommendation: "${rec.title}"
Category: ${rec.category}
Estimated load-time savings: ${rec.savings}
Estimated effort to implement: ${rec.estTime}
Issue type: ${rec.webflow?.culpritLabel ?? "Unclassified"}
Actionability: ${rec.webflow?.remediationLabel ?? "Needs review"}
Recommended action: ${rec.webflow?.guidance ?? "Review the Lighthouse evidence before assigning an owner."}

Explain what this recommendation means and why the proposed action or workaround is worth doing, in plain terms. Do not mention a hosting platform, product team, product gap, or escalation. Reference the numbers naturally rather than restating them verbatim. Two sentences maximum. No preamble, no markdown.`;
  return generateText(prompt, { maxTokens: 150 });
}

/** The Watcher's dashboard narrative: a short, factual read of current conditions, refreshed once per nightly run. */
export async function generateWatcherNote(dataStore: DataStore, now: Date): Promise<void> {
  const [state, visitorEvidence] = await Promise.all([
    dataStore.getState(),
    dataStore.getCruxEvidence().catch(() => []),
  ]);
  const thresholds = normalizePerformanceThresholds(state.performanceThresholds);
  const w = buildWatcher(state.pages, state.recs, "desktop", 30, state.agentIgnoreDefaults, thresholds, visitorEvidence);
  const regressionDetail = state.pages.flatMap((p) => {
    if (!isPageActivelyMonitored(p)) return [];
    if (pageRangeTrend(p, "desktop", 30, effectivePerformanceThresholds(thresholds, p)) !== "regressing" || !p.baseline) return [];
    const drop = Math.abs(pageRangeComparison(p, "desktop", "perf", 30)?.delta ?? 0);
    const marker = p.markers.length ? p.markers[p.markers.length - 1].text : null;
    return [`${p.title}: dropped ${drop} performance points${marker ? ` after "${marker}"` : ""}`];
  });

  const prompt = `You are "The Watcher," an automated page-performance monitor writing a short status summary for a marketing team's dashboard.

Current desktop conditions over the last 30 days: ${w.total} monitored pages — ${w.regressing} regressions, ${w.lowPerformance} below the Performance threshold, ${w.agentGaps} with agent-readiness gaps, ${w.qualityIssues} with other Lighthouse quality issues, ${w.fieldCorroborated} with visitor issues reproduced in Lighthouse, and ${w.fieldOnly} with visitor issues Lighthouse did not reproduce.
${regressionDetail.length ? `Regressing pages:\n${regressionDetail.join("\n")}` : "No pages are currently regressing over the last 30 days."}
${w.topRec ? w.topRec.source === "crux-field-only"
    ? `Top recommendation (${w.topRec.evidenceLabel}): investigate "${w.topRec.recTitle}" on "${w.topRec.pageTitle}" because visitor evidence is outside the good range and Lighthouse did not reproduce it.`
    : `Top recommendation (${w.topRec.evidenceLabel}): on "${w.topRec.pageTitle}", "${w.topRec.recTitle}" would recover about ${w.topRec.savings} of load time.` : ""}

Write a factual, specific 2-3 sentence summary of current page conditions for this team, in a professional but direct tone (no hype, no exclamation points). Do not call pages healthy: range trend and absolute quality are separate concepts. Reference the concrete numbers above naturally. No preamble, no markdown, no headings — plain prose only.`;

  const text = await generateText(prompt, { maxTokens: 250 });
  if (!text) return;
  await dataStore.updateState((draft) => {
    draft.watcherNote = { text, generatedAt: now.toISOString(), modelVersion: 3 };
  });
}

/** Fill optional AI prose after the durable collection commit has succeeded. */
export async function enrichRecommendations(dataStore: DataStore, pageId: string): Promise<void> {
  const snapshot = await dataStore.getState();
  const page = snapshot.pages.find((item) => item.id === pageId);
  if (!page) return;
  const candidates = snapshot.recs.filter((item) => item.pageId === pageId && !item.aiSummary).slice(0, 4);
  const summaries = await Promise.all(candidates.map(async (rec) => ({ key: rec.key, text: await summarizeRec(rec, page) })));
  await dataStore.updateState((draft) => {
    for (const summary of summaries) {
      if (!summary.text) continue;
      const rec = draft.recs.find((item) => item.key === summary.key);
      if (rec && !rec.aiSummary) rec.aiSummary = summary.text;
    }
  });
}

/**
 * Where the app answers, for the links a digest sends out.
 *
 * Empty is a legal answer and produces root-relative links, which do not resolve
 * from a mail client. That is deliberate: a deployment that has not been told
 * its own address should send a link that visibly fails rather than one that
 * quietly resolves against whatever opened it.
 */
function publicAppUrl(): string {
  return getEnv("PUBLIC_APP_URL") ?? "";
}

/** Mark post-commit notification work complete and try any now-ready daily digest. */
export async function notifyCollectionJob(dataStore: DataStore, jobId: string): Promise<void> {
  const snapshot = await dataStore.getState();
  const job = (snapshot.jobs ?? []).find((item) => item.id === jobId);
  if (!job || job.state !== "succeeded" || job.notifiedAt) return;
  await dataStore.updateState((draft) => {
    const current = (draft.jobs ?? []).find((item) => item.id === jobId);
    if (current?.state === "succeeded" && !current.notifiedAt) {
      current.notifiedAt = new Date().toISOString();
      delete current.notificationError;
    }
  });
  await processDailyDigests(dataStore, undefined, undefined, { appUrl: publicAppUrl() });
}

/** Capture a real baseline, then atomically apply it to the current page. */
export async function captureBaseline(pageId: string, options: CollectorDependencies = {}): Promise<AppState> {
  const d = deps(options);
  const snapshot = await d.dataStore.getState();
  const page = snapshot.pages.find((item) => item.id === pageId);
  if (!page) throw new Error(`captureBaseline: page ${pageId} not found`);
  if (!isPageActivelyMonitored(page)) throw new Error(`captureBaseline: page ${pageId} is paused`);

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
    authoritative.status = "stable";
  });
}

/** Nightly job with bounded page concurrency and priority-first start order. */
export async function runNightly(options: CollectorDependencies = {}): Promise<{ ran: number; failed: string[]; coalesced: string[] }> {
  const d = deps(options);
  const snapshot = await d.dataStore.getState();
  const ordered = snapshot.pages
    .filter(isPageActivelyMonitored)
    .sort((a, b) => (a.flag === "priority" ? 0 : 1) - (b.flag === "priority" ? 0 : 1));
  const configured = options.nightlyConcurrency ?? Number(getEnv("NIGHTLY_PAGE_CONCURRENCY") ?? 2);
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
  await generateWatcherNote(d.dataStore, d.now());
  const digestAt = d.now();
  await d.dataStore.updateState((state) => {
    ensureDailyDigest(state, dailyDigestCohortId(state, digestAt), [], digestAt);
  });
  await processDailyDigests(d.dataStore, digestAt, d.alertFn, { appUrl: publicAppUrl() });
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
    const page = state.pages.find((candidate) => candidate.id === item.pageId);
    if (!page || !isPageActivelyMonitored(page)) return;
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
