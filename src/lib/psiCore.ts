import { CATEGORIES } from "./types";
import type {
  AggregatedLighthouseFinding,
  CategoryKey,
  LighthouseCollectionQuality,
  LighthouseOpportunity,
  LighthouseRunEvidence,
  NightScores,
  PsiMeasurementContext,
  ScoreByCategory,
  Strategy,
} from "./types";
import {
  aggregateLighthouseRunEvidence,
  extractLighthouseRunEvidence,
  lighthouseRuntimeError,
  lighthouseScores,
} from "./lighthouseEvidence";
import { median, range } from "./scoring";

const PSI_ENDPOINT = "https://www.googleapis.com/pagespeedonline/v5/runPagespeed";
export const DEFAULT_PSI_RUNS = 3;

export function normalizePsiRuns(value: unknown): number {
  const parsed = Number(value);
  return Math.max(1, Math.min(5, Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_PSI_RUNS));
}

export interface RunResult {
  scores: ScoreByCategory;
  evidence: LighthouseRunEvidence;
  raw: unknown;
  sampleKey: string;
}

export type CompactRunResult = Omit<RunResult, "raw">;

export interface CollectResult {
  schemaVersion: 2;
  scores: NightScores;
  opportunities: LighthouseOpportunity[];
  findings: AggregatedLighthouseFinding[];
  runEvidence: LighthouseRunEvidence[];
  quality: LighthouseCollectionQuality;
  sampleSize: number;
  raws: unknown[];
}

interface PsiResponse {
  error?: { code?: number; message?: string };
}

export class PsiRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "PsiRequestError";
  }
}

export class PsiResponseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PsiResponseError";
  }
}

export class PsiLighthouseRuntimeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PsiLighthouseRuntimeError";
  }
}

export type PsiFailureKind = "quota" | "target" | "transient";

