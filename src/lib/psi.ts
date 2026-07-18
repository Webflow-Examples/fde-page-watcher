import { CATEGORIES } from "./types";
import type { CategoryKey, NightScores, ScoreByCategory, Strategy } from "./types";
import { median, range } from "./scoring";

// PageSpeed Insights (Lighthouse) client. Works keyless at low volume; set
// PAGESPEED_API_KEY in .env.local for higher quota. Retries on failure and
// records the reduced sample when some of the five runs fail (REQ-032).

const PSI_ENDPOINT = "https://www.googleapis.com/pagespeedonline/v5/runPagespeed";

export interface Opportunity {
  id: string;
  title: string;
  savingsMs: number;
}

export interface RunResult {
  scores: ScoreByCategory;
  opportunities: Opportunity[];
  raw: unknown;
}

export interface CollectResult {
  scores: NightScores;
  opportunities: Opportunity[];
  sampleSize: number;
  raw: unknown;
}

export function normalizeUrl(url: string): string {
  return /^https?:\/\//i.test(url) ? url : `https://${url}`;
}

/** Runs per strategy — 5 per the spec, overridable via PSI_RUNS for quick checks. */
export function defaultRuns(): number {
  return Math.max(1, Math.min(5, Number(process.env.PSI_RUNS) || 5));
}

interface PsiResponse {
  lighthouseResult?: {
    categories?: Record<string, { score: number | null }>;
    audits?: Record<string, { title?: string; score?: number | null; details?: { type?: string; overallSavingsMs?: number }; numericValue?: number }>;
  };
}

function toScore(v: number | null | undefined): number {
  return v == null ? 0 : Math.round(v * 100);
}

/** One PSI run for a URL + strategy. */
export async function runOnce(url: string, strategy: Strategy, signal?: AbortSignal): Promise<RunResult> {
  const params = new URLSearchParams({ url: normalizeUrl(url), strategy });
  for (const c of CATEGORIES) params.append("category", c.psi);
  const key = process.env.PAGESPEED_API_KEY;
  if (key) params.set("key", key);

  const res = await fetch(`${PSI_ENDPOINT}?${params.toString()}`, { signal });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`PSI ${res.status}: ${body.slice(0, 200)}`);
  }
  const json = (await res.json()) as PsiResponse;
  const cats = json.lighthouseResult?.categories ?? {};
  const scores: ScoreByCategory = {
    perf: toScore(cats["performance"]?.score),
    a11y: toScore(cats["accessibility"]?.score),
    bp: toScore(cats["best-practices"]?.score),
    seo: toScore(cats["seo"]?.score),
  };

  const audits = json.lighthouseResult?.audits ?? {};
  const opportunities: Opportunity[] = Object.entries(audits)
    .filter(([, a]) => a.details?.type === "opportunity" && (a.details?.overallSavingsMs ?? 0) > 0 && (a.score ?? 1) < 1)
    .map(([id, a]) => ({ id, title: a.title ?? id, savingsMs: Math.round(a.details?.overallSavingsMs ?? 0) }))
    .sort((x, y) => y.savingsMs - x.savingsMs);

  return { scores, opportunities, raw: json };
}

async function withRetry(url: string, strategy: Strategy, attempts = 2): Promise<RunResult> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 70_000);
    try {
      return await runOnce(url, strategy, ctrl.signal);
    } catch (err) {
      lastErr = err;
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr;
}

/**
 * Measure a URL five times for one strategy; return the median score per
 * category with the run-to-run range, the representative run's opportunities,
 * and the successful sample size (REQ-012/014/032).
 */
export async function collect(url: string, strategy: Strategy, n = defaultRuns()): Promise<CollectResult> {
  // Offline test seam: with PSI_MOCK set, return deterministic scores without
  // calling the API, so the collection pipeline can be verified where keyless
  // PSI is rate-limited. Real runs (with PAGESPEED_API_KEY) never take this path.
  if (process.env.PSI_MOCK) return mockCollect(url, strategy, n);

  const runs: RunResult[] = [];
  for (let i = 0; i < n; i++) {
    try {
      runs.push(await withRetry(url, strategy));
    } catch {
      // record failure; continue with remaining runs (reduced sample)
    }
  }
  if (runs.length === 0) throw new Error(`PSI collection failed for ${url} (${strategy})`);

  const scores = {} as NightScores;
  for (const c of CATEGORIES as { key: CategoryKey }[]) {
    const vals = runs.map((r) => r.scores[c.key]);
    const m = median(vals);
    const { lo, hi } = range(vals);
    scores[c.key] = { m, lo, hi };
  }

  // Representative run = the one whose performance equals the median.
  const medianPerf = scores.perf.m;
  const rep = runs.slice().sort((a, b) => Math.abs(a.scores.perf - medianPerf) - Math.abs(b.scores.perf - medianPerf))[0];

  return { scores, opportunities: rep.opportunities, sampleSize: runs.length, raw: rep.raw };
}

function mockCollect(url: string, strategy: Strategy, n: number): CollectResult {
  let h = 0;
  for (const ch of url) h = (h * 31 + ch.charCodeAt(0)) % 1000;
  const bonus = strategy === "desktop" ? 18 : 0;
  const perf = Math.min(100, 52 + (h % 20) + bonus);
  const mk = (v: number, spread: number) => ({ m: Math.min(100, v), lo: Math.max(0, v - spread), hi: Math.min(100, v + spread) });
  const scores: NightScores = { perf: mk(perf, 3), a11y: mk(90, 1), bp: mk(95, 1), seo: mk(98, 1) };
  const opportunities: Opportunity[] = [
    { id: "unused-javascript", title: "Reduce unused JavaScript", savingsMs: 1800 },
    { id: "modern-image-formats", title: "Serve images in next-gen formats", savingsMs: 1200 },
    { id: "render-blocking-resources", title: "Eliminate render-blocking resources", savingsMs: 600 },
  ];
  return { scores, opportunities, sampleSize: n, raw: { mock: true, url, strategy, note: "PSI_MOCK synthetic report" } };
}
