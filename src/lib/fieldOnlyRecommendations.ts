import type { CruxPageEvidence } from "./crux";
import { compareLabAndField, type LabFieldMetricComparison } from "./labFieldComparison";
import { costBand } from "./cost";
import { evidenceForPage } from "./visitorExperience";
import { shortDate } from "./ui";
import { webflowClassificationFor } from "./webflowPerformance";
import type {
  AppState,
  FieldOnlyMetricKey,
  FieldOnlyLifecycleStatus,
  FieldOnlyRecommendationSignal,
  FieldOnlyStrategyLifecycle,
  Night,
  Rec,
  Strategy,
  WatchPage,
  WebflowPerformanceClassification,
  WebflowPerformanceMetric,
} from "./types";
import type { DataStore } from "./store/fsStore";

interface FieldOnlyDefinition {
  id: string;
  title: string;
  lighthouseMetric: WebflowPerformanceMetric | null;
  investigation: string;
}

const DEFINITIONS: Record<FieldOnlyMetricKey, FieldOnlyDefinition> = {
  lcp: {
    id: "crux-field-only-lcp",
    title: "Investigate visitor-only content loading",
    lighthouseMetric: "LCP",
    investigation: "Segment real-user LCP by template, device, geography, and connection, then inspect the visitor LCP element before assigning a culprit.",
  },
  responsiveness: {
    id: "crux-field-only-inp",
    title: "Investigate visitor-only interaction delay",
    lighthouseMetric: "TBT",
    investigation: "Reproduce common interactions under real device conditions and inspect long tasks and third-party handlers; lab TBT is only a diagnostic proxy for visitor INP.",
  },
  cls: {
    id: "crux-field-only-cls",
    title: "Investigate visitor-only layout shifts",
    lighthouseMetric: "CLS",
    investigation: "Use real-user attribution or a production trace to identify the shifting element before changing layout or media behavior.",
  },
  ttfb: {
    id: "crux-field-only-ttfb",
    title: "Investigate visitor-only server response delay",
    lighthouseMetric: null,
    investigation: "Segment real-user server response by geography and route, then review caching, redirects, and backend response behavior before assigning ownership.",
  },
};

function fieldOnlyClassification(investigation: string): WebflowPerformanceClassification {
  return {
    version: 1,
    metric: "other",
    metricWeight: 0,
    culprit: "other",
    culpritLabel: "Root cause unconfirmed",
    remediation: "unknown",
    remediationLabel: "Investigation needed",
    guidance: investigation,
    source: "crux-field-only",
  };
}

function labNightForComparison(page: WatchPage, strategy: Strategy, capturedAt: string | null): Night | null {
  if (capturedAt) {
    const exact = [...page.history].reverse().find((night) => night.iso === capturedAt);
    if (exact) return exact;
  }
  return [...page.history].reverse().find((night) => !!night.measurementContext?.[strategy] && night.evidenceStatus !== "provider-anomaly") ?? null;
}

function hasMatchingLighthouseAudit(
  page: WatchPage,
  strategy: Strategy,
  metric: WebflowPerformanceMetric | null,
  labCapturedAt: string | null,
): boolean {
  if (!metric) return false;
  const night = labNightForComparison(page, strategy, labCapturedAt);
  if (!night) return false;
  const opportunities = night.opportunitiesByStrategy?.[strategy]
    ?? (strategy === "mobile" ? night.opportunities ?? [] : []);
  const diagnostics = night.diagnostics?.[strategy] ?? [];
  return [...opportunities, ...diagnostics].some((finding) =>
    finding.category === "Performance" && webflowClassificationFor(finding).metric === metric);
}

function retainedSignal(metric: LabFieldMetricComparison, detectedAt: string, collection: NonNullable<ReturnType<typeof compareLabAndField>["fieldWindow"]>): FieldOnlyRecommendationSignal | null {
  if (!metric.lab || !metric.field || metric.field.rating === "Good" || collection.scope !== "url") return null;
  return {
    metricKey: metric.key,
    metricLabel: metric.label,
    relationship: metric.relationship,
    labLabel: metric.lab.label,
    labFormatted: metric.lab.formatted,
    fieldLabel: metric.field.label,
    fieldValue: metric.field.value,
    fieldFormatted: metric.field.formatted,
    fieldRating: metric.field.rating,
    scope: "url",
    collectionStart: collection.start,
    collectionEnd: collection.end,
    detectedAt,
  };
}

function summary(signals: Partial<Record<Strategy, FieldOnlyRecommendationSignal>>, investigation: string): string {
  const evidence = (Object.entries(signals) as [Strategy, FieldOnlyRecommendationSignal][])
    .map(([strategy, signal]) => `${signal.fieldLabel} is ${signal.fieldFormatted} (${signal.fieldRating.toLowerCase()}) on ${strategy}, while ${signal.labLabel} is ${signal.labFormatted} (good)`)
    .join("; ");
  return `Exact-URL CrUX shows a visitor-only issue: ${evidence}, and the latest Lighthouse capture produced no matching audit. ${investigation}`;
}

