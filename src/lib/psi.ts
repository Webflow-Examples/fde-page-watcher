import type { LighthouseRunEvidence, NightScores, Strategy } from "./types";
import { getEnv } from "./env";
import { aggregateLighthouseRunEvidence } from "./lighthouseEvidence";
import { collectPsi, runPsiOnce } from "./psiCore";
import type { CollectResult as CoreCollectResult } from "./psiCore";

export { normalizeUrl } from "./psiCore";

// PageSpeed Insights (Lighthouse) client. Works keyless at low volume; set
// PAGESPEED_API_KEY in .env.local for higher quota. Retries on failure and
// records the reduced sample when some of the five runs fail (REQ-032).

export type CollectResult = CoreCollectResult;

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
  const runEvidence: LighthouseRunEvidence[] = Array.from({ length: n }, (_, index) => ({
    run: index + 1,
    warnings: [],
    findings: [
      { id: "unused-javascript", title: "Code the page never runs is costing 1.8 seconds", category: "Performance", savingsMs: 1800, savingsBytes: 0, actionable: true },
      { id: "modern-image-formats", title: "Images could be sent in a lighter format", category: "Performance", savingsMs: 1200, savingsBytes: 0, actionable: true },
      { id: "render-blocking-resources", title: "A stylesheet delays the first text on the page", category: "Performance", savingsMs: 600, savingsBytes: 0, actionable: true },
      { id: "dom-size", title: "The page nests elements too deeply", category: "Performance", score: 0, scoreDisplayMode: "binary", savingsMs: 0, savingsBytes: 0, actionable: true },
    ],
  }));
  const aggregated = aggregateLighthouseRunEvidence(runEvidence, n);
  const raws = Array.from({ length: n }, (_, k) => ({
    mock: true,
    url,
    strategy,
    run: k + 1,
    note: "PSI_MOCK synthetic report",
    lighthouseResult: {
      lighthouseVersion: "mock-1",
      environment: { benchmarkIndex: strategy === "desktop" ? 1_200 : 800 },
      audits: {
        "first-contentful-paint": { numericValue: strategy === "desktop" ? 1_050 : 2_150 },
        "speed-index": { numericValue: strategy === "desktop" ? 2_100 : 4_250 },
        "largest-contentful-paint": { numericValue: strategy === "desktop" ? 1_700 : 3_350 },
        "total-blocking-time": { numericValue: strategy === "desktop" ? 120 : 520 },
        "cumulative-layout-shift": { numericValue: strategy === "desktop" ? 0.04 : 0.14 },
        "server-response-time": { numericValue: 180 },
        "dom-size": { details: { items: [
          { statistic: "Total DOM Elements", value: 1_180 + k * 12 },
          { statistic: "Maximum DOM Depth", value: 24 },
          { statistic: "Maximum Child Elements", value: 46 },
        ] } },
        "unused-css-rules": { details: {
          overallSavingsBytes: 148_000 + k * 1_000,
          items: [{ url: "https://cdn.prod.website-files.com/site/styles.css", totalBytes: 310_000, wastedBytes: 148_000 + k * 1_000 }],
        } },
        "unused-javascript": { details: {
          overallSavingsBytes: 286_000 + k * 2_000,
          items: [{ url: "https://cdn.prod.website-files.com/site/webflow.js", totalBytes: 520_000, wastedBytes: 286_000 + k * 2_000 }],
        } },
        "third-party-summary": { details: { items: [
          { url: "https://www.googletagmanager.com/gtm.js", transferSize: 128_000, mainThreadTime: 210 + k * 4, blockingTime: 82 + k * 2 },
          { url: "https://connect.facebook.net/sdk.js", transferSize: 76_000, mainThreadTime: 130, blockingTime: 44 },
        ] } },
        "render-blocking-resources": { details: {
          overallSavingsMs: 600 + k * 10,
          items: [
            { url: "https://cdn.prod.website-files.com/site/styles.css", totalBytes: 310_000, wastedMs: 420 },
            { url: "https://fonts.googleapis.com/css2", totalBytes: 12_000, wastedMs: 180 },
          ],
        } },
        "uses-responsive-images": { details: {
          overallSavingsBytes: 420_000 + k * 2_000,
          items: [
            { url: "https://cdn.prod.website-files.com/site/hero.jpg", totalBytes: 620_000, wastedBytes: 340_000 },
            { url: "https://cdn.prod.website-files.com/site/card.jpg", totalBytes: 180_000, wastedBytes: 80_000 },
          ],
        } },
        "largest-contentful-paint-element": { details: { items: [{
          url: "https://cdn.prod.website-files.com/site/hero.jpg",
          node: { snippet: "<img class=\"hero-image\">", boundingRect: { width: 1440, height: 810 } },
        }] } },
      },
    },
  }));
  return {
    schemaVersion: 2,
    scores,
    opportunities: aggregated.opportunities,
    findings: aggregated.findings,
    runEvidence,
    quality: aggregated.quality,
    sampleSize: n,
    raws,
  };
}
