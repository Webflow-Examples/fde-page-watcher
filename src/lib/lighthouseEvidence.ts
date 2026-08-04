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
  return detail || "Lighthouse runtime error";
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