/** Classify failures before deciding whether another provider request is useful. */
export function classifyPsiFailure(error: unknown): PsiFailureKind {
  if (error instanceof PsiRequestError) {
    if (error.status === 429) return "quota";
    if (error.status >= 400 && error.status < 500) return "target";
  }
  if (error instanceof PsiResponseError || error instanceof PsiLighthouseRuntimeError) return "target";
  return "transient";
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function finiteMetric(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function medianMetric(values: Array<number | null>): number | undefined {
  const usable = values.filter((value): value is number => value !== null);
  if (usable.length === 0) return undefined;
  return median(usable);
}

export function summarizePsiMeasurements(raws: unknown[] = []): PsiMeasurementContext {
  const lighthouse = raws
    .map((raw) => record(record(raw)?.lighthouseResult))
    .filter((value): value is Record<string, unknown> => value !== null);
  const auditMetric = (result: Record<string, unknown>, id: string): number | null => {
    const audits = record(result.audits);
    return finiteMetric(record(audits?.[id])?.numericValue);
  };
  const versions = lighthouse.flatMap((result) =>
    typeof result.lighthouseVersion === "string" ? [result.lighthouseVersion] : []);
  return {
    lighthouseVersion: versions[0],
    medianBenchmarkIndex: medianMetric(lighthouse.map((result) =>
      finiteMetric(record(result.environment)?.benchmarkIndex))),
    medianFirstContentfulPaint: medianMetric(lighthouse.map((result) =>
      auditMetric(result, "first-contentful-paint"))),
    medianTotalBlockingTime: medianMetric(lighthouse.map((result) =>
      auditMetric(result, "total-blocking-time"))),
    medianLargestContentfulPaint: medianMetric(lighthouse.map((result) =>
      auditMetric(result, "largest-contentful-paint"))),
    medianSpeedIndex: medianMetric(lighthouse.map((result) =>
      auditMetric(result, "speed-index"))),
    medianCumulativeLayoutShift: medianMetric(lighthouse.map((result) =>
      auditMetric(result, "cumulative-layout-shift"))),
    medianServerResponseTime: medianMetric(lighthouse.map((result) =>
      auditMetric(result, "server-response-time"))),
  };
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

/** Identify a provider measurement independently from the request that returned it. */
export async function psiSampleKey(value: unknown): Promise<string> {
  const lighthouse = record(record(value)?.lighthouseResult);
  const fetchTime = lighthouse?.fetchTime;
  if (typeof fetchTime === "string" && fetchTime.trim()) return `fetch:${fetchTime.trim()}`;
  return `sha256:${await sha256(JSON.stringify(value))}`;
}

export function normalizeUrl(url: string): string {
  return /^https?:\/\//i.test(url) ? url : `https://${url}`;
}

function safeProviderDetail(value: string): string {
  return value.replace(/https?:\/\/\S+/gi, "[url]").slice(0, 200);
}

/** Provider-neutral single PSI request, used by both Next and the Workflow worker. */
export async function runPsiOnce(
  url: string,
  strategy: Strategy,
  options: { apiKey?: string; signal?: AbortSignal } = {},
): Promise<RunResult> {
  const params = new URLSearchParams({ url: normalizeUrl(url), strategy });
  for (const category of CATEGORIES) params.append("category", category.psi);
  if (options.apiKey) params.set("key", options.apiKey);

  const response = await fetch(`${PSI_ENDPOINT}?${params.toString()}`, { signal: options.signal });
  const json = (await response.json().catch(() => ({}))) as PsiResponse;
  if (!response.ok) {
    const detail = json.error?.message ? `: ${safeProviderDetail(json.error.message)}` : "";
    throw new PsiRequestError(`PSI request failed with HTTP ${response.status}${detail}`, response.status);
  }

  if (json.error) {
    const detail = json.error.message ? `: ${safeProviderDetail(json.error.message)}` : "";
    const status = json.error.code;
    if (typeof status === "number") {
      throw new PsiRequestError(`PSI provider error ${status}${detail}`, status);
    }
    throw new PsiResponseError(`PSI provider error unknown${detail}`);
  }
  const runtimeError = lighthouseRuntimeError(json);
  if (runtimeError) {
    throw new PsiLighthouseRuntimeError(`Lighthouse runtime error: ${safeProviderDetail(runtimeError)}`);
  }
  const scores = lighthouseScores(json);
  if (!scores) {
    throw new PsiResponseError("PSI response is missing one or more requested Lighthouse category scores");
  }
  return {
    scores,
    evidence: extractLighthouseRunEvidence(json, 0),
    raw: json,
    sampleKey: await psiSampleKey(json),
  };
}

async function runPsiWithTimeout(url: string, strategy: Strategy, apiKey: string | undefined): Promise<RunResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 70_000);
  try {
    return await runPsiOnce(url, strategy, { apiKey, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/** Collect a median/range from multiple successful PSI samples. */
export function aggregatePsiRuns(
  runs: Array<CompactRunResult & { raw?: unknown }>,
  requestedRuns: number,
  raws: unknown[] = runs.flatMap((run) => run.raw === undefined ? [] : [run.raw]),
): CollectResult {
  if (runs.length === 0) throw new Error("PSI collection has no successful runs");
  const uniqueRuns = runs.filter((run, index) =>
    runs.findIndex((candidate) => candidate.sampleKey === run.sampleKey) === index);

  const aggregated = aggregateLighthouseRunEvidence(
    uniqueRuns.map((run) => run.evidence),
    requestedRuns,
  );
  const scoreRuns = uniqueRuns.filter((run) => run.evidence.warnings.length === 0);
  const scoringRuns = scoreRuns.length > 0 ? scoreRuns : uniqueRuns;

  const scores = {} as NightScores;
  for (const category of CATEGORIES as { key: CategoryKey }[]) {
    const values = scoringRuns.map((run) => run.scores[category.key]);
    const bounds = range(values);
    scores[category.key] = { m: median(values), lo: bounds.lo, hi: bounds.hi };
  }

  return {
    schemaVersion: 2,
    scores,
    opportunities: aggregated.opportunities,
    findings: aggregated.findings,
    runEvidence: uniqueRuns.map((run) => run.evidence),
    quality: {
      ...aggregated.quality,
      attemptRuns: runs.length,
      successfulRuns: uniqueRuns.length,
      uniqueRuns: uniqueRuns.length,
      duplicateRuns: runs.length - uniqueRuns.length,
    },
    sampleSize: scoreRuns.length,
    raws,
  };
}

/** Collect a median/range from multiple successful PSI samples. */
export async function collectPsi(
  url: string,
  strategy: Strategy,
  options: { apiKey?: string; runs?: number } = {},
): Promise<CollectResult> {
  const runsRequested = normalizePsiRuns(options.runs);
  // Keep requests sequential. Concurrent identical PSI requests can return the
  // same cached Lighthouse measurement and create false five-run confidence.
  const settled: PromiseSettledResult<RunResult>[] = [];
  for (let index = 0; index < runsRequested; index += 1) {
    try {
      settled.push({ status: "fulfilled", value: await runPsiWithTimeout(url, strategy, options.apiKey) });
    } catch (reason) {
      settled.push({ status: "rejected", reason });
      if (classifyPsiFailure(reason) !== "transient") break;
    }
  }
  const runs = settled
    .flatMap((result, index): RunResult[] =>
      result.status === "fulfilled"
        ? [{ ...result.value, evidence: { ...result.value.evidence, run: index + 1 } }]
        : []);
  if (runs.length === 0) {
    const latest = settled.at(-1);
    const detail = latest?.status === "rejected"
      ? `: ${latest.reason instanceof Error ? latest.reason.message : String(latest.reason)}`
      : "";
    throw new Error(`PSI collection failed for ${strategy}${detail}`);
  }
  return aggregatePsiRuns(runs, runsRequested, runs.map((run) => run.raw));
}
