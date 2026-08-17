import type {
  CulpritEvidence,
  CulpritEvidenceFact,
  CulpritEvidenceSource,
  CulpritEvidenceUnit,
  Night,
  Strategy,
} from "./types";
import { median } from "./scoring";

type UnknownRecord = Record<string, unknown>;

const TITLES: Record<string, string> = {
  "dom-size": "DOM structure",
  "unused-css-rules": "Unused CSS",
  "unused-javascript": "Unused JavaScript",
  "unminified-javascript": "Unminified JavaScript",
  "legacy-javascript": "Legacy JavaScript",
  "third-party-summary": "Third-party JavaScript",
  "render-blocking-resources": "Render-blocking resources",
  "render-blocking-insight": "Render-blocking resources",
  "uses-responsive-images": "Oversized images",
  "uses-optimized-images": "Image encoding waste",
  "largest-contentful-paint-element": "Largest Contentful Paint element",
};

/**
 * Audit IDs this module knows how to extract structured evidence for. Kept in
 * sync with `DOCUMENTED_WEBFLOW_AUDIT_IDS` in `webflowPerformance.ts` only by
 * a cross-module test (`culprit-evidence-catalog.test.ts`), since the two
 * catalogs are maintained independently for unrelated reasons.
 */
export const CULPRIT_EVIDENCE_AUDIT_IDS = Object.freeze(Object.keys(TITLES));

function record(value: unknown): UnknownRecord | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as UnknownRecord : null;
}

function records(value: unknown): UnknownRecord[] {
  return Array.isArray(value) ? value.flatMap((item) => record(item) ? [record(item)!] : []) : [];
}