function initialLifecycle(signal: FieldOnlyRecommendationSignal): FieldOnlyStrategyLifecycle {
  return {
    status: "active",
    firstDetectedAt: signal.detectedAt,
    lastDetectedAt: signal.detectedAt,
    lastEvaluatedCollectionEnd: signal.collectionEnd,
    consecutiveGoodWindows: 0,
  };
}

function aggregateLifecycle(statuses: FieldOnlyLifecycleStatus[]): FieldOnlyLifecycleStatus {
  for (const status of ["regressed", "active", "verifying", "corroborated", "resolved"] as const) {
    if (statuses.includes(status)) return status;
  }
  return "active";
}

/** Aggregate a multi-device field lifecycle; legacy synthetic records remain actionable. */
export function fieldRecommendationLifecycleStatus(rec: Pick<Rec, "source" | "fieldLifecycle">): FieldOnlyLifecycleStatus | null {
  if (rec.source !== "crux-field-only") return null;
  const statuses = Object.values(rec.fieldLifecycle ?? {}).flatMap((item) => item ? [item.status] : []);
  return statuses.length ? aggregateLifecycle(statuses) : "active";
}

export function isFieldRecommendationActionable(rec: Pick<Rec, "source" | "fieldLifecycle">): boolean {
  const status = fieldRecommendationLifecycleStatus(rec);
  return status === null || status === "active" || status === "regressed";
}

function evaluateExistingLifecycle(
  rec: Rec,
  page: WatchPage,
  evidence: CruxPageEvidence[],
  now: Date,
): boolean {
  if (rec.source !== "crux-field-only") return false;
  const metricKey = Object.values(rec.fieldSignals ?? {}).find(Boolean)?.metricKey;
  const definition = metricKey ? DEFINITIONS[metricKey] : Object.values(DEFINITIONS).find((item) => item.id === rec.id);
  if (!definition) return false;
  const before = JSON.stringify(rec.fieldLifecycle ?? {});
  const lifecycle = { ...(rec.fieldLifecycle ?? {}) };
  const strategies = new Set<Strategy>([
    ...(rec.strategies ?? []),
    ...(Object.keys(rec.fieldSignals ?? {}) as Strategy[]),
    ...(Object.keys(rec.fieldLifecycle ?? {}) as Strategy[]),
  ]);
  for (const strategy of strategies) {
    const visitorEvidence = evidenceForPage(evidence, page.id, strategy);
    if (!visitorEvidence || (visitorEvidence.status && !["available", "partial"].includes(visitorEvidence.status.status))) continue;
    const comparison = compareLabAndField(page.history, strategy, visitorEvidence);
    if (comparison.fieldWindow?.scope !== "url") continue;
    const key = rec.fieldSignals?.[strategy]?.metricKey ?? metricKey;
    const metric = comparison.metrics.find((item) => item.key === key);
    if (!metric?.field) continue;
    const retained = rec.fieldSignals?.[strategy];
    const current = lifecycle[strategy] ?? (retained ? initialLifecycle(retained) : null);
    if (!current) continue;
    const next = { ...current };
    const newWindow = next.lastEvaluatedCollectionEnd !== comparison.fieldWindow.end;
    if (metric.field.rating === "Good") {
      const transitionedToGood = next.status !== "verifying" && next.status !== "resolved";
      if (newWindow || transitionedToGood) {
        next.consecutiveGoodWindows += 1;
        next.lastEvaluatedCollectionEnd = comparison.fieldWindow.end;
        next.status = next.consecutiveGoodWindows >= 2 ? "resolved" : "verifying";
        if (next.status === "resolved") next.resolvedAt = now.toISOString();
      }
    } else if (metric.lab) {
      const explained = metric.lab.rating !== "Good"
        || hasMatchingLighthouseAudit(page, strategy, definition.lighthouseMetric, comparison.labCapturedAt);
      const wasInactive = next.status === "resolved" || next.status === "corroborated";
      const nextStatus = explained ? "corroborated" : wasInactive || next.status === "regressed" ? "regressed" : "active";
      if (newWindow || next.status !== nextStatus) {
        next.status = nextStatus;
        if (!explained && wasInactive) next.returnedAt = now.toISOString();
        next.consecutiveGoodWindows = 0;
        next.lastDetectedAt = now.toISOString();
        next.lastEvaluatedCollectionEnd = comparison.fieldWindow.end;
        delete next.resolvedAt;
      }
    }
    lifecycle[strategy] = next;
  }
  rec.fieldLifecycle = lifecycle;
  return before !== JSON.stringify(lifecycle);
}

