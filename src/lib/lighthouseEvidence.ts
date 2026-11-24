import { CATEGORIES } from "./types";
import type {
  AggregatedLighthouseFinding,
  LighthouseCollectionQuality,
  LighthouseOpportunity,
  LighthouseRunEvidence,
  LighthouseRunFinding,
  ScoreByCategory,
} from "./types";
import { classifyWebflowPerformance } from "./webflowPerformance";

export const MINIMUM_TRUSTED_RUNS = 3;

export function minimumTrustedRuns(requestedRuns: number): number {
  return Math.min(MINIMUM_TRUSTED_RUNS, Math.max(1, requestedRuns));
}

interface PsiAudit {
  title?: string;
  description?: string;
  score?: number | null;
  scoreDisplayMode?: string;
  details?: {
    type?: string;
    overallSavingsMs?: number;
    overallSavingsBytes?: number;
    /** Present on table and list audits; the informative whitelist reads it. */
    items?: unknown;
  };
}

interface PsiCategory {
  title?: string;
  score?: number | null;
  auditRefs?: { id?: string; weight?: number; group?: string }[];
}

export interface PsiLighthouseResponse {
  lighthouseResult?: {
    lighthouseVersion?: string;
    finalDisplayedUrl?: string;
    requestedUrl?: string;
    runWarnings?: unknown[];
    runtimeError?: { code?: string; message?: string };
    categories?: Record<string, PsiCategory>;
    audits?: Record<string, PsiAudit>;
  };
}

const NON_ACTIONABLE_DISPLAY_MODES = new Set(["notApplicable", "informative", "manual", "error"]);

/**
 * Informative audits that carry a finding worth showing even though they have no
 * numeric score.
 *
 * `extractLighthouseRunEvidence` used to keep only audits with a score below 1,
 * so everything Lighthouse marks `informative` was dropped — including the three
 * measurements behind the audit's largest causes: third-party transfer and
 * blocking time, the resource mix, and the main image being set to load late.
 * They were invisible for a reason no reader could see, which is the worst kind
 * of invisible.
 *
 * A whitelist rather than "every informative audit", because most of them are
 * diagnostics with nothing to act on. A whitelisted audit is kept only when its
 * details yield a figure or a detection; `deriveInformativeAudit` returns null
 * otherwise, so an audit that found nothing adds no finding — an empty slot
 * would read as a reading that found nothing (registry rule 15).
 */
export const INFORMATIVE_AUDIT_IDS = Object.freeze([
  "third-party-summary",
  "resource-summary",
  "lcp-lazy-loaded",
]);

function itemBytes(item: Record<string, unknown>): number {
  return finiteNonNegative(item.transferSize) || finiteNonNegative(item.totalBytes);
}

function items(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) =>
    entry && typeof entry === "object" && !Array.isArray(entry) ? [entry as Record<string, unknown>] : []);
}

function nestedLoading(value: unknown): string | undefined {
  const node = value && typeof value === "object" ? (value as Record<string, unknown>) : null;
  const loading = node?.loading;
  return typeof loading === "string" ? loading.toLowerCase() : undefined;
}

function snippetOf(item: Record<string, unknown>): string {
  const node = item.node as Record<string, unknown> | undefined;
  const snippet = node?.snippet;
  return typeof snippet === "string" ? snippet : "";
}

/**
 * What an informative audit measured, in the same two units every other finding
 * uses — or null when it measured nothing.
 *
 *   - third-party-summary: the bytes every third party transferred, and the time
 *     they kept the main thread blocked. Both are sums within ONE run of one
 *     page, which is what the audit itself reports; the cross-run aggregation
 *     below still takes a median rather than adding runs together.
 *   - resource-summary: the third-party share of the page's transfer. A summary
 *     has no fix of its own, so it is never actionable — it is evidence for the
 *     third-party case, not a case.
 *   - lcp-lazy-loaded: the image visitors wait for, when it is set to load late.
 *     Actionable exactly when that is what the audit found.
 */
