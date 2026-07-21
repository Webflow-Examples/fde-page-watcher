import type { LighthouseOpportunity, NightScores, Strategy } from "./types";
import { getEnv } from "./env";
import { collectPsi, runPsiOnce } from "./psiCore";

export { normalizeUrl } from "./psiCore";

// PageSpeed Insights (Lighthouse) client. Works keyless at low volume; set
// PAGESPEED_API_KEY in .env.local for higher quota. Retries on failure and
// records the reduced sample when some of the five runs fail (REQ-032).

export interface CollectResult {
  scores: NightScores;
  opportunities: LighthouseOpportunity[];
  sampleSize: number;
  raws: unknown[]; // every successful run's raw payload — the full audit trail (REQ-006), not one representative
}

/** Runs per strategy — 5 per the spec, overridable via PSI_RUNS for quick checks. */
export function defaultRuns(): number {
  return Math.max(1, Math.min(5, Number(getEnv("PSI_RUNS")) || 5));
}

/** One PSI run for a URL + strategy. */
export async function runOnce(url: string, strategy: Strategy, signal?: AbortSignal) {
  return runPsiOnce(url, strategy, { apiKey: getEnv("PAGESPEED_API_KEY"), signal });
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
  if (getEnv("PSI_MOCK")) return mockCollect(url, strategy, n);

  return collectPsi(url, strategy, { apiKey: getEnv("PAGESPEED_API_KEY"), runs: n });
}

function mockCollect(url: string, strategy: Strategy, n: number): CollectResult {
  let h = 0;
  for (const ch of url) h = (h * 31 + ch.charCodeAt(0)) % 1000;
  const bonus = strategy === "desktop" ? 18 : 0;
  const perf = Math.min(100, 52 + (h % 20) + bonus);
  const mk = (v: number, spread: number) => ({ m: Math.min(100, v), lo: Math.max(0, v - spread), hi: Math.min(100, v + spread) });
  const scores: NightScores = { perf: mk(perf, 3), a11y: mk(90, 1), bp: mk(95, 1), seo: mk(98, 1) };
  const opportunities: LighthouseOpportunity[] = [
    { id: "unused-javascript", title: "Reduce unused JavaScript", category: "Performance", savingsMs: 1800 },
    { id: "modern-image-formats", title: "Serve images in next-gen formats", category: "Performance", savingsMs: 1200 },
    { id: "render-blocking-resources", title: "Eliminate render-blocking resources", category: "Performance", savingsMs: 600 },
  ];
  const raws = Array.from({ length: n }, (_, k) => ({ mock: true, url, strategy, run: k + 1, note: "PSI_MOCK synthetic report" }));
  return { scores, opportunities, sampleSize: n, raws };
}
