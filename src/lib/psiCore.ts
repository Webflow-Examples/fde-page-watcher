import { CATEGORIES } from "./types";
import type { CategoryKey, LighthouseOpportunity, NightScores, ScoreByCategory, Strategy } from "./types";
import { median, range } from "./scoring";

const PSI_ENDPOINT = "https://www.googleapis.com/pagespeedonline/v5/runPagespeed";

export interface RunResult {
  scores: ScoreByCategory;
  opportunities: LighthouseOpportunity[];
  raw: unknown;
}

export interface CollectResult {
  scores: NightScores;
  opportunities: LighthouseOpportunity[];
  sampleSize: number;
  raws: unknown[];
}

interface PsiResponse {
  lighthouseResult?: {
    categories?: Record<string, { score: number | null }>;
    audits?: Record<
      string,
      {
        title?: string;
        description?: string;
        score?: number | null;
        details?: { type?: string; overallSavingsMs?: number };
      }
    >;
  };
}

export function normalizeUrl(url: string): string {
  return /^https?:\/\//i.test(url) ? url : `https://${url}`;
}

function toScore(value: number | null | undefined): number {
  return value == null ? 0 : Math.round(value * 100);
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
    const body = await response.text().catch(() => "");
    throw new Error(`PSI ${response.status}: ${body.slice(0, 200)}`);
  }

  const json = (await response.json()) as PsiResponse;
  const categories = json.lighthouseResult?.categories ?? {};
  const scores: ScoreByCategory = {
    perf: toScore(categories.performance?.score),
    a11y: toScore(categories.accessibility?.score),
    bp: toScore(categories["best-practices"]?.score),
    seo: toScore(categories.seo?.score),
  };
  const audits = json.lighthouseResult?.audits ?? {};
  const opportunities = Object.entries(audits)
    .filter(([, audit]) => audit.details?.type === "opportunity" && (audit.details.overallSavingsMs ?? 0) > 0 && (audit.score ?? 1) < 1)
    .map(([id, audit]): LighthouseOpportunity => ({
      id,
      title: audit.title ?? id,
      description: audit.description,
      category: "Performance",
      savingsMs: Math.round(audit.details?.overallSavingsMs ?? 0),
    }))
    .sort((a, b) => b.savingsMs - a.savingsMs);
  return { scores, opportunities, raw: json };
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
    .filter((result): result is PromiseFulfilledResult<RunResult> => result.status === "fulfilled")
    .map((result) => result.value);
  if (runs.length === 0) throw new Error(`PSI collection failed for ${url} (${strategy})`);

  const scores = {} as NightScores;
  for (const category of CATEGORIES as { key: CategoryKey }[]) {
    const values = runs.map((run) => run.scores[category.key]);
    const bounds = range(values);
    scores[category.key] = { m: median(values), lo: bounds.lo, hi: bounds.hi };
  }
  const representative = runs
    .slice()
    .sort((a, b) => Math.abs(a.scores.perf - scores.perf.m) - Math.abs(b.scores.perf - scores.perf.m))[0];
  return {
    scores,
    opportunities: representative.opportunities,
    sampleSize: runs.length,
    raws: runs.map((run) => run.raw),
  };
}
