import { CATEGORIES } from "./types";
import type {
  AggregatedLighthouseFinding,
  CategoryKey,
  LighthouseCollectionQuality,
  LighthouseOpportunity,
  LighthouseRunEvidence,
  NightScores,
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

export interface RunResult {
  scores: ScoreByCategory;
  evidence: LighthouseRunEvidence;
  raw: unknown;
}

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
  if (!response.ok) {
    throw new Error(`PSI request failed with HTTP ${response.status}`);
  }

  const json = (await response.json()) as PsiResponse;
  if (json.error) throw new Error(`PSI provider error ${json.error.code ?? "unknown"}`);
  const runtimeError = lighthouseRuntimeError(json);
  if (runtimeError) throw new Error(`Lighthouse runtime error: ${safeProviderDetail(runtimeError)}`);
  const scores = lighthouseScores(json);
  if (!scores) throw new Error("PSI response is missing one or more requested Lighthouse category scores");
  return { scores, evidence: extractLighthouseRunEvidence(json, 0), raw: json };
}

async function withRetry(url: string, strategy: Strategy, apiKey: string | undefined, attempts = 2): Promise<RunResult> {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 70_000);
    try {
      return await runPsiOnce(url, strategy, { apiKey, signal: controller.signal });
    } catch (error) {
      lastError = error;
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError;
}

/** Collect a median/range from multiple successful PSI samples. */
export async function collectPsi(
  url: string,
  strategy: Strategy,
  options: { apiKey?: string; runs?: number } = {},
): Promise<CollectResult> {
  const runsRequested = Math.max(1, Math.min(5, options.runs ?? 5));
  const settled = await Promise.allSettled(
    Array.from({ length: runsRequested }, () => withRetry(url, strategy, options.apiKey)),
  );
  const runs = settled
    .flatMap((result, index): RunResult[] =>
      result.status === "fulfilled"
        ? [{ ...result.value, evidence: { ...result.value.evidence, run: index + 1 } }]
        : []);
  if (runs.length === 0) throw new Error(`PSI collection failed for ${strategy}`);

  const aggregated = aggregateLighthouseRunEvidence(
    runs.map((run) => run.evidence),
    runsRequested,
  );
  // Warning-free runs are the only trusted scoring inputs. A provisional score
  // is still staged when all successful runs warn so the failed collection can
  // be audited, but callers must not commit a non-reliable result.
  const scoreRuns = runs.filter((run) => run.evidence.warnings.length === 0);
  const scoringRuns = scoreRuns.length > 0 ? scoreRuns : runs;

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
    runEvidence: runs.map((run) => run.evidence),
    quality: aggregated.quality,
    sampleSize: scoreRuns.length,
    raws: runs.map((run) => run.raw),
  };
}