function number(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function fact(key: string, label: string, value: number | undefined, unit: CulpritEvidenceUnit): CulpritEvidenceFact | null {
  return value === undefined ? null : { key, label, value: Math.round(value * 100) / 100, unit };
}

function compactFacts(values: Array<CulpritEvidenceFact | null>): CulpritEvidenceFact[] {
  return values.filter((value): value is CulpritEvidenceFact => value !== null);
}

function nestedItems(details: UnknownRecord): UnknownRecord[] {
  const top = records(details.items);
  return top.flatMap((item) => {
    const subItems = record(item.subItems);
    return [item, ...records(subItems?.items)];
  });
}

function safeHost(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  try {
    const host = new URL(value).hostname.toLowerCase().replace(/^www\./, "");
    return host && host.length <= 253 ? host : undefined;
  } catch {
    return undefined;
  }
}

function sourcesFor(items: UnknownRecord[]): CulpritEvidenceSource[] {
  const grouped = new Map<string, CulpritEvidenceSource>();
  for (const item of items) {
    const host = safeHost(item.url ?? item.source ?? item.request);
    if (!host) continue;
    const current = grouped.get(host) ?? { host };
    const transferBytes = number(item.transferSize ?? item.totalBytes);
    const blockingMs = number(item.blockingTime ?? item.mainThreadTime ?? item.wastedMs);
    if (transferBytes !== undefined) current.transferBytes = (current.transferBytes ?? 0) + transferBytes;
    if (blockingMs !== undefined) current.blockingMs = (current.blockingMs ?? 0) + blockingMs;
    grouped.set(host, current);
  }
  return [...grouped.values()]
    .sort((left, right) => (right.blockingMs ?? 0) - (left.blockingMs ?? 0) || (right.transferBytes ?? 0) - (left.transferBytes ?? 0))
    .slice(0, 3);
}

function domEvidence(details: UnknownRecord): CulpritEvidenceFact[] {
  const stats = new Map<string, number>();
  for (const item of nestedItems(details)) {
    if (typeof item.statistic !== "string") continue;
    const value = number(item.value);
    if (value !== undefined) stats.set(item.statistic.toLowerCase(), value);
  }
  const matching = (pattern: RegExp) => [...stats.entries()].find(([key]) => pattern.test(key))?.[1];
  return compactFacts([
    fact("nodes", "DOM nodes", matching(/total dom|dom elements|elements/), "count"),
    fact("depth", "Maximum depth", matching(/maximum dom depth|max.*depth/), "count"),
    fact("width", "Maximum children", matching(/maximum child|max.*child/), "count"),
  ]);
}

function bytesEvidence(details: UnknownRecord, items: UnknownRecord[]): CulpritEvidenceFact[] {
  const wastedBytes = number(details.overallSavingsBytes)
    ?? items.reduce((sum, item) => sum + (number(item.wastedBytes) ?? 0), 0);
  const totalBytes = items.reduce((sum, item) => sum + (number(item.totalBytes ?? item.transferSize) ?? 0), 0);
  const wastedPercent = totalBytes > 0 ? wastedBytes / totalBytes * 100 : undefined;
  return compactFacts([
    fact("wastedBytes", "Potential savings", wastedBytes, "bytes"),
    fact("totalBytes", "Inspected bytes", totalBytes || undefined, "bytes"),
    fact("wastedPercent", "Unused", wastedPercent, "percent"),
  ]);
}

function thirdPartyEvidence(items: UnknownRecord[]): CulpritEvidenceFact[] {
  return compactFacts([
    fact("transferBytes", "Transfer size", items.reduce((sum, item) => sum + (number(item.transferSize) ?? 0), 0), "bytes"),
    fact("mainThreadMs", "Main-thread time", items.reduce((sum, item) => sum + (number(item.mainThreadTime) ?? 0), 0), "milliseconds"),
    fact("blockingMs", "Blocking time", items.reduce((sum, item) => sum + (number(item.blockingTime) ?? 0), 0), "milliseconds"),
    fact("sources", "Third-party sources", new Set(items.map((item) => safeHost(item.url)).filter(Boolean)).size, "count"),
  ]).filter((item) => item.value > 0);
}

function renderBlockingEvidence(details: UnknownRecord, items: UnknownRecord[]): CulpritEvidenceFact[] {
  return compactFacts([
    fact("resources", "Blocking resources", items.filter((item) => typeof item.url === "string").length, "count"),
    fact("delayMs", "Potential delay", number(details.overallSavingsMs) ?? items.reduce((sum, item) => sum + (number(item.wastedMs) ?? 0), 0), "milliseconds"),
    fact("transferBytes", "Transfer size", items.reduce((sum, item) => sum + (number(item.totalBytes ?? item.transferSize) ?? 0), 0), "bytes"),
  ]).filter((item) => item.value > 0);
}

function elementType(item: UnknownRecord): string {
  const node = record(item.node);
  const snippet = typeof node?.snippet === "string" ? node.snippet : "";
  const match = /^\s*<([a-z][a-z\d-]*)\b/i.exec(snippet);
  return match?.[1]?.toLowerCase() ?? "element";
}

function extractOne(raw: unknown): CulpritEvidence[] {
  const lighthouse = record(record(raw)?.lighthouseResult);
  if (!lighthouse) return [];
  const warnings = Array.isArray(lighthouse.runWarnings) ? lighthouse.runWarnings.filter(Boolean) : [];
  if (warnings.length > 0) return [];
  const audits = record(lighthouse.audits) ?? {};
  return Object.entries(TITLES).flatMap(([auditId, title]): CulpritEvidence[] => {
    const audit = record(audits[auditId]);
    const details = record(audit?.details);
    if (!details) return [];
    const items = nestedItems(details);
    let facts: CulpritEvidenceFact[] = [];
    let sources: CulpritEvidenceSource[] | undefined;
    let lcpElement: CulpritEvidence["lcpElement"];

    if (auditId === "dom-size") facts = domEvidence(details);
    else if (auditId === "unused-css-rules" || auditId === "unused-javascript" || auditId === "unminified-javascript" || auditId === "legacy-javascript" || auditId === "uses-responsive-images" || auditId === "uses-optimized-images") {
      facts = bytesEvidence(details, items);
      sources = sourcesFor(items);
      const resourceLabel = auditId.startsWith("uses-") ? "Affected images" : auditId.includes("javascript") ? "Affected scripts" : "Affected stylesheets";
      facts.unshift({ key: "resources", label: resourceLabel, value: items.filter((item) => typeof item.url === "string").length, unit: "count" });
    } else if (auditId === "third-party-summary") {
      facts = thirdPartyEvidence(items);
      sources = sourcesFor(items);
    } else if (auditId === "render-blocking-resources" || auditId === "render-blocking-insight") {
      facts = renderBlockingEvidence(details, items);
      sources = sourcesFor(items);
    } else if (auditId === "largest-contentful-paint-element") {
      const item = items.find((candidate) => candidate.node) ?? items[0];
      if (item) {
        const node = record(item.node);
        const rect = record(node?.boundingRect);
        lcpElement = {
          elementType: elementType(item),
          assetHost: safeHost(item.url ?? node?.url),
          width: number(rect?.width),
          height: number(rect?.height),
        };
        facts = compactFacts([
          fact("width", "Rendered width", lcpElement.width, "pixels"),
          fact("height", "Rendered height", lcpElement.height, "pixels"),
        ]);
      }
    }
    if (facts.length === 0 && !lcpElement) return [];
    return [{ auditId, title, facts, sources: sources?.length ? sources : undefined, lcpElement, sampleRuns: 1 }];
  });
}

function medianOptional(values: Array<number | undefined>): number | undefined {
  const usable = values.filter((value): value is number => value !== undefined);
  return usable.length ? median(usable) : undefined;
}

/** Summarize only warning-free reports into a compact median evidence snapshot. */
export function summarizeCulpritEvidence(raws: unknown[] = []): CulpritEvidence[] {
  const uniqueRaws = raws.filter((raw, index) => {
    const fetchTime = record(record(raw)?.lighthouseResult)?.fetchTime;
    if (typeof fetchTime !== "string" || !fetchTime.trim()) return true;
    return raws.findIndex((candidate) => record(record(candidate)?.lighthouseResult)?.fetchTime === fetchTime) === index;
  });
  const captures = uniqueRaws.map(extractOne);
  const auditIds = new Set(captures.flatMap((capture) => capture.map((item) => item.auditId)));
  return [...auditIds].map((auditId): CulpritEvidence => {
    const observations = captures.flatMap((capture) => capture.filter((item) => item.auditId === auditId));
    const source = observations[0];
    const factKeys = new Set(observations.flatMap((item) => item.facts.map((entry) => entry.key)));
    const facts = [...factKeys].map((key): CulpritEvidenceFact => {
      const samples = observations.flatMap((item) => item.facts.filter((entry) => entry.key === key));
      return { ...samples[0], value: median(samples.map((item) => item.value)) };
    });
    const sourceHosts = new Set(observations.flatMap((item) => item.sources?.map((entry) => entry.host) ?? []));
    const sources = [...sourceHosts].map((host): CulpritEvidenceSource => ({
      host,
      transferBytes: medianOptional(observations.map((item) => item.sources?.find((entry) => entry.host === host)?.transferBytes)),
      blockingMs: medianOptional(observations.map((item) => item.sources?.find((entry) => entry.host === host)?.blockingMs)),
    })).sort((left, right) => (right.blockingMs ?? 0) - (left.blockingMs ?? 0) || (right.transferBytes ?? 0) - (left.transferBytes ?? 0)).slice(0, 3);
    const lcpSamples = observations.flatMap((item) => item.lcpElement ? [item.lcpElement] : []);
    const elementTypes = lcpSamples.map((item) => item.elementType);
    const lcpElement = lcpSamples.length ? {
      elementType: elementTypes.sort((left, right) => elementTypes.filter((value) => value === right).length - elementTypes.filter((value) => value === left).length)[0],
      assetHost: lcpSamples.find((item) => item.assetHost)?.assetHost,
      width: medianOptional(lcpSamples.map((item) => item.width)),
      height: medianOptional(lcpSamples.map((item) => item.height)),
    } : undefined;
    return { auditId, title: source.title, facts, sources: sources.length ? sources : undefined, lcpElement, sampleRuns: observations.length };
  });
}

export interface CulpritEvidenceTrend {
  evidence: CulpritEvidence;
  primary: CulpritEvidenceFact | undefined;
  series: number[];
  delta?: number;
}

const PRIMARY_FACTS: Record<string, string> = {
  "dom-size": "nodes",
  "unused-css-rules": "wastedPercent",
  "unused-javascript": "wastedBytes",
  "unminified-javascript": "wastedBytes",
  "legacy-javascript": "wastedBytes",
  "third-party-summary": "blockingMs",
  "render-blocking-resources": "delayMs",
  "render-blocking-insight": "delayMs",
  "uses-responsive-images": "wastedBytes",
  "uses-optimized-images": "wastedBytes",
  "largest-contentful-paint-element": "width",
};

/** See `CULPRIT_EVIDENCE_AUDIT_IDS`; kept in sync with `TITLES` by the same drift-guard test. */
export const CULPRIT_EVIDENCE_PRIMARY_FACT_AUDIT_IDS = Object.freeze(Object.keys(PRIMARY_FACTS));

export function culpritEvidenceTrends(history: Night[], strategy: Strategy): CulpritEvidenceTrend[] {
  const captures = [...history].sort((left, right) => left.i - right.i)
    .flatMap((night) => night.culpritEvidence?.[strategy] ? [{ night, evidence: night.culpritEvidence[strategy]! }] : []);
  const latest = captures.at(-1);
  if (!latest) return [];
  return latest.evidence.map((evidence) => {
    const key = PRIMARY_FACTS[evidence.auditId] ?? evidence.facts[0]?.key;
    const series = captures.flatMap((capture) => {
      const item = capture.evidence.find((candidate) => candidate.auditId === evidence.auditId);
      const value = item?.facts.find((candidate) => candidate.key === key)?.value;
      return value === undefined ? [] : [value];
    });
    return {
      evidence,
      primary: evidence.facts.find((item) => item.key === key),
      series,
      delta: series.length >= 2 ? series.at(-1)! - series.at(-2)! : undefined,
    };
  });
}

export function formatEvidenceValue(value: number, unit: CulpritEvidenceUnit): string {
  if (unit === "bytes") return value >= 1_048_576 ? `${(value / 1_048_576).toFixed(1)} MB` : `${Math.round(value / 1_024)} KB`;
  if (unit === "milliseconds") return value >= 1_000 ? `${(value / 1_000).toFixed(1)} s` : `${Math.round(value)} ms`;
  if (unit === "percent") return `${value.toFixed(1)}%`;
  if (unit === "pixels") return `${Math.round(value)} px`;
  return Math.round(value).toLocaleString("en-US");
}
