import { launch } from "@cloudflare/playwright";
import { createFdeStore } from "./dataStore";
import { safeKitesurfDetail, summarizeAriaSnapshot } from "../src/lib/kitesurfEvidence";
import { nativeElementScan } from "../src/lib/nativeElements";
import { normalizeUrl } from "../src/lib/psiCore";
import type { KitesurfEvidence, NativeElementScan } from "../src/lib/types";

const MAX_RETAINED_HTML_CHARACTERS = 2_000_000;

interface EvaluatedPageMetrics {
  domNodes: number;
  textCharacters: number;
  headings: number;
  links: number;
  buttons: number;
  forms: number;
  images: number;
  iframes: number;
  serializedHtmlCharacters: number;
  resourceEntries: number;
  transferBytes: number;
  responseStartMs?: number;
  domContentLoadedMs?: number;
  loadEventMs?: number;
}

export interface KitesurfCaptureResult {
  evidence: KitesurfEvidence;
  nativeElements?: NativeElementScan;
}

function finiteNonNegative(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function evaluatedPageMetrics(value: unknown): EvaluatedPageMetrics {
  if (!value || typeof value !== "object") throw new Error("Kitesurf page metrics are invalid");
  const record = value as Record<string, unknown>;
  const required = [
    "domNodes",
    "textCharacters",
    "headings",
    "links",
    "buttons",
    "forms",
    "images",
    "iframes",
    "serializedHtmlCharacters",
    "resourceEntries",
    "transferBytes",
  ] as const;
  const metrics: Partial<EvaluatedPageMetrics> = {};
  for (const key of required) {
    const number = finiteNonNegative(record[key]);
    if (number === undefined) throw new Error(`Kitesurf page metric ${key} is invalid`);
    metrics[key] = number;
  }
  for (const key of ["responseStartMs", "domContentLoadedMs", "loadEventMs"] as const) {
    const number = finiteNonNegative(record[key]);
    if (number !== undefined) metrics[key] = number;
  }
  return metrics as EvaluatedPageMetrics;
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function pageMetricsScript(): string {
  return `JSON.stringify((() => {
    const navigation = performance.getEntriesByType("navigation")[0];
    const resources = performance.getEntriesByType("resource");
    return {
      domNodes: document.querySelectorAll("*").length,
      textCharacters: (document.body?.innerText || "").length,
      headings: document.querySelectorAll("h1,h2,h3,h4,h5,h6").length,
      links: document.querySelectorAll("a[href]").length,
      buttons: document.querySelectorAll("button,[role=button]").length,
      forms: document.querySelectorAll("form").length,
      images: document.querySelectorAll("img").length,
      iframes: document.querySelectorAll("iframe").length,
      serializedHtmlCharacters: document.documentElement?.outerHTML.length || 0,
      resourceEntries: resources.length,
      transferBytes: resources.reduce((total, entry) => total + (Number(entry.transferSize) || 0), 0),
      responseStartMs: navigation ? Number(navigation.responseStart) : undefined,
      domContentLoadedMs: navigation ? Number(navigation.domContentLoadedEventEnd) : undefined,
      loadEventMs: navigation ? Number(navigation.loadEventEnd) : undefined,
    };
  })())`;
}

/**
 * Run one stateless Kitesurf probe and stage its raw rendered evidence in R2.
 * The caller deliberately treats all failures as optional sidecar failures.
 */
export async function captureAndStoreKitesurfEvidence(
  env: Env,
  input: { tenant: string; pageId: string; runId: string; url: string },
): Promise<KitesurfCaptureResult> {
  const browser = await launch(env.BROWSER, { browser: "kitesurf" });
  try {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
    });
    const page = await context.newPage();
    page.setDefaultTimeout(10_000);

    let requests = 0;
    let failedRequests = 0;
    let errorResponses = 0;
    let consoleErrors = 0;
    let pageErrors = 0;
    const thirdPartyHosts = new Set<string>();
    const target = new URL(normalizeUrl(input.url));

    page.on("request", (request) => {
      requests += 1;
      try {
        const host = new URL(request.url()).hostname;
        if (host && host !== target.hostname) thirdPartyHosts.add(host);
      } catch {
        // Invalid subresource URLs are counted as requests but never retained.
      }
    });
    page.on("requestfailed", () => {
      failedRequests += 1;
    });
    page.on("response", (response) => {
      if (response.status() >= 400) errorResponses += 1;
    });
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors += 1;
    });
    page.on("pageerror", () => {
      pageErrors += 1;
    });

    const startedAt = Date.now();
    const navigationResponse = await page.goto(target.toString(), {
      waitUntil: "domcontentloaded",
      timeout: 45_000,
    });
    try {
      await page.waitForLoadState("networkidle", { timeout: 10_000 });
    } catch {
      // Long-polling and analytics requests should not make the rendered probe fail.
    }
    await page.waitForTimeout(500);

    const metricsJson = await page.evaluate<string>(pageMetricsScript());
    const metrics = evaluatedPageMetrics(JSON.parse(metricsJson) as unknown);
    const title = await page.title();
    let ariaSnapshot: string | undefined;
    try {
      ariaSnapshot = await page.locator("body").ariaSnapshot({ timeout: 10_000 });
    } catch {
      // The rest of the rendered probe remains useful if the beta AX path fails.
    }

    const renderedHtml = metrics.serializedHtmlCharacters <= MAX_RETAINED_HTML_CHARACTERS
      ? await page.content()
      : undefined;
    const [renderedContentHash, accessibilityHash] = await Promise.all([
      renderedHtml ? sha256(renderedHtml) : Promise.resolve(undefined),
      ariaSnapshot ? sha256(ariaSnapshot) : Promise.resolve(undefined),
    ]);
    const capturedAt = new Date().toISOString();
    const rawReportKey = `run-${input.runId}-kitesurf`;
    const evidence: KitesurfEvidence = {
      schemaVersion: 1,
      engine: "kitesurf",
      status: "available",
      capturedAt,
      httpStatus: navigationResponse?.status(),
      title: title || undefined,
      renderedContentHash,
      accessibilityHash,
      rawReportKey,
      document: {
        domNodes: metrics.domNodes,
        textCharacters: metrics.textCharacters,
        headings: metrics.headings,
        links: metrics.links,
        buttons: metrics.buttons,
        forms: metrics.forms,
        images: metrics.images,
        iframes: metrics.iframes,
        serializedHtmlCharacters: metrics.serializedHtmlCharacters,
        htmlRetained: renderedHtml !== undefined,
      },
      accessibility: ariaSnapshot ? summarizeAriaSnapshot(ariaSnapshot) : undefined,
      network: {
        requests,
        failedRequests,
        errorResponses,
        thirdPartyHosts: thirdPartyHosts.size,
        resourceEntries: metrics.resourceEntries,
        transferBytes: metrics.transferBytes,
      },
      runtime: { consoleErrors, pageErrors },
      diagnosticTimings: {
        wallTimeMs: Date.now() - startedAt,
        responseStartMs: metrics.responseStartMs,
        domContentLoadedMs: metrics.domContentLoadedMs,
        loadEventMs: metrics.loadEventMs,
      },
    };
    const nativeElements = renderedHtml ? nativeElementScan(renderedHtml) : undefined;
    await createFdeStore(input.tenant, env).putReport(input.pageId, rawReportKey, {
      schemaVersion: 1,
      engine: "kitesurf",
      evidence,
      renderedHtml,
      renderedHtmlOmitted: renderedHtml === undefined,
      accessibilitySnapshot: ariaSnapshot,
      nativeElements,
    });
    return { evidence, nativeElements };
  } finally {
    try {
      await browser.close();
    } catch (error) {
      console.warn(JSON.stringify({
        message: "Kitesurf browser close failed",
        error: safeKitesurfDetail(error),
      }));
    }
  }
}