/** Build one synthetic recommendation per exact-URL metric that lab did not reproduce or explain. */
export function fieldOnlyRecommendationsForPage(
  page: WatchPage,
  evidence: CruxPageEvidence[],
  now: Date,
  sourceRunId?: string,
): Rec[] {
  const byMetric = new Map<FieldOnlyMetricKey, Partial<Record<Strategy, FieldOnlyRecommendationSignal>>>();
  for (const strategy of ["mobile", "desktop"] as const) {
    const visitorEvidence = evidenceForPage(evidence, page.id, strategy);
    if (visitorEvidence?.status && !["available", "partial"].includes(visitorEvidence.status.status)) continue;
    const comparison = compareLabAndField(page.history, strategy, visitorEvidence);
    if (comparison.fieldWindow?.scope !== "url") continue;
    for (const metric of comparison.metrics) {
      if (metric.verdict !== "field-only-risk") continue;
      const definition = DEFINITIONS[metric.key];
      if (hasMatchingLighthouseAudit(page, strategy, definition.lighthouseMetric, comparison.labCapturedAt)) continue;
      const signal = retainedSignal(metric, now.toISOString(), comparison.fieldWindow);
      if (!signal) continue;
      const signals = byMetric.get(metric.key) ?? {};
      signals[strategy] = signal;
      byMetric.set(metric.key, signals);
    }
  }

  return [...byMetric.entries()].map(([metricKey, fieldSignals]): Rec => {
    const definition = DEFINITIONS[metricKey];
    const strategies = (["mobile", "desktop"] as const).filter((strategy) => !!fieldSignals[strategy]);
    return {
      key: `${page.id}:${definition.id}`,
      pageId: page.id,
      pageTitle: page.title,
      url: page.url,
      id: definition.id,
      source: "crux-field-only",
      strategies: [...strategies],
      fieldSignals,
      fieldLifecycle: Object.fromEntries(
        (Object.entries(fieldSignals) as [Strategy, FieldOnlyRecommendationSignal][])
          .map(([strategy, signal]) => [strategy, initialLifecycle(signal)]),
      ),
      sourceRunId,
      title: definition.title,
      category: "Performance",
      webflow: fieldOnlyClassification(definition.investigation),
      savings: "Field signal",
      estTime: costBand(`${definition.id} ${definition.title}`),
      status: "inbox",
      taskStatus: "todo",
      added: shortDate(now),
      doneDate: null,
      aiSummary: summary(fieldSignals, definition.investigation),
    };
  });
}

/** Upsert current field-only evidence without reopening ignored/completed user work. */
export function reconcileFieldOnlyRecommendationsInState(
  state: AppState,
  evidence: CruxPageEvidence[],
  now: Date,
  pageIds?: Iterable<string>,
  sourceRunId?: string,
): { created: number; updated: number } {
  const selected = pageIds ? new Set(pageIds) : null;
  let created = 0;
  let updated = 0;
  for (const page of state.pages) {
    if (selected && !selected.has(page.id)) continue;
    const lifecycleUpdates = new Set<string>();
    for (const existing of state.recs.filter((item) => item.pageId === page.id && item.source === "crux-field-only")) {
      if (evaluateExistingLifecycle(existing, page, evidence, now)) lifecycleUpdates.add(existing.key);
    }
    for (const candidate of fieldOnlyRecommendationsForPage(page, evidence, now, sourceRunId)) {
      const existing = state.recs.find((item) => item.key === candidate.key);
      if (!existing) {
        state.recs.push(candidate);
        created += 1;
        continue;
      }
      existing.source = "crux-field-only";
      existing.strategies = [...new Set([...(existing.strategies ?? []), ...(candidate.strategies ?? [])])];
      existing.fieldSignals = candidate.fieldSignals;
      existing.fieldLifecycle = {
        ...(candidate.fieldLifecycle ?? {}),
        ...(existing.fieldLifecycle ?? {}),
      };
      existing.webflow = candidate.webflow;
      existing.aiSummary = candidate.aiSummary;
      lifecycleUpdates.add(existing.key);
    }
    updated += lifecycleUpdates.size;
  }
  return { created, updated };
}

/** Data-store wrapper shared by app-side collection paths. */
export async function reconcileFieldOnlyRecommendations(
  dataStore: DataStore,
  pageId: string,
  now: Date,
  sourceRunId?: string,
): Promise<AppState> {
  const evidence = await dataStore.getCruxEvidence().catch(() => []);
  if (!evidence.length) return dataStore.getState();
  return dataStore.updateState((state) => {
    reconcileFieldOnlyRecommendationsInState(state, evidence, now, [pageId], sourceRunId);
  });
}