function deriveInformativeAudit(
  id: string,
  details: Record<string, unknown> | undefined,
): { savingsMs: number; savingsBytes: number; actionable: boolean } | null {
  if (!details) return null;
  const rows = items(details.items);
  if (id === "third-party-summary") {
    if (rows.length === 0) return null;
    const savingsBytes = Math.round(rows.reduce((sum, row) => sum + itemBytes(row), 0));
    const savingsMs = Math.round(rows.reduce((sum, row) => sum + finiteNonNegative(row.blockingTime), 0));
    return { savingsMs, savingsBytes, actionable: savingsBytes > 0 || savingsMs > 0 };
  }
  if (id === "resource-summary") {
    const thirdParty = rows.find((row) =>
      String(row.resourceType ?? row.label ?? "").toLowerCase().includes("third party")
      || String(row.resourceType ?? "").toLowerCase() === "third-party");
    const savingsBytes = thirdParty ? itemBytes(thirdParty) : 0;
    return savingsBytes > 0 ? { savingsMs: 0, savingsBytes, actionable: false } : null;
  }
  if (id === "lcp-lazy-loaded") {
    const lazy = rows.some((row) => nestedLoading(row.node) === "lazy" || /loading\s*=\s*["']lazy["']/i.test(snippetOf(row)));
    if (!lazy) return null;
    return {
      savingsMs: Math.round(finiteNonNegative(details.overallSavingsMs)),
      savingsBytes: Math.round(
        finiteNonNegative(details.overallSavingsBytes) || rows.reduce((sum, row) => sum + itemBytes(row), 0),
      ),
      actionable: true,
    };
  }
  return null;
}

function finiteNonNegative(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : Math.round((sorted[middle - 1] + sorted[middle]) / 2);
}

function bounds(values: number[]): { low: number; high: number } {
  if (values.length === 0) return { low: 0, high: 0 };
  return { low: Math.min(...values), high: Math.max(...values) };
}

function categoryLabel(id: string, category?: PsiCategory): string {
  const known = CATEGORIES.find((item) => item.psi === id);
  return known?.label ?? category?.title ?? id;
}

function categoryByAudit(categories: Record<string, PsiCategory>): Map<string, string> {
  const result = new Map<string, string>();
  for (const [categoryId, category] of Object.entries(categories)) {
    for (const reference of category.auditRefs ?? []) {
      if (!reference.id || result.has(reference.id)) continue;
      result.set(reference.id, categoryLabel(categoryId, category));
    }
  }
  return result;
}

function cleanWarning(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const warning = value.trim();
  return warning ? warning.slice(0, 1_000) : null;
}

/** Return a provider runtime error without accepting its missing scores as zeroes. */
export function lighthouseRuntimeError(value: unknown): string | null {
  const response = value as PsiLighthouseResponse;
  const runtimeError = response?.lighthouseResult?.runtimeError;
  if (!runtimeError) return null;
  const detail = [runtimeError.code, runtimeError.message].filter(Boolean).join(": ");
  return detail || "The nightly test could not finish (Lighthouse runtime error)";
}

/** Validate all four requested Lighthouse category scores. */
export function lighthouseScores(value: unknown): ScoreByCategory | null {
  const response = value as PsiLighthouseResponse;
  const categories = response?.lighthouseResult?.categories;
  if (!categories) return null;
  const entries = CATEGORIES.map((category) => {
    const score = categories[category.psi]?.score;
    return [category.key, typeof score === "number" && Number.isFinite(score) ? Math.round(score * 100) : null] as const;
  });
  if (entries.some(([, score]) => score === null)) return null;
  return Object.fromEntries(entries) as ScoreByCategory;
}

/** Normalize warnings and every failing category audit from one successful PSI response. */
export function extractLighthouseRunEvidence(value: unknown, run: number): LighthouseRunEvidence {
  const response = value as PsiLighthouseResponse;
  const result = response?.lighthouseResult;
  const categories = result?.categories ?? {};
  const auditCategories = categoryByAudit(categories);
  const warnings = (result?.runWarnings ?? [])
    .map(cleanWarning)
    .filter((warning): warning is string => !!warning);

  const findings = Object.entries(result?.audits ?? {}).flatMap(([id, audit]): LighthouseRunFinding[] => {
    const informative = (INFORMATIVE_AUDIT_IDS as readonly string[]).includes(id);
    if (informative) {
      // Kept on what its details say, never on its score — an informative audit
      // has none. The category falls back to Performance because a whitelisted
      // audit can sit outside every category's `auditRefs` and would otherwise
      // be dropped for having no home.
      const derived = deriveInformativeAudit(id, audit.details);
      if (!derived) return [];
      return [{
        id,
        title: audit.title?.trim() || id,
        description: audit.description,
        category: auditCategories.get(id) ?? "Performance",
        ...(typeof audit.score === "number" ? { score: audit.score } : {}),
        scoreDisplayMode: audit.scoreDisplayMode,
        savingsMs: derived.savingsMs,
        savingsBytes: derived.savingsBytes,
        actionable: derived.actionable,
        webflow: classifyWebflowPerformance(id, audit.title),
      }];
    }
    if (typeof audit.score !== "number" || !Number.isFinite(audit.score) || audit.score >= 1) return [];
    if (audit.scoreDisplayMode && NON_ACTIONABLE_DISPLAY_MODES.has(audit.scoreDisplayMode)) return [];
    const category = auditCategories.get(id);
    if (!category) return [];
    const savingsMs = Math.round(finiteNonNegative(audit.details?.overallSavingsMs));
    const savingsBytes = Math.round(finiteNonNegative(audit.details?.overallSavingsBytes));
    return [{
      id,
      title: audit.title?.trim() || id,
      description: audit.description,
      category,
      score: audit.score,
      scoreDisplayMode: audit.scoreDisplayMode,
      savingsMs,
      savingsBytes,
      actionable: audit.details?.type === "opportunity"
        || savingsMs > 0
        || savingsBytes > 0
        || audit.scoreDisplayMode === "binary",
      webflow: classifyWebflowPerformance(id),
    }];
  });

  return { run, warnings, findings };
}

export interface AggregatedLighthouseEvidence {
  findings: AggregatedLighthouseFinding[];
  opportunities: LighthouseOpportunity[];
  quality: LighthouseCollectionQuality;
}

/**
 * Aggregate by stable Lighthouse audit id. All observations are retained, but
 * only strict-majority findings from at least three warning-free runs qualify
 * for customer-facing recommendations.
 */
export function aggregateLighthouseRunEvidence(
  evidence: LighthouseRunEvidence[],
  requestedRuns: number,
): AggregatedLighthouseEvidence {
  const eligible = evidence.filter((item) => item.warnings.length === 0);
  const successfulRuns = evidence.length;
  const eligibleRuns = eligible.length;
  const requiredRuns = minimumTrustedRuns(requestedRuns);
  const quorum = eligibleRuns > 0 ? Math.floor(eligibleRuns / 2) + 1 : 0;
  const allIds = new Set(evidence.flatMap((item) => item.findings.map((finding) => finding.id)));

  const findings = [...allIds].map((id): AggregatedLighthouseFinding => {
    const allObservations = evidence.flatMap((item) => item.findings.filter((finding) => finding.id === id));
    const eligibleObservations = eligible.flatMap((item) => item.findings.filter((finding) => finding.id === id));
    const source = eligibleObservations[0] ?? allObservations[0];
    const observedRuns = eligible.filter((item) => item.findings.some((finding) => finding.id === id)).length;
    const totalObservedRuns = evidence.filter((item) => item.findings.some((finding) => finding.id === id)).length;
    const frequency = eligibleRuns > 0 ? observedRuns / eligibleRuns : 0;
    const promoted = source.actionable
      && eligibleRuns >= requiredRuns
      && observedRuns >= quorum;
    const confidence = eligibleRuns < requiredRuns
      ? "insufficient"
      : !promoted
        ? "intermittent"
        : eligibleRuns >= 4 && frequency >= 0.8
          ? "high"
          : "medium";
    const savingsMsValues = (eligibleObservations.length ? eligibleObservations : allObservations)
      .map((finding) => finding.savingsMs);
    const savingsBytesValues = (eligibleObservations.length ? eligibleObservations : allObservations)
      .map((finding) => finding.savingsBytes);
    const savingsMs = bounds(savingsMsValues);
    const savingsBytes = bounds(savingsBytesValues);

    return {
      ...source,
      webflow: source.webflow ?? classifyWebflowPerformance(id),
      savingsMs: median(savingsMsValues),
      savingsBytes: median(savingsBytesValues),
      observedRuns,
      totalObservedRuns,
      eligibleRuns,
      successfulRuns,
      quorum,
      frequency,
      promoted,
      confidence,
      savingsLowMs: savingsMs.low,
      savingsHighMs: savingsMs.high,
      savingsLowBytes: savingsBytes.low,
      savingsHighBytes: savingsBytes.high,
    };
  }).sort((left, right) =>
    Number(right.promoted) - Number(left.promoted)
    || right.savingsMs - left.savingsMs
    || right.frequency - left.frequency
    || left.id.localeCompare(right.id));

  const opportunities = findings
    .filter((finding) => finding.promoted && finding.savingsMs > 0)
    .map((finding): LighthouseOpportunity => ({
      id: finding.id,
      title: finding.title,
      description: finding.description,
      category: finding.category,
      savingsMs: finding.savingsMs,
      savingsBytes: finding.savingsBytes,
      observedRuns: finding.observedRuns,
      eligibleRuns: finding.eligibleRuns,
      confidence: finding.confidence === "high" ? "high" : "medium",
      savingsLowMs: finding.savingsLowMs,
      savingsHighMs: finding.savingsHighMs,
      webflow: finding.webflow ?? classifyWebflowPerformance(finding.id),
    }));

  const warnedRuns = successfulRuns - eligibleRuns;
  const quality: LighthouseCollectionQuality = {
    requestedRuns,
    successfulRuns,
    eligibleRuns,
    warnedRuns,
    failedRuns: Math.max(0, requestedRuns - successfulRuns),
    findingsObserved: findings.length,
    findingsPromoted: findings.filter((finding) => finding.promoted).length,
    status: eligibleRuns >= requiredRuns
      ? "reliable"
      : eligibleRuns > 0
        ? "low-confidence"
        : "unusable",
  };
  return { findings, opportunities, quality };
}
